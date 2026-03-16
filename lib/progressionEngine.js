import { calculateMacros }   from "./macroEngine.js";
import { calculateCalories } from "./calorieEngine.js";

function estimateBCSCategory(currentWeight, targetWeight) {
  const deviation = ((currentWeight - targetWeight) / targetWeight) * 100;
  if (deviation <= -20) return "Severely_Underweight";
  if (deviation <= -5)  return "Underweight";
  if (deviation <= 5)   return "Ideal";
  if (deviation <= 20)  return "Overweight";
  return "Obese";
}

export function simulateJourney({
  startWeight,
  targetWeight,
  weeklyPercent,
  mode,
  lifeStage,
  ageMonths,
  activity,
  season = "Normal",
  symptoms = [],
  engineData,
}) {

  if (!engineData) throw new Error("engineData missing in progression engine");
  if (!mode || mode === "Maintenance") return [];
  if (!startWeight || startWeight <= 0) throw new Error("Invalid startWeight");

  let weight          = startWeight;
  const weeklyDecimal = weeklyPercent / 100;
  const results       = [];

  for (let week = 1; week <= 52; week++) {

    if (mode === "Fat_Loss") {
      weight = weight - (weight * weeklyDecimal);
    } else if (mode === "Weight_Gain" || mode === "Muscle_Build") {
      weight = weight + (weight * weeklyDecimal);
    }

    weight = Number(weight.toFixed(2));

    const currentBCS = estimateBCSCategory(weight, targetWeight);

    const calorieResult = calculateCalories({
      weight, ageMonths, activity, season, symptoms,
      lifeStage, bcsCategory: currentBCS, engineData,
    });

    const macroResult = calculateMacros({
      calories: calorieResult.finalDailyCalories,
      strategyMode: mode, lifeStage, engineData,
    });

    results.push({
      week,
      projected_weight:      weight,
      bcs_category:          currentBCS,
      weekly_percent_change: mode === "Fat_Loss" ? -weeklyPercent : weeklyPercent,
      calories:              calorieResult.finalDailyCalories,
      protein_g:             macroResult.macro_grams.protein,
      fat_g:                 macroResult.macro_grams.fat,
      carbs_g:               macroResult.macro_grams.carbs,
    });

    if (mode === "Fat_Loss"    && weight <= targetWeight) break;
    if (mode === "Weight_Gain" && weight >= targetWeight) break;
    if (mode === "Muscle_Build" && week >= 12)            break;
  }

  return results;
}