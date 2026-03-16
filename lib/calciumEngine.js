/* ═══════════════════════════════════════════════════════════════════
   calciumEngine.js

   Handles three jobs in sequence, exactly as the JSON spec defines:

   1. MINERAL COMPUTATION
      Sums actual Ca and P from every ingredient in the day's meals.
      Uses calcium_g_per_100g and phosphorus_g_per_100g from the
      food DB. Calculates Ca:P ratio and Ca per 1000 kcal.

   2. CALCIUM SUPPLEMENTATION (growth stages only)
      If diet calcium falls below the NRC minimum (3.0g/1000kcal
      for large-breed growth), calculates how much Calcium Carbonate
      to add. Enforces Ca:P ratio [1.1–1.4] via bounded adjustment loop.
      Never activates for Adult or Senior — those stages have wider
      Ca tolerance and supplementation risks hypercalcemia.

   3. SENIOR PHOSPHORUS CONTROL
      For Early_Senior, Senior, Geriatric stages: flags if phosphorus
      exceeds the safe ceiling (0.5g/1000kcal). Returns a warning
      and the offending ingredient for dietary adjustment.

   OUTPUT STRUCTURE:
   {
     minerals: {
       total_calcium_g, total_phosphorus_g,
       calcium_per_1000kcal, phosphorus_per_1000kcal,
       ca_to_p_ratio
     },
     calcium_supplement: {
       required: bool,
       source: string,
       supplement_grams_per_day: number,
       calcium_added_g: number,
       final_calcium_g: number,
       final_ca_to_p_ratio: number,
       status: "sufficient"|"supplemented"|"growth_only_not_applicable",
       warning: string|null
     },
     phosphorus_control: {
       senior_check_required: bool,
       phosphorus_per_1000kcal: number,
       within_safe_range: bool,
       ceiling_g_per_1000kcal: 0.5,
       warning: string|null
     },
     lifecycle_validation: {
       is_growth_stage: bool,
       is_senior_stage: bool,
       ca_per_1000kcal_range: [min, max],
       ca_per_1000kcal_status: "below"|"within"|"above"
     }
   }

   REFERENCES:
   NRC (2006) — Ca 3.0–4.5 g/1000 kcal ME for large-breed growth
   AAFCO 2023 — Ca:P ratio 1.1:1 to 1.4:1 during growth
   JSON: Calcium_Supplementation_Module, Mineral_Computation_Engine,
         Senior_Phosphorus_Control_Module, Nutrient_Standards
═══════════════════════════════════════════════════════════════════ */

/* ─── Growth stage names (from JSON Lifecycle_Restriction) ──────── */
const GROWTH_STAGES = new Set([
  "Socialization_Puppy",
  "Early_Puppy",
  "Juvenile_I",
  "Juvenile_II",
  "Juvenile_III",
  "Adolescence_Early",
  "Adolescence_Mid",
  "Adolescence_Late",
]);

/* ─── Senior stage names (from JSON Lifecycle_Activation) ───────── */
const SENIOR_STAGES = new Set([
  "Early_Senior",
  "Senior",
  "Geriatric",
]);

/* ─── Ca and P per 1000 kcal targets (NRC/AAFCO for large breed) ── */
const GROWTH_CA_MIN_PER_1000KCAL = 3.0;
const GROWTH_CA_MAX_PER_1000KCAL = 4.5;
const CA_TO_P_MIN = 1.1;
const CA_TO_P_MAX = 1.4;
const SENIOR_P_MAX_PER_1000KCAL  = 0.5;
const SENIOR_P_MIN_PER_1000KCAL  = 0.3;

/* ═══════════════════════════════════════════════════════════════════
   STEP 1 — MINERAL COMPUTATION
   Reads actual grams of each ingredient per day and sums Ca + P.
   Accepts a flat array of { food_name, grams } for the full day.
═══════════════════════════════════════════════════════════════════ */
function computeMinerals({ dailyIngredients, finalDailyCalories, foodTable }) {

  let totalCaG  = 0;
  let totalPhG  = 0;

  for (const { food_name, grams } of dailyIngredients) {

    const food = foodTable[food_name];

    if (!food) {
      console.warn(`[CALCIUM WARN] Food not found in DB: "${food_name}" — skipping mineral calc`);
      continue;
    }

    const caContrib = (food.calcium_g_per_100g    ?? 0) * grams / 100;
    const phContrib = (food.phosphorus_g_per_100g ?? 0) * grams / 100;

    totalCaG += caContrib;
    totalPhG += phContrib;
  }

  const caP1000   = finalDailyCalories > 0
    ? (totalCaG / finalDailyCalories) * 1000
    : 0;

  const phP1000   = finalDailyCalories > 0
    ? (totalPhG / finalDailyCalories) * 1000
    : 0;

  const caToP = totalPhG > 0
    ? totalCaG / totalPhG
    : null;

  return {
    total_calcium_g:         Number(totalCaG.toFixed(4)),
    total_phosphorus_g:      Number(totalPhG.toFixed(4)),
    calcium_per_1000kcal:    Number(caP1000.toFixed(3)),
    phosphorus_per_1000kcal: Number(phP1000.toFixed(3)),
    ca_to_p_ratio:           caToP !== null ? Number(caToP.toFixed(3)) : null,
  };
}

