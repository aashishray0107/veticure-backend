import fs from "fs";
import path from "path";
import { validateAAFCO } from "./aafcoValidator.js";

const dataPath = path.join(process.cwd(), "data", "labrador_engine.json");

if (!fs.existsSync(dataPath)) {
  throw new Error("labrador_engine.json not found in /data folder");
}

const engineData = JSON.parse(fs.readFileSync(dataPath, "utf-8"));

export function calculateMacros({
  calories,
  strategyMode,
  lifeStage
}) {

  if (!calories || calories <= 0) {
    throw new Error("Invalid calories passed to macro engine");
  }

  const macroRoot = engineData.Macronutrient_Ratio_Profiles;

  if (!macroRoot) {
    throw new Error("Macronutrient_Ratio_Profiles missing in JSON");
  }

  let profileKey = strategyMode;

  if (strategyMode === "Fat_Loss")
    profileKey = "Fat_Loss_Priority";

  if (strategyMode === "Weight_Gain")
    profileKey = "Weight_Gain_Priority";

  const profile = macroRoot[profileKey];

  if (!profile) {
    throw new Error(`Macro profile not found for strategy: ${profileKey}`);
  }

  /* -------------------------
     Initial Macro Distribution
  -------------------------- */

  let proteinGrams = (calories * profile.Protein) / 4;
  let fatGrams = (calories * profile.Fat) / 9;
  let carbGrams = (calories * profile.Carbs) / 4;

  /* -------------------------
     AAFCO Validation
  -------------------------- */

  const validated = validateAAFCO({
    calories,
    proteinGrams,
    fatGrams,
    lifeStage
  });

  const proteinFinal = validated.protein_grams;
  const fatFinal = validated.fat_grams;

  /* -------------------------
     Energy Conservation Fix
  -------------------------- */

  const proteinKcal = proteinFinal * 4;
  const fatKcal = fatFinal * 9;

  const remainingKcal = calories - proteinKcal - fatKcal;

  const carbFinal = remainingKcal > 0
    ? remainingKcal / 4
    : 0;

  return {
    strategy_used: strategyMode,
    macro_grams: {
      protein: Math.round(proteinFinal),
      fat: Math.round(fatFinal),
      carbs: Math.round(carbFinal)
    }
  };
}