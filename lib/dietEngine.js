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
  engineData.Expanded_Food_Composition_Database_v2 ||
  engineData.Food_Composition_Database;

if (!foodDB) {
  throw new Error("Food database missing in JSON");
}

const foodTable = foodDB.Ingredients;
const rotation = foodDB.Diet_Rotation_Config;

if (!foodTable || !rotation) {
  throw new Error("Diet rotation config missing inside food database");
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

  for (let day = 0; day < 7; day++) {

    const proteinName = proteinList[day % proteinList.length];
    const carbName = carbList[day % carbList.length];

    const proteinData = foodTable[proteinName];
    const carbData = foodTable[carbName];

    if (!proteinData || !carbData) {
      throw new Error("Food not found in composition table");
    }

    if (proteinData.protein <= 0 || carbData.carbs <= 0) {
      throw new Error("Invalid macro values in food table");
    }

    // Strict macro math
    const proteinQty =
      (proteinTarget / proteinData.protein) * 100;

    const carbQty =
      (carbTarget / carbData.carbs) * 100;

    const meals = [];

    for (let m = 1; m <= feedingFrequency; m++) {
      meals.push({
        meal_number: m,
        protein_food: proteinName,
        protein_grams: Math.round(proteinQty / feedingFrequency),
        carb_food: carbName,
        carb_grams: Math.round(carbQty / feedingFrequency)
      });
    }

    weeklyPlan.push({
      day: day + 1,
      total_daily_calories: calories,
      total_protein_g: proteinTarget,
      total_carb_g: carbTarget,
      meals
    });
  }

  return weeklyPlan;
}