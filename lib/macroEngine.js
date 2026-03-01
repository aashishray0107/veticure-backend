import fs from "fs";
import path from "path";

const dataPath = path.join(process.cwd(), "data", "labrador_engine.json");

const engineData = JSON.parse(
  fs.readFileSync(dataPath, "utf-8")
);

export function calculateMacros({ calories, strategyMode }) {

  console.log("StrategyMode received:", strategyMode);

  const bcsRoot = engineData.BCS_Automatic_Detection_Logic;

  if (!bcsRoot) {
    throw new Error("BCS_Automatic_Detection_Logic missing in JSON");
  }

  console.log("BCS Root Keys:", Object.keys(bcsRoot));

  const macroRoot = bcsRoot.Macronutrient_Ratio_Profiles;

  if (!macroRoot) {
    throw new Error(
      "Macronutrient_Ratio_Profiles not found under BCS_Automatic_Detection_Logic"
    );
  }

  console.log("Available Macro Profiles:", Object.keys(macroRoot));

  let profileKey = strategyMode;

  if (strategyMode === "Fat_Loss") {
    profileKey = "Fat_Loss_Priority";
  }

  if (strategyMode === "Weight_Gain") {
    profileKey = "Weight_Gain_Priority";
  }

  const profile = macroRoot[profileKey];

  if (!profile) {
    throw new Error(
      `Macro profile not found for strategy: ${profileKey}`
    );
  }

  const proteinGrams = (calories * profile.Protein) / 4;
  const fatGrams = (calories * profile.Fat) / 9;
  const carbGrams = (calories * profile.Carbs) / 4;

  return {
    strategy_used: profileKey,
    protein_grams: Math.round(proteinGrams),
    fat_grams: Math.round(fatGrams),
    carb_grams: Math.round(carbGrams)
  };
}