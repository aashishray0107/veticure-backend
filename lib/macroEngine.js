import { validateAAFCO } from "./aafcoValidator.js";

export function calculateMacros({
  calories,
  strategyMode,
  lifeStage,
  engineData,
}) {

  if (!engineData) throw new Error("engineData missing in macro engine");
  if (!calories || calories <= 0) throw new Error("Invalid calories");

  const macroRoot = engineData.Macronutrient_Ratio_Profiles;
  if (!macroRoot) throw new Error("Macronutrient_Ratio_Profiles missing");

  let profileKey = "Maintenance";
  if (strategyMode === "Fat_Loss")     profileKey = "Fat_Loss_Priority";
  if (strategyMode === "Weight_Gain")  profileKey = "Weight_Gain_Priority";
  if (strategyMode === "Muscle_Build") profileKey = "Muscle_Build";

  const profile = macroRoot[profileKey];
  if (!profile) throw new Error(`Macro profile not found: ${profileKey}`);

  const totalRatio =
    (profile.Protein ?? 0) +
    (profile.Fat     ?? 0) +
    (profile.Carbs   ?? 0) +
    (profile.Fiber   ?? 0);

  if (totalRatio <= 0) throw new Error("Invalid macro profile ratios");

  const proteinRatio = profile.Protein / totalRatio;
  const fatRatio     = profile.Fat     / totalRatio;
  const carbRatio    = profile.Carbs   / totalRatio;
  const fiberRatio   = (profile.Fiber ?? 0) / totalRatio;

  const proteinGrams = (calories * proteinRatio) / 4;
  const fatGrams     = (calories * fatRatio)     / 9;
  const carbGrams    = (calories * carbRatio)    / 4;
  const fiberGrams   = (calories * fiberRatio)   / 4;

  const validated = validateAAFCO({
    calories, proteinGrams, fatGrams, lifeStage, engineData,
  });

  const usedCalories =
    (validated.protein_grams * 4) +
    (validated.fat_grams     * 9) +
    (fiberGrams              * 4);

  const adjustedCarbGrams = Math.max(0, calories - usedCalories) / 4;

  return {
    strategy_used:      strategyMode,
    macro_profile_used: profileKey,
    macro_grams: {
      protein: Math.round(validated.protein_grams),
      fat:     Math.round(validated.fat_grams),
      carbs:   Math.round(adjustedCarbGrams),
      fiber:   Math.round(fiberGrams),
    },
    aafco_debug: {
      lifecycle_used:        validated.lifecycle_used,
      aafco_protein_floor_g: validated.aafco_protein_floor_g,
      aafco_fat_floor_g:     validated.aafco_fat_floor_g,
      protein_was_bumped:    validated.protein_grams > proteinGrams,
      fat_was_bumped:        validated.fat_grams     > fatGrams,
    },
  };
}