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
    
  const foodDB =
  engineData?.Expanded_Food_Composition_Database_v2?.Ingredients;

if (!foodDB) {
  throw new Error("Food_Composition_Database not found in JSON");
}

  const proteinTarget = macros.protein;
  const carbTarget = macros.carbs;

  const foods = Object.keys(foodDB);

  if (!foods.length) {
    throw new Error("No foods available in selected database");
  }

  const feedingFrequency =
    engineData.Weight_Condition_Adjustment_Engine?.[bcsCategory]
      ?.Feeding_Frequency || 2;

  const weeklyPlan = [];

  let proteinIndex = 0;

  for (let day = 1; day <= 7; day++) {

    const proteinFood = foods[proteinIndex % foods.length];
    const proteinData = foodDB[proteinFood];

    if (!proteinData.protein_g) {
      proteinIndex++;
      continue;
    }

    const proteinQty =
      (proteinTarget / proteinData.protein_g) * 100;

    // Rotate carb from different food (avoid same as protein)
    const carbFood =
      foods[(proteinIndex + 2) % foods.length];
    const carbData = foodDB[carbFood];

    const carbQty =
      carbData.carbs_g
        ? (carbTarget / carbData.carbs_g) * 100
        : 0;

    const meals = [];

    for (let m = 1; m <= feedingFrequency; m++) {
      meals.push({
        meal_number: m,
        protein_food: proteinFood,
        protein_grams: Math.round(proteinQty / feedingFrequency),
        carb_food: carbFood,
        carb_grams: Math.round(carbQty / feedingFrequency)
      });
    }

    weeklyPlan.push({
      day,
      total_daily_calories: calories,
      total_protein_g: Math.round(proteinQty),
      total_carb_g: Math.round(carbQty),
      meals
    });

    proteinIndex++;
  }

  return weeklyPlan;
}