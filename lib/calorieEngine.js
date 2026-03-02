import fs from "fs";
import path from "path";

/* ----------------------------------
   🔹 Load JSON
----------------------------------- */

const dataPath = path.join(process.cwd(), "data", "labrador_engine.json");

if (!fs.existsSync(dataPath)) {
  throw new Error("labrador_engine.json not found in /data folder");
}

const engineData = JSON.parse(
  fs.readFileSync(dataPath, "utf-8")
);

/* ----------------------------------
   🔹 Core RER Formula
----------------------------------- */

function calculateRER(weight) {
  return 70 * Math.pow(weight, 0.75);
}

/* ----------------------------------
   🔹 Utility Normalizer
----------------------------------- */

function normalizeKey(str) {
  if (!str) return null;
  return str.replace(/\s+/g, "_").trim().toLowerCase();
}

/* ----------------------------------
   🔹 Calorie Engine
----------------------------------- */

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
  const safetyLimits = engineData.Absolute_Calorie_Safety_Limits;
  const globalCap = engineData.Global_Adjustment_Cap;

  if (!energySystem?.MER_Multipliers) {
    throw new Error("MER_Multipliers missing in JSON");
  }

  /* =========================================================
     STEP 1 — MER Selection
  ========================================================== */

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
    const act = normalizeKey(activity);

    if (act === "low")
      selectedMER = merMap.Low_Activity;
    else if (act === "high")
      selectedMER = merMap.High_Activity;
    else
      selectedMER = merMap.Moderate_Activity;
  }

  if (!selectedMER) {
    throw new Error("Unable to resolve MER from JSON");
  }

  const baseCalories = rer * selectedMER;

  /* =========================================================
     STEP 2 — Adjustments (Activity + BCS + Season)
  ========================================================== */

  let totalAdjustment = 0;
  const isPuppy = ageMonths !== null && ageMonths <= 12;

  const normActivity = normalizeKey(activity);
  const normSeason = normalizeKey(season);
  const normBCS = normalizeKey(bcsCategory);
  if (normBCS === "very_thin") {
  normBCS = "underweight";
}

  /* ---------- Activity Adjustment ---------- */

  if (activityAdjustments) {
    const actKey = Object.keys(activityAdjustments).find(
      key => normalizeKey(key) === normActivity
    );

    if (actKey) {
      const delta =
        activityAdjustments[actKey].Calorie_Adjustment_Percent;

      if (typeof delta === "number") {
        const isPuppy = ageMonths !== null && ageMonths <= 12;
      }
    }
  }

  /* ---------- BCS Adjustment (IMPORTANT FIX) ---------- */

  if (weightAdjustments) {
    const bcsKey = Object.keys(weightAdjustments).find(
      key => normalizeKey(key) === normBCS
    );

    if (bcsKey) {
      const delta =
        weightAdjustments[bcsKey].Calorie_Delta_Percent;

      if (typeof delta === "number") {
        totalAdjustment += delta;
      }
    }
  }

  /* ---------- Seasonal Adjustment ---------- */

  if (seasonalAdjustments) {
    const seasonKey = Object.keys(seasonalAdjustments).find(
      key => normalizeKey(key) === normSeason
    );

    if (seasonKey) {
      const delta =
        seasonalAdjustments[seasonKey].Calorie_Adjustment_Percent;

      if (typeof delta === "number") {
        totalAdjustment += delta;
      }
    }
  }

  /* =========================================================
     STEP 3 — Global Cap Enforcement
  ========================================================== */

  if (globalCap) {

    if (
      typeof globalCap.Max_Positive_Adjustment === "number" &&
      totalAdjustment > globalCap.Max_Positive_Adjustment
    ) {
      totalAdjustment = globalCap.Max_Positive_Adjustment;
    }

    if (
      typeof globalCap.Max_Negative_Adjustment === "number" &&
      totalAdjustment < globalCap.Max_Negative_Adjustment
    ) {
      totalAdjustment = globalCap.Max_Negative_Adjustment;
    }
  }

  const adjustedCalories =
    baseCalories * (1 + totalAdjustment);

  /* =========================================================
     STEP 4 — Absolute Safety Limits
  ========================================================== */

  let finalCalories = adjustedCalories;

  if (safetyLimits?.Minimum_kcal === "RER") {
    if (finalCalories < rer) {
      finalCalories = rer;
    }
  }

  if (safetyLimits?.Maximum_kcal === "2.5xRER") {
    const maxAllowed = rer * 2.5;

    if (finalCalories > maxAllowed) {
      finalCalories = maxAllowed;
    }
  }

  /* =========================================================
     STEP 5 — Hydration
  ========================================================== */

  let waterML =
    weight *
    (hydrationSystem?.Standard_ml_per_kg_per_day || 55);

  if (symptoms.length > 0) {
    for (const s of symptoms) {
      if (hydrationSystem?.[`${s}_Override`]) {
        waterML *= hydrationSystem[`${s}_Override`];
      }
    }
  }

  /* =========================================================
     FINAL OUTPUT
  ========================================================== */

  return {
    rer: Math.round(rer),
    selectedMER,
    baseCalories: Math.round(baseCalories),
    totalAdjustmentPercent: Number(
      totalAdjustment.toFixed(3)
    ),
    adjustedCalories: Math.round(adjustedCalories),
    finalDailyCalories: Math.round(finalCalories),
    dailyWaterML: Math.round(waterML)
  };
}