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

  let selectedMER = null;

  const merMap = energySystem.MER_Multipliers;

  if (lifeStage?.includes("Puppy") && ageMonths < 4) {
    selectedMER = merMap.Puppy_0_4_Months;
  }
  else if (lifeStage?.includes("Puppy")) {
    selectedMER = merMap.Puppy_4_12_Months;
  }
  else if (lifeStage?.includes("Senior")) {
    selectedMER = merMap.Senior;
  }
  else {
    // adult logic by activity
    if (activity === "Low") selectedMER = merMap.Low_Activity;
    else if (activity === "High") selectedMER = merMap.High_Activity;
    else selectedMER = merMap.Moderate_Activity;
  }

  if (!selectedMER) {
    throw new Error("Unable to resolve MER from JSON");
  }

  const baseCalories = rer * selectedMER;

  /* -------------------------
     🔹 STEP 2 — Collect Adjustments
  -------------------------- */

  let totalAdjustment = 0;

  // Activity adjustment
  if (activityAdjustments?.[activity]) {
    totalAdjustment += activityAdjustments[activity].Calorie_Adjustment_Percent;
  }

  // BCS weight adjustment
  if (weightAdjustments?.[bcsCategory]) {
    totalAdjustment += weightAdjustments[bcsCategory].Calorie_Adjustment_Percent;
  }

  // Seasonal
  if (seasonalAdjustments?.[season]) {
    totalAdjustment += seasonalAdjustments[season].Calorie_Adjustment_Percent;
  }

  // Clamp global adjustment
  if (globalCap) {
    if (totalAdjustment > globalCap.Max_Positive_Adjustment)
      totalAdjustment = globalCap.Max_Positive_Adjustment;

    if (totalAdjustment < globalCap.Max_Negative_Adjustment)
      totalAdjustment = globalCap.Max_Negative_Adjustment;
  }

  const adjustedCalories = baseCalories * (1 + totalAdjustment);

  /* -------------------------
     🔹 STEP 3 — Absolute Safety Limits
  -------------------------- */

  let minAllowed = rer;
  let maxAllowed = rer * 2.5;

  if (typeof safety?.Minimum_kcal === "string") {
    minAllowed = rer; // RER * 1.0
  }

  if (typeof safety?.Maximum_kcal === "string") {
    maxAllowed = rer * 2.5;
  }

  let finalCalories = adjustedCalories;

  if (finalCalories < minAllowed) finalCalories = minAllowed;
  if (finalCalories > maxAllowed) finalCalories = maxAllowed;

  /* -------------------------
     🔹 STEP 4 — Hydration
  -------------------------- */

  let waterML = weight * hydrationSystem.Standard_ml_per_kg_per_day;

  if (symptoms.length > 0) {
    for (const s of symptoms) {
      if (hydrationSystem[`${s}_Override`]) {
        waterML *= hydrationSystem[`${s}_Override`];
      }
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