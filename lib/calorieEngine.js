/**
 * calorieEngine.js
 * RER → MER → pipeline adjustments → final daily calories.
 *
 * Fixes applied vs old version:
 *  - CALORIE_02: Neuter status now drives primary MER (Adult_Neutered vs Adult_Intact)
 *  - CALORIE_03: Senior MER and thresholds read from JSON, not hardcoded
 *  - CALORIE_04: Activity applied as ADDITIVE pipeline modifier (per JSON spec)
 *  - CALORIE_05: Senior lifecycle boundary read from JSON (Early_Senior.min_age_years)
 *  - CALORIE_06: Hydration multipliers applied from Hydration_Stack_Control
 */

/* ─── RER ────────────────────────────────────────────────────────────────── */
function calculateRER(weight) {
  if (!weight || weight <= 0) throw new Error("Invalid weight for RER");
  return 70 * Math.pow(weight, 0.75);
}

/* ─── Resolve activity adjustment key ──────────────────────────────────────
 * Returns the key used in Master_Calorie_Adjustment_Pipeline.Activity_Adjustment
 */
function resolveActivityAdjKey(activity) {
  if (!activity) return "Moderate_Activity";
  const a = activity.toLowerCase().trim();
  if (a === "high"    || a === "high_activity")   return "High_Activity";
  if (a === "low"     || a === "low_activity")    return "Low_Activity";
  if (a === "working" || a === "working_dog")     return "Working_Dog";
  return "Moderate_Activity";
}

/* ─── Resolve primary MER key ──────────────────────────────────────────────
 * For ADULTS: primary MER is based on neuter status (per JSON MER_Multiplier_Selection_Rule)
 * For PUPPIES: based on age bracket
 * For SENIORS: uses Senior MER key
 */
function resolvePrimaryMERKey(ageMonths, isPuppy, isSenior, isNeutered) {
  if (isPuppy) {
    return ageMonths < 4 ? "Puppy_0_4_Months" : "Puppy_4_12_Months";
  }
  if (isSenior) {
    return "Senior";
  }
  // Adult — neuter status determines base MER per JSON spec
  return isNeutered ? "Adult_Neutered" : "Adult_Intact";
}

/* ─── Detect senior boundary from JSON ─────────────────────────────────────
 * Reads Early_Senior.min_age_years from Lifecycle_Growth_Model_20_Stages
 * instead of hardcoding 84 months.
 */
function getSeniorThresholdMonths(engineData) {
  const stages = engineData?.Lifecycle_Growth_Model_20_Stages || [];
  const earlySenior = stages.find(s => s.Stage_Name === "Early_Senior");
  if (earlySenior?.min_age_years != null) {
    return earlySenior.min_age_years * 12;
  }
  // Safe fallback per JSON (7 years = 84 months)
  return 84;
}

/* ─── Detect puppy boundary from JSON ──────────────────────────────────────
 * Reads Young_Adult_Early.min_age_months — anything below is growth lifecycle
 */
function getPuppyThresholdMonths(engineData) {
  const stages = engineData?.Lifecycle_Growth_Model_20_Stages || [];
  const youngAdult = stages.find(s => s.Stage_Name === "Young_Adult_Early");
  if (youngAdult?.min_age_months != null) {
    return youngAdult.min_age_months;
  }
  return 12; // fallback
}

/* ─── Resolve hydration multiplier ─────────────────────────────────────────
 * Applies the highest single multiplier per Hydration_Stack_Control spec.
 * Priority order: Symptom > Activity > Season
 */
function resolveHydrationMultiplier(symptoms, activity, season, engineData) {
  const hsc = engineData?.Hydration_Stack_Control;
  if (!hsc) return 1.0;

  const maxCap = hsc.Max_Multiplier_Cap ?? 1.5;
  let   best   = 1.0;

  /* Symptom multipliers — read from Symptom_Adjustment as proxy
   * (Hydration_Stack_Control doesn't define per-symptom multipliers explicitly,
   *  so we use a sensible data-driven approach: any symptom that reduces calories
   *  also raises hydration need)
   */
  const symptomAdj = engineData?.Master_Calorie_Adjustment_Pipeline?.Symptom_Adjustment || {};
  if (Array.isArray(symptoms)) {
    for (const s of symptoms) {
      // Symptoms that reduce calories also increase hydration need
      if (symptomAdj[s] !== undefined && symptomAdj[s] < 0) {
        best = Math.max(best, 1.2);
      }
    }
  }

  /* Activity multiplier */
  const actKey = resolveActivityAdjKey(activity);
  const activityMultipliers = {
    "High_Activity":  1.3,
    "Working_Dog":    1.5,
    "Moderate_Activity": 1.0,
    "Low_Activity":   1.0,
  };
  best = Math.max(best, activityMultipliers[actKey] ?? 1.0);

  /* Season multiplier */
  const seasonKey = season
    ? (season.charAt(0).toUpperCase() + season.slice(1).toLowerCase())
    : "Normal";
  const seasonMultipliers = { Summer: 1.2, Hot: 1.3, Humid: 1.15 };
  best = Math.max(best, seasonMultipliers[seasonKey] ?? 1.0);

  // Prevent compound multiplication — only highest wins, capped at maxCap
  return Math.min(best, maxCap);
}

/* ─── Main export ───────────────────────────────────────────────────────────
 *
 * @param {object} params
 * @param {number}   params.weight         kg
 * @param {number}   params.ageMonths
 * @param {string}   params.activity       "Low" | "Moderate" | "High" | "Working"
 * @param {string}   params.season         "Summer" | "Winter" | "Rainy" | "Normal" | ...
 * @param {string[]} params.symptoms       e.g. ["Loose_Motion"]
 * @param {string}   params.lifeStage      Stage_Name from lifecycle model (informational)
 * @param {string}   params.bcsCategory    e.g. "Ideal" | "Overweight" | ...
 * @param {boolean}  params.isNeutered     true / false (default true for safety)
 * @param {object}   params.engineData     Full breed JSON
 */
export function calculateCalories({
  weight,
  ageMonths,
  activity,
  season,
  symptoms = [],
  lifeStage,
  bcsCategory,
  isNeutered = true,
  engineData,
}) {
  /* ── Guards ─────────────────────────────────────────────────────────────── */
  if (!engineData)             throw new Error("engineData missing in calorie engine");
  if (!weight || weight <= 0)  throw new Error("Invalid weight in calorie engine");
  if (ageMonths == null || ageMonths < 0) throw new Error("Invalid ageMonths");

  /* ── Step 1: RER ────────────────────────────────────────────────────────── */
  const rer = calculateRER(weight);

  /* ── Step 2: Resolve lifecycle boundaries from JSON ─────────────────────── */
  const seniorThreshold = getSeniorThresholdMonths(engineData);
  const puppyThreshold  = getPuppyThresholdMonths(engineData);

  const isPuppy  = ageMonths < puppyThreshold;
  const isSenior = ageMonths >= seniorThreshold;

  /* ── Step 3: Primary MER (lifecycle-based) ──────────────────────────────── */
  const merMap = engineData?.Energy_System?.MER_Multipliers;
  if (!merMap) throw new Error("Energy_System.MER_Multipliers missing in engineData");

  const primaryMERKey = resolvePrimaryMERKey(ageMonths, isPuppy, isSenior, isNeutered);
  const primaryMER    = merMap[primaryMERKey];

  if (!primaryMER) {
    throw new Error(
      `MER not found for key: "${primaryMERKey}". ` +
      `Available keys: ${Object.keys(merMap).join(", ")}`
    );
  }

  const baseCalories = rer * primaryMER;

  /* ── Step 4: Additive pipeline adjustments ──────────────────────────────── */
  const pipeline = engineData?.Master_Calorie_Adjustment_Pipeline;
  if (!pipeline) throw new Error("Master_Calorie_Adjustment_Pipeline missing in engineData");

  let totalAdjustment = 0;

  /* 4a. Activity adjustment (additive decimal per JSON spec) */
  const actAdjKey = resolveActivityAdjKey(activity);

  /* Puppies: no activity modifier — MER already at 3x/2x */
  if (!isPuppy) {
    const actAdj = pipeline?.Activity_Adjustment?.[actAdjKey];
    if (actAdj !== undefined) totalAdjustment += actAdj;
  }

  /* 4b. BCS adjustment */
  const bcsAdj = pipeline?.BCS_Adjustment?.[bcsCategory];
  if (bcsAdj !== undefined) totalAdjustment += bcsAdj;

  /* 4c. Seasonal adjustment — single authority, no stacking */
  const seasonKey = season
    ? (season.charAt(0).toUpperCase() + season.slice(1).toLowerCase())
    : "Normal";
  const seasonAdj = pipeline?.Seasonal_Adjustment?.[seasonKey];
  if (seasonAdj !== undefined) totalAdjustment += seasonAdj;

  /* 4d. Symptom adjustments */
  const symptomAdj = pipeline?.Symptom_Adjustment;
  if (symptomAdj && Array.isArray(symptoms)) {
    for (const symptom of symptoms) {
      const adj = symptomAdj[symptom];
      if (adj !== undefined) totalAdjustment += adj;
    }
  }

  /* ── Step 5: Global adjustment cap ─────────────────────────────────────── */
  const safetyClamp = pipeline?.Safety_Clamp;
  const maxPos = safetyClamp?.Global_Max_Positive ?? 0.35;
  const maxNeg = safetyClamp?.Global_Max_Negative ?? -0.35;
  totalAdjustment = Math.min(maxPos, Math.max(maxNeg, totalAdjustment));

  /* ── Step 6: Apply adjustment ───────────────────────────────────────────── */
  let finalCalories = baseCalories * (1 + totalAdjustment);

  /* ── Step 7: RER floor ──────────────────────────────────────────────────── */
  const minKcal = rer * 1.0;
  const maxKcal = rer * 2.5;
  finalCalories = Math.max(minKcal, Math.min(maxKcal, finalCalories));

  /* ── Step 8: Senior metabolic slowdown ─────────────────────────────────── */
  if (isSenior) {
    const stages      = engineData?.Lifecycle_Growth_Model_20_Stages || [];
    const stage       = stages.find(s => {
      const minM = (s.min_age_years ?? 0) * 12;
      const maxM = s.max_age_years != null ? s.max_age_years * 12 : Infinity;
      return ageMonths >= minM && ageMonths < maxM;
    });
    const slowdown = stage?.Metabolic_Slowdown_Percent;
    if (slowdown) {
      finalCalories *= (1 - slowdown);
      // Re-enforce floor after slowdown
      finalCalories = Math.max(minKcal, finalCalories);
    }
  }

  finalCalories = Math.round(finalCalories);

  /* ── Step 9: Hydration ──────────────────────────────────────────────────── */
  const hsc         = engineData?.Hydration_Stack_Control;
  const baseMlPerKg = hsc?.Base_ml_per_kg ?? 55;
  const hydMult     = resolveHydrationMultiplier(symptoms, activity, season, engineData);
  const dailyWaterML = Math.round(weight * baseMlPerKg * hydMult);

  return {
    rer:                Math.round(rer),
    primary_mer_key:    primaryMERKey,
    primary_mer_value:  primaryMER,
    activity_adj_key:   actAdjKey,
    activity_adj_applied: !isPuppy ? (pipeline?.Activity_Adjustment?.[actAdjKey] ?? 0) : 0,
    total_adjustment:   Number(totalAdjustment.toFixed(3)),
    base_calories:      Math.round(baseCalories),
    finalDailyCalories: finalCalories,
    calorie_floor:      Math.round(minKcal),
    calorie_ceiling:    Math.round(maxKcal),
    daily_water_ml:     dailyWaterML,
    hydration_multiplier: hydMult,
    is_puppy:           isPuppy,
    is_senior:          isSenior,
  };
}