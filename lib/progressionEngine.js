import { calculateCalories } from "./calorieEngine.js";
import { calculateMacros } from "./macroEngine.js";

/* ----------------------------------
   🔹 Weekly Progression Simulator
----------------------------------- */

export function simulateJourney({
  startWeight,
  targetWeight,
  weeklyPercent,
  mode,                // "Fat_Loss" | "Weight_Gain" | "Maintenance"
  lifeStage,
  gender,
  activity,
  season,
  symptoms = []
}) {

  if (!startWeight || !targetWeight) {
    throw new Error("Invalid weight inputs for progression engine");
  }

  if (!weeklyPercent || weeklyPercent <= 0 || mode === "Maintenance") {
    return [];
  }

  const weeklyDecimal = weeklyPercent / 100;

  let currentWeight = startWeight;

  const results = [];

  let week = 1;

  /* Safety cap: 52 weeks max */
  while (week <= 52) {

    /* ----------------------------------
       1️⃣ Update Weight
    ----------------------------------- */

    if (mode === "Fat_Loss") {
      currentWeight = currentWeight - (currentWeight * weeklyDecimal);
    }
    else if (mode === "Weight_Gain") {
      currentWeight = currentWeight + (currentWeight * weeklyDecimal);
    }

    currentWeight = Number(currentWeight.toFixed(2));

    /* Stop if goal reached */
    if (
      (mode === "Fat_Loss" && currentWeight <= targetWeight) ||
      (mode === "Weight_Gain" && currentWeight >= targetWeight)
    ) {
      currentWeight = Number(targetWeight.toFixed(2));
    }

    /* ----------------------------------
       2️⃣ Recalculate Calories
    ----------------------------------- */

    const calorieResult = calculateCalories({
      weight: currentWeight,
      ageMonths: null,        // not required for adult simulation
      activity,
      season,
      symptoms,
      lifeStage,
      bcsCategory: null       // optional in simulation phase
    });

    /* ----------------------------------
       3️⃣ Recalculate Macros
    ----------------------------------- */

    const macroResult = calculateMacros({
      calories: calorieResult.finalDailyCalories,
      strategyMode: mode,
      lifeStage
    });

    /* ----------------------------------
       4️⃣ Store Week Snapshot
    ----------------------------------- */

    results.push({
      week,
      projected_weight: currentWeight,
      calories: calorieResult.finalDailyCalories,
      protein_g: macroResult.macro_grams.protein,
      fat_g: macroResult.macro_grams.fat,
      carbs_g: macroResult.macro_grams.carbs
    });

    /* If goal reached, break */
    if (currentWeight === targetWeight) {
      break;
    }

    week++;
  }

  return results;
}