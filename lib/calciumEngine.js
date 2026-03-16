const GROWTH_STAGES = new Set([
  "Socialization_Puppy", "Early_Puppy",
  "Juvenile_I", "Juvenile_II", "Juvenile_III",
  "Adolescence_Early", "Adolescence_Mid", "Adolescence_Late",
]);

const SENIOR_STAGES = new Set([
  "Early_Senior", "Senior", "Geriatric",
]);

const CA_MIN  = 3.0;
const CA_MAX  = 4.5;
const CAP_MIN = 1.1;
const CAP_MAX = 1.4;
const P_MIN   = 0.3;
const P_MAX   = 0.5;

export function buildDailyIngredients(dayPlan) {
  const totals = {};
  for (const meal of dayPlan.meals) {
    const items = [
      { name: meal.veg_protein_food,    grams: meal.veg_protein_grams    },
      { name: meal.nonveg_protein_food, grams: meal.nonveg_protein_grams },
      { name: meal.carb_food,           grams: meal.carb_grams           },
      { name: meal.fiber_food,          grams: meal.fiber_grams          },
    ];
    for (const { name, grams } of items) {
      if (!name || !grams || grams <= 0) continue;
      totals[name] = (totals[name] ?? 0) + grams;
    }
  }
  return Object.entries(totals).map(([food_name, grams]) => ({ food_name, grams }));
}

function computeMinerals(dailyIngredients, finalDailyCalories, foodTable) {
  let totalCa = 0;
  let totalP  = 0;

  for (const { food_name, grams } of dailyIngredients) {
    const food = foodTable[food_name];
    if (!food) { console.warn(`[CA] Not in DB: "${food_name}"`); continue; }
    totalCa += (food.calcium_g_per_100g    ?? 0) * grams / 100;
    totalP  += (food.phosphorus_g_per_100g ?? 0) * grams / 100;
  }

  return {
    total_calcium_g:         Number(totalCa.toFixed(4)),
    total_phosphorus_g:      Number(totalP.toFixed(4)),
    calcium_per_1000kcal:    Number((finalDailyCalories > 0 ? (totalCa / finalDailyCalories) * 1000 : 0).toFixed(3)),
    phosphorus_per_1000kcal: Number((finalDailyCalories > 0 ? (totalP  / finalDailyCalories) * 1000 : 0).toFixed(3)),
    ca_to_p_ratio:           totalP > 0 ? Number((totalCa / totalP).toFixed(3)) : null,
  };
}

function calcSupplement(minerals, finalDailyCalories, bodyWeight, lifeStage, engineData) {
  if (!GROWTH_STAGES.has(lifeStage)) {
    return {
      required: false, source: null,
      supplement_grams_per_day: 0, calcium_added_g: 0,
      final_calcium_g: minerals.total_calcium_g,
      final_phosphorus_g: minerals.total_phosphorus_g,
      final_ca_to_p_ratio: minerals.ca_to_p_ratio,
      final_calcium_per_1000kcal: minerals.calcium_per_1000kcal,
      status: "not_applicable_adult_or_senior", warning: null,
    };
  }

  const suppModule = engineData.Calcium_Supplementation_Module;
  if (!suppModule) throw new Error("Calcium_Supplementation_Module missing in JSON");

  const source = suppModule.Sources?.find(s => s.name === "Calcium_Carbonate_Food_Grade")
              || suppModule.Sources?.[0];
  if (!source) throw new Error("No calcium source in JSON");

  const caTarget = (CA_MIN * finalDailyCalories) / 1000;
  const deficit  = Math.max(0, caTarget - minerals.total_calcium_g);

  if (deficit === 0) {
    const caMax   = (CA_MAX * finalDailyCalories) / 1000;
    return {
      required: false, source: null,
      supplement_grams_per_day: 0, calcium_added_g: 0,
      final_calcium_g: minerals.total_calcium_g,
      final_phosphorus_g: minerals.total_phosphorus_g,
      final_ca_to_p_ratio: minerals.ca_to_p_ratio,
      final_calcium_per_1000kcal: minerals.calcium_per_1000kcal,
      status: "sufficient",
      warning: minerals.total_calcium_g > caMax
        ? `Calcium too high: ${minerals.total_calcium_g.toFixed(3)}g vs max ${caMax.toFixed(3)}g. Vet needed.`
        : null,
    };
  }

  let suppGrams  = Math.min(deficit / source.calcium_g_per_gram, source.max_safe_gram_per_kg_bodyweight * bodyWeight);
  let finalCa    = minerals.total_calcium_g    + (suppGrams * source.calcium_g_per_gram);
  let finalP     = minerals.total_phosphorus_g + (suppGrams * (source.phosphorus_g_per_gram ?? 0));
  let finalCaToP = finalP > 0 ? finalCa / finalP : null;
  let warning    = null;
  let loops      = 0;

  while (finalCaToP !== null && finalCaToP > CAP_MAX && suppGrams > 0 && loops < 20) {
    suppGrams  = Math.max(0, suppGrams - 0.05);
    finalCa    = minerals.total_calcium_g    + (suppGrams * source.calcium_g_per_gram);
    finalP     = minerals.total_phosphorus_g + (suppGrams * (source.phosphorus_g_per_gram ?? 0));
    finalCaToP = finalP > 0 ? finalCa / finalP : null;
    loops++;
  }

  if (finalCaToP !== null && finalCaToP < CAP_MIN)
    warning = `Ca:P ratio ${finalCaToP.toFixed(2)} below minimum ${CAP_MIN}. Vet review required.`;

  const finalCaPer1000 = (finalCa / finalDailyCalories) * 1000;
  if (finalCaPer1000 > CA_MAX)
    warning = `Calcium ${finalCaPer1000.toFixed(2)}g/1000kcal exceeds max ${CA_MAX}. Reduce dose. Vet needed.`;

  return {
    required:                   suppGrams > 0,
    source:                     source.name,
    supplement_grams_per_day:   Number(suppGrams.toFixed(2)),
    calcium_added_g:            Number((suppGrams * source.calcium_g_per_gram).toFixed(4)),
    final_calcium_g:            Number(finalCa.toFixed(4)),
    final_phosphorus_g:         Number(finalP.toFixed(4)),
    final_calcium_per_1000kcal: Number(finalCaPer1000.toFixed(3)),
    final_ca_to_p_ratio:        finalCaToP !== null ? Number(finalCaToP.toFixed(3)) : null,
    ratio_loop_iterations:      loops,
    status:                     suppGrams > 0 ? "supplemented" : "sufficient",
    warning,
  };
}

function checkSeniorP(minerals, lifeStage, dailyIngredients, foodTable) {
  if (!SENIOR_STAGES.has(lifeStage)) {
    return {
      senior_check_required: false,
      phosphorus_per_1000kcal: minerals.phosphorus_per_1000kcal,
      within_safe_range: true, warning: null, high_phosphorus_foods: [],
    };
  }

  const pP1000 = minerals.phosphorus_per_1000kcal;
  const ok     = pP1000 >= P_MIN && pP1000 <= P_MAX;

  const pFoods = dailyIngredients
    .map(({ food_name, grams }) => {
      const food = foodTable[food_name];
      return food ? { food_name, grams, phosphorus_g_per_100g: food.phosphorus_g_per_100g ?? 0 } : null;
    })
    .filter(Boolean)
    .sort((a, b) => b.phosphorus_g_per_100g - a.phosphorus_g_per_100g)
    .slice(0, 3);

  let warning = null;
  if (pP1000 > P_MAX)
    warning = `Phosphorus ${pP1000.toFixed(2)}g/1000kcal exceeds senior limit ${P_MAX}. Replace "${pFoods[0]?.food_name}". Vet needed.`;
  if (pP1000 < P_MIN)
    warning = `Phosphorus ${pP1000.toFixed(2)}g/1000kcal below senior minimum ${P_MIN}. Review protein sources.`;

  return {
    senior_check_required: true,
    phosphorus_per_1000kcal: Number(pP1000.toFixed(3)),
    safe_range: [P_MIN, P_MAX],
    within_safe_range: ok,
    warning,
    high_phosphorus_foods: pFoods,
  };
}

export function calculateCalcium({
  dayPlan, finalDailyCalories, bodyWeight, lifeStage, engineData,
}) {
  if (!engineData)                    throw new Error("engineData missing in calciumEngine");
  if (!dayPlan)                       throw new Error("dayPlan missing");
  if (!lifeStage)                     throw new Error("lifeStage missing");
  if (!bodyWeight || bodyWeight <= 0) throw new Error("Invalid bodyWeight");
  if (!finalDailyCalories || finalDailyCalories <= 0) throw new Error("Invalid finalDailyCalories");

  const foodTable = engineData.Expanded_Food_Composition_Database_v2?.Ingredients;
  if (!foodTable) throw new Error("Food DB Ingredients missing in JSON");

  const dailyIngredients  = buildDailyIngredients(dayPlan);
  const minerals          = computeMinerals(dailyIngredients, finalDailyCalories, foodTable);
  const calcium_supplement = calcSupplement(minerals, finalDailyCalories, bodyWeight, lifeStage, engineData);
  const phosphorus_control = checkSeniorP(minerals, lifeStage, dailyIngredients, foodTable);

  const isGrowth = GROWTH_STAGES.has(lifeStage);
  const isSenior = SENIOR_STAGES.has(lifeStage);

  let caStatus = "within_range";
  if (minerals.calcium_per_1000kcal < CA_MIN) caStatus = "below_minimum";
  if (minerals.calcium_per_1000kcal > CA_MAX) caStatus = "above_maximum";

  return {
    minerals,
    calcium_supplement,
    phosphorus_control,
    lifecycle_summary: {
      life_stage:                   lifeStage,
      is_growth_stage:              isGrowth,
      is_senior_stage:              isSenior,
      is_adult_stage:               !isGrowth && !isSenior,
      ca_target_range_per_1000kcal: [CA_MIN, CA_MAX],
      ca_actual_per_1000kcal:       minerals.calcium_per_1000kcal,
      ca_status:                    caStatus,
    },
  };
}