/**
 * calciumEngine.js
 * Computes mineral totals from a daily diet plan, then applies Ca supplementation
 * and senior phosphorus control per the JSON engine spec.
 *
 * Fixes applied vs old version:
 *  - CALCIUM_01: P_MIN / P_MAX now read from JSON Senior_Phosphorus_Control_Module
 *  - CALCIUM_02: All constants moved inside functions — no module-level engineData access
 *  - CALCIUM_03: DB key corrected to 'Expanded_Food_Composition_Database' (no _v2)
 *  - CALCIUM_05: suppGrams clamped to ≥ 0 to prevent negative supplement
 */

/* ─── Stage sets (static Stage_Name strings — not data-dependent) ─────────── */
const GROWTH_STAGE_NAMES = new Set([
  "Socialization_Puppy", "Early_Puppy",
  "Juvenile_I", "Juvenile_II", "Juvenile_III",
  "Adolescence_Early", "Adolescence_Mid", "Adolescence_Late",
]);

const SENIOR_STAGE_NAMES = new Set([
  "Early_Senior", "Senior", "Geriatric",
]);

/* ─── buildDailyIngredients ──────────────────────────────────────────────── */
/**
 * Flatten a dayPlan's meals into {food_name, grams} aggregates.
 * Handles all 4 food slot types: veg_protein, nonveg_protein, carb, fiber.
 */
export function buildDailyIngredients(dayPlan) {
  if (!dayPlan?.meals?.length) return [];

  const totals = {};

  for (const meal of dayPlan.meals) {
    const slots = [
      { name: meal.veg_protein_food,    grams: meal.veg_protein_grams    },
      { name: meal.nonveg_protein_food, grams: meal.nonveg_protein_grams },
      { name: meal.carb_food,           grams: meal.carb_grams           },
      { name: meal.fiber_food,          grams: meal.fiber_grams          },
    ];

    for (const { name, grams } of slots) {
      if (!name || !grams || grams <= 0) continue;
      totals[name] = (totals[name] ?? 0) + grams;
    }
  }

  return Object.entries(totals).map(([food_name, grams]) => ({ food_name, grams }));
}

/* ─── computeMinerals ────────────────────────────────────────────────────── */
function computeMinerals(dailyIngredients, finalDailyCalories, foodTable) {
  let totalCa = 0;
  let totalP  = 0;

  for (const { food_name, grams } of dailyIngredients) {
    const food = foodTable[food_name];
    if (!food) {
      console.warn(`[Ca Engine] Food not found in DB: "${food_name}" — skipping mineral calc`);
      continue;
    }

    totalCa += (food.calcium_g_per_100g    ?? 0) * grams / 100;
    totalP  += (food.phosphorus_g_per_100g ?? 0) * grams / 100;
  }

  const calcium_per_1000kcal    = finalDailyCalories > 0
    ? (totalCa / finalDailyCalories) * 1000
    : 0;
  const phosphorus_per_1000kcal = finalDailyCalories > 0
    ? (totalP  / finalDailyCalories) * 1000
    : 0;
  const ca_to_p_ratio           = totalP > 0 ? totalCa / totalP : null;

  return {
    total_calcium_g:          Number(totalCa.toFixed(4)),
    total_phosphorus_g:       Number(totalP.toFixed(4)),
    calcium_per_1000kcal:     Number(calcium_per_1000kcal.toFixed(3)),
    phosphorus_per_1000kcal:  Number(phosphorus_per_1000kcal.toFixed(3)),
    ca_to_p_ratio:            ca_to_p_ratio !== null ? Number(ca_to_p_ratio.toFixed(3)) : null,
  };
}

