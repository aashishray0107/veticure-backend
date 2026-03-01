import fs from "fs";
import path from "path";

/* ----------------------------------
   🔹 Load JSON
----------------------------------- */

const dataPath = path.join(process.cwd(), "data", "labrador_engine.json");

if (!fs.existsSync(dataPath)) {
  throw new Error("labrador_engine.json not found in /data folder");
}

const engineData = JSON.parse(fs.readFileSync(dataPath, "utf-8"));

/* 🔍 DEBUG LOGS — TEMPORARY */
console.log("TOP LEVEL:", Object.keys(engineData));
console.log(
  "BCS ROOT:",
  Object.keys(engineData.BCS_Automatic_Detection_Logic || {})
);

/* ----------------------------------
   🔹 Macro Engine
----------------------------------- */

export function calculateMacros({ calories, strategyMode }) {

  const macroRoot =
    engineData?.BCS_Automatic_Detection_Logic
      ?.Macronutrient_Ratio_Profiles;

  if (!macroRoot) {
    throw new Error("Macronutrient_Ratio_Profiles missing in JSON");
  }

  const profile = macroRoot[strategyMode];

  if (!profile) {
    throw new Error(`Macro profile not found for strategy: ${strategyMode}`);
  }

  const proteinRatio = profile.Protein;
  const fatRatio = profile.Fat;
  const carbRatio = profile.Carbs;

  const proteinGrams = (calories * proteinRatio) / 4;
  const fatGrams = (calories * fatRatio) / 9;
  const carbGrams = (calories * carbRatio) / 4;

  return {
    strategy_used: strategyMode,
    protein_grams: Math.round(proteinGrams),
    fat_grams: Math.round(fatGrams),
    carb_grams: Math.round(carbGrams)
  };
}