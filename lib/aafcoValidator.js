const DM_ENERGY_DENSITY = 3.5;

export function validateAAFCO({
  calories,
  proteinGrams,
  fatGrams,
  lifeStage,
  engineData,
}) {

  if (!engineData) throw new Error("engineData missing in AAFCO validator");

  const standardsRoot =
    engineData?.Macronutrient_Ratio_Profiles?.Nutrient_Minimum_Standards;

  if (!standardsRoot) throw new Error("Nutrient_Minimum_Standards missing");

  let lifecycle = "Adult";
  if (lifeStage?.includes("Puppy") ||
      lifeStage?.includes("Juvenile") ||
      lifeStage?.includes("Adolescence") ||
      lifeStage?.includes("Neonatal") ||
      lifeStage?.includes("Transitional") ||
      lifeStage?.includes("Socialization")) {
    lifecycle = "Puppy";
  } else if (lifeStage?.includes("Senior") || lifeStage?.includes("Geriatric")) {
    lifecycle = "Senior";
  }

  const standard = standardsRoot[lifecycle];
  if (!standard) throw new Error(`No AAFCO standard for lifecycle: ${lifecycle}`);

  const minProteinGrams = (calories * standard.Protein_Min) / DM_ENERGY_DENSITY;
  const minFatGrams     = (calories * standard.Fat_Min)     / DM_ENERGY_DENSITY;

  const finalProtein = Math.max(proteinGrams, minProteinGrams);
  const finalFat     = Math.max(fatGrams,     minFatGrams);

  return {
    protein_grams:         finalProtein,
    fat_grams:             finalFat,
    lifecycle_used:        lifecycle,
    aafco_protein_floor_g: Math.round(minProteinGrams),
    aafco_fat_floor_g:     Math.round(minFatGrams),
  };
}