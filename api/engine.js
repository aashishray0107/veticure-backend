import fs from "fs";
import path from "path";

import { generateDietPlan } from "../lib/dietEngine.js";
import { simulateJourney } from "../lib/progressionEngine.js";
import { calculateCalories } from "../lib/calorieEngine.js";
import { calculateMacros } from "../lib/macroEngine.js";
import { saveReport } from "../lib/pocketbase.js";

/* ---------------- DATASET ---------------- */

const dataPath = path.join(process.cwd(), "data", "labrador_engine.json");

if (!fs.existsSync(dataPath)) {
  throw new Error("Dataset missing: labrador_engine.json");
}

const engineData = JSON.parse(
  fs.readFileSync(dataPath, "utf-8")
);

/* ---------------- LIFE STAGE ---------------- */

function detectLifeStage(ageMonths) {

  if (ageMonths < 12) return "Puppy";

  if (ageMonths < 96) return "Adult";

  return "Senior";
}

/* ---------------- IDEAL WEIGHT ENGINE ---------------- */

function calculateIdealWeight(ageMonths, gender = "unknown") {

  const ranges = engineData.Weight_By_Age;

  if (!ranges || !Array.isArray(ranges)) {
    throw new Error("Weight_By_Age dataset missing");
  }

  const g = gender.toLowerCase();

  for (const r of ranges) {

    const minAge = r.min_age_months;
    const maxAge = r.max_age_months;

    const match =
      ageMonths >= minAge &&
      (maxAge === null || ageMonths <= maxAge);

    if (!match) continue;

    const male = r.data?.Male_kg;
    const female = r.data?.Female_kg;

    if (!male || !female) {
      throw new Error("Weight range data malformed");
    }

    let minWeight;
    let maxWeight;

    if (g === "male") {
      minWeight = male[0];
      maxWeight = male[1];
    }

    else if (g === "female") {
      minWeight = female[0];
      maxWeight = female[1];
    }

    else {
      minWeight = (male[0] + female[0]) / 2;
      maxWeight = (male[1] + female[1]) / 2;
    }

    const ideal = (minWeight + maxWeight) / 2;

    return Number(ideal.toFixed(1));
  }

  /* fallback last range */

  const last = ranges[ranges.length - 1];

  const male = last.data.Male_kg;
  const female = last.data.Female_kg;

  let minWeight;
  let maxWeight;

  if (g === "male") {
    minWeight = male[0];
    maxWeight = male[1];
  }

  else if (g === "female") {
    minWeight = female[0];
    maxWeight = female[1];
  }

  else {
    minWeight = (male[0] + female[0]) / 2;
    maxWeight = (male[1] + female[1]) / 2;
  }

  return Number(((minWeight + maxWeight) / 2).toFixed(1));
}

/* ---------------- BCS ENGINE ---------------- */

function evaluateBCS(weight, idealWeight) {

  const deviation = ((weight - idealWeight) / idealWeight) * 100;

  let category = "Ideal";

  if (deviation <= -20) category = "Severely_Underweight";
  else if (deviation <= -5) category = "Underweight";
  else if (deviation <= 5) category = "Ideal";
  else if (deviation <= 20) category = "Overweight";
  else category = "Obese";

  return {
    idealWeight,
    deviationPercent: Number(deviation.toFixed(1)),
    category
  };
}

/* ---------------- STRATEGY ENGINE ---------------- */

function determineStrategy(bcsCategory, goal = "Maintenance", activity = "Moderate") {

  if (bcsCategory === "Obese" || bcsCategory === "Overweight") {
    return "Fat_Loss";
  }

  if (bcsCategory === "Underweight" || bcsCategory === "Severely_Underweight") {
    return "Weight_Gain";
  }

  if (bcsCategory === "Ideal" && activity === "High") {
    return "Muscle_Build";
  }

  return goal;
}

/* ---------------- API HANDLER ---------------- */

export default async function handler(req, res) {

  try {

    const {

      weight,
      age,
      gender = "unknown",
      activity = "Moderate",
      season = "Normal",
      goal = "Maintenance",
      symptoms = []

    } = req.body;

    if (!weight || weight <= 0)
      throw new Error("Invalid weight");

    if (!age || age < 0)
      throw new Error("Invalid age");

    const lifeStage = detectLifeStage(age);

    const idealWeight = calculateIdealWeight(age, gender);

    const bcs = evaluateBCS(weight, idealWeight);

    const strategyMode =
      determineStrategy(bcs.category, goal, activity);

    const calorieResult = calculateCalories({
      weight,
      ageMonths: age,
      activity,
      season,
      symptoms,
      lifeStage,
      bcsCategory: bcs.category
    });

    const macroResult = calculateMacros({
      calories: calorieResult.finalDailyCalories,
      strategyMode,
      lifeStage
    });

    const journey = simulateJourney({
      startWeight: weight,
      targetWeight: idealWeight,
      weeklyPercent: 1,
      mode: strategyMode,
      lifeStage,
      ageMonths: age,
      activity,
      season,
      symptoms
    });

    const diet = generateDietPlan({
      macros: macroResult.macro_grams,
      calories: calorieResult.finalDailyCalories,
      bcsCategory: bcs.category,
      bodyWeight: weight,
      symptoms
    });

    return res.status(200).json({

      bcs_report: {
        ideal_weight: bcs.idealWeight,
        weight_deviation_percent: bcs.deviationPercent,
        bcs_category: bcs.category
      },

      strategy_used: strategyMode,

      calorie_report: calorieResult,

      macro_report: macroResult,

      weight_progression: journey,

      weekly_diet_plan: diet

    });

  }

  catch (err) {

    console.error(err);

    return res.status(500).json({
      error: err.message
    });
  }
}