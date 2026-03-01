import fs from "fs";
import path from "path";

const dataPath = path.join(process.cwd(), "data", "labrador_engine.json");
const engineData = JSON.parse(fs.readFileSync(dataPath, "utf-8"));

function calculateRER(weight) {
  return 70 * Math.pow(weight, 0.75);
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

  if (!weight || weight <= 0)
    throw new Error("Invalid weight");

  const rer = calculateRER(weight);

  const energySystem = engineData.Energy_System;
  const activityAdjustments = engineData.Activity_Based_Nutrition_Adjustment;
  const weightAdjustments = engineData.Weight_Condition_Adjustment_Engine;
  const seasonalAdjustments = engineData.Seasonal_Adjustment;
  const hydrationSystem = engineData.Hydration_System;
  const safety = engineData.Absolute_Calorie_Safety_Limits;
  const globalCap = engineData.Global_Adjustment_Cap;

  if (!energySystem?.MER_Multipliers) {
    throw new Error("MER_Multipliers missing in JSON");
  }

  /* -------------------------
     🔹 STEP 1 — Select MER
  -------------------------- */

  const merMap = energySystem.MER_Multipliers;

  let selectedMER;

  if (lifeStage?.includes("Puppy")) {
    selectedMER =
      ageMonths < 4
        ? merMap.Puppy_0_4_Months
        : merMap.Puppy_4_12_Months;
  }
  else if (lifeStage?.includes("Senior")) {
    selectedMER = merMap.Senior;
  }
  else {
    if (activity === "Low") selectedMER = merMap.Low_Activity;
    else if (activity === "High") selectedMER = merMap.High_Activity;
    else selectedMER = merMap.Moderate_Activity;
  }

  if (!selectedMER)
    throw new Error("Unable to resolve MER from JSON");

  const baseCalories = rer * selectedMER;

  /* -------------------------
     🔹 STEP 2 — Stack Adjustments
  -------------------------- */

  let totalAdjustment = 0;

  if (activityAdjustments?.[activity])
    totalAdjustment += activityAdjustments[activity].Calorie_Adjustment_Percent;

  if (weightAdjustments?.[bcsCategory])
    totalAdjustment += weightAdjustments[bcsCategory].Calorie_Adjustment_Percent;

  if (seasonalAdjustments?.[season])
    totalAdjustment += seasonalAdjustments[season].Calorie_Adjustment_Percent;

  if (globalCap) {
    if (totalAdjustment > globalCap.Max_Positive_Adjustment)
      totalAdjustment = globalCap.Max_Positive_Adjustment;

    if (totalAdjustment < globalCap.Max_Negative_Adjustment)
      totalAdjustment = globalCap.Max_Negative_Adjustment;
  }

  const adjustedCalories = baseCalories * (1 + totalAdjustment);

  /* -------------------------
     🔹 STEP 3 — Absolute Safety
  -------------------------- */

  let finalCalories = adjustedCalories;

  if (safety?.Minimum_kcal === "RER")
    finalCalories = Math.max(finalCalories, rer);

  if (safety?.Maximum_kcal === "2.5_RER")
    finalCalories = Math.min(finalCalories, rer * 2.5);

  /* -------------------------
     🔹 STEP 4 — Hydration
  -------------------------- */

  let waterML =
    weight * hydrationSystem.Standard_ml_per_kg_per_day;

  for (const s of symptoms) {
    if (hydrationSystem[`${s}_Override`]) {
      waterML *= hydrationSystem[`${s}_Override`];
    }
  }

  return {
    rer: Math.round(rer),
    selectedMER,
    baseCalories: Math.round(baseCalories),
    totalAdjustmentPercent: totalAdjustment,
    adjustedCalories: Math.round(adjustedCalories),
    finalDailyCalories: Math.round(finalCalories),
    dailyWaterML: Math.round(waterML)
  };
}