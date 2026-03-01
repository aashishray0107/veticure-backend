import fs from "fs";
import path from "path";

const dataPath = path.join(process.cwd(), "data", "labrador_engine.json");
const engineData = JSON.parse(fs.readFileSync(dataPath, "utf-8"));

export function validateAAFCO({
  calories,
  proteinGrams,
  fatGrams,
  lifeStage
}) {

  if (!lifeStage) {
    throw new Error("Life stage missing in AAFCO validation");
  }

  // 🔹 FIX: Use top-level nutrition buckets
  const nutritionBlock = engineData[lifeStage];

  if (!nutritionBlock) {
    throw new Error(
      "AAFCO nutrition block not found for life stage: " + lifeStage
    );
  }

  // 🔹 Pull minimum protein & fat % from JSON
  const minProteinPercent =
    nutritionBlock?.Macronutrient_Targets?.Protein_Min_Percent;

  const minFatPercent =
    nutritionBlock?.Macronutrient_Targets?.Fat_Min_Percent;

  if (
    minProteinPercent === undefined ||
    minFatPercent === undefined
  ) {
    throw new Error(
      "Macronutrient minimum standards missing in: " + lifeStage
    );
  }

  const proteinCalories = proteinGrams * 4;
  const fatCalories = fatGrams * 9;

  const proteinPercent = proteinCalories / calories;
  const fatPercent = fatCalories / calories;

  let finalProtein = proteinGrams;
  let finalFat = fatGrams;

  // 🔹 Enforce minimum protein
  if (proteinPercent < minProteinPercent) {
    finalProtein = (calories * minProteinPercent) / 4;
  }

  // 🔹 Enforce minimum fat
  if (fatPercent < minFatPercent) {
    finalFat = (calories * minFatPercent) / 9;

    console.log("Nutrition block keys:", Object.keys(nutritionBlock));
  }

  return {
    protein_grams: Math.round(finalProtein),
    fat_grams: Math.round(finalFat)
  };
}