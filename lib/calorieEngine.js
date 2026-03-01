import fs from "fs";
import path from "path";

const dataPath = path.join(process.cwd(), "data", "labrador_engine.json");

if (!fs.existsSync(dataPath)) {
  throw new Error("labrador_engine.json not found in /data folder");
}

const engineData = JSON.parse(fs.readFileSync(dataPath, "utf-8"));

function calculateRER(weight) {
  return 70 * Math.pow(weight, 0.75);
}

function normalizeKey(str) {
  if (!str) return null;
  return str.replace(/\s+/g, "_").trim();
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

  if (!weight || weight <= 0) {
    throw new Error("Invalid weight for calorie calculation");
  }

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
     STEP 1 — Select MER
  -------------------------- */

  const merMap = energySystem.MER_Multipliers;

  let selectedMER = null;

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
    const normalizedActivity = normalizeKey(activity);

    if (normalizedActivity === "Low")
      selectedMER = merMap.Low_Activity;
    else if (normalizedActivity === "High")
      selectedMER = merMap.High_Activity;
    else
      selectedMER = merMap.Moderate_Activity;
  }

  if (!selectedMER) {
    throw new Error("Unable to resolve MER from JSON");
  }

  const baseCalories = rer * selectedMER;

  /* -------------------------
     STEP 2 — Collect Adjustments
  -------------------------- */

  let totalAdjustment = 0;

  const normalizedActivity = normalizeKey(activity);
  const normalizedSeason = normalizeKey(season);
  const normalizedBCS = normalizeKey(bcsCategory);

  if (activityAdjustments?.[normalizedActivity]) {
    totalAdjustment +=
      activityAdjustments[normalizedActivity].Calorie_Adjustment_Percent || 0;
  }

  if (weightAdjustments?.[normalizedBCS]) {
    totalAdjustment +=
      weightAdjustments[normalizedBCS].Calorie_Adjustment_Percent || 0;
  }

  if (seasonalAdjustments?.[normalizedSeason]) {
    totalAdjustment +=
      seasonalAdjustments[normalizedSeason].Calorie_Adjustment_Percent || 0;
  }

  if (globalCap) {
    if (totalAdjustment > globalCap.Max_Positive_Adjustment)
      totalAdjustment = globalCap.Max_Positive_Adjustment;

    if (totalAdjustment < globalCap.Max_Negative_Adjustment)
      totalAdjustment = globalCap.Max_Negative_Adjustment;
  }

  const adjustedCalories = baseCalories * (1 + totalAdjustment);

  /* -------------------------
     STEP 3 — Absolute Safety Limits
  -------------------------- */

  let finalCalories = adjustedCalories;

  if (safety?.Minimum_kcal === "RER") {
    if (finalCalories < rer) finalCalories = rer;
  }

  if (safety?.Maximum_kcal === "2.5xRER") {
    const maxAllowed = rer * 2.5;
    if (finalCalories > maxAllowed) finalCalories = maxAllowed;
  }

  /* -------------------------
     STEP 4 — Hydration
  -------------------------- */

  let waterML = weight * (hydrationSystem?.Standard_ml_per_kg_per_day || 55);

  if (symptoms.length > 0) {
    for (const s of symptoms) {
      if (hydrationSystem?.[`${s}_Override`]) {
        waterML *= hydrationSystem[`${s}_Override`];
      }
    }
  }

  return {
    rer: Math.round(rer),
    selectedMER,
    baseCalories: Math.round(baseCalories),
    totalAdjustmentPercent: Number(totalAdjustment.toFixed(3)),
    adjustedCalories: Math.round(adjustedCalories),
    finalDailyCalories: Math.round(finalCalories),
    dailyWaterML: Math.round(waterML)
  };
}