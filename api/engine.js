import { calculateBCS } from "../lib/bcsEngine.js";

function calculateRER(weight) {
  return 70 * Math.pow(weight, 0.75);
}

function calculateHydration(weight) {
  return weight * 55; // 55 ml per kg
}

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      return res.status(405).json({ error: "Method Not Allowed" });
    }

    const body = req.body || {};

    const weight = parseFloat(body.weight);
    const age = parseInt(body.age);

    if (isNaN(weight) || isNaN(age)) {
      return res.status(400).json({ error: "Invalid weight or age" });
    }

    const bcsResult = calculateBCS(weight, age);

    const rer = calculateRER(weight);
    const hydration = calculateHydration(weight);

    return res.status(200).json({
      input: { weight, age },
      lifecycle_report: bcsResult,
      energy_report: {
        RER: Math.round(rer)
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