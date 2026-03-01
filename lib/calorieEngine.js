import fs from "fs";
import path from "path";

const dataPath = path.join(process.cwd(), "data", "labrador_engine.json");
const engineData = JSON.parse(fs.readFileSync(dataPath, "utf-8"));

export function calculateCalories({
  weight,
  lifeStage,
  activity,
  bcsCategory,
  season = "Normal",
  symptoms = []
}) {

  /* --------------------------
     1️⃣ RER
  -------------------------- */
  const rer = 70 * Math.pow(weight, 0.75);

  /* --------------------------
     2️⃣ MER SELECTION
  -------------------------- */

  const energySystem = engineData.Energy_System;
  const activityConfig = engineData.Activity_Based_Nutrition_Adjustment;

  let selectedMER = 1.0;

  // Puppy stage MER override
  if (lifeStage && energySystem?.Puppy_MER) {
    selectedMER = energySystem.Puppy_MER;
  }

  // Senior stage MER override
  else if (lifeStage?.toLowerCase().includes("senior") && energySystem?.Senior_MER) {
    selectedMER = energySystem.Senior_MER;
  }

  // Adult activity MER
  else if (activityConfig?.[activity]) {
    selectedMER = activityConfig[activity].MER_Multiplier;
  }

  const baseCalories = rer * selectedMER;

  /* --------------------------
     3️⃣ ADDITIVE STACK
  -------------------------- */

  let totalAdjustment = 0;

  // Activity calorie shift
  if (activityConfig?.[activity]?.Calorie_Adjustment_Percent !== undefined) {
    totalAdjustment += activityConfig[activity].Calorie_Adjustment_Percent / 100;
  }

  // BCS weight condition adjustment
  const weightCondition = engineData.Weight_Condition_Adjustment_Engine;
  if (weightCondition?.[bcsCategory]?.Calorie_Delta_Percent !== undefined) {
    totalAdjustment += weightCondition[bcsCategory].Calorie_Delta_Percent / 100;
  }

  // Seasonal adjustment
  const seasonal = engineData.Seasonal_Adjustment;
  if (seasonal?.[season]?.Calorie_Shift_Percent_vs_Normal !== undefined) {
    totalAdjustment += seasonal[season].Calorie_Shift_Percent_vs_Normal / 100;
  }

  // Symptom adjustments
  const symptomLogic = engineData.Symptom_Based_Nutrition_Logic;
  for (const s of symptoms) {
    if (symptomLogic?.[s]?.Calorie_Adjustment !== undefined) {
      totalAdjustment += symptomLogic[s].Calorie_Adjustment / 100;
    }
  }

  /* --------------------------
     4️⃣ GLOBAL CLAMP
  -------------------------- */

  const capConfig =
    engineData.BCS_Automatic_Detection_Logic
      ?.Master_Calorie_Adjustment_Pipeline
      ?.Global_Adjustment_Cap;

  const minCap = capConfig?.Min_Total_Adjustment ?? -0.35;
  const maxCap = capConfig?.Max_Total_Adjustment ?? 0.35;

  totalAdjustment = Math.max(minCap, Math.min(maxCap, totalAdjustment));

  /* --------------------------
     5️⃣ FINAL CALORIE
  -------------------------- */

  let finalCalories = baseCalories * (1 + totalAdjustment);

  // Minimum floor: never below RER
  if (finalCalories < rer) finalCalories = rer;

  /* --------------------------
     6️⃣ ABSOLUTE SAFETY LIMITS
  -------------------------- */

  const safety =
    engineData.Absolute_Calorie_Safety_Limits;

  const minAbsolute = rer * (safety?.Min_RER_Multiplier ?? 1.0);
  const maxAbsolute = rer * (safety?.Max_RER_Multiplier ?? 2.5);

  finalCalories = Math.max(minAbsolute, Math.min(maxAbsolute, finalCalories));

  /* --------------------------
     7️⃣ HYDRATION
  -------------------------- */

  const hydrationSystem = engineData.Hydration_System;

  let hydrationMultiplier = 1.0;

  for (const s of symptoms) {
    if (hydrationSystem?.Symptom_Overrides?.[s]?.Hydration_Multiplier) {
      hydrationMultiplier = Math.max(
        hydrationMultiplier,
        hydrationSystem.Symptom_Overrides[s].Hydration_Multiplier
      );
    }
  }

  const dailyWaterML = weight * 55 * hydrationMultiplier;

  return {
    rer: Math.round(rer),
    selectedMER,
    baseCalories: Math.round(baseCalories),
    totalAdjustmentPercent: Number((totalAdjustment * 100).toFixed(2)),
    finalDailyCalories: Math.round(finalCalories),
    dailyWaterML: Math.round(dailyWaterML)
  };
}
