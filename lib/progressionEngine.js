import { calculateMacros } from "./macroEngine.js";
import { calculateCalories } from "./calorieEngine.js";

export function simulateJourney({
  startWeight,
  targetWeight,
  weeklyPercent,
  mode,
  lifeStage,
  activity = "Moderate",
  season = "Normal",
  symptoms = []
}) {

  if (!mode || mode === "Maintenance") return [];

  let weight = startWeight;

  const weeklyDecimal = weeklyPercent / 100;

  const results = [];

  for (let week = 1; week <= 52; week++) {

    /* ---------- WEIGHT CHANGE ---------- */

    if (mode === "Fat_Loss") {
      weight -= weight * weeklyDecimal;
    }

    if (mode === "Weight_Gain" || mode === "Muscle_Build") {
      weight += weight * weeklyDecimal;
    }

    weight = Number(weight.toFixed(2));

    /* ---------- RECALCULATE CALORIES ---------- */

    const calorieResult = calculateCalories({
      weight,
      ageMonths: 24, // placeholder since progression doesn't change age
      activity,
      season,
      symptoms,
      lifeStage,
      bcsCategory: "Ideal"
    });

    /* ---------- RECALCULATE MACROS ---------- */

    const macros = calculateMacros({
      calories: calorieResult.finalDailyCalories,
      strategyMode: mode,
      lifeStage
    });

    /* ---------- STORE WEEK RESULT ---------- */

    results.push({
      week,
      projected_weight: weight,
      weekly_percent_change:
        mode === "Fat_Loss" ? -weeklyPercent : weeklyPercent,
      calories: calorieResult.finalDailyCalories,
      protein_g: macros.macro_grams.protein,
      fat_g: macros.macro_grams.fat,
      carbs_g: macros.macro_grams.carbs
    });

    /* ---------- STOP WHEN TARGET REACHED ---------- */

    if (
      (mode === "Fat_Loss" && weight <= targetWeight) ||
      (mode === "Weight_Gain" && weight >= targetWeight)
    ) {
      break;
    }

  }

  return results;
}