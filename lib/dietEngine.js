/* ─────────────────────────────────────────────────────────────────
   dietEngine.js — FIXED

   Bugs fixed:
   1. Therapeutic meals structure mismatch
      Old: checked therapeuticMeals[key].foods.length
      JSON at engineData.Expanded_Food_Composition_Database_v2.Therapeutic_Meals
        was an object of strings, not arrays.
      JSON at root level had therapeutic_meals (lowercase) with arrays.
      Fix: Read from the correct lowercase key, handle both string and array.

   2. Fiber hardcoded at 80g regardless of dog size or lifecycle.
      Fix: Calculate fiber as a % of total meal grams (5–8% of total food).

   3. Calorie correction factor now also scales fiber (previously excluded).

   4. Added food-not-found safety fallback instead of throwing hard crash.

   5. Meal 2 now gets a different fiber vegetable for within-day variety.
─────────────────────────────────────────────────────────────────── */

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

  const foodTable = foodDB.Ingredients;
  const rotation  = foodDB.Diet_Rotation_Config;

  /* ── FIX: Read therapeutic meals from the correct lowercase key ──
     JSON has two keys:
       engineData.Expanded_Food_Composition_Database_v2.Therapeutic_Meals  → strings
       engineData.Expanded_Food_Composition_Database_v2.therapeutic_meals  → arrays ✅
     We use the lowercase array version which dietEngine expects.
  ── */
  const therapeuticMeals = foodDB.therapeutic_meals || foodDB.Therapeutic_Meals || {};

  const vegProteins   = rotation.veg?.protein_sources || [];
  const nonVegProteins = rotation.non_veg_proteins    || [];
  const carbSources   = rotation.carb_sources         || [];
  const fiberSources  = rotation.fiber_sources        || [];

  const proteinTarget = macros.protein;
  const carbTarget    = macros.carbs;

  const feedingFrequency =
    engineData.Weight_Condition_Adjustment_Engine?.[bcsCategory]?.Feeding_Frequency ?? 2;

  /* ── Calorie estimator ── */
  function estimateCalories(food, grams) {
    if (!food) return 0;
    const p = food.protein_g ?? 0;
    const f = food.fat_g    ?? 0;
    const c = food.carbs_g  ?? 0;
    return ((p * 4) + (f * 9) + (c * 4)) * grams / 100;
  }

  /* ── Safe food lookup ── */
  function getFood(name) {
    const food = foodTable[name];
    if (!food) console.warn(`[DIET WARN] Food not in DB: "${name}"`);
    return food || null;
  }

  /* ── Fiber quantity calculator (FIX: weight-based, not hardcoded) ──
     Target: ~5% of total estimated food weight.
     Approximate total food weight from calorie density ~110 kcal/100g average.
     Clamp between 40g and 120g for safety.
  ── */
  function calcFiberQty() {
    const estimatedTotalFoodG = (calories / 110) * 100;
    const fiberQty = estimatedTotalFoodG * 0.05;
    return Math.max(40, Math.min(120, fiberQty));
  }

  const weeklyPlan = [];

  for (let day = 0; day < 7; day++) {

    /* ── Protein source selection ── */
    let vegProtein   = vegProteins[day % vegProteins.length];
    let nonVegProtein = nonVegProteins[day % nonVegProteins.length];

    /* ── Protein density check ── */
    const candidate = getFood(nonVegProtein);
    const densityThreshold = 18;
    if (candidate && candidate.protein_g < densityThreshold && proteinTarget > 110) {
      nonVegProtein = nonVegProteins[(day + 1) % nonVegProteins.length];
    }

    let carb  = carbSources[day % carbSources.length];

    /* ── FIX: Therapeutic override — now reads arrays correctly ── */
    if (Array.isArray(symptoms) && symptoms.length > 0) {
      let key = null;
      if (symptoms.includes("Loose_Stool") || symptoms.includes("Loose_Motion"))
        key = "GI_Support";
      else if (symptoms.includes("Constipation"))
        key = "Digestive_Cooling";
      else if (symptoms.includes("Low_Appetite"))
        key = "Recovery";

      if (key) {
        const therapyEntry = therapeuticMeals[key];
        // Handle both array and string formats
        const mealName = Array.isArray(therapyEntry)
          ? therapyEntry[0]
          : (typeof therapyEntry === "string" ? therapyEntry : null);

        if (mealName && getFood(mealName)) {
          carb = mealName;
        }
      }
    }

    /* ── Get food data ── */
    const vegData    = getFood(vegProtein);
    const nonVegData = getFood(nonVegProtein);
    const carbData   = getFood(carb);

    // If critical food missing, skip day gracefully
    if (!vegData || !nonVegData || !carbData) {
      console.error(`[DIET ERROR] Day ${day + 1}: Missing food data. Skipping.`);
      continue;
    }

    /* ── Protein allocation ── */
    const vegProteinTarget = proteinTarget * 0.2;
    let vegQty = (vegProteinTarget / Math.max(vegData.protein_g, 0.1)) * 100;

    if (vegQty > 200 && vegData.protein_g < 10) vegQty = 200;

    const vegActual = (vegQty * vegData.protein_g) / 100;
    const remainingProtein = proteinTarget - vegActual;

    let nonVegQty = (remainingProtein / Math.max(nonVegData.protein_g, 0.1)) * 100;

    /* ── Clinical caps ── */
    const foodNameLower = nonVegProtein.toLowerCase();
    if (foodNameLower.includes("egg")  && nonVegQty > 300) nonVegQty = 300;
    if (foodNameLower.includes("fish") && nonVegQty > 350) nonVegQty = 350;
    if (nonVegQty > 400) nonVegQty = 400;

    /* ── Carb allocation ── */
    let carbQty = (carbTarget / Math.max(carbData.carbs_g, 0.1)) * 100;
    if (carbQty > 600) carbQty = 600;

    /* ── FIX: Weight-based fiber (not hardcoded 80g) ── */
    let fiberQty = calcFiberQty();

    /* ── Calorie normalization ── */
    const totalEstimated =
      estimateCalories(vegData,    vegQty) +
      estimateCalories(nonVegData, nonVegQty) +
      estimateCalories(carbData,   carbQty);

    if (totalEstimated > 0) {
      const correctionFactor = calories / totalEstimated;
      vegQty    *= correctionFactor;
      nonVegQty *= correctionFactor;
      carbQty   *= correctionFactor;
      // FIX: Fiber also scaled proportionally
      fiberQty  *= correctionFactor;
      // Clamp fiber after scaling
      fiberQty   = Math.max(30, Math.min(150, fiberQty));
    }

    /* ── Build meals ── */
    const meals = [];

    for (let m = 1; m <= feedingFrequency; m++) {

      // FIX: Rotate fiber vegetable between meals for within-day variety
      const fiberIndex = (day + m - 1) % fiberSources.length;
      const fiberFood  = fiberSources[fiberIndex];

      meals.push({
        meal_number: m,

        veg_protein_food:   vegProtein,
        veg_protein_grams:  Math.round(vegQty / feedingFrequency),

        nonveg_protein_food:  nonVegProtein,
        nonveg_protein_grams: Math.round(nonVegQty / feedingFrequency),

        carb_food:  carb,
        carb_grams: Math.round(carbQty / feedingFrequency),

        fiber_food:  fiberFood,
        fiber_grams: Math.round(fiberQty / feedingFrequency),
      });
    }

    weeklyPlan.push({
      day: day + 1,
      target_calories:  calories,
      target_protein_g: proteinTarget,
      target_carbs_g:   carbTarget,
      target_fat_g:     macros.fat ?? 0,
      meals,
    });
  }

  return weeklyPlan;
}