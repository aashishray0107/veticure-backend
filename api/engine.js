import fs from "fs";
import path from "path";

import { generateDietPlan } from "../lib/dietEngine.js";
import { simulateJourney } from "../lib/progressionEngine.js";
import { calculateCalories } from "../lib/calorieEngine.js";
import { calculateMacros } from "../lib/macroEngine.js";
import { saveReport } from "../lib/pocketbase.js";

/* ---------------- DATASET CACHE ---------------- */

const datasetCache = {};

/* ---------------- DATASET LOADER ---------------- */

function loadDataset(breed) {

  if (!breed) throw new Error("Breed required");

  const normalizedBreed =
    breed.toLowerCase().replace(/\s+/g, "_");

  const fileName = `${normalizedBreed}_engine.json`;

  if (datasetCache[fileName]) {
    return datasetCache[fileName];
  }

  const dataPath = path.join(
    process.cwd(),
    "data",
    "breeds",
    fileName
  );

  if (!fs.existsSync(dataPath)) {
    throw new Error(`Dataset not found for breed: ${breed}`);
  }

  const dataset = JSON.parse(
    fs.readFileSync(dataPath, "utf-8")
  );

  datasetCache[fileName] = dataset;

  return dataset;
}

/* ---------------- LIFE STAGE ---------------- */

function detectLifeStage(ageMonths) {

  if (ageMonths < 12) return "Puppy";
  if (ageMonths < 96) return "Adult";

  return "Senior";
}

/* ---------------- IDEAL WEIGHT ENGINE ---------------- */
function calculateIdealWeight(engineData, ageMonths, gender = "unknown") {

  let stages = engineData.Lifecycle_Growth_Model_20_Stages;

  if (!stages) {
    throw new Error("Lifecycle_Growth_Model_20_Stages missing");
  }

  if (!Array.isArray(stages)) {
    stages = Object.values(stages);
  }

  const g = gender.toLowerCase();

  for (const stage of stages) {

    let minMonths = null;
    let maxMonths = null;

    /* convert weeks → months */

    if (stage.min_age_weeks !== undefined) {

      minMonths = stage.min_age_weeks / 4.345;

      maxMonths =
        stage.max_age_weeks !== null &&
        stage.max_age_weeks !== undefined
          ? stage.max_age_weeks / 4.345
          : null;

    }

    /* already months */

    else if (stage.min_age_months !== undefined) {

      minMonths = stage.min_age_months;

      maxMonths =
        stage.max_age_months !== null &&
        stage.max_age_months !== undefined
          ? stage.max_age_months
          : null;

    }

    /* years → months */

    else if (stage.min_age_years !== undefined) {

      minMonths = stage.min_age_years * 12;

      maxMonths =
        stage.max_age_years !== null &&
        stage.max_age_years !== undefined
          ? stage.max_age_years * 12
          : null;

    }

    if (minMonths === null) continue;

    const match =
      ageMonths >= minMonths &&
      (maxMonths === null || ageMonths <= maxMonths);

    if (!match) continue;

    const male = stage.Male_Ideal_Weight_Range_kg;
    const female = stage.Female_Ideal_Weight_Range_kg;

    if (!male || !female) continue;

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

  throw new Error("Ideal weight not found for given age");

}

/* ---------------- BCS ENGINE ---------------- */

function evaluateBCS(weight, idealWeight) {

  const deviation =
    ((weight - idealWeight) / idealWeight) * 100;

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

function determineStrategy(
  bcsCategory,
  goal = "Maintenance",
  activity = "Moderate"
) {

  if (bcsCategory === "Obese" || bcsCategory === "Overweight")
    return "Fat_Loss";

  if (
    bcsCategory === "Underweight" ||
    bcsCategory === "Severely_Underweight"
  )
    return "Weight_Gain";

  if (bcsCategory === "Ideal" && activity === "High")
    return "Muscle_Build";

  return goal;
}

/* ---------------- API HANDLER ---------------- */

export default async function handler(req, res) {

  try {

    if (req.method !== "POST") {
      return res.status(405).json({
        error: "Method not allowed"
      });
    }

    const body = req.body || {};

    const {

      breed = "Labrador",
      weight,
      age,
      gender = "unknown",
      activity = "Moderate",
      season = "Normal",
      goal = "Maintenance",
      symptoms = []

    } = body;

    if (!weight || weight <= 0) {
      throw new Error("Invalid weight");
    }

    if (age === undefined || age < 0) {
      throw new Error("Invalid age");
    }

    /* Load dataset */

    const engineData = loadDataset(breed);

    const lifeStage = detectLifeStage(age);

    const idealWeight =
      calculateIdealWeight(engineData, age, gender);

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
  bcsCategory: bcs.category,
  engineData
});

    const macroResult = calculateMacros({
  calories: calorieResult.finalDailyCalories,
  strategyMode,
  lifeStage,
  engineData
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
  symptoms,
  engineData
});

    const result = {

      breed,

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

    };

// await saveReport(result);
    return res.status(200).json(result);

  }

  catch (err) {

    console.error("ENGINE ERROR:", err);

    return res.status(500).json({
      error: err.message
    });

  }
}