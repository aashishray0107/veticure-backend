import { calculateBCS } from "../lib/bcsEngine.js";

function calculateRER(weight) {
  return 70 * Math.pow(weight, 0.75);
}

function calculateHydration(weight) {
  return weight * 55;
}

function getMERMultiplier(activity) {
  if (activity === "low") return 1.2;
  if (activity === "moderate") return 1.5;
  if (activity === "high") return 1.8;
  return 1.4;
}

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      return res.status(405).json({ error: "Method Not Allowed" });
    }

    const body = req.body || {};

    const weight = parseFloat(body.weight);
    const age = parseInt(body.age);
    const activity = (body.activity || "moderate").toLowerCase();

    if (isNaN(weight) || isNaN(age)) {
      return res.status(400).json({ error: "Invalid weight or age" });
    }

    const bcsResult = calculateBCS(weight, age);

    const rer = calculateRER(weight);
    const merMultiplier = getMERMultiplier(activity);
    let dailyCalories = rer * merMultiplier;

    // 🔥 Strategy Override Based on BCS
    if (bcsResult.category === "Obese") {
      dailyCalories *= 0.8; // 20% deficit
    }

    if (bcsResult.category === "Underweight") {
      dailyCalories *= 1.2; // 20% surplus
    }

    // 🔥 Global Safety Cap
    const minCalories = rer * 0.7;
    const maxCalories = rer * 1.35;

    if (dailyCalories < minCalories) dailyCalories = minCalories;
    if (dailyCalories > maxCalories) dailyCalories = maxCalories;

    const hydration = calculateHydration(weight);

    return res.status(200).json({
      input: { weight, age, activity },
      lifecycle_report: bcsResult,
      energy_report: {
        RER: Math.round(rer),
        MER_multiplier: merMultiplier,
        final_daily_calories: Math.round(dailyCalories)
      },
      hydration_report: {
        daily_water_ml: Math.round(hydration)
      }
    });

  } catch (error) {
    console.error("Engine error:", error);
    return res.status(500).json({ error: "Engine failed" });
  }
}