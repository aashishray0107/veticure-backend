function resolveLifecycleCategory(lifeStage) {

  if (!lifeStage) return null;

  if (
    lifeStage.includes("Puppy") ||
    lifeStage.includes("Juvenile") ||
    lifeStage.includes("Adolescence")
  ) return "Puppy";

  if (
    lifeStage.includes("Senior") ||
    lifeStage.includes("Geriatric")
  ) return "Senior";

  return "Adult";
}

export function validateAAFCO({

  calories,
  proteinGrams,
  fatGrams,
  lifeStage,
  engineData

}) {

  if (!engineData) {
    throw new Error("engineData missing in AAFCO validator");
  }

  const standardsRoot =
    engineData?.Macronutrient_Ratio_Profiles
      ?.Nutrient_Minimum_Standards;

  if (!standardsRoot) {
    throw new Error("Nutrient_Minimum_Standards missing");
  }

  let lifecycle = "Adult";

  if (lifeStage.includes("Puppy")) lifecycle = "Puppy";
  if (lifeStage.includes("Senior")) lifecycle = "Senior";

  const standard = standardsRoot[lifecycle];

  const proteinPercent =
    (proteinGrams * 4) / calories;

  const fatPercent =
    (fatGrams * 9) / calories;

  let finalProtein = proteinGrams;
  let finalFat = fatGrams;

  if (proteinPercent < standard.Protein_Min) {
    finalProtein = (calories * standard.Protein_Min) / 4;
  }

  if (fatPercent < standard.Fat_Min) {
    finalFat = (calories * standard.Fat_Min) / 9;
  }

  return {

    protein_grams: Math.round(finalProtein),
    fat_grams: Math.round(finalFat)

  };

}