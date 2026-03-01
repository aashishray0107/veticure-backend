import { calculateBCS } from "../lib/bcsEngine.js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  const { weight, age } = req.body;

  const result = calculateBCS(weight, age);

  return res.status(200).json({
    input: { weight, age },
    bcs_result: result
  });
}