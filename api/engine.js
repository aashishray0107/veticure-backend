import { calculateBCS } from "../lib/bcsEngine.js";

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

    const result = calculateBCS(weight, age);

    return res.status(200).json({
      input: { weight, age },
      bcs_result: result
    });

  } catch (error) {
    console.error("Engine error:", error);
    return res.status(500).json({ error: "Engine failed" });
  }
}