import { calculateMacros } from "./macroEngine.js";
import { calculateCalories } from "./calorieEngine.js";

export function simulateJourney({

  startWeight,
  targetWeight,
  weeklyPercent,
  mode,
  lifeStage,
  ageMonths,
  activity = "Moderate",
  season = "Normal",
  symptoms = [],
  engineData

}) {

  if (!mode || mode === "Maintenance") return [];

  if (!startWeight || startWeight <= 0) {
    throw new Error("Invalid startWeight for progression engine");
  }

  if (!engineData) {
    throw new Error("engineData missing in progression engine");
  }

  let weight = startWeight;

  const weeklyDecimal = weeklyPercent / 100;

  const results = [];

  const MAX_WEEKS = 52;

  for (let week = 1; week <= MAX_WEEKS; week++) {

    /* ---------------- WEIGHT CHANGE ---------------- */

    if (mode === "Fat_Loss") {

      weight = weight - (weight * weeklyDecimal);

    }

    else if (mode === "Weight_Gain" || mode === "Muscle_Build") {

      weight = weight + (weight * weeklyDecimal);

    }

    weight = Number(weight.toFixed(2));

    /* ---------------- CALORIE RECALCULATION ---------------- */

    const calorieResult = calculateCalories({

      weight,
      ageMonths,
      activity,
      season,
      symptoms,
      lifeStage,
      bcsCategory: "Ideal",
      engineData

    });

    /* ---------------- MACRO RECALCULATION ---------------- */

    const macroResult = calculateMacros({

      calories: calorieResult.finalDailyCalories,
      strategyMode: mode,
      lifeStage,
      engineData

    });

    /* ---------------- STORE WEEK DATA ---------------- */

    results.push({

      week,

      projected_weight: weight,

      weekly_percent_change:
        mode === "Fat_Loss"
          ? -weeklyPercent
          : weeklyPercent,

      calories: calorieResult.finalDailyCalories,

      protein_g: macroResult.macro_grams.protein,

      fat_g: macroResult.macro_grams.fat,

      carbs_g: macroResult.macro_grams.carbs

    });

    /* ---------------- STOP CONDITIONS ---------------- */

    if (mode === "Fat_Loss" && weight <= targetWeight) {
      break;
    }

    if (mode === "Weight_Gain" && weight >= targetWeight) {
      break;
    }

    if (mode === "Muscle_Build" && week >= 12) {
      break;
    }

  }

  return results;

}