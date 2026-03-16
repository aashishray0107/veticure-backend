export function generateDietPlan({
  macros,
  calories,
  bcsCategory,
  bodyWeight,
  symptoms = [],
  engineData,
}) {

  if (!engineData) throw new Error("engineData missing in diet engine");
  if (!bodyWeight || bodyWeight <= 0) throw new Error("Invalid bodyWeight");

  const foodDB = engineData.Expanded_Food_Composition_Database_v2;
  if (!foodDB?.Ingredients || !foodDB?.Diet_Rotation_Config) {
    throw new Error("Food DB config missing");
  }

  const foodTable      = foodDB.Ingredients;
  const rotation       = foodDB.Diet_Rotation_Config;
  const therapeuticMeals = foodDB.therapeutic_meals || foodDB.Therapeutic_Meals || {};

  const vegProteins    = rotation.veg?.protein_sources || [];
  const nonVegProteins = rotation.non_veg_proteins     || [];
  const carbSources    = rotation.carb_sources         || [];
  const fiberSources   = rotation.fiber_sources        || [];

  const proteinTarget = macros.protein;
  const carbTarget    = macros.carbs;

  const feedingFrequency =
    engineData.Weight_Condition_Adjustment_Engine?.[bcsCategory]?.Feeding_Frequency ?? 2;

  function estimateCalories(food, grams) {
    if (!food) return 0;
    return (((food.protein_g ?? 0) * 4) + ((food.fat_g ?? 0) * 9) + ((food.carbs_g ?? 0) * 4)) * grams / 100;
  }

  function getFood(name) {
    const food = foodTable[name];
    if (!food) console.warn(`[DIET] Food not in DB: "${name}"`);
    return food || null;
  }

  function calcFiberQty() {
    const estimatedTotalFoodG = (calories / 110) * 100;
    return Math.max(40, Math.min(120, estimatedTotalFoodG * 0.05));
  }

  const weeklyPlan = [];

  for (let day = 0; day < 7; day++) {

    let vegProtein    = vegProteins[day % vegProteins.length];
    let nonVegProtein = nonVegProteins[day % nonVegProteins.length];

    const candidate = getFood(nonVegProtein);
    if (candidate && candidate.protein_g < 18 && proteinTarget > 110) {
      nonVegProtein = nonVegProteins[(day + 1) % nonVegProteins.length];
    }

    let carb = carbSources[day % carbSources.length];

    /* Therapeutic override */
    if (Array.isArray(symptoms) && symptoms.length > 0) {
      let key = null;
      if (symptoms.includes("Loose_Stool") || symptoms.includes("Loose_Motion")) key = "GI_Support";
      else if (symptoms.includes("Constipation"))  key = "Digestive_Cooling";
      else if (symptoms.includes("Low_Appetite"))  key = "Recovery";

      if (key) {
        const entry    = therapeuticMeals[key];
        const mealName = Array.isArray(entry) ? entry[0] : (typeof entry === "string" ? entry : null);
        if (mealName && getFood(mealName)) carb = mealName;
      }
    }

    const vegData    = getFood(vegProtein);
    const nonVegData = getFood(nonVegProtein);
    const carbData   = getFood(carb);

    if (!vegData || !nonVegData || !carbData) {
      console.error(`[DIET] Day ${day + 1}: Missing food. Skipping.`);
      continue;
    }

    /* Protein allocation */
    let vegQty = (proteinTarget * 0.2 / Math.max(vegData.protein_g, 0.1)) * 100;
    if (vegQty > 200 && vegData.protein_g < 10) vegQty = 200;

    const vegActual        = (vegQty * vegData.protein_g) / 100;
    const remainingProtein = proteinTarget - vegActual;
    let nonVegQty          = (remainingProtein / Math.max(nonVegData.protein_g, 0.1)) * 100;

    /* Clinical caps */
    const nl = nonVegProtein.toLowerCase();
    if (nl.includes("egg")  && nonVegQty > 300) nonVegQty = 300;
    if (nl.includes("fish") && nonVegQty > 350) nonVegQty = 350;
    if (nonVegQty > 400) nonVegQty = 400;

    /* Carb */
    let carbQty = (carbTarget / Math.max(carbData.carbs_g, 0.1)) * 100;
    if (carbQty > 600) carbQty = 600;

    /* Fiber */
    let fiberQty = calcFiberQty();

    /* Calorie correction */
    const totalEst = estimateCalories(vegData, vegQty) +
                     estimateCalories(nonVegData, nonVegQty) +
                     estimateCalories(carbData, carbQty);

    if (totalEst > 0) {
      const cf  = calories / totalEst;
      vegQty   *= cf;
      nonVegQty *= cf;
      carbQty  *= cf;
      fiberQty *= cf;
      fiberQty  = Math.max(30, Math.min(150, fiberQty));
    }

    /* Build meals */
    const meals = [];
    for (let m = 1; m <= feedingFrequency; m++) {
      const fiberFood = fiberSources[(day + m - 1) % fiberSources.length];
      meals.push({
        meal_number:          m,
        veg_protein_food:     vegProtein,
        veg_protein_grams:    Math.round(vegQty    / feedingFrequency),
        nonveg_protein_food:  nonVegProtein,
        nonveg_protein_grams: Math.round(nonVegQty / feedingFrequency),
        carb_food:            carb,
        carb_grams:           Math.round(carbQty   / feedingFrequency),
        fiber_food:           fiberFood,
        fiber_grams:          Math.round(fiberQty  / feedingFrequency),
      });
    }

    weeklyPlan.push({
      day:              day + 1,
      target_calories:  calories,
      target_protein_g: proteinTarget,
      target_carbs_g:   carbTarget,
      target_fat_g:     macros.fat ?? 0,
      meals,
    });
  }

  return weeklyPlan;
}