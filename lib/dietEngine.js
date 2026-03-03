import fs from "fs";
import path from "path";

/* Load JSON once */
const dataPath = path.join(process.cwd(), "data/labrador_engine.json");

if (!fs.existsSync(dataPath)) {
  throw new Error("labrador_engine.json missing");
}

const engineData = JSON.parse(
  fs.readFileSync(dataPath, "utf-8")
);

const therapeuticMeals = engineData?.Therapeutic_Meals || {};

export function generateDietPlan({
  macros,
  calories,
  bcsCategory,
  bodyWeight,
  symptoms = []
}) {

  if (!bodyWeight || bodyWeight <= 0) {
    throw new Error("Invalid bodyWeight");
  }

  const foodDB = engineData.Expanded_Food_Composition_Database_v2;

  if (!foodDB?.Ingredients || !foodDB?.Diet_Rotation_Config) {
    throw new Error("Food DB config missing");
  }

  const foodTable = foodDB.Ingredients;
  const rotation = foodDB.Diet_Rotation_Config;

  const vegProteins = rotation.veg?.protein_sources || [];
  const nonVegProteins = rotation.non_veg_proteins || [];
  const carbSources = rotation.carb_sources || [];
  const fiberSources = rotation.fiber_sources || [];

  const proteinTarget = macros.protein;
  const carbTarget = macros.carbs;
  const fatTarget = macros.fat || 0;

  const feedingFrequency =
    engineData.Weight_Condition_Adjustment_Engine?.[bcsCategory]
      ?.Feeding_Frequency || 2;

  const weeklyPlan = [];

  for (let day = 0; day < 7; day++) {

    let vegProtein = vegProteins[day % vegProteins.length];
let nonVegProtein =
  nonVegProteins[day % nonVegProteins.length];

/* Prefer higher density proteins if protein target high */
const densityThreshold = 18; // g per 100g

const candidate = foodTable[nonVegProtein];

if (
  candidate &&
  candidate.protein_g < densityThreshold &&
  proteinTarget > 110
) {
  // switch to next protein in rotation
  nonVegProtein =
    nonVegProteins[(day + 1) % nonVegProteins.length];
}    let carb = carbSources[day % carbSources.length];
    let fiber = fiberSources[day % fiberSources.length];

    /* Therapeutic override */
    if (Array.isArray(symptoms)) {
      const useGI = symptoms.includes("Loose_Stool");
      const useRecovery = symptoms.includes("Low_Appetite");
      const useConstipation = symptoms.includes("Constipation");

      let key = null;
      if (useGI) key = "GI_Support";
      else if (useConstipation) key = "Digestive_Cooling";
      else if (useRecovery) key = "Recovery";

      if (key && therapeuticMeals?.[key]?.foods?.length) {
        const mealName = therapeuticMeals[key].foods[0];
        if (foodTable[mealName]) {
          carb = mealName;
        }
      }
    }

    const vegData = foodTable[vegProtein];
    const nonVegData = foodTable[nonVegProtein];
    const carbData = foodTable[carb];

    if (!vegData || !nonVegData || !carbData) {
      throw new Error("Food missing in DB");
    }

    /* Allocation */

const vegProteinTarget = proteinTarget * 0.2;

let vegQty =
  (vegProteinTarget / vegData.protein_g) * 100;

if (vegQty > 200 && vegData.protein_g < 10) {
  vegQty = 200;
}

const vegActual =
  (vegQty * vegData.protein_g) / 100;

const remainingProtein =
  proteinTarget - vegActual;

let nonVegQty =
  (remainingProtein / nonVegData.protein_g) * 100;

/* -------- Clinical Caps -------- */

const foodName = nonVegProtein.toLowerCase();

if (foodName.includes("egg") && nonVegQty > 300)
  nonVegQty = 300;

if (foodName.includes("fish") && nonVegQty > 350)
  nonVegQty = 350;

if (nonVegQty > 400)
  nonVegQty = 400;

/* ---- Carb Allocation ---- */

let carbQty =
  (carbTarget / carbData.carbs_g) * 100;

if (carbQty > 600)
  carbQty = 600;

/* ---- Fiber ---- */

let fiberQty = 80;

    const meals = [];

    for (let m = 1; m <= feedingFrequency; m++) {
      meals.push({
        meal_number: m,
        veg_protein_food: vegProtein,
        veg_protein_grams: Math.round(vegQty / feedingFrequency),
        nonveg_protein_food: nonVegProtein,
        nonveg_protein_grams: Math.round(nonVegQty / feedingFrequency),
        carb_food: carb,
        carb_grams: Math.round(carbQty / feedingFrequency),
        fiber_food: fiber,
        fiber_grams: Math.round(fiberQty / feedingFrequency)
      });
    }

    weeklyPlan.push({
      day: day + 1,
      target_calories: calories,
      target_protein_g: proteinTarget,
      target_carbs_g: carbTarget,
      target_fat_g: fatTarget,
      meals
    });
  }

  return weeklyPlan;
}