/* ─── calcSupplement ─────────────────────────────────────────────────────── */
function calcSupplement(minerals, finalDailyCalories, bodyWeight, lifeStage, engineData) {

  const suppModule = engineData?.Calcium_Supplementation_Module;
  if (!suppModule) throw new Error("Calcium_Supplementation_Module missing in engineData");

  /* Read targets from JSON */
  const targets  = suppModule.Targets;
  const CA_MIN   = targets?.calcium_per_1000kcal_min     ?? 3.0;
  const CA_MAX   = targets?.calcium_per_1000kcal_max     ?? 4.5;
  const CA_OPT   = targets?.calcium_per_1000kcal_optimal ?? (CA_MIN + CA_MAX) / 2;
  const CAP_MIN  = targets?.ca_to_p_ratio_min            ?? 1.1;
  const CAP_MAX  = targets?.ca_to_p_ratio_max            ?? 1.4;

  /* Read adult monitoring threshold */
  const adultCaMin = suppModule?.Adult_Ca_Monitoring?.Alert_If_Ca_per_1000kcal_Below ?? 1.25;

  /* Determine if we are in a growth stage */
  const isGrowth = GROWTH_STAGE_NAMES.has(lifeStage);
  const isAdult  = !isGrowth && !SENIOR_STAGE_NAMES.has(lifeStage);

  /* Choose effective minimum based on lifecycle */
  const effectiveCaMin = isGrowth ? CA_MIN : adultCaMin;

  /* Select calcium source (prefer Calcium_Carbonate_Food_Grade) */
  const source =
    suppModule.Sources?.find(s => s.name === "Calcium_Carbonate_Food_Grade") ||
    suppModule.Sources?.[0];

  if (!source) throw new Error("No calcium supplement source defined in JSON");

  const maxAllowed = source.max_safe_gram_per_kg_bodyweight * bodyWeight;

  /* Target calcium absolute grams */
  const targetCaGrams = (CA_OPT * finalDailyCalories) / 1000;

  let suppGrams  = 0;
  let finalCa    = minerals.total_calcium_g;
  let finalP     = minerals.total_phosphorus_g;
  let finalRatio = finalP > 0 ? finalCa / finalP : null;
  let warning    = null;
  let alertOnly  = false;

  /* ── For adult/senior: alert mode only (no auto-add) ────────────────────── */
  if (!isGrowth) {
    const currentCaPer1000 = minerals.calcium_per_1000kcal;
    alertOnly = true;

    if (currentCaPer1000 < adultCaMin) {
      warning = `Adult/Senior Ca deficit: ${currentCaPer1000.toFixed(2)} g/1000kcal ` +
                `(NRC minimum: ${adultCaMin}). ` +
                `Recommend Calcium_Carbonate_Food_Grade 0.5-1g/day — confirm with user.`;
    }

    return {
      required:                   false,
      alert_only:                 alertOnly,
      source:                     source.name,
      supplement_grams_per_day:   0,
      calcium_added_g:            0,
      final_calcium_g:            Number(finalCa.toFixed(4)),
      final_phosphorus_g:         Number(finalP.toFixed(4)),
      final_calcium_per_1000kcal: Number(minerals.calcium_per_1000kcal.toFixed(3)),
      final_ca_to_p_ratio:        finalRatio !== null ? Number(finalRatio.toFixed(3)) : null,
      status:                     warning ? "adult_ca_alert" : "sufficient",
      warning,
    };
  }

  /* ── Growth stage: auto-supplementation ──────────────────────────────────── */

  /* STEP 1 — Reach optimal calcium target */
  if (finalCa < targetCaGrams) {
    const deficit = targetCaGrams - finalCa;
    suppGrams = deficit / source.calcium_g_per_gram;
  }

  suppGrams = Math.min(suppGrams, maxAllowed);
  suppGrams = Math.max(0, suppGrams); // never negative

  finalCa    = minerals.total_calcium_g + (suppGrams * source.calcium_g_per_gram);
  finalRatio = finalP > 0 ? finalCa / finalP : null;

  /* STEP 2 — Fix LOW Ca:P ratio (add more Ca) */
  if (finalRatio !== null && finalRatio < CAP_MIN) {
    const requiredCa = CAP_MIN * finalP;
    const deficit    = requiredCa - finalCa;

    if (deficit > 0) {
      const extraGrams = deficit / source.calcium_g_per_gram;
      suppGrams        = Math.min(suppGrams + extraGrams, maxAllowed);
      suppGrams        = Math.max(0, suppGrams);

      finalCa    = minerals.total_calcium_g + (suppGrams * source.calcium_g_per_gram);
      finalRatio = finalP > 0 ? finalCa / finalP : null;
    }

    warning = `Low Ca:P corrected → ${finalRatio?.toFixed(2) ?? "N/A"}`;
  }

  /* STEP 3 — Fix HIGH Ca:P ratio (reduce supplement, never go negative) */
  if (finalRatio !== null && finalRatio > CAP_MAX) {
    const maxCa    = CAP_MAX * finalP;
    const neededCa = maxCa - minerals.total_calcium_g;

    // suppGrams is the additional Ca we add. If food Ca alone exceeds maxCa, no supplement.
    suppGrams  = neededCa > 0 ? neededCa / source.calcium_g_per_gram : 0;
    suppGrams  = Math.max(0, Math.min(suppGrams, maxAllowed)); // clamp [0, maxAllowed]

    finalCa    = minerals.total_calcium_g + (suppGrams * source.calcium_g_per_gram);
    finalRatio = finalP > 0 ? finalCa / finalP : null;

    warning = `High Ca:P corrected → ${finalRatio?.toFixed(2) ?? "N/A"}`;
  }

  /* STEP 4 — Overdose protection */
  const finalCaPer1000 = finalDailyCalories > 0
    ? (finalCa / finalDailyCalories) * 1000
    : 0;

  if (finalCaPer1000 > CA_MAX) {
    warning = `Ca above maximum (${finalCaPer1000.toFixed(2)} > ${CA_MAX}). Reduce supplement.`;
  } else if (finalCaPer1000 < CA_MIN) {
    warning = (warning ? warning + " | " : "") +
              `Ca still below minimum (${finalCaPer1000.toFixed(2)} < ${CA_MIN}). ` +
              `Maxed supplement — vet review needed.`;
  }

  return {
    required:                   suppGrams > 0,
    alert_only:                 false,
    source:                     source.name,
    supplement_grams_per_day:   Number(suppGrams.toFixed(2)),
    calcium_added_g:            Number((suppGrams * source.calcium_g_per_gram).toFixed(4)),
    final_calcium_g:            Number(finalCa.toFixed(4)),
    final_phosphorus_g:         Number(finalP.toFixed(4)),
    final_calcium_per_1000kcal: Number(finalCaPer1000.toFixed(3)),
    final_ca_to_p_ratio:        finalRatio !== null ? Number(finalRatio.toFixed(3)) : null,
    targets_used: { CA_MIN, CA_MAX, CA_OPT, CAP_MIN, CAP_MAX },
    status:       suppGrams > 0 ? "supplemented" : "sufficient",
    warning,
  };
}

/* ─── checkSeniorP ───────────────────────────────────────────────────────── */
function checkSeniorP(minerals, lifeStage, engineData) {

  if (!SENIOR_STAGE_NAMES.has(lifeStage)) {
    return {
      senior_check_required:  false,
      phosphorus_per_1000kcal: minerals.phosphorus_per_1000kcal,
      within_safe_range:      true,
      warning:                null,
    };
  }

  /* Read safe range from JSON */
  const spModule = engineData?.Senior_Phosphorus_Control_Module;
  const range    = spModule?.Safe_Phosphorus_g_per_1000_kcal_Range;

  const P_MIN = Array.isArray(range) ? range[0] : 0.40;
  const P_MAX = Array.isArray(range) ? range[1] : 0.50;

  const p   = minerals.phosphorus_per_1000kcal;
  const ok  = p >= P_MIN && p <= P_MAX;

  let warning = null;
  if (p > P_MAX) {
    warning = `Senior P too high: ${p.toFixed(3)} g/1000kcal (max ${P_MAX}). ` +
              `Trigger protein source substitution per Senior_Phosphorus_Control_Module.`;
  } else if (p < P_MIN) {
    warning = `Senior P below floor: ${p.toFixed(3)} g/1000kcal (min ${P_MIN}). ` +
              `Values below ${spModule?.Vet_Override_Floor ?? 0.30} require vet override.`;
  }

  return {
    senior_check_required:  true,
    phosphorus_per_1000kcal: Number(p.toFixed(3)),
    safe_range:             [P_MIN, P_MAX],
    within_safe_range:      ok,
    warning,
  };
}

/* ─── calculateCalcium (main export) ─────────────────────────────────────── */
/**
 * @param {object} params
 * @param {object}  params.dayPlan              Day 1 from weekly diet plan
 * @param {number}  params.finalDailyCalories   From calorieEngine
 * @param {number}  params.bodyWeight           kg
 * @param {string}  params.lifeStage            Stage_Name from lifecycle model
 * @param {object}  params.engineData           Full breed JSON dataset
 */
export function calculateCalcium({
  dayPlan,
  finalDailyCalories,
  bodyWeight,
  lifeStage,
  engineData,
}) {
  /* ── Guards ─────────────────────────────────────────────────────────────── */
  if (!engineData)           throw new Error("engineData missing in calcium engine");
  if (!dayPlan)              throw new Error("dayPlan missing in calcium engine");
  if (!finalDailyCalories || finalDailyCalories <= 0) {
    throw new Error("Invalid finalDailyCalories in calcium engine");
  }
  if (!bodyWeight || bodyWeight <= 0) throw new Error("Invalid bodyWeight in calcium engine");

  /* ── Resilient DB key lookup — supports both old (_v2) and new JSON schemas ─
   * v1.2.x: Expanded_Food_Composition_Database (no suffix)
   * legacy : Expanded_Food_Composition_Database_v2
   * ─────────────────────────────────────────────────────────────────────────── */
  const foodDB =
    engineData?.Expanded_Food_Composition_Database
    ?? engineData?.Expanded_Food_Composition_Database_v2
    ?? null;

  const foodTable = foodDB?.Ingredients ?? null;

  if (!foodTable) {
    throw new Error(
      "Food composition database Ingredients missing in calciumEngine. " +
      "Tried: 'Expanded_Food_Composition_Database.Ingredients' and " +
      "'Expanded_Food_Composition_Database_v2.Ingredients'."
    );
  }

  /* ── Run pipeline ────────────────────────────────────────────────────────── */
  const dailyIngredients   = buildDailyIngredients(dayPlan);
  const minerals           = computeMinerals(dailyIngredients, finalDailyCalories, foodTable);
  const calcium_supplement = calcSupplement(
    minerals, finalDailyCalories, bodyWeight, lifeStage, engineData
  );
  const phosphorus_control = checkSeniorP(minerals, lifeStage, engineData);

  return {
    daily_ingredients_used: dailyIngredients,
    minerals,
    calcium_supplement,
    phosphorus_control,
  };
}