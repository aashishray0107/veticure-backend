/**
 * dietEngine.js
 * Generates a 7-day deterministic meal rotation plan.
 * Fully data-driven — reads all food data, rotation config, and limits from JSON.
 *
 * Fixes applied vs old version:
 *  - DIET_01: DB key corrected to 'Expanded_Food_Composition_Database' (no _v2)
 *  - DIET_02: Feeding frequency read from Age_Wise_Diet / Puppy_Month_By_Month_Nutrition
 *  - DIET_03/04: Protein portion caps use max_safe_percentage_of_total_meal from food DB
 *  - DIET_06: Therapeutic meals read from top-level Therapeutic_Meals_Module
 *  - DIET_07: Surmai weekly frequency capped at max_freq_per_week from food DB
 */

/* ─── Helpers ────────────────────────────────────────────────────────────── */

/** Get food data from DB; warn if missing */
function getFood(foodTable, name) {
  if (!name) return null;
  const food = foodTable[name];
  if (!food) console.warn(`[Diet Engine] Food not found in DB: "${name}"`);
  return food ?? null;
}

/** Estimate kcal from food macro data (ME formula) */
function estimateKcal(food, grams) {
  if (!food || !grams || grams <= 0) return 0;
  return (
    ((food.protein_g ?? 0) * 4) +
    ((food.fat_g     ?? 0) * 9) +
    ((food.carbs_g   ?? 0) * 4)
  ) * grams / 100;
}

/**
 * Resolve feeding frequency from JSON age-wise diet tables.
 * Checks Puppy_Month_By_Month_Nutrition_0_12M first, then Age_Wise_Diet.
 */
function resolveFeedingFrequency(ageMonths, engineData) {
  /* Puppy detailed table (0-12 months) */
  const puppyTable = engineData?.Puppy_Month_By_Month_Nutrition_0_12M || [];
  for (const entry of puppyTable) {
    if (
      ageMonths >= entry.min_age_months &&
      ageMonths < entry.max_age_months
    ) {
      const freq = entry.data?.Feeding_Frequency;
      if (typeof freq === "number") return freq;
    }
  }

  /* Age-wise diet table (all ages) */
  const ageWise = engineData?.Age_Wise_Diet || [];
  for (const entry of ageWise) {
    const minM = entry.min_age_months ?? 0;
    const maxM = entry.max_age_months ?? Infinity;
    if (ageMonths >= minM && ageMonths < maxM) {
      const freq = entry.data?.Feeding_Frequency;
      if (typeof freq === "number") return freq;
    }
  }

  /* Safe default */
  return 2;
}

/**
 * Resolve therapeutic carb override for symptomatic dogs.
 * Reads from top-level Therapeutic_Meals_Module per v1.2.2 JSON structure.
 */
function resolveTherapeuticCarb(symptoms, therapeuticModule, foodTable, fallbackCarb) {
  if (!Array.isArray(symptoms) || symptoms.length === 0) return fallbackCarb;
  if (!therapeuticModule) return fallbackCarb;

  let key = null;
  if (symptoms.includes("Loose_Stool") || symptoms.includes("Loose_Motion")) key = "GI_Support";
  else if (symptoms.includes("Constipation"))                                  key = "Digestive_Cooling";
  else if (symptoms.includes("Low_Appetite"))                                  key = "Recovery";
  else if (symptoms.includes("Vomiting"))                                      key = "GI_Support";

  if (!key) return fallbackCarb;

  const entry    = therapeuticModule[key];
  const mealName = Array.isArray(entry) ? entry[0] : (typeof entry === "string" ? entry : null);

  if (mealName) {
    return mealName;
  }
  return fallbackCarb;
}

/**
 * Compute safe max grams for a food given:
 *  - max_safe_percentage_of_total_meal from food DB
 *  - total estimated meal grams (calories / average kcal density)
 * Falls back to a generous absolute cap if not available.
 */
function computeMaxGrams(food, totalMealCalories, absoluteFallback = 400) {
  const pct = food?.max_safe_percentage_of_total_meal;
  if (pct && pct > 0 && totalMealCalories > 0) {
    /* Rough total meal grams estimate: calories / 1.3 kcal/g (blended density) */
    const estimatedTotalGrams = totalMealCalories / 1.3;
    return estimatedTotalGrams * pct;
  }
  return absoluteFallback;
}