/* ═══════════════════════════════════════════════════════════════════
   STEP 2 — CALCIUM SUPPLEMENTATION
   Only runs for growth stages.
   Implements the JSON Calcium_Supplementation_Module exactly:
     - Deficit detection
     - Source selection (Calcium_Carbonate_Food_Grade default)
     - Bounded Ca:P ratio protection loop (max 20 iterations)
     - Overdose protection
═══════════════════════════════════════════════════════════════════ */
function calculateCalciumSupplement({
  minerals,
  finalDailyCalories,
  bodyWeight,
  lifeStage,
  engineData,
}) {

  const isGrowth = GROWTH_STAGES.has(lifeStage);

  /* Adults and seniors: supplementation not applicable.
     Return a clean informational block, not an error. */
  if (!isGrowth) {
    return {
      required:                    false,
      source:                      null,
      supplement_grams_per_day:    0,
      calcium_added_g:             0,
      final_calcium_g:             minerals.total_calcium_g,
      final_ca_to_p_ratio:         minerals.ca_to_p_ratio,
      status:                      "growth_only_not_applicable",
      warning:                     null,
    };
  }

  /* ── Load supplement sources from JSON ── */
  const suppModule = engineData.Calcium_Supplementation_Module;
  if (!suppModule) throw new Error("Calcium_Supplementation_Module missing in JSON");

  const sources = suppModule.Sources || [];

  /* Default source: Calcium_Carbonate_Food_Grade (JSON spec: deterministic selection) */
  const selectedSource = sources.find(
    s => s.name === "Calcium_Carbonate_Food_Grade"
  ) || sources[0];

  if (!selectedSource) throw new Error("No calcium supplement source found in JSON");

  /* ── Deficit detection ────────────────────────────────────────────
     Formula from JSON:
     Calcium_Deficit_g = max(0,
       (Ca_min_per_1000kcal * finalDailyCalories / 1000) - currentCa_g
     )
  ── */
  const caTarget = (GROWTH_CA_MIN_PER_1000KCAL * finalDailyCalories) / 1000;
  const deficit  = Math.max(0, caTarget - minerals.total_calcium_g);

  if (deficit === 0) {
    /* Already meeting minimum — check it's not exceeding max either */
    const caMax = (GROWTH_CA_MAX_PER_1000KCAL * finalDailyCalories) / 1000;

    if (minerals.total_calcium_g > caMax) {
      return {
        required:                 false,
        source:                   null,
        supplement_grams_per_day: 0,
        calcium_added_g:          0,
        final_calcium_g:          minerals.total_calcium_g,
        final_ca_to_p_ratio:      minerals.ca_to_p_ratio,
        status:                   "sufficient",
        warning:                  `Calcium exceeds safe maximum (${caMax.toFixed(2)}g). ` +
                                  `Reduce high-calcium ingredients. Vet review recommended.`,
      };
    }

    return {
      required:                 false,
      source:                   null,
      supplement_grams_per_day: 0,
      calcium_added_g:          0,
      final_calcium_g:          minerals.total_calcium_g,
      final_ca_to_p_ratio:      minerals.ca_to_p_ratio,
      status:                   "sufficient",
      warning:                  null,
    };
  }

  /* ── Initial supplement gram calculation ── */
  const suppGramsRaw = deficit / selectedSource.calcium_g_per_gram;

  /* ── Overdose protection: cap at max_safe_gram_per_kg_bodyweight ── */
  const maxSafeGrams = selectedSource.max_safe_gram_per_kg_bodyweight * bodyWeight;
  let suppGrams = Math.min(suppGramsRaw, maxSafeGrams);

  /* ── Ca:P ratio protection loop (JSON spec: max 20 iterations) ──
     After adding supplement, recalculate Ca:P.
     If Ca:P > 1.4: reduce supplement by 0.05g decrements.
     If Ca:P < 1.1 after adding: flag for vet — don't auto-increase P.
  ── */
  const MAX_ITERATIONS = 20;
  let   finalCaG       = minerals.total_calcium_g + (suppGrams * selectedSource.calcium_g_per_gram);
  let   finalPhG       = minerals.total_phosphorus_g + (suppGrams * (selectedSource.phosphorus_g_per_gram ?? 0));
  let   finalCaToP     = finalPhG > 0 ? finalCaG / finalPhG : null;
  let   warning        = null;
  let   iterations     = 0;

  while (
    finalCaToP !== null &&
    finalCaToP > CA_TO_P_MAX &&
    suppGrams > 0 &&
    iterations < MAX_ITERATIONS
  ) {
    suppGrams  = Math.max(0, suppGrams - 0.05);
    finalCaG   = minerals.total_calcium_g + (suppGrams * selectedSource.calcium_g_per_gram);
    finalPhG   = minerals.total_phosphorus_g + (suppGrams * (selectedSource.phosphorus_g_per_gram ?? 0));
    finalCaToP = finalPhG > 0 ? finalCaG / finalPhG : null;
    iterations++;
  }

  /* Ca:P below minimum after adjustment — flag for vet */
  if (finalCaToP !== null && finalCaToP < CA_TO_P_MIN) {
    warning =
      `Ca:P ratio (${finalCaToP.toFixed(2)}) is below safe minimum (${CA_TO_P_MIN}). ` +
      `Manual vet adjustment required. Do not auto-increase phosphorus.`;
  }

  /* Overdose check post-loop */
  const finalCaPer1000 = (finalCaG / finalDailyCalories) * 1000;
  if (finalCaPer1000 > GROWTH_CA_MAX_PER_1000KCAL) {
    warning =
      `Calcium per 1000 kcal (${finalCaPer1000.toFixed(2)}g) exceeds safe maximum ` +
      `(${GROWTH_CA_MAX_PER_1000KCAL}g). Reduce supplement or review diet. Vet required.`;
  }

  return {
    required:                    suppGrams > 0,
    source:                      selectedSource.name,
    supplement_grams_per_day:    Number(suppGrams.toFixed(2)),
    calcium_added_g:             Number((suppGrams * selectedSource.calcium_g_per_gram).toFixed(4)),
    final_calcium_g:             Number(finalCaG.toFixed(4)),
    final_phosphorus_g:          Number(finalPhG.toFixed(4)),
    final_calcium_per_1000kcal:  Number(finalCaPer1000.toFixed(3)),
    final_ca_to_p_ratio:         finalCaToP !== null ? Number(finalCaToP.toFixed(3)) : null,
    ratio_iterations_used:       iterations,
    status:                      suppGrams > 0 ? "supplemented" : "sufficient",
    warning,
  };
}

