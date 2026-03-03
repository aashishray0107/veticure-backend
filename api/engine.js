import fs from "fs";
import path from "path";

/* ----------------------------------
   🔹 Load JSON
----------------------------------- */

const dataPath = path.join(
  process.cwd(),
  "data/labrador_engine.json"
);

if (!fs.existsSync(dataPath)) {
  throw new Error("labrador_engine.json not found in /data folder");
}

const engineData = JSON.parse(
  fs.readFileSync(dataPath, "utf-8")
);

const therapeuticMeals =
  engineData?.Therapeutic_Meals || {};

/* ----------------------------------
   🔹 Diet Engine
----------------------------------- */

export function generateDietPlan({
  macros,
  calories,
  bcsCategory,
  preference = "non_veg",
  bodyWeight,
  symptoms = []
}) {

  if (!bodyWeight || bodyWeight <= 0) {
    throw new Error("Invalid bodyWeight passed to diet engine");
  }

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

  if (!vegProteins.length || !nonVegProteins.length || !carbSources.length) {
    throw new Error("Rotation configuration incomplete");
  }

  const proteinTarget = macros.protein;
  const carbTarget = macros.carbs;
  const fatTarget = macros.fat || 0;

  const feedingFrequency =
    engineData.Weight_Condition_Adjustment_Engine?.[bcsCategory]
      ?.Feeding_Frequency || 2;

  const weeklyPlan = [];

  for (let day = 0; day < 7; day++) {

    /* ===============================
       1️⃣ Rotation
    =============================== */

    let vegProteinName =
      vegProteins[day % vegProteins.length];

    let nonVegProteinName =
      nonVegProteins[day % nonVegProteins.length];

    let carbName =
      carbSources[day % carbSources.length];

    let fiberName =
      fiberSources[day % fiberSources.length];

    /* ===============================
       2️⃣ Therapeutic Full Override
    =============================== */

    let therapeuticOverride = false;

    if (Array.isArray(symptoms) && symptoms.length > 0) {

      const useGI =
        symptoms.includes("Loose_Stool") ||
        symptoms.includes("GI_Distress");

      const useConstipation =
        symptoms.includes("Constipation");

      const useRecovery =
        symptoms.includes("Recovery") ||
        symptoms.includes("Low_Appetite");

      let therapeuticKey = null;

      if (useGI) therapeuticKey = "GI_Support";
      else if (useConstipation) therapeuticKey = "Digestive_Cooling";
      else if (useRecovery) therapeuticKey = "Recovery";

      if (
        therapeuticKey &&
        therapeuticMeals?.[therapeuticKey]?.foods?.length
      ) {
        const mealName =
          therapeuticMeals[therapeuticKey].foods[0];

        if (foodTable[mealName]) {
          vegProteinName = mealName;
          nonVegProteinName = mealName;
          carbName = mealName;
          therapeuticOverride = true;
        }
      }
    }

    /* Prevent dual role in normal mode */
    if (!therapeuticOverride && vegProteinName === carbName) {
      carbName =
        carbSources[(day + 1) % carbSources.length];
    }

    const vegData = foodTable[vegProteinName];
    const nonVegData = foodTable[nonVegProteinName];
    const carbData = foodTable[carbName];
    const fiberData = foodTable[fiberName];

    if (!vegData || !nonVegData || !carbData) {
      throw new Error(
        `Food missing in DB: ${vegProteinName}, ${nonVegProteinName}, or ${carbName}`
      );
    }

    /* ===============================
       3️⃣ Quantity Allocation
    =============================== */

    let vegQty = 0;
    let nonVegQty = 0;
    let carbQty = 0;
    let fiberQty = 80;

    if (!therapeuticOverride) {

      // 20% veg protein
      const vegProteinTarget = proteinTarget * 0.2;

      vegQty =
        (vegProteinTarget / vegData.protein_g) * 100;

      if (vegQty > 250) vegQty = 250;

      const vegProteinActual =
        (vegQty * vegData.protein_g) / 100;

      const remainingProtein =
        proteinTarget - vegProteinActual;

      nonVegQty =
        (remainingProtein / nonVegData.protein_g) * 100;

      // Egg upper safety
      if (
        nonVegProteinName.toLowerCase().includes("egg") &&
        nonVegQty > 400
      ) {
        nonVegQty = 400;
      }

      carbQty =
        (carbTarget / carbData.carbs_g) * 100;

    } else {
      // Therapeutic meal simple split
      carbQty =
        (carbTarget / carbData.carbs_g) * 100;
      vegQty = 0;
      nonVegQty = 0;
    }

    /* ===============================
       4️⃣ Ingredient Safety Caps
    =============================== */

    const totalWeight =
      vegQty + nonVegQty + carbQty + fiberQty;

    if (
      vegData.max_safe_percentage_of_total_meal &&
      vegQty / totalWeight >
        vegData.max_safe_percentage_of_total_meal
    ) {
      vegQty =
        totalWeight *
        vegData.max_safe_percentage_of_total_meal;
    }

    if (
      nonVegData.max_safe_percentage_of_total_meal &&
      nonVegQty / totalWeight >
        nonVegData.max_safe_percentage_of_total_meal
    ) {
      nonVegQty =
        totalWeight *
        nonVegData.max_safe_percentage_of_total_meal;
    }

    /* ===============================
       5️⃣ Meal Split
    =============================== */

    const meals = [];

    for (let m = 1; m <= feedingFrequency; m++) {

      meals.push({
        meal_number: m,

        veg_protein_food: vegProteinName,
        veg_protein_grams:
          Math.round(vegQty / feedingFrequency),

        nonveg_protein_food: nonVegProteinName,
        nonveg_protein_grams:
          Math.round(nonVegQty / feedingFrequency),

        carb_food: carbName,
        carb_grams:
          Math.round(carbQty / feedingFrequency),

        fiber_food: fiberName,
        fiber_grams:
          Math.round(fiberQty / feedingFrequency)
      });
    }

    weeklyPlan.push({
      day: day + 1,
      target_calories: calories,
      target_protein_g: proteinTarget,
      target_carbs_g: carbTarget,
      target_fat_g: fatTarget,
      therapeutic_applied: therapeuticOverride,
      meals
    });
  }

  return weeklyPlan;
}