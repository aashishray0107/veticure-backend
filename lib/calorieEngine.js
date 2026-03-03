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
   🔹 Utility
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

  const {
    Energy_System,
    Weight_Condition_Adjustment_Engine,
    Seasonal_Adjustment,
    Hydration_System,
    Absolute_Calorie_Safety_Limits,
    Global_Adjustment_Cap
  } = engineData;

  if (!Energy_System?.MER_Multipliers) {
    throw new Error("MER_Multipliers missing in JSON");
  }

  const merMap = Energy_System.MER_Multipliers;

  /* =========================================================
     STEP 1 — MER Selection (Deterministic)
  ========================================================== */

  const normActivity = normalizeKey(activity);
  const normLifeStage = normalizeKey(lifeStage);

  let selectedMER;

  const isPuppy = ageMonths && ageMonths <= 12;
  const isSenior = normLifeStage?.includes("senior");

  if (isPuppy) {
    selectedMER =
      ageMonths < 4
        ? merMap.Puppy_0_4_Months
        : merMap.Puppy_4_12_Months;
  }
  else if (isSenior) {
    // Senior respects activity but does not double count
    if (normActivity === "low") selectedMER = 1.2;
    else if (normActivity === "high") selectedMER = 1.4;
    else selectedMER = 1.3;
  }
  else {
    if (normActivity === "low") selectedMER = merMap.Low_Activity;
    else if (normActivity === "high") selectedMER = merMap.High_Activity;
    else selectedMER = merMap.Moderate_Activity;
  }

  if (!selectedMER || isNaN(selectedMER)) {
    throw new Error("Unable to resolve MER");
  }

  const baseCalories = rer * selectedMER;

  /* =========================================================
     STEP 2 — Adjustments (BCS + Season)
  ========================================================== */

  let totalAdjustment = 0;

  let normBCS = normalizeKey(bcsCategory);
  if (normBCS === "very_thin") normBCS = "underweight";

  const normSeason = normalizeKey(season);

  // --- BCS ---
  if (Weight_Condition_Adjustment_Engine) {
    const match = Object.keys(
      Weight_Condition_Adjustment_Engine
    ).find(
      key => normalizeKey(key) === normBCS
    );

    if (match) {
      const delta =
        Weight_Condition_Adjustment_Engine[match]
          ?.Calorie_Delta_Percent;

      if (typeof delta === "number") {
        totalAdjustment += delta;
      }
    }
  }

  // --- Season ---
  if (Seasonal_Adjustment) {
    const match = Object.keys(
      Seasonal_Adjustment
    ).find(
      key => normalizeKey(key) === normSeason
    );

    if (match) {
      const delta =
        Seasonal_Adjustment[match]
          ?.Calorie_Adjustment_Percent;

      if (typeof delta === "number") {
        totalAdjustment += delta;
      }
    }
  }

  /* =========================================================
     STEP 3 — Global Cap
  ========================================================== */

  if (Global_Adjustment_Cap) {

    if (
      typeof Global_Adjustment_Cap.Max_Positive_Adjustment === "number" &&
      totalAdjustment > Global_Adjustment_Cap.Max_Positive_Adjustment
    ) {
      totalAdjustment =
        Global_Adjustment_Cap.Max_Positive_Adjustment;
    }

    if (
      typeof Global_Adjustment_Cap.Max_Negative_Adjustment === "number" &&
      totalAdjustment < Global_Adjustment_Cap.Max_Negative_Adjustment
    ) {
      totalAdjustment =
        Global_Adjustment_Cap.Max_Negative_Adjustment;
    }
  }

  const adjustedCalories =
    baseCalories * (1 + totalAdjustment);

  /* =========================================================
     STEP 4 — Safety Limits
  ========================================================== */

  let finalCalories = adjustedCalories;

  if (
    Absolute_Calorie_Safety_Limits?.Minimum_kcal === "RER" &&
    finalCalories < rer
  ) {
    finalCalories = rer;
  }

  if (
    Absolute_Calorie_Safety_Limits?.Maximum_kcal === "2.5xRER"
  ) {
    const maxAllowed = rer * 2.5;
    if (finalCalories > maxAllowed) {
      finalCalories = maxAllowed;
    }
  }

  /* =========================================================
     STEP 5 — Hydration (Highest Override Only)
  ========================================================== */

  let waterML =
    weight *
    (Hydration_System?.Standard_ml_per_kg_per_day || 55);

  let highestMultiplier = 1;

  if (Array.isArray(symptoms)) {
    for (const s of symptoms) {
      const key = `${s}_Override`;
      if (
        Hydration_System?.[key] &&
        Hydration_System[key] > highestMultiplier
      ) {
        highestMultiplier =
          Hydration_System[key];
      }
    }
  }

  waterML *= highestMultiplier;

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