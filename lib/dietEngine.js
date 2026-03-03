import fs from "fs";
import path from "path";

const dataPath = path.join(process.cwd(), "data", "labrador_engine.json");
const engineData = JSON.parse(fs.readFileSync(dataPath, "utf-8"));

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

  const foodDB = engineData.Expanded_Food_Composition_Database_v2;

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

  const feedingFrequency =
    engineData.Weight_Condition_Adjustment_Engine?.[bcsCategory]
      ?.Feeding_Frequency || 2;

  const weeklyPlan = [];

  for (let day = 0; day < 7; day++) {

    /* -----------------------------
       1️⃣ Ingredient Rotation
    ------------------------------ */

    let vegProteinName =
      vegProteins[day % vegProteins.length];

    let nonVegProteinName =
      nonVegProteins[day % nonVegProteins.length];

    let carbName =
      carbSources[day % carbSources.length];

    let fiberName =
      fiberSources[day % fiberSources.length];

    /* -----------------------------
       2️⃣ Therapeutic Override
    ------------------------------ */

    if (symptoms.length > 0 && foodDB.therapeutic_meals) {

      if (symptoms.includes("loose_stool")) {
        carbName = foodDB.therapeutic_meals.GI_Support;
      }

      else if (symptoms.includes("low_appetite")) {
        carbName = foodDB.therapeutic_meals.Recovery;
      }

      else if (symptoms.includes("constipation")) {
        carbName = foodDB.therapeutic_meals.Digestive_Cooling;
      }
    }

    /* Prevent dual role ingredient */
    if (vegProteinName === carbName) {
      carbName =
        carbSources[(day + 1) % carbSources.length];
    }

    const vegData = foodTable[vegProteinName];
    const nonVegData = foodTable[nonVegProteinName];
    const carbData = foodTable[carbName];
    const fiberData = foodTable[fiberName];

    if (!vegData || !nonVegData || !carbData) {
      throw new Error(`Food missing in DB: ${vegProteinName}, ${nonVegProteinName}, or ${carbName}`);
    }

    /* -----------------------------
       3️⃣ Protein Allocation
       20% veg, 80% animal
    ------------------------------ */

    const vegProteinTarget = proteinTarget * 0.2;

    let vegQty =
      (vegProteinTarget / vegData.protein_g) * 100;

    if (vegQty > 250) vegQty = 250;

    const vegProteinActual =
      (vegQty * vegData.protein_g) / 100;

    const remainingProtein =
      proteinTarget - vegProteinActual;

    let nonVegQty =
      (remainingProtein / nonVegData.protein_g) * 100;

    /* Egg upper bound safeguard */
    if (
      nonVegProteinName.toLowerCase().includes("egg") &&
      nonVegQty > 400
    ) {
      nonVegQty = 400;
    }

    /* -----------------------------
       4️⃣ Carb Allocation
    ------------------------------ */

    let carbQty =
      (carbTarget / carbData.carbs_g) * 100;

    /* -----------------------------
       5️⃣ Fiber Allocation
       Fixed safe moderate base
    ------------------------------ */

    let fiberQty = 80;

    /* -----------------------------
       6️⃣ Ingredient Safety Cap
    ------------------------------ */

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

    /* -----------------------------
       7️⃣ Meal Split
    ------------------------------ */

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
      meals
    });
  }

  return weeklyPlan;
}