/* ═══════════════════════════════════════════════════════════════════
   STEP 3 — SENIOR PHOSPHORUS CONTROL
   For Early_Senior, Senior, Geriatric:
   Check if phosphorus exceeds 0.5g/1000kcal.
   Returns a warning with the offending ingredient if found.
   Does NOT auto-substitute (that's a diet engine job) —
   it flags and reports for the diet engine to act on.
═══════════════════════════════════════════════════════════════════ */
function checkSeniorPhosphorus({
  minerals,
  finalDailyCalories,
  lifeStage,
  dailyIngredients,
  foodTable,
}) {

  const isSenior = SENIOR_STAGES.has(lifeStage);

  if (!isSenior) {
    return {
      senior_check_required:   false,
      phosphorus_per_1000kcal: minerals.phosphorus_per_1000kcal,
      within_safe_range:       true,
      warning:                 null,
      high_phosphorus_foods:   [],
    };
  }

  const phP1000       = minerals.phosphorus_per_1000kcal;
  const withinRange   = phP1000 >= SENIOR_P_MIN_PER_1000KCAL &&
                        phP1000 <= SENIOR_P_MAX_PER_1000KCAL;

  /* Identify the highest-P foods for flagging */
  const phFoods = dailyIngredients
    .map(({ food_name, grams }) => {
      const food = foodTable[food_name];
      if (!food) return null;
      const phDensity = food.phosphorus_g_per_100g ?? 0;
      return { food_name, grams, phosphorus_g_per_100g: phDensity };
    })
    .filter(Boolean)
    .sort((a, b) => b.phosphorus_g_per_100g - a.phosphorus_g_per_100g)
    .slice(0, 3); // top 3 highest-P ingredients

  let warning = null;

  if (phP1000 > SENIOR_P_MAX_PER_1000KCAL) {
    warning =
      `Phosphorus (${phP1000.toFixed(2)}g/1000kcal) exceeds senior safe ceiling ` +
      `(${SENIOR_P_MAX_PER_1000KCAL}g/1000kcal). ` +
      `Consider replacing "${phFoods[0]?.food_name}" with a lower-phosphorus protein. ` +
      `Renal health risk for senior dogs. Vet review recommended.`;
  }

  if (phP1000 < SENIOR_P_MIN_PER_1000KCAL) {
    warning =
      `Phosphorus (${phP1000.toFixed(2)}g/1000kcal) is below the senior minimum ` +
      `(${SENIOR_P_MIN_PER_1000KCAL}g/1000kcal). Review protein sources.`;
  }

  return {
    senior_check_required:   true,
    phosphorus_per_1000kcal: Number(phP1000.toFixed(3)),
    within_safe_range:       withinRange,
    safe_range:              [SENIOR_P_MIN_PER_1000KCAL, SENIOR_P_MAX_PER_1000KCAL],
    warning,
    high_phosphorus_foods:   phFoods,
  };
}

