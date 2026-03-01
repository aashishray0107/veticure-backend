import fs from "fs";
import path from "path";

const dataPath = path.join(process.cwd(), "data", "labrador_engine.json");
const engineData = JSON.parse(fs.readFileSync(dataPath, "utf-8"));

export function calculateMacros({ calories, strategyMode }) {

  const macroRoot = engineData.Macronutrient_Ratio_Profiles;

  if (!macroRoot) {
    throw new Error("Macronutrient_Ratio_Profiles missing at top level");
  }

  let profileKey = strategyMode;

  if (strategyMode === "Fat_Loss") {
    profileKey = "Fat_Loss_Priority";
  }

  if (strategyMode === "Weight_Gain") {
    profileKey = "Weight_Gain_Priority";
  }

  const profile = macroRoot[profileKey];

  if (!profile) {
    throw new Error(`Macro profile not found for strategy: ${profileKey}`);
  }

  const proteinGrams = (calories * profile.Protein) / 4;
  const fatGrams = (calories * profile.Fat) / 9;
  const carbGrams = (calories * profile.Carbs) / 4;

  return {
    strategy_used: profileKey,
    macro_grams: {
      protein: Math.round(proteinGrams),
      fat: Math.round(fatGrams),
      carbs: Math.round(carbGrams)
    }
  };
}