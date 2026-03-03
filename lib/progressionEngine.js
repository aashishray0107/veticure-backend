import { calculateCalories } from "./calorieEngine.js";
import { calculateMacros } from "./macroEngine.js";

/* ----------------------------------
   🔹 Weekly Progression Simulator
----------------------------------- */

export function simulateJourney({
  startWeight,
  targetWeight,
  weeklyPercent,
  mode,
  lifeStage,
  startAgeMonths = null,
  gender,
  activity,
  season,
  symptoms = []
}) {

  if (!startWeight || startWeight <= 0) {
    throw new Error("Invalid startWeight for progression engine");
  }

  if (!mode || mode === "Maintenance") {
    return [];
  }

  let currentWeight = Number(startWeight);
  let currentAge =
    typeof startAgeMonths === "number"
      ? Number(startAgeMonths)
      : null;

  const weeklyDecimal =
    weeklyPercent && weeklyPercent > 0
      ? weeklyPercent / 100
      : 0;

  const results = [];
  let week = 1;

  /* Safety Cap: 52 weeks max */
  while (week <= 52) {

    /* ----------------------------------
       1️⃣ Age Progression (Puppies)
    ----------------------------------- */

    if (currentAge !== null) {
      currentAge += 0.25; // 1 week ≈ 0.25 month
    }

    if (
      mode.startsWith("Growth") &&
      currentAge !== null &&
      currentAge >= 12
    ) {
      break;
    }

    /* ----------------------------------
       2️⃣ Weight Update
    ----------------------------------- */

    if (mode === "Fat_Loss") {
      currentWeight -= currentWeight * weeklyDecimal;
    }
    else if (mode === "Weight_Gain") {
      currentWeight += currentWeight * weeklyDecimal;
    }
    else if (mode === "Growth_Acceleration") {
      currentWeight += currentWeight * 0.01;
    }
    // Growth_Slowdown = weight stable

    currentWeight = Number(currentWeight.toFixed(2));

    /* Adult Stop Conditions */

    let reachedTarget = false;

    if (mode === "Fat_Loss" && currentWeight <= targetWeight) {
      currentWeight = Number(targetWeight.toFixed(2));
      reachedTarget = true;
    }

    if (mode === "Weight_Gain" && currentWeight >= targetWeight) {
      currentWeight = Number(targetWeight.toFixed(2));
      reachedTarget = true;
    }

    /* ----------------------------------
       3️⃣ Dynamic BCS Category
    ----------------------------------- */

    let dynamicBCS = "Ideal";

    if (mode === "Fat_Loss") dynamicBCS = "Obese";
    else if (mode === "Weight_Gain") dynamicBCS = "Underweight";

    /* ----------------------------------
       4️⃣ Recalculate Calories
    ----------------------------------- */

    const calorieResult = calculateCalories({
      weight: currentWeight,
      ageMonths: currentAge,
      activity,
      season,
      symptoms,
      lifeStage,
      bcsCategory: dynamicBCS
    });

    /* ----------------------------------
       5️⃣ Recalculate Macros
    ----------------------------------- */

    const macroResult = calculateMacros({
      calories: calorieResult.finalDailyCalories,
      strategyMode: mode,
      lifeStage
    });

    /* ----------------------------------
       6️⃣ Store Weekly Snapshot
    ----------------------------------- */

    results.push({
      week,
      projected_weight: currentWeight,
      calories: calorieResult.finalDailyCalories,
      protein_g: macroResult.macro_grams.protein,
      fat_g: macroResult.macro_grams.fat,
      carbs_g: macroResult.macro_grams.carbs
    });

    /* ----------------------------------
       7️⃣ Switch to Maintenance
    ----------------------------------- */

    if (
      (mode === "Fat_Loss" || mode === "Weight_Gain") &&
      reachedTarget
    ) {

      const maintenanceCalories = calculateCalories({
        weight: currentWeight,
        ageMonths: currentAge,
        activity,
        season,
        symptoms,
        lifeStage,
        bcsCategory: "Ideal"
      });

      const maintenanceMacros = calculateMacros({
        calories: maintenanceCalories.finalDailyCalories,
        strategyMode: "Maintenance",
        lifeStage
      });

      results.push({
        week: week + 1,
        projected_weight: currentWeight,
        calories: maintenanceCalories.finalDailyCalories,
        protein_g: maintenanceMacros.macro_grams.protein,
        fat_g: maintenanceMacros.macro_grams.fat,
        carbs_g: maintenanceMacros.macro_grams.carbs,
        note: "Maintenance phase begins"
      });

      break;
    }

    week++;
  }

  return results;
}