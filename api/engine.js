import { calculateBCS } from "../lib/bcsEngine.js";

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      return res.status(405).json({ error: "Method Not Allowed" });
    }

    const { weight, age } = req.body || {};

    if (!weight || !age) {
      return res.status(400).json({ error: "Missing weight or age" });
    }

    const result = calculateBCS(
      parseFloat(weight),
      parseInt(age)
    );

    return res.status(200).json({
      input: { weight, age },
      lifecycle_report: result
    });

  } catch (err) {
    console.error("Engine crash:", err);
    return res.status(500).json({ error: err.message });
  }
}