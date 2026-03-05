import { generateDietPlan } from "../lib/dietEngine.js";
import { simulateJourney } from "../lib/progressionEngine.js";
import { calculateCalories } from "../lib/calorieEngine.js";
import { calculateMacros } from "../lib/macroEngine.js";
import { saveReport } from "../lib/pocketbase.js";

/* ------------------ BCS ENGINE ------------------ */

function evaluateBCS(weight, idealWeight) {

  const deviation = ((weight - idealWeight) / idealWeight) * 100;

  let category = "Ideal";

  if (deviation <= -20) category = "Severely_Underweight";
  else if (deviation <= -10) category = "Underweight";
  else if (deviation <= 10) category = "Ideal";
  else if (deviation <= 20) category = "Overweight";
  else category = "Obese";

  return {
    idealWeight,
    deviationPercent: Number(deviation.toFixed(1)),
    category
  };
}

/* ------------------ STRATEGY ENGINE ------------------ */

function determineStrategy(bcsCategory, goal = "Maintenance") {

  if (bcsCategory === "Obese" || bcsCategory === "Overweight") {
    return "Fat_Loss";
  }

  if (bcsCategory === "Underweight" || bcsCategory === "Severely_Underweight") {
    return "Weight_Gain";
  }

  return goal;
}

/* ---------- JOURNEY SUMMARY ---------- */

function summarizeJourney(journey, startWeight, idealWeight) {

  if (!Array.isArray(journey) || journey.length === 0) {
    return null;
  }

  const weeks = journey.length;
  const finalWeight = journey[journey.length - 1].weight;

  const totalChange = Number((finalWeight - startWeight).toFixed(2));

  const percentChange = Number(((totalChange / startWeight) * 100).toFixed(2));

  const weeklyPercentChanges = [];

  let prev = startWeight;

  for (const w of journey) {

    const pct = ((w.weight - prev) / prev) * 100;

    weeklyPercentChanges.push(Number(pct.toFixed(2)));

    prev = w.weight;

  }

  return {

    start_weight: startWeight,
    target_weight: idealWeight,
    estimated_weeks: weeks,
    total_weight_change: totalChange,
    total_percent_change: percentChange,
    weekly_percent_changes: weeklyPercentChanges

  };

}

/* ------------------ API HANDLER ------------------ */

export default async function handler(req, res) {

  try {

    const {
      weight,
      age,
      activity,
      season,
      goal = "Maintenance",
      symptoms = []
    } = req.body;

    /* ---------- BCS ---------- */

    const idealWeight = 32; // labrador reference

    const bcs = evaluateBCS(weight, idealWeight);

    /* ---------- STRATEGY ---------- */

    const strategyMode = determineStrategy(bcs.category, goal);

    /* ---------- CALORIES ---------- */

    const calorieResult = calculateCalories({
      weight,
      ageMonths: age,
      activity,
      season,
      symptoms,
      lifeStage: "Adult",
      bcsCategory: bcs.category
    });

    /* ---------- MACROS ---------- */

    const macroResult = calculateMacros({
      calories: calorieResult.finalDailyCalories,
      strategyMode,
      lifeStage: "Adult"
    });

    /* ---------- PROGRESSION ---------- */

    const journey = simulateJourney({
      startWeight: weight,
      idealWeight: bcs.idealWeight,
      strategy: strategyMode
    });

    const journeySummary = summarizeJourney(journey, weight, bcs.idealWeight);

    /* ---------- DIET ---------- */

    const diet = generateDietPlan({
      macros: macroResult.macro_grams,
      calories: calorieResult.finalDailyCalories,
      bcsCategory: bcs.category,
      bodyWeight: weight,
      symptoms
    });

    /* ---------- SAVE REPORT (SAFE) ---------- */

    try {

      await saveReport({
        calories: calorieResult.finalDailyCalories,
        hydration_ml: calorieResult.dailyWaterML || 0,
        protein_g: macroResult.macro_grams.protein,
        fat_g: macroResult.macro_grams.fat,
        carbs_g: macroResult.macro_grams.carbs,
        strategy: strategyMode,
        bcs_category: bcs.category
      });

    } catch (dbError) {

      console.error("DB Save Failed:", dbError.message);

    }

    /* ---------- RESPONSE ---------- */

    return res.status(200).json({

      bcs_report: {
        ideal_weight: bcs.idealWeight,
        weight_deviation_percent: bcs.deviationPercent,
        bcs_category: bcs.category
      },

      strategy_used: strategyMode,

      weight_progression: journey,

      weight_progress_guidelines: journeySummary,

      calorie_report: calorieResult,

      macro_report: macroResult,

      weekly_diet_plan: diet

    });

  } catch (err) {

    console.error(err);

    return res.status(500).json({
      error: err.message
    });

  }

}