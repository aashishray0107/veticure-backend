import { calculateMacros } from "./macroEngine.js";

export function simulateJourney({
  startWeight,
  targetWeight,
  weeklyPercent,
  mode,
  lifeStage,
  calories
}) {

  if (!mode || mode === "Maintenance") return [];

  let weight = startWeight;

  const weeklyDecimal = weeklyPercent / 100;

  const results = [];

  const macroResult = calculateMacros({
    calories,
    strategyMode: mode,
    lifeStage
  });

  for (let week = 1; week <= 52; week++) {

    if (mode === "Fat_Loss") {
      weight -= weight * weeklyDecimal;
    }

    if (mode === "Weight_Gain") {
      weight += weight * weeklyDecimal;
    }

    weight = Number(weight.toFixed(2));

    results.push({
      week,
      projected_weight: weight,
      weekly_percent_change: -weeklyPercent,
      calories: calories,
      protein_g: macroResult.macro_grams.protein,
      fat_g: macroResult.macro_grams.fat,
      carbs_g: macroResult.macro_grams.carbs
    });

    if (
      (mode === "Fat_Loss" && weight <= targetWeight) ||
      (mode === "Weight_Gain" && weight >= targetWeight)
    ) {
      break;
    }

  }

  return results;
}