/* ═══════════════════════════════════════════════════════════════════
   HELPER — Build dailyIngredients array from weekly_diet_plan day
   Accepts a single day object from the diet plan and flattens
   all meals into a single { food_name, grams } list for mineral calc.
   Combines grams across meals for the same food (correct approach —
   minerals are computed on daily totals, not per meal).
═══════════════════════════════════════════════════════════════════ */
export function buildDailyIngredients(dayPlan) {

  const totals = {};

  for (const meal of dayPlan.meals) {

    const foods = [
      { name: meal.veg_protein_food,   grams: meal.veg_protein_grams   },
      { name: meal.nonveg_protein_food, grams: meal.nonveg_protein_grams },
      { name: meal.carb_food,           grams: meal.carb_grams           },
      { name: meal.fiber_food,          grams: meal.fiber_grams          },
    ];

    for (const { name, grams } of foods) {
      if (!name || !grams) continue;
      totals[name] = (totals[name] ?? 0) + grams;
    }
  }

  return Object.entries(totals).map(([food_name, grams]) => ({ food_name, grams }));
}

/* ═══════════════════════════════════════════════════════════════════
   MAIN EXPORT — calculateCalcium
   Called once per day plan (or for the representative Day 1).
   Returns the full calcium report.

   Parameters:
   {
     dayPlan           — one day object from weekly_diet_plan
     finalDailyCalories — from calorie_report
     bodyWeight        — input weight in kg
     lifeStage         — from bcs_report.life_stage_detected
     engineData        — full breed JSON
   }
═══════════════════════════════════════════════════════════════════ */
export function calculateCalcium({
  dayPlan,
  finalDailyCalories,
  bodyWeight,
  lifeStage,
  engineData,
}) {

  if (!engineData) throw new Error("engineData missing in calcium engine");
  if (!dayPlan)    throw new Error("dayPlan missing in calcium engine");
  if (!lifeStage)  throw new Error("lifeStage missing in calcium engine");

  const foodTable = engineData.Expanded_Food_Composition_Database_v2?.Ingredients;
  if (!foodTable)  throw new Error("Food DB Ingredients missing");

  /* Build flat daily ingredient list */
  const dailyIngredients = buildDailyIngredients(dayPlan);

  /* Step 1 — Compute actual minerals */
  const minerals = computeMinerals({
    dailyIngredients,
    finalDailyCalories,
    foodTable,
  });

  /* Step 2 — Calcium supplementation (growth only) */
  const calciumSupplement = calculateCalciumSupplement({
    minerals,
    finalDailyCalories,
    bodyWeight,
    lifeStage,
    engineData,
  });

  /* Step 3 — Senior phosphorus control */
  const phosphorusControl = checkSeniorPhosphorus({
    minerals,
    finalDailyCalories,
    lifeStage,
    dailyIngredients,
    foodTable,
  });

  /* Lifecycle validation summary */
  const isGrowth = GROWTH_STAGES.has(lifeStage);
  const isSenior = SENIOR_STAGES.has(lifeStage);

  let caStatus = "within";
  if (minerals.calcium_per_1000kcal < GROWTH_CA_MIN_PER_1000KCAL) caStatus = "below";
  if (minerals.calcium_per_1000kcal > GROWTH_CA_MAX_PER_1000KCAL) caStatus = "above";

  return {
    minerals,

    calcium_supplement: calciumSupplement,

    phosphorus_control: phosphorusControl,

    lifecycle_validation: {
      life_stage:              lifeStage,
      is_growth_stage:         isGrowth,
      is_senior_stage:         isSenior,
      ca_per_1000kcal_range:   [GROWTH_CA_MIN_PER_1000KCAL, GROWTH_CA_MAX_PER_1000KCAL],
      ca_per_1000kcal_actual:  minerals.calcium_per_1000kcal,
      ca_per_1000kcal_status:  caStatus,
    },
  };
}