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
    engineData.Expanded_Food_Composition_Database_v2;

  if (!foodDB?.Ingredients || !foodDB?.Diet_Rotation_Config) {
    throw new Error("Food DB or rotation config missing");
  }

  const foodTable = foodDB.Ingredients;
  const rotation = foodDB.Diet_Rotation_Config;

  const vegProteins = rotation.veg?.protein_sources || [];
  const nonVegProteins = rotation.non_veg_proteins || [];
  const carbSources = rotation.carb_sources || [];
  const fiberSources = rotation.fiber_sources || [];

  const proteinTarget = macros.protein;
  const carbTarget = macros.carbs;

  const feedingFrequency =
    engineData.Weight_Condition_Adjustment_Engine?.[bcsCategory]
      ?.Feeding_Frequency || 2;

  const weeklyPlan = [];

  for (let day = 0; day < 7; day++) {

    const vegProteinName =
      vegProteins[day % vegProteins.length];

    const nonVegProteinName =
      nonVegProteins[day % nonVegProteins.length];

    const carbName =
      carbSources[day % carbSources.length];

    const fiberName =
      fiberSources[day % fiberSources.length];

    const vegData = foodTable[vegProteinName];
    const nonVegData = foodTable[nonVegProteinName];
    const carbData = foodTable[carbName];
    const fiberData = foodTable[fiberName];

    if (!vegData || !nonVegData || !carbData) {
      throw new Error("Food missing in DB");
    }

    /* 1️⃣ Veg protein = 20% target (realistic cap 250g) */

    const vegProteinTarget = proteinTarget * 0.2;

    let vegQty =
      (vegProteinTarget / vegData.protein_g) * 100;

    if (vegQty > 250) vegQty = 250;

    const vegProteinActual =
      (vegQty * vegData.protein_g) / 100;

    /* 2️⃣ Remaining from animal */

    const remainingProtein =
      proteinTarget - vegProteinActual;

    const nonVegQty =
      (remainingProtein / nonVegData.protein_g) * 100;

    /* 3️⃣ Carb */

    const carbQty =
      (carbTarget / carbData.carbs_g) * 100;

    /* 4️⃣ Fiber fixed */

    const fiberQty = 80;

    const meals = [];

    for (let m = 1; m <= feedingFrequency; m++) {
      meals.push({
        meal_number: m,
        veg_protein_food: vegProteinName,
        veg_protein_grams: Math.round(vegQty / feedingFrequency),

        nonveg_protein_food: nonVegProteinName,
        nonveg_protein_grams: Math.round(nonVegQty / feedingFrequency),

        carb_food: carbName,
        carb_grams: Math.round(carbQty / feedingFrequency),

        fiber_food: fiberName,
        fiber_grams: Math.round(fiberQty / feedingFrequency)
      });
    }

    weeklyPlan.push({
      day: day + 1,
      target_calories: calories,
      target_protein_g: proteinTarget,
      target_carbs_g: carbTarget,
      meals
    });
  }

  return weeklyPlan;
}