/* ─── Main export ────────────────────────────────────────────────────────── */
/**
 * generateDietPlan
 *
 * @param {object} params
 * @param {object}  params.macros        {protein: g, fat: g, carbs: g}
 * @param {number}  params.calories      Final daily kcal
 * @param {string}  params.bcsCategory   "Ideal" | "Overweight" | ...
 * @param {number}  params.bodyWeight    kg
 * @param {number}  params.ageMonths     For feeding frequency lookup
 * @param {string}  params.lifeStage     Stage_Name from bcsEngine (for senior P substitution)
 * @param {string[]} params.symptoms     e.g. ["Loose_Motion"]
 * @param {object}  params.engineData    Full breed JSON dataset
 *
 * @returns {object[]} 7-day weekly plan
 */
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
  /* ── Guards ─────────────────────────────────────────────────────────────── */
  if (!engineData)                    throw new Error("engineData missing in diet engine");
  if (!bodyWeight || bodyWeight <= 0) throw new Error("Invalid bodyWeight in diet engine");
  if (!calories   || calories <= 0)   throw new Error("Invalid calories in diet engine");
  if (!macros)                        throw new Error("macros missing in diet engine");

  /* ── Resilient DB key lookup — supports both old (_v2) and new JSON schemas ─ */
  const foodDB =
    engineData?.Expanded_Food_Composition_Database       // v1.2.x (new)
    ?? engineData?.Expanded_Food_Composition_Database_v2  // legacy labrador / older breeds
    ?? null;

  if (!foodDB) {
    throw new Error(
      "Food composition database missing. Tried keys: " +
      "'Expanded_Food_Composition_Database' and 'Expanded_Food_Composition_Database_v2'. " +
      "Ensure the breed JSON contains one of these keys."
    );
  }
  if (!foodDB.Ingredients) {
    throw new Error("Food DB found but 'Ingredients' sub-key is missing.");
  }
  if (!foodDB.Diet_Rotation_Config) {
    throw new Error("Food DB found but 'Diet_Rotation_Config' sub-key is missing.");
  }

  const foodTable = foodDB.Ingredients;
  const rotation  = foodDB.Diet_Rotation_Config;

  /* ── Therapeutic meals — check all locations across old and new JSON schemas ─
   * v1.2.x : top-level Therapeutic_Meals_Module
   * legacy  : inside Expanded_Food_Composition_Database_v2.therapeutic_meals
   *           or .Therapeutic_Meals
   * ─────────────────────────────────────────────────────────────────────────── */
  const therapeuticModule =
    engineData?.Therapeutic_Meals_Module                                     // new top-level (v1.2.x)
    ?? engineData?.Expanded_Food_Composition_Database_v2?.therapeutic_meals  // legacy lowercase
    ?? engineData?.Expanded_Food_Composition_Database_v2?.Therapeutic_Meals  // legacy PascalCase
    ?? engineData?.Expanded_Food_Composition_Database?.therapeutic_meals     // new DB lowercase
    ?? engineData?.Expanded_Food_Composition_Database?.Therapeutic_Meals     // new DB PascalCase
    ?? null;

  /* ── Rotation lists ─────────────────────────────────────────────────────── */
  const vegProteins    = rotation.veg?.protein_sources || [];
  const nonVegProteins = rotation.non_veg_proteins     || [];
  const carbSources    = rotation.carb_sources         || [];
  const fiberSources   = rotation.fiber_sources        || [];

  if (!nonVegProteins.length) throw new Error("non_veg_proteins list empty in Diet_Rotation_Config");
  if (!carbSources.length)    throw new Error("carb_sources list empty in Diet_Rotation_Config");
  if (!fiberSources.length)   throw new Error("fiber_sources list empty in Diet_Rotation_Config");

  /* ── Feeding frequency from JSON ────────────────────────────────────────── */
  const feedingFrequency = resolveFeedingFrequency(ageMonths, engineData);

  /* ── Per-meal calorie target ─────────────────────────────────────────────── */
  const caloriesPerMeal  = calories / feedingFrequency;

  /* ── Macro targets ─────────────────────────────────────────────────────── */
  const proteinTarget = macros.protein ?? 0;
  const carbTarget    = macros.carbs   ?? 0;

  /* ── Surmai weekly frequency tracking ──────────────────────────────────── */
  const surmaiFoodNames = nonVegProteins.filter(n => n.toLowerCase().includes("surmai"));
  const surmai = surmaiFoodNames.length > 0 ? surmaiFoodNames[0] : null;
  const sormaiMaxPerWeek = surmai
    ? (foodTable[surmai]?.max_freq_per_week ?? 2)
    : 0;
  let   surmaiUsedCount = 0;

  /* ── Build 7-day plan ─────────────────────────────────────────────────── */
  const weeklyPlan = [];

  for (let day = 0; day < 7; day++) {

    /* ── Pick veg protein ─────────────────────────────────────────────── */
    const vegProtein = vegProteins.length > 0
      ? vegProteins[day % vegProteins.length]
      : null;

    /* ── Pick non-veg protein with Surmai cap enforcement ──────────────── */
    let nonVegProtein = nonVegProteins[day % nonVegProteins.length];

    /* If this slot would be Surmai but cap is hit, swap to next protein */
    if (
      surmai &&
      nonVegProtein === surmai &&
      surmaiUsedCount >= sormaiMaxPerWeek
    ) {
      const alternatives = nonVegProteins.filter(n => n !== surmai);
      nonVegProtein = alternatives[day % Math.max(alternatives.length, 1)];
    }

    if (nonVegProtein === surmai) surmaiUsedCount++;

    /* ── Pick carb with therapeutic override ──────────────────────────── */
    const baseCarb  = carbSources[day % carbSources.length];
    const carbFood  = resolveTherapeuticCarb(symptoms, therapeuticModule, foodTable, baseCarb);

    /* ── Get food data ─────────────────────────────────────────────────── */
    const vegData    = vegProtein ? getFood(foodTable, vegProtein) : null;
    const nonVegData = getFood(foodTable, nonVegProtein);
    const carbData   = getFood(foodTable, carbFood);

    if (!nonVegData || !carbData) {
      console.error(`[Diet Engine] Day ${day + 1}: Critical food missing. Skipping.`);
      continue;
    }

    /* ── Compute max grams per food using DB limits ─────────────────────── */
    const maxNonVegG = computeMaxGrams(nonVegData, calories);
    const maxCarbG   = computeMaxGrams(carbData,   calories);
    const maxVegG    = vegData ? computeMaxGrams(vegData, calories) : 0;

    /* ── Protein allocation ─────────────────────────────────────────────── */
    /* Veg protein: 20% of protein target (secondary source) */
    let vegQty = 0;
    if (vegData && (vegData.protein_g ?? 0) > 0) {
      vegQty = Math.min(
        (proteinTarget * 0.20 / vegData.protein_g) * 100,
        maxVegG
      );
    }

    const vegActual        = vegData ? (vegQty * (vegData.protein_g ?? 0)) / 100 : 0;
    const remainingProtein = Math.max(0, proteinTarget - vegActual);

    let nonVegQty = nonVegData.protein_g > 0
      ? Math.min(
          (remainingProtein / nonVegData.protein_g) * 100,
          maxNonVegG
        )
      : 0;

    /* ── Carb allocation ────────────────────────────────────────────────── */
    let carbQty = carbData.carbs_g > 0
      ? Math.min(
          (carbTarget / carbData.carbs_g) * 100,
          maxCarbG
        )
      : 0;

    /* ── Fiber allocation ───────────────────────────────────────────────── */
    /* Fiber is volume/GI-based — not calorie-proportional.
     * Target: ~5% of estimated total food volume, clamped to 30-120g.
     */
    const estimatedTotalFoodG = calories > 0 ? (calories / 1.1) : 500;
    let fiberQty = Math.max(30, Math.min(120, estimatedTotalFoodG * 0.05));

    /* ── Calorie correction factor ──────────────────────────────────────── */
    /* Scale protein and carb quantities so total estimated kcal ≈ target */
    const totalEstKcal =
      estimateKcal(vegData,    vegQty)    +
      estimateKcal(nonVegData, nonVegQty) +
      estimateKcal(carbData,   carbQty);

    if (totalEstKcal > 0) {
      const cf = calories / totalEstKcal;
      vegQty    = Math.min(vegQty    * cf, maxVegG);
      nonVegQty = Math.min(nonVegQty * cf, maxNonVegG);
      carbQty   = Math.min(carbQty   * cf, maxCarbG);
      /* Fiber stays independent of calorie correction */
    }

    /* ── Build per-meal objects ─────────────────────────────────────────── */
    const meals = [];

    for (let m = 1; m <= feedingFrequency; m++) {
      const fiberFood = fiberSources[(day + m - 1) % fiberSources.length];

      meals.push({
        meal_number:          m,
        veg_protein_food:     vegProtein   ?? null,
        veg_protein_grams:    vegProtein   ? Math.round(vegQty    / feedingFrequency) : 0,
        nonveg_protein_food:  nonVegProtein,
        nonveg_protein_grams: Math.round(nonVegQty / feedingFrequency),
        carb_food:            carbFood,
        carb_grams:           Math.round(carbQty   / feedingFrequency),
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
      surmai_used_this_week: surmaiUsedCount,
      meals,
    });
  }

  /* ── Senior Phosphorus Protein Substitution ──────────────────────────────
   * Runs AFTER the 7-day plan is built — purely additive, zero existing
   * logic is changed.
   *
   * Problem: home-cooked diets deliver ~0.82-0.92 g P/1000kcal which
   * exceeds the senior safe max of 0.50 g/1000kcal.
   *
   * Fix: for senior/geriatric stages, replace high-phosphorus nonveg
   * proteins (chicken, egg, fish) with the lowest-P protein available
   * in the food DB.  Grams are recalculated to preserve protein target.
   *
   * Source: Senior_Phosphorus_Control_Module in JSON.
   * Falls back gracefully if module or substitutes are missing.
   * ─────────────────────────────────────────────────────────────────────── */
  const SENIOR_STAGE_NAMES_DIET = new Set(["Early_Senior", "Senior", "Geriatric"]);
  const isSeniorDiet = lifeStage && SENIOR_STAGE_NAMES_DIET.has(lifeStage);

  if (isSeniorDiet) {
    const spModule   = engineData?.Senior_Phosphorus_Control_Module;
    const safeRange  = spModule?.Safe_Phosphorus_g_per_1000_kcal_Range ?? [0.40, 0.50];
    const P_MAX_PER_100G = 0.22; // foods above this threshold are "high-P"
                                 // (chicken ~0.24, egg ~0.18, fish ~0.22)

    /* Read substitutes from JSON — expected format: array of food name strings
     * e.g. ["Egg white boiled", "Paneer low fat"]
     * Falls back to anything in foodTable with phosphorus_g_per_100g < P_MAX_PER_100G */
    const jsonSubs = spModule?.Low_Phosphorus_Protein_Substitutes ?? [];

    /* Build effective substitute list: JSON-defined first, then fallback from DB */
    const effectiveSubs = jsonSubs.length > 0
      ? jsonSubs.filter(name => foodTable[name])
      : Object.entries(foodTable)
          .filter(([, food]) =>
            (food.protein_g ?? 0) > 5 &&           // has meaningful protein
            (food.phosphorus_g_per_100g ?? 1) < P_MAX_PER_100G
          )
          .sort((a, b) =>
            (a[1].phosphorus_g_per_100g ?? 0) - (b[1].phosphorus_g_per_100g ?? 0)
          )
          .map(([name]) => name);

    if (effectiveSubs.length > 0) {
      for (const day of weeklyPlan) {
        for (const meal of day.meals) {
          if (!meal.nonveg_protein_food) continue;

          const currentFoodData = foodTable[meal.nonveg_protein_food];
          if (!currentFoodData) continue;

          const currentP = currentFoodData.phosphorus_g_per_100g ?? 0;

          /* Only substitute if this food is a high-P source */
          if (currentP > P_MAX_PER_100G) {
            /* Find the lowest-P substitute that's not the current food */
            const sub = effectiveSubs.find(name => name !== meal.nonveg_protein_food);

            if (sub && foodTable[sub]) {
              const oldProteinPer100 = currentFoodData.protein_g ?? 0;
              const newProteinPer100 = foodTable[sub].protein_g  ?? 0;

              /* Recalculate grams so protein contribution stays the same */
              const newGrams = oldProteinPer100 > 0 && newProteinPer100 > 0
                ? Math.round(meal.nonveg_protein_grams * (oldProteinPer100 / newProteinPer100))
                : meal.nonveg_protein_grams;

              meal.nonveg_protein_food  = sub;
              meal.nonveg_protein_grams = newGrams;
              day.senior_p_substitution_applied = true;
            }
          }
        }
      }
    }
  }

  return weeklyPlan;
}