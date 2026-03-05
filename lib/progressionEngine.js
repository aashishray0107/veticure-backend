import { calculateCalories } from "./calorieEngine.js";
import { calculateMacros } from "./macroEngine.js";

/*
Veterinary guideline references:

WSAVA Global Nutrition Guidelines
NRC 2006 Canine Nutrition
Clinical weight-management studies

Safe rates:
Fat loss: 1–2 % body weight per week
Weight gain: 1.5–2.5 % per week
*/

export function simulateJourney({
  startWeight,
  targetWeight,
  mode,
  lifeStage,
  ageMonths,
  activity,
  season,
  symptoms = []
}) {

  if (!mode || mode === "Maintenance") return [];

  const results = [];

  let weight = startWeight;

  /* ---------- Determine Safe Weekly Change ---------- */

  let weeklyRate = 0;

  if (mode === "Fat_Loss") {
    weeklyRate = -0.015; // 1.5% loss per week (safe clinical average)
  }

  if (mode === "Weight_Gain") {
    weeklyRate = 0.02; // 2% gain per week
  }

  /* ---------- Simulate Weeks ---------- */

  for (let week = 1; week <= 52; week++) {

    weight = weight + weight * weeklyRate;

    weight = Number(weight.toFixed(2));

    /* ---------- Recalculate Calories ---------- */

    const calorieResult = calculateCalories({
      weight,
      ageMonths,
      activity,
      season,
      symptoms,
      lifeStage,
      bcsCategory: "Ideal"
    });

    /* ---------- Recalculate Macros ---------- */

    const macroResult = calculateMacros({
      calories: calorieResult.finalDailyCalories,
      strategyMode: mode,
      lifeStage
    });

    results.push({

      week,

      projected_weight: weight,

      weekly_percent_change: Number((weeklyRate * 100).toFixed(2)),

      calories: calorieResult.finalDailyCalories,

      protein_g: macroResult.macro_grams.protein,

      fat_g: macroResult.macro_grams.fat,

      carbs_g: macroResult.macro_grams.carbs

    });

    /* ---------- Stop When Target Reached ---------- */

    if (
      (mode === "Fat_Loss" && weight <= targetWeight) ||
      (mode === "Weight_Gain" && weight >= targetWeight)
    ) {
      break;
    }

  }

  return results;
}