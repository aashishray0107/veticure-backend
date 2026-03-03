import fs from "fs";
import path from "path";

const dataPath = path.join(process.cwd(), "data/labrador_engine.json");

if (!fs.existsSync(dataPath)) {
  throw new Error("labrador_engine.json missing");
}

const engineData = JSON.parse(
  fs.readFileSync(dataPath, "utf-8")
);

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
  bcsCategory
}) {

  const rer = calculateRER(weight);
  const merMap = engineData.Energy_System.MER_Multipliers;

  const normActivity = normalize(activity);
  const isPuppy = ageMonths && ageMonths <= 12;
  const isSenior = normalize(lifeStage)?.includes("senior");

  let selectedMER;

  if (isPuppy) {
    selectedMER =
      ageMonths < 4
        ? merMap.Puppy_0_4_Months
        : merMap.Puppy_4_12_Months;
  } else if (isSenior) {
    selectedMER = normActivity === "high" ? 1.4 :
                  normActivity === "low" ? 1.2 : 1.3;
  } else {
    selectedMER = normActivity === "high"
      ? merMap.High_Activity
      : normActivity === "low"
      ? merMap.Low_Activity
      : merMap.Moderate_Activity;
  }

  const baseCalories = rer * selectedMER;

  let totalAdjustment = 0;

  const weightAdj = engineData.Weight_Condition_Adjustment_Engine;
  const seasonalAdj = engineData.Seasonal_Adjustment;

  const normBCS = normalize(bcsCategory);
  const normSeason = normalize(season);

  if (weightAdj?.[bcsCategory]?.Calorie_Delta_Percent)
    totalAdjustment += weightAdj[bcsCategory].Calorie_Delta_Percent;

  if (seasonalAdj?.[season]?.Calorie_Adjustment_Percent)
    totalAdjustment += seasonalAdj[season].Calorie_Adjustment_Percent;

  const finalCalories = baseCalories * (1 + totalAdjustment);

  let waterML =
    weight *
    (engineData.Hydration_System.Standard_ml_per_kg_per_day || 55);

  return {
    rer: Math.round(rer),
    selectedMER,
    baseCalories: Math.round(baseCalories),
    finalDailyCalories: Math.round(finalCalories),
    dailyWaterML: Math.round(waterML)
  };
}