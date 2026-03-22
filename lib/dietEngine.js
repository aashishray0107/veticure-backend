/**
 * dietEngine.js — VETiCure 7-day deterministic meal plan generator
 *
 * Architecture: fully data-driven from breed JSON
 * Clinical basis: NRC 2006, AAFCO 2023, WSAVA nutrition guidelines
 *
 * Fixed in this version:
 *  - DIET_01: Resilient DB key lookup (Expanded_Food_Composition_Database / _v2)
 *  - DIET_02: Feeding frequency from JSON age tables
 *  - DIET_03: Protein portion caps from food DB max_safe_percentage_of_total_meal
 *  - DIET_04: Therapeutic carb override without food DB lookup (meal names ≠ ingredients)
 *  - DIET_05: Senior P substitution restricted to PROTEIN categories only (not carbs/fiber)
 *  - DIET_06: Surmai weekly frequency cap enforced
 */

/* ─── Category sets ──────────────────────────────────────────────────────── */

/**
 * Only foods in these categories are eligible for senior P substitution.
 * Carb foods (category: "carb_base") must NEVER appear in nonveg_protein slot.
 */
const PROTEIN_CATEGORIES = new Set([
  "lean_animal_protein",
  "senior_low_phosphorus_protein",
  "controlled_organ",
  "veg_protein",
  "dairy_protein",
  "plant_protein_carb",  // dal — dual use but eligible
]);

/* ─── Helpers ────────────────────────────────────────────────────────────── */

function getFood(foodTable, name) {
  if (!name) return null;
  const food = foodTable[name];
  if (!food) console.warn(`[Diet] Food not found: "${name}"`);
  return food ?? null;
}

function estimateKcal(food, grams) {
  if (!food || !grams || grams <= 0) return 0;
  return (
    ((food.protein_g ?? 0) * 4) +
    ((food.fat_g     ?? 0) * 9) +
    ((food.carbs_g   ?? 0) * 4)
  ) * grams / 100;
}

function resolveFeedingFrequency(ageMonths, engineData) {
  const puppyTable = engineData?.Puppy_Month_By_Month_Nutrition_0_12M ?? [];
  for (const e of puppyTable) {
    if (ageMonths >= e.min_age_months && ageMonths < e.max_age_months) {
      const f = e.data?.Feeding_Frequency;
      if (typeof f === "number") return f;
    }
  }
  const ageWise = engineData?.Age_Wise_Diet ?? [];
  for (const e of ageWise) {
    const min = e.min_age_months ?? 0;
    const max = e.max_age_months ?? Infinity;
    if (ageMonths >= min && ageMonths < max) {
      const f = e.data?.Feeding_Frequency;
      if (typeof f === "number") return f;
    }
  }
  return 2;
}

function resolveTherapeuticCarb(symptoms, therapeuticModule, fallbackCarb) {
  if (!Array.isArray(symptoms) || symptoms.length === 0) return fallbackCarb;
  if (!therapeuticModule) return fallbackCarb;

  let key = null;
  if (symptoms.includes("Loose_Motion") || symptoms.includes("Loose_Stool") || symptoms.includes("Vomiting")) {
    key = "GI_Support";
  } else if (symptoms.includes("Constipation")) {
    key = "Digestive_Cooling";
  } else if (symptoms.includes("Low_Appetite")) {
    key = "Recovery";
  }

  if (!key) return fallbackCarb;

  const entry = therapeuticModule[key];
  // Therapeutic_Meals_Module values are arrays or strings — meal names, NOT ingredient keys
  const mealName = Array.isArray(entry) ? entry[0] : (typeof entry === "string" ? entry : null);
  return mealName ?? fallbackCarb;
}

function computeMaxGrams(food, totalCalories, fallback = 400) {
  const pct = food?.max_safe_percentage_of_total_meal;
  if (pct && pct > 0 && totalCalories > 0) {
    return (totalCalories / 1.3) * pct;
  }
  return fallback;
}

/* ─── Main export ────────────────────────────────────────────────────────── */

export function generateDietPlan({
  macros,
  calories,
  bcsCategory,
  bodyWeight,
  ageMonths = 24,
  lifeStage = null,
  symptoms = [],
  engineData,
}) {
  /* Guards */
  if (!engineData)                    throw new Error("engineData missing in diet engine");
  if (!bodyWeight || bodyWeight <= 0) throw new Error("Invalid bodyWeight");
  if (!calories   || calories <= 0)   throw new Error("Invalid calories");
  if (!macros)                        throw new Error("macros missing");

  /* Resilient DB key */
  const foodDB =
    engineData?.Expanded_Food_Composition_Database
    ?? engineData?.Expanded_Food_Composition_Database_v2
    ?? null;

  if (!foodDB)           throw new Error("Food DB missing. Expected 'Expanded_Food_Composition_Database' or '_v2'.");
  if (!foodDB.Ingredients)        throw new Error("Food DB 'Ingredients' missing.");
  if (!foodDB.Diet_Rotation_Config) throw new Error("Food DB 'Diet_Rotation_Config' missing.");

  const foodTable = foodDB.Ingredients;
  const rotation  = foodDB.Diet_Rotation_Config;

  /* Therapeutic module — check all JSON locations */
  const therapeuticModule =
    engineData?.Therapeutic_Meals_Module
    ?? engineData?.Expanded_Food_Composition_Database_v2?.therapeutic_meals
    ?? engineData?.Expanded_Food_Composition_Database_v2?.Therapeutic_Meals
    ?? engineData?.Expanded_Food_Composition_Database?.therapeutic_meals
    ?? engineData?.Expanded_Food_Composition_Database?.Therapeutic_Meals
    ?? null;

  const vegProteins    = rotation.veg?.protein_sources ?? [];
  const nonVegProteins = rotation.non_veg_proteins     ?? [];
  const carbSources    = rotation.carb_sources         ?? [];
  const fiberSources   = rotation.fiber_sources        ?? [];

  if (!nonVegProteins.length) throw new Error("non_veg_proteins empty in Diet_Rotation_Config");
  if (!carbSources.length)    throw new Error("carb_sources empty in Diet_Rotation_Config");
  if (!fiberSources.length)   throw new Error("fiber_sources empty in Diet_Rotation_Config");

  const feedingFrequency = resolveFeedingFrequency(ageMonths, engineData);
  const proteinTarget    = macros.protein ?? 0;
  const carbTarget       = macros.carbs   ?? 0;

  /* Surmai cap */
  const surmai = nonVegProteins.find(n => n.toLowerCase().includes("surmai")) ?? null;
  const surmaiMax = surmai ? (foodTable[surmai]?.max_freq_per_week ?? 2) : 0;
  let   surmaiCount = 0;

  /* ── Build 7-day plan ──────────────────────────────────────────────────── */
  const weeklyPlan = [];

  for (let day = 0; day < 7; day++) {

    const vegProtein = vegProteins.length > 0
      ? vegProteins[day % vegProteins.length]
      : null;

    let nonVegProtein = nonVegProteins[day % nonVegProteins.length];
    if (surmai && nonVegProtein === surmai && surmaiCount >= surmaiMax) {
      const alts = nonVegProteins.filter(n => n !== surmai);
      nonVegProtein = alts[day % Math.max(alts.length, 1)];
    }
    if (nonVegProtein === surmai) surmaiCount++;

    const baseCarb = carbSources[day % carbSources.length];
    const carbFood = resolveTherapeuticCarb(symptoms, therapeuticModule, baseCarb);

    const vegData    = vegProtein ? getFood(foodTable, vegProtein) : null;
    const nonVegData = getFood(foodTable, nonVegProtein);
    // Therapeutic carb (Khichdi/Daliya/Curd rice) may not be in ingredient DB
    // Fall back to baseCarb if therapeutic meal name not found
    const resolvedCarbFood = getFood(foodTable, carbFood) ? carbFood : baseCarb;
    const carbData = getFood(foodTable, resolvedCarbFood);

    if (!nonVegData || !carbData) {
      console.error(`[Diet] Day ${day + 1}: critical food missing — skipping`);
      continue;
    }

    const maxNonVegG = computeMaxGrams(nonVegData, calories);
    const maxCarbG   = computeMaxGrams(carbData,   calories);
    const maxVegG    = vegData ? computeMaxGrams(vegData, calories) : 0;

    /* Protein allocation */
    let vegQty = 0;
    if (vegData && (vegData.protein_g ?? 0) > 0) {
      vegQty = Math.min((proteinTarget * 0.20 / vegData.protein_g) * 100, maxVegG);
    }
    const vegActual        = vegData ? (vegQty * (vegData.protein_g ?? 0)) / 100 : 0;
    const remainingProtein = Math.max(0, proteinTarget - vegActual);

    let nonVegQty = nonVegData.protein_g > 0
      ? Math.min((remainingProtein / nonVegData.protein_g) * 100, maxNonVegG)
      : 0;

    /* Carb allocation */
    let carbQty = carbData.carbs_g > 0
      ? Math.min((carbTarget / carbData.carbs_g) * 100, maxCarbG)
      : 0;

    /* Fiber allocation — volume-based, independent of calorie math */
    const estimatedTotalFoodG = calories / 1.1;
    let fiberQty = Math.max(30, Math.min(120, estimatedTotalFoodG * 0.05));

    /* Calorie correction */
    const totalEstKcal =
      estimateKcal(vegData, vegQty) +
      estimateKcal(nonVegData, nonVegQty) +
      estimateKcal(carbData, carbQty);

    if (totalEstKcal > 0) {
      const cf = calories / totalEstKcal;
      vegQty    = Math.min(vegQty    * cf, maxVegG);
      nonVegQty = Math.min(nonVegQty * cf, maxNonVegG);
      carbQty   = Math.min(carbQty   * cf, maxCarbG);
    }

    const meals = [];
    for (let m = 1; m <= feedingFrequency; m++) {
      const fiberFood = fiberSources[(day + m - 1) % fiberSources.length];
      meals.push({
        meal_number:          m,
        veg_protein_food:     vegProtein ?? null,
        veg_protein_grams:    vegProtein ? Math.round(vegQty    / feedingFrequency) : 0,
        nonveg_protein_food:  nonVegProtein,
        nonveg_protein_grams: Math.round(nonVegQty / feedingFrequency),
carb_food:            resolvedCarbFood,        carb_grams:           Math.round(carbQty   / feedingFrequency),
        fiber_food:           fiberFood,
        fiber_grams:          Math.round(fiberQty  / feedingFrequency),
      });
    }

    weeklyPlan.push({
      day:                   day + 1,
      target_calories:       calories,
      target_protein_g:      proteinTarget,
      target_carbs_g:        carbTarget,
      target_fat_g:          macros.fat ?? 0,
      feeding_frequency:     feedingFrequency,
therapeutic_override:  carbFood !== baseCarb ? carbFood : null,
      // Note: therapeutic meal shown as label even if not in ingredient DB      surmai_used_this_week: surmaiCount,
      meals,
    });
  }

  /* ── Senior Phosphorus Protein Substitution ──────────────────────────────
   *
   * Clinical basis: NRC 2006 — senior dogs benefit from restricted dietary
   * phosphorus to reduce renal workload. Safe range: 0.40-0.50 g/1000kcal.
   *
   * CRITICAL FIX: only substitute foods in PROTEIN_CATEGORIES.
   * Carb foods (roti, rice, dal-as-carb) must never replace a protein source.
   * ─────────────────────────────────────────────────────────────────────── */
  const SENIOR_STAGES = new Set(["Early_Senior", "Senior", "Geriatric"]);
  const isSenior = lifeStage && SENIOR_STAGES.has(lifeStage);

  /* Senior P substitution only if JSON module requires it (not warn-only mode)
   * GR JSON: Warn_Only = true → skip substitution, warn in calciumEngine only
   * Labrador JSON: Hard_Guard requires renal_support_required flag
   */
  const spModuleCheck = engineData?.Senior_Phosphorus_Control_Module;
  const isWarnOnly    = spModuleCheck?.Warn_Only === true;
  const requiresRenal = spModuleCheck?.Substitution_Requires_Renal_Flag === true;

  if (isSenior && !isWarnOnly && !requiresRenal) {
    const spModule      = engineData?.Senior_Phosphorus_Control_Module;
    const P_MAX_PER_100G = 0.22; // g P per 100g food — above this = high-P source

    /* Build substitute list from JSON or DB fallback.
     * FILTER: must be a protein-category food, not a carb/fiber food. */
    const jsonSubs = spModule?.Low_Phosphorus_Protein_Substitutes ?? [];

    const effectiveSubs = jsonSubs.length > 0
      ? jsonSubs.filter(name => {
          const f = foodTable[name];
          return f && PROTEIN_CATEGORIES.has(f.category ?? "");
        })
      : Object.entries(foodTable)
          .filter(([, food]) => {
            const isProteinCat = PROTEIN_CATEGORIES.has(food.category ?? "");
            const hasProtein   = (food.protein_g ?? 0) > 5;
            const isLowP       = (food.phosphorus_g_per_100g ?? 1) < P_MAX_PER_100G;
            return isProteinCat && hasProtein && isLowP;
          })
          .sort((a, b) =>
            (a[1].phosphorus_g_per_100g ?? 0) - (b[1].phosphorus_g_per_100g ?? 0)
          )
          .map(([name]) => name);

    if (effectiveSubs.length > 0) {
      for (const day of weeklyPlan) {
        for (const meal of day.meals) {
          if (!meal.nonveg_protein_food) continue;

          const currentFood = foodTable[meal.nonveg_protein_food];
          if (!currentFood) continue;

          /* Only substitute actual high-P protein foods */
          const isProtein = PROTEIN_CATEGORIES.has(currentFood.category ?? "");
          const isHighP   = (currentFood.phosphorus_g_per_100g ?? 0) > P_MAX_PER_100G;

          if (!isProtein || !isHighP) continue;

          const sub = effectiveSubs.find(name => name !== meal.nonveg_protein_food);
          if (!sub || !foodTable[sub]) continue;

          const oldP100 = currentFood.protein_g     ?? 0;
          const newP100 = foodTable[sub].protein_g  ?? 0;

          meal.nonveg_protein_food  = sub;
          meal.nonveg_protein_grams = (oldP100 > 0 && newP100 > 0)
            ? Math.round(meal.nonveg_protein_grams * (oldP100 / newP100))
            : meal.nonveg_protein_grams;

          day.senior_p_substitution_applied = true;
        }
      }
    }
  }

  return weeklyPlan;
}