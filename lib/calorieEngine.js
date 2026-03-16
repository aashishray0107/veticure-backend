/* ─────────────────────────────────────────────────────────────────
   calorieEngine.js  — FIXED

   Bugs fixed:
   1. Activity normalization mismatch
      Old: normalize("Moderate") → "moderate" then compared to "high"/"low"
      Fix: Match the exact MER_Multipliers keys from JSON after normalizing both sides

   2. BCS calorie adjustment never fired
      Old: normalize(bcsCategory) → "ideal" but JSON key is "Ideal"
      Fix: Use the category string directly (comes from bcsEngine already correct-cased)

   3. Seasonal adjustment never fired
      Old: normalize("Normal") → "normal" but JSON key is "Normal"
      Fix: Same — use the season string directly, match JSON keys exactly

   4. Added RER floor safety clamp (was in JSON spec, missing in code)
─────────────────────────────────────────────────────────────────── */

function calculateRER(weight) {
  return 70 * Math.pow(weight, 0.75);
}

/* ─── Activity key resolver ───────────────────────────────────────
   JSON MER_Multipliers keys: "Low_Activity", "Moderate_Activity",
   "High_Activity", "Puppy_0_4_Months", "Puppy_4_12_Months"

   API activity input can be: "Low", "Moderate", "High",
   "Low_Activity", "Moderate_Activity", "High_Activity"
   We normalize both forms to the JSON key format.
─────────────────────────────────────────────────────────────────── */
function resolveActivityKey(activity) {
  if (!activity) return "Moderate_Activity";

  const a = activity.toLowerCase().trim();

  if (a === "high" || a === "high_activity")    return "High_Activity";
  if (a === "low"  || a === "low_activity")     return "Low_Activity";
  if (a === "working" || a === "working_dog")   return "Working_Dog";

  // Default: Moderate
  return "Moderate_Activity";
}

/* ─── Season key resolver ─────────────────────────────────────────
   JSON Seasonal_Adjustment_Engine keys:
   "Summer", "Winter", "Rainy", "Normal", "Humid", "Cold", "Hot"
   Capitalize first letter to match JSON exactly.
─────────────────────────────────────────────────────────────────── */
function resolveSeasonKey(season) {
  if (!season) return "Normal";
  // Capitalize first letter, lowercase rest to match JSON keys
  const s = season.trim();
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}

export function calculateCalories({
  weight,
  ageMonths,
  activity,
  season,
  symptoms = [],
  lifeStage,
  bcsCategory,
  engineData,
}) {

  if (!engineData) throw new Error("engineData missing in calorie engine");

  /* ── RER ── */
  const rer = calculateRER(weight);

  /* ── MER ── */
  const merMap = engineData.Energy_System?.MER_Multipliers;
  if (!merMap) throw new Error("Energy_System.MER_Multipliers missing");

  const activityKey = resolveActivityKey(activity);
  const isPuppy = ageMonths !== undefined && ageMonths <= 12;
  const isSenior = lifeStage?.toLowerCase().includes("senior");

  let selectedMER;

  if (isPuppy) {
    selectedMER =
      ageMonths < 4
        ? merMap.Puppy_0_4_Months
        : merMap.Puppy_4_12_Months;
  } else if (isSenior) {
    // Senior: activity-adjusted but conservative
    selectedMER =
      activityKey === "High_Activity" ? 1.4 :
      activityKey === "Low_Activity"  ? 1.2 :
      1.3;
  } else {
    selectedMER = merMap[activityKey] ?? merMap.Moderate_Activity;
  }

  if (!selectedMER) throw new Error(`MER not found for activity: ${activityKey}`);

  const baseCalories = rer * selectedMER;

  /* ── Adjustments ──────────────────────────────────────────────
     FIX: BCS and Season keys are used directly (correct case),
     not passed through normalize() which lowercased them causing
     every lookup to return undefined → zero adjustment.
  ────────────────────────────────────────────────────────────── */
  let totalAdjustment = 0;

  // BCS adjustment
  const weightAdj = engineData.Weight_Condition_Adjustment_Engine;
  // bcsCategory arrives as e.g. "Ideal", "Overweight" — matches JSON keys directly
  const bcsAdj = weightAdj?.[bcsCategory]?.Calorie_Adjustment_Percent;
  if (bcsAdj !== undefined) totalAdjustment += bcsAdj;

  // Seasonal adjustment
  const seasonalAdj = engineData.Seasonal_Adjustment_Engine;
  const seasonKey = resolveSeasonKey(season);
  const seasonAdjVal = seasonalAdj?.[seasonKey]?.Calorie_Adjustment_Percent;
  if (seasonAdjVal !== undefined) totalAdjustment += seasonAdjVal;

  // Symptom adjustment (bonus — not in original code)
  const symptomAdj = engineData.Master_Calorie_Adjustment_Pipeline?.Symptom_Adjustment;
  if (symptomAdj && Array.isArray(symptoms)) {
    for (const symptom of symptoms) {
      const adj = symptomAdj[symptom];
      if (adj !== undefined) totalAdjustment += adj;
    }
  }

  /* ── Global cap ── */
  const globalControl = engineData.Global_Adjustment_Controller;
  if (globalControl) {
    const maxPos = globalControl.max_total_positive_adjustment ?? 0.4;
    const maxNeg = globalControl.max_total_negative_adjustment ?? -0.4;
    totalAdjustment = Math.min(maxPos, Math.max(maxNeg, totalAdjustment));
  }

  let finalCalories = baseCalories * (1 + totalAdjustment);

  /* ── RER floor safety clamp (JSON spec: Final_kcal ≥ RER * 1.0) ── */
  if (finalCalories < rer) finalCalories = rer;

  /* ── Hydration ── */
  const waterML = weight * (engineData.Hydration_Adjustment_Engine?.Base_ml_per_kg ?? 55);

  return {
    rer:                Math.round(rer),
    selectedMER,
    baseCalories:       Math.round(baseCalories),
    finalDailyCalories: Math.round(finalCalories),
    dailyWaterML:       Math.round(waterML),
  };
}