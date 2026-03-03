import { generateDietPlan } from "../lib/dietEngine.js";
import { simulateJourney } from "../lib/progressionEngine.js";
import { calculateBCS } from "../lib/bcsEngine.js";
import { calculateCalories } from "../lib/calorieEngine.js";
import { calculateMacros } from "../lib/macroEngine.js";
import fs from "fs";
import path from "path";

/* ----------------------------------
   🔹 Load Engine Data
----------------------------------- */

const dataPath = path.join(process.cwd(), "data", "labrador_engine.json");

if (!fs.existsSync(dataPath)) {
  throw new Error("labrador_engine.json not found in /data folder");
}

const engineData = JSON.parse(
  fs.readFileSync(dataPath, "utf-8")
);

/* ----------------------------------
   🔹 Weight Correction (Adult)
----------------------------------- */

function generateWeightCorrectionPlan(weight, idealMid, finalBCS) {
  const config =
    engineData?.BCS_Automatic_Detection_Logic
      ?.Weight_Correction_Config;

  if (!config?.BCS_Based_Strategy) {
    throw new Error("Weight correction configuration missing in JSON");
  }

  const strategy = config.BCS_Based_Strategy[String(finalBCS)];
  if (!strategy) return maintenance(weight, idealMid);

  const { mode, weekly_percent = 0 } = strategy;

  if (!weekly_percent || mode === "Maintenance") {
    return maintenance(weight, idealMid);
  }

  const difference =
    mode === "Fat_Loss"
      ? weight - idealMid
      : idealMid - weight;

  if (difference <= 0) return maintenance(weight, idealMid);

  const weeklyChange = weight * (weekly_percent / 100);
  const rawWeeks = difference / weeklyChange;

  const weeks =
    config.Rounding?.Weeks_Round_Method === "ceil"
      ? Math.ceil(rawWeeks)
      : Math.round(rawWeeks);

  return {
    mode,
    current_weight: Number(weight.toFixed(2)),
    target_weight: Number(idealMid.toFixed(2)),
    weekly_percent,
    weekly_change: Number(weeklyChange.toFixed(2)),
    estimated_weeks_to_goal: weeks > 0 ? weeks : 0
  };
}

function maintenance(weight, idealMid) {
  return {
    mode: "Maintenance",
    current_weight: Number(weight.toFixed(2)),
    target_weight: Number(idealMid.toFixed(2)),
    weekly_percent: 0,
    weekly_change: 0,
    estimated_weeks_to_goal: 0
  };
}

/* ----------------------------------
   🔹 Puppy Adjustment
----------------------------------- */

function generatePuppyCorrectionPlan(category) {
  if (["Severely_Obese", "Obese"].includes(category)) {
    return { mode: "Growth_Slowdown", weekly_percent: 0.5 };
  }

  if (["Very_Thin", "Underweight"].includes(category)) {
    return { mode: "Growth_Acceleration", weekly_percent: 0.5 };
  }

  return { mode: "Optimal_Growth", weekly_percent: 0 };
}

/* ----------------------------------
   🔹 API Handler
----------------------------------- */

export default async function handler(req, res) {

  try {

    if (req.method !== "POST") {
      return res.status(405).json({ error: "Method Not Allowed" });
    }

    const {
      weight,
      age,
      gender = "Male",
      activity = "Moderate",
      season = "Normal",
      symptoms = []
    } = req.body || {};

    if (!weight || !age) {
      return res.status(400).json({ error: "Missing weight or age" });
    }

    const parsedWeight = Number(weight);
    const parsedAge = Number(age);

    if (isNaN(parsedWeight) || isNaN(parsedAge)) {
      return res.status(400).json({ error: "Invalid numeric input" });
    }

    const isPuppy = parsedAge <= 12;

    /* ----------------------------------
       🔹 Symptom Whitelist
    ----------------------------------- */

    const allowedSymptoms = [
      "loose_stool",
      "constipation",
      "joint_stiffness",
      "low_appetite",
      "skin_itching",
      "low_energy"
    ];

    const filteredSymptoms = symptoms.filter(s =>
      allowedSymptoms.includes(s)
    );

    /* ----------------------------------
       🔹 1️⃣ BCS
    ----------------------------------- */

    const bcsResult = calculateBCS(
      parsedWeight,
      parsedAge,
      gender
    );

    /* ----------------------------------
       🔹 2️⃣ Weight Plan
    ----------------------------------- */

    const weightPlan = isPuppy
      ? generatePuppyCorrectionPlan(bcsResult.category)
      : generateWeightCorrectionPlan(
          parsedWeight,
          bcsResult.idealMid,
          bcsResult.estimatedBCS
        );

    /* ----------------------------------
       🔹 3️⃣ Calories
    ----------------------------------- */

    const calorieResult = calculateCalories({
      weight: parsedWeight,
      ageMonths: parsedAge,
      lifeStage: bcsResult.life_stage,
      activity,
      bcsCategory: bcsResult.category,
      season,
      symptoms: filteredSymptoms
    });

    /* ----------------------------------
       🔹 4️⃣ Base Macros
    ----------------------------------- */

    const macroResult = calculateMacros({
      calories: calorieResult.finalDailyCalories,
      strategyMode: weightPlan.mode,
      lifeStage: bcsResult.life_stage
    });

    /* ----------------------------------
       🔹 5️⃣ Weekly Projection
    ----------------------------------- */

    const weeklyProjection = simulateJourney({
      startWeight: parsedWeight,
      targetWeight: weightPlan.target_weight,
      weeklyPercent: weightPlan.weekly_percent,
      mode: weightPlan.mode,
      lifeStage: bcsResult.life_stage,
      startAgeMonths: parsedAge,
      gender,
      activity,
      season,
      symptoms: filteredSymptoms
    });

    const activeWeek = weeklyProjection?.[0];

    const effectiveCalories =
      activeWeek?.calories ?? calorieResult.finalDailyCalories;

    const effectiveProtein =
      activeWeek?.protein_g ?? macroResult.macro_grams.protein;

    const effectiveFat =
      activeWeek?.fat_g ?? macroResult.macro_grams.fat;

    const effectiveCarbs =
      activeWeek?.carbs_g ?? macroResult.macro_grams.carbs;

    /* ----------------------------------
       🔹 6️⃣ Diet Plan
    ----------------------------------- */

    const dietPlan = generateDietPlan({
      macros: {
        protein: effectiveProtein,
        fat: effectiveFat,
        carbs: effectiveCarbs
      },
      calories: effectiveCalories,
      bcsCategory: bcsResult.category,
      preference: "non_veg",
      bodyWeight: parsedWeight,
      symptoms: filteredSymptoms
    });

    /* ----------------------------------
       🔹 7️⃣ Supplement Advisory
    ----------------------------------- */

    const supplementAdvisory = {
      omega3: { recommended: false }
    };

    if (
      bcsResult.estimatedBCS >= 6 ||
      bcsResult.life_stage === "Senior" ||
      filteredSymptoms.includes("joint_stiffness") ||
      filteredSymptoms.includes("skin_itching")
    ) {
      supplementAdvisory.omega3 = {
        recommended: true,
        reason: "Supports anti-inflammatory and metabolic function.",
        note: "Consult veterinarian for appropriate EPA+DHA dosing."
      };
    }

    /* ----------------------------------
       🔹 Response
    ----------------------------------- */

    return res.status(200).json({
      input: {
        weight: parsedWeight,
        age: parsedAge,
        gender,
        activity,
        season,
        symptoms: filteredSymptoms
      },
      lifecycle_report: bcsResult,
      weight_correction_plan: weightPlan,
      calorie_report: calorieResult,
      macro_report: macroResult,
      weekly_projection: weeklyProjection,
      weekly_diet_plan: dietPlan,
      supplement_advisory: supplementAdvisory
    });

  } catch (err) {

    console.error("Engine crash:", err);

    return res.status(500).json({
      error: err.message
    });
  }
}