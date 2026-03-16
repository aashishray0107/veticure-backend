function calculateRER(weight) {
  return 70 * Math.pow(weight, 0.75);
}

function resolveActivityKey(activity) {
  if (!activity) return "Moderate_Activity";
  const a = activity.toLowerCase().trim();
  if (a === "high" || a === "high_activity")  return "High_Activity";
  if (a === "low"  || a === "low_activity")   return "Low_Activity";
  if (a === "working" || a === "working_dog") return "Working_Dog";
  return "Moderate_Activity";
}

function resolveSeasonKey(season) {
  if (!season) return "Normal";
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

  const rer = calculateRER(weight);

  const merMap = engineData.Energy_System?.MER_Multipliers;
  if (!merMap) throw new Error("Energy_System.MER_Multipliers missing");

  const activityKey = resolveActivityKey(activity);
  const isPuppy     = ageMonths !== undefined && ageMonths <= 12;
  const isSenior    = lifeStage?.toLowerCase().includes("senior");

  let selectedMER;

  if (isPuppy) {
    selectedMER = ageMonths < 4 ? merMap.Puppy_0_4_Months : merMap.Puppy_4_12_Months;
  } else if (isSenior) {
    selectedMER =
      activityKey === "High_Activity" ? 1.4 :
      activityKey === "Low_Activity"  ? 1.2 : 1.3;
  } else {
    selectedMER = merMap[activityKey] ?? merMap.Moderate_Activity;
  }

  if (!selectedMER) throw new Error(`MER not found for activity: ${activityKey}`);

  const baseCalories = rer * selectedMER;

  let totalAdjustment = 0;

  /* BCS adjustment — reads from Master_Calorie_Adjustment_Pipeline.BCS_Adjustment */
  const pipeline = engineData.Master_Calorie_Adjustment_Pipeline;
  const bcsAdj   = pipeline?.BCS_Adjustment?.[bcsCategory];
  if (bcsAdj !== undefined) totalAdjustment += bcsAdj;

  /* Seasonal adjustment */
  const seasonKey = resolveSeasonKey(season);
  const seasonAdj = pipeline?.Seasonal_Adjustment?.[seasonKey];
  if (seasonAdj !== undefined) totalAdjustment += seasonAdj;

  /* Symptom adjustment */
  const symptomAdj = pipeline?.Symptom_Adjustment;
  if (symptomAdj && Array.isArray(symptoms)) {
    for (const symptom of symptoms) {
      const adj = symptomAdj[symptom];
      if (adj !== undefined) totalAdjustment += adj;
    }
  }

  /* Global cap */
  const safetyClamp = pipeline?.Safety_Clamp;
  if (safetyClamp) {
    const maxPos = safetyClamp.Global_Max_Positive ?? 0.35;
    const maxNeg = safetyClamp.Global_Max_Negative ?? -0.35;
    totalAdjustment = Math.min(maxPos, Math.max(maxNeg, totalAdjustment));
  }

  let finalCalories = baseCalories * (1 + totalAdjustment);

  /* RER floor */
  if (finalCalories < rer) finalCalories = rer;

  /* Hydration */
  const waterML = weight * (engineData.Hydration_Stack_Control?.Base_ml_per_kg ?? 55);

  return {
    rer:                Math.round(rer),
    selectedMER,
    baseCalories:       Math.round(baseCalories),
    finalDailyCalories: Math.round(finalCalories),
    dailyWaterML:       Math.round(waterML),
  };
}