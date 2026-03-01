import fs from "fs";
import path from "path";

const dataPath = path.join(process.cwd(), "data", "labrador_engine.json");

if (!fs.existsSync(dataPath)) {
  throw new Error("labrador_engine.json not found in /data");
}

const engineData = JSON.parse(
  fs.readFileSync(dataPath, "utf-8")
);

function resolveLifecycleCategory(lifeStage) {

  if (!lifeStage) return null;

  if (
    lifeStage.includes("Puppy") ||
    lifeStage.includes("Juvenile") ||
    lifeStage.includes("Adolescence")
  ) {
    return "Puppy";
  }

  if (
    lifeStage.includes("Senior") ||
    lifeStage.includes("Geriatric")
  ) {
    return "Senior";
  }

  return "Adult";
}

export function validateAAFCO({
  calories,
  proteinGrams,
  fatGrams,
  lifeStage
}) {

  if (!calories || calories <= 0)
    throw new Error("Invalid calories for AAFCO validation");

  const standardsRoot =
    engineData?.Macronutrient_Ratio_Profiles
      ?.Nutrient_Minimum_Standards;

  if (!standardsRoot)
    throw new Error("Nutrient_Minimum_Standards missing in JSON");

  const lifecycleCategory =
    resolveLifecycleCategory(lifeStage);

  if (!lifecycleCategory)
    throw new Error("Unable to resolve lifecycle category");

  const standard = standardsRoot[lifecycleCategory];

  if (!standard)
    throw new Error(
      `No AAFCO standard found for lifecycle: ${lifecycleCategory}`
    );

  /* -----------------------------------
     Convert grams → percent of calories
  ----------------------------------- */

  const proteinPercent =
    (proteinGrams * 4) / calories;

  const fatPercent =
    (fatGrams * 9) / calories;

  /* -----------------------------------
     Enforce Minimums
  ----------------------------------- */

  const minProtein = standard.Protein_Min;
  const minFat = standard.Fat_Min;

  let finalProteinGrams = proteinGrams;
  let finalFatGrams = fatGrams;

  if (proteinPercent < minProtein) {
    finalProteinGrams =
      (calories * minProtein) / 4;
  }

  if (fatPercent < minFat) {
    finalFatGrams =
      (calories * minFat) / 9;
  }

  return {
    protein_grams: Math.round(finalProteinGrams),
    fat_grams: Math.round(finalFatGrams)
  };
}