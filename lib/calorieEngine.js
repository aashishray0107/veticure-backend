function calculateRER(weight) {
  return 70 * Math.pow(weight, 0.75);
}

function normalize(str) {
  return str?.toLowerCase().replace(/\s+/g, "_");
}

export function calculateCalories({

  weight,
  ageMonths,
  activity,
  season,
  symptoms = [],
  lifeStage,
  bcsCategory,
  engineData

}) {

  if (!engineData) {
    throw new Error("engineData missing in calorie engine");
  }

  const rer = calculateRER(weight);

  const merMap = engineData.Energy_System?.MER_Multipliers;

  if (!merMap) {
    throw new Error("Energy_System.MER_Multipliers missing in dataset");
  }

  const normActivity = normalize(activity);
  const isPuppy = ageMonths && ageMonths <= 12;
  const isSenior = normalize(lifeStage)?.includes("senior");

  let selectedMER;

  if (isPuppy) {

    selectedMER =
      ageMonths < 4
        ? merMap.Puppy_0_4_Months
        : merMap.Puppy_4_12_Months;

  }

  else if (isSenior) {

    selectedMER =
      normActivity === "high" ? 1.4 :
      normActivity === "low" ? 1.2 :
      1.3;

  }

  else {

    selectedMER =
      normActivity === "high"
        ? merMap.High_Activity
        : normActivity === "low"
        ? merMap.Low_Activity
        : merMap.Moderate_Activity;

  }

  const baseCalories = rer * selectedMER;

  let totalAdjustment = 0;

  const weightAdj =
    engineData.Weight_Condition_Adjustment_Engine;

  const seasonalAdj =
    engineData.Seasonal_Adjustment_Engine;

  const normBCS = normalize(bcsCategory);
  const normSeason = normalize(season);

  if (weightAdj?.[normBCS]?.Calorie_Adjustment_Percent)
    totalAdjustment +=
      weightAdj[normBCS].Calorie_Adjustment_Percent;

  if (seasonalAdj?.[normSeason]?.Calorie_Adjustment_Percent)
    totalAdjustment +=
      seasonalAdj[normSeason].Calorie_Adjustment_Percent;

  const finalCalories =
    baseCalories * (1 + totalAdjustment);

  let waterML =
    weight *
    (engineData.Hydration_Adjustment_Engine?.Base_ml_per_kg || 55);

  return {

    rer: Math.round(rer),

    selectedMER,

    baseCalories: Math.round(baseCalories),

    finalDailyCalories: Math.round(finalCalories),

    dailyWaterML: Math.round(waterML)

  };

}