import { calculateBCS } from "../lib/bcsEngine.js";
import { calculateCalories } from "../lib/calorieEngine.js";
import fs from "fs";
import path from "path";

/* ----------------------------------
   🔹 Load JSON
----------------------------------- */
const dataPath = path.join(process.cwd(), "data", "labrador_engine.json");

if (!fs.existsSync(dataPath)) {
  throw new Error("labrador_engine.json not found in /data folder");
}

const engineData = JSON.parse(fs.readFileSync(dataPath, "utf-8"));

/* ----------------------------------
   🔹 Weight Correction Engine
----------------------------------- */
function generateWeightCorrectionPlan(weight, idealMid, finalBCS) {

  const bcsRoot = engineData.BCS_Automatic_Detection_Logic;

  if (!bcsRoot) {
    throw new Error("BCS_Automatic_Detection_Logic missing in JSON");
  }

  const config = bcsRoot.Weight_Correction_Config;

  if (!config) {
    throw new Error("Weight_Correction_Config missing in JSON");
  }

  const strategyMap = config.BCS_Based_Strategy;

  if (!strategyMap) {
    throw new Error("BCS_Based_Strategy missing in JSON");
  }

  const strategy = strategyMap[String(finalBCS)];

  if (!strategy) {
    return {
      mode: "Maintenance",
      current_weight: weight,
      target_weight: idealMid,
      weekly_percent: 0,
      weekly_change: 0,
      estimated_weeks_to_goal: 0
    };
  }

  const mode = strategy.mode;
  const weeklyPercent = strategy.weekly_percent || 0;
  const weeklyPercentDecimal = weeklyPercent / 100;

  if (mode === "Maintenance" || weeklyPercentDecimal === 0) {
    return {
      mode: "Maintenance",
      current_weight: weight,
      target_weight: idealMid,
      weekly_percent: 0,
      weekly_change: 0,
      estimated_weeks_to_goal: 0
    };
  }

  const difference =
    mode === "Fat_Loss"
      ? weight - idealMid
      : idealMid - weight;

  if (difference <= 0) {
    return {
      mode: "Maintenance",
      current_weight: weight,
      target_weight: idealMid,
      weekly_percent: 0,
      weekly_change: 0,
      estimated_weeks_to_goal: 0
    };
  }

  const weeklyChange = weight * weeklyPercentDecimal;

  const rawWeeks = difference / weeklyChange;

  const weeks =
    config.Rounding?.Weeks_Round_Method === "ceil"
      ? Math.ceil(rawWeeks)
      : Math.round(rawWeeks);

  return {
    mode,
    current_weight: Number(weight.toFixed(2)),
    target_weight: Number(idealMid.toFixed(2)),
    weekly_percent: weeklyPercent,
    weekly_change: Number(weeklyChange.toFixed(2)),
    estimated_weeks_to_goal: weeks > 0 ? weeks : 0
  };
}

/* ----------------------------------
   🔹 API Handler
----------------------------------- */
export default async function handler(req, res) {

  try {

    if (req.method !== "POST") {
      return res.status(405).json({ error: "Method Not Allowed" });
    }

    const { weight, age, gender = "Male" } = req.body || {};

    if (!weight || !age) {
      return res.status(400).json({ error: "Missing weight or age" });
    }

    const parsedWeight = parseFloat(weight);
    const parsedAge = parseInt(age);

    if (isNaN(parsedWeight) || isNaN(parsedAge)) {
      return res.status(400).json({ error: "Invalid numeric input" });
    }

    const bcsResult = calculateBCS(
      parsedWeight,
      parsedAge,
      gender
    );

    const weightPlan = generateWeightCorrectionPlan(
      parsedWeight,
      bcsResult.idealMid,
      bcsResult.estimatedBCS
    );

    return res.status(200).json({
      input: { weight: parsedWeight, age: parsedAge, gender },
      lifecycle_report: bcsResult,
      weight_correction_plan: weightPlan
    });

  } catch (err) {

    console.error("Engine crash:", err);

    return res.status(500).json({
      error: err.message
    });
  }
}