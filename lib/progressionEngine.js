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

  if (!startWeight) {
    throw new Error("Invalid weight inputs for progression engine");
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

  /* Safety cap: 52 weeks */
  while (week <= 52) {

    /* ----------------------------------
       0️⃣ Age Progression (if puppy)
    ----------------------------------- */
    if (currentAge !== null) {
      currentAge += 0.25; // 1 week ≈ 0.25 month
    }

    /* Stop growth simulation at 12 months */
    if (
      mode.startsWith("Growth") &&
      currentAge !== null &&
      currentAge >= 12
    ) {
      break;
    }

    /* ----------------------------------
       1️⃣ Update Weight
    ----------------------------------- */

    if (mode === "Fat_Loss") {
      currentWeight -= currentWeight * weeklyDecimal;
    }
    else if (mode === "Weight_Gain") {
      currentWeight += currentWeight * weeklyDecimal;
    }
    else if (mode === "Growth_Slowdown") {
      // Hold weight stable while skeleton catches up
      currentWeight = currentWeight;
    }
    else if (mode === "Growth_Acceleration") {
      currentWeight += currentWeight * 0.01;
    }

    currentWeight = Number(currentWeight.toFixed(2));

    /* Adult stop condition */
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
      ageMonths: currentAge,
      activity,
      season,
      symptoms,
      lifeStage,
      bcsCategory:
        mode === "Fat_Loss"
          ? "Obese"
          : mode === "Weight_Gain"
          ? "Underweight"
          : "Ideal"
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
       4️⃣ Store Snapshot
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
       5️⃣ Adult Maintenance Switch
    ----------------------------------- */

    if (
      (mode === "Fat_Loss" || mode === "Weight_Gain") &&
      currentWeight === targetWeight
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