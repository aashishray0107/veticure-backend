import fs from "fs";
import path from "path";

const dataPath = path.join(process.cwd(), "data", "labrador_engine.json");
const engineData = JSON.parse(fs.readFileSync(dataPath, "utf-8"));

export function generateDietPlan({
  macros,
  calories,
  bcsCategory,
  preference = "non_veg"
}) {

  const foodTable = engineData.Food_Composition_Table;
  const rotation = engineData.Diet_Rotation_Config;

  if (!foodTable || !rotation) {
    throw new Error("Diet configuration missing in JSON");
  }

  const proteinTarget = macros.protein;
  const carbTarget = macros.carbs;

  const proteinList =
    preference === "non_veg"
      ? rotation.non_veg_proteins
      : rotation.veg_proteins;

  const carbList = rotation.carb_sources;
  const fiberList = rotation.fiber_sources;

  const feedingFrequency =
    engineData.Weight_Condition_Adjustment_Engine?.[bcsCategory]
      ?.Feeding_Frequency || 2;

  const weeklyPlan = [];

  let proteinIndex = 0;
  let proteinStreak = 0;

  for (let day = 1; day <= 7; day++) {

    const proteinName = proteinList[proteinIndex];
    const proteinData = foodTable[proteinName];

    const proteinQty =
      (proteinTarget / proteinData.protein) * 100;

    const carbName =
      carbList[day % carbList.length];
    const carbData = foodTable[carbName];

    const carbQty =
      (carbTarget / carbData.carbs) * 100;

    const fiberName = fiberList[0];
    const fiberQty = 60; // small digestive support

    const meals = [];

    for (let m = 1; m <= feedingFrequency; m++) {
      meals.push({
        meal_number: m,
        protein_food: proteinName,
        protein_grams: Math.round(proteinQty / feedingFrequency),
        carb_food: carbName,
        carb_grams: Math.round(carbQty / feedingFrequency),
        fiber_food: fiberName,
        fiber_grams: Math.round(fiberQty / feedingFrequency)
      });
    }

    weeklyPlan.push({
      day,
      total_daily_calories: calories,
      total_protein_g: Math.round(proteinQty),
      total_carb_g: Math.round(carbQty),
      meals
    });

    proteinStreak++;

    if (proteinStreak >= rotation.max_same_protein_streak) {
      proteinIndex =
        (proteinIndex + 1) % proteinList.length;
      proteinStreak = 0;
    }
  }

  return weeklyPlan;
}