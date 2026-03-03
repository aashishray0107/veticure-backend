import { generateDietPlan } from "../lib/dietEngine.js";
import { simulateJourney } from "../lib/progressionEngine.js";
import { calculateCalories } from "../lib/calorieEngine.js";
import { calculateMacros } from "../lib/macroEngine.js";

export default function handler(req, res) {

  try {

    const {
      weight,
      age,
      activity,
      season,
      symptoms = []
    } = req.body;

    const calorieResult = calculateCalories({
      weight,
      ageMonths: age,
      activity,
      season,
      symptoms,
      lifeStage: "Adult",
      bcsCategory: "Ideal"
    });

    const macroResult = calculateMacros({
      calories: calorieResult.finalDailyCalories,
      strategyMode: "Maintenance",
      lifeStage: "Adult"
    });

    const diet = generateDietPlan({
      macros: macroResult.macro_grams,
      calories: calorieResult.finalDailyCalories,
      bcsCategory: "Ideal",
      bodyWeight: weight,
      symptoms
    });

    return res.status(200).json({
      calorie_report: calorieResult,
      macro_report: macroResult,
      weekly_diet_plan: diet
    });

  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: err.message });
  }
}