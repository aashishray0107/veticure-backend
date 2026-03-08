import { validateAAFCO } from "./aafcoValidator.js";

export function calculateMacros({

  calories,
  strategyMode,
  lifeStage,
  engineData

}) {

  if (!engineData) {
    throw new Error("engineData missing in macro engine");
  }

  if (!calories || calories <= 0) {
    throw new Error("Invalid calories passed to macro engine");
  }

  const macroRoot = engineData.Macronutrient_Ratio_Profiles;

  if (!macroRoot) {
    throw new Error("Macronutrient_Ratio_Profiles missing in dataset");
  }

  /* ---------------- Strategy Routing ---------------- */

  let profileKey = "Maintenance";

  if (strategyMode === "Fat_Loss") {
    profileKey = "Fat_Loss_Priority";
  }
  else if (strategyMode === "Weight_Gain") {
    profileKey = "Weight_Gain_Priority";
  }
  else if (strategyMode === "Muscle_Build") {
    profileKey = "Muscle_Build";
  }

  const profile = macroRoot[profileKey];

  if (!profile) {
    throw new Error(`Macro profile not found: ${profileKey}`);
  }

  /* ---------------- Ratio Normalization ---------------- */

  const totalRatio =
    profile.Protein +
    profile.Fat +
    profile.Carbs;

  if (totalRatio <= 0) {
    throw new Error("Invalid macro profile ratios");
  }

  const proteinRatio = profile.Protein / totalRatio;
  const fatRatio = profile.Fat / totalRatio;
  const carbRatio = profile.Carbs / totalRatio;

  /* ---------------- Calorie → Grams ---------------- */

 const proteinGrams = (calories * normalizedProtein) / 4;
const fatGrams = (calories * normalizedFat) / 9;
const carbGrams = (calories * normalizedCarbs) / 4;

  /* ---------------- AAFCO Validation ---------------- */

  const validated = validateAAFCO({

    calories,
    proteinGrams,
    fatGrams,
    lifeStage,
    engineData

  });
return {
  strategy_used: strategyMode,
  macro_profile_used: profileKey,
  macro_grams: {
    protein: Math.round(validated.protein_grams),
    fat: Math.round(validated.fat_grams),
    carbs: Math.round(carbGrams)
  }
};

}