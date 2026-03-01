import fs from "fs";
import path from "path";

/* ----------------------------------
   🔹 Load JSON Once
----------------------------------- */

const dataPath = path.join(process.cwd(), "data", "labrador_engine.json");
const engineData = JSON.parse(fs.readFileSync(dataPath, "utf-8"));

/* ----------------------------------
   🔹 AAFCO Validator
----------------------------------- */

export function validateAAFCO({
  calories,
  proteinGrams,
  fatGrams,
  lifeStage
}) {

  const standardsRoot = engineData.Nutrient_Standards;

  if (!standardsRoot) {
    throw new Error("Nutrient_Standards missing in JSON");
  }

  // 🔹 Choose stage specific standard
  const stageStandard =
    standardsRoot[lifeStage] ||
    standardsRoot["Adult"] ||
    null;

  if (!stageStandard) {
    throw new Error("AAFCO standard not found for life stage: " + lifeStage);
  }

  const minProteinPercent = stageStandard.Minimum_Protein_Percent;
  const minFatPercent = stageStandard.Minimum_Fat_Percent;

  if (
    minProteinPercent === undefined ||
    minFatPercent === undefined
  ) {
    throw new Error("Incomplete AAFCO minimum structure in JSON");
  }

  /* ----------------------------------
     🔹 Convert grams → % of kcal
  ----------------------------------- */

  const proteinKcal = proteinGrams * 4;
  const fatKcal = fatGrams * 9;

  const proteinPercent =
    (proteinKcal / calories) * 100;

  const fatPercent =
    (fatKcal / calories) * 100;

  let adjustedProteinGrams = proteinGrams;
  let adjustedFatGrams = fatGrams;

  /* ----------------------------------
     🔹 Enforce Minimum Protein
  ----------------------------------- */

  if (proteinPercent < minProteinPercent) {

    const requiredProteinKcal =
      (minProteinPercent / 100) * calories;

    adjustedProteinGrams =
      requiredProteinKcal / 4;
  }

  /* ----------------------------------
     🔹 Enforce Minimum Fat
  ----------------------------------- */

  if (fatPercent < minFatPercent) {

    const requiredFatKcal =
      (minFatPercent / 100) * calories;

    adjustedFatGrams =
      requiredFatKcal / 9;
  }

  return {
    protein_grams: Math.round(adjustedProteinGrams),
    fat_grams: Math.round(adjustedFatGrams)
  };
}