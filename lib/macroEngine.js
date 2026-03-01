import fs from "fs";
import path from "path";

/* ----------------------------------
   🔹 Load JSON (Single Source of Truth)
----------------------------------- */

const dataPath = path.join(process.cwd(), "data", "labrador_engine.json");

if (!fs.existsSync(dataPath)) {
  throw new Error("labrador_engine.json not found in /data folder");
}

const engineData = JSON.parse(fs.readFileSync(dataPath, "utf-8"));

/* ----------------------------------
   🔹 Macro Execution Layer
----------------------------------- */

export function calculateMacros({ calories, strategyMode }) {

  if (!calories || calories <= 0) {
    throw new Error("Invalid calorie input for macro calculation");
  }

  if (!strategyMode) {
    throw new Error("Strategy mode required for macro calculation");
  }

  const bcsRoot = engineData.BCS_Automatic_Detection_Logic;

  if (!bcsRoot) {
    throw new Error("BCS_Automatic_Detection_Logic missing in JSON");
  }

  const macroRoot = bcsRoot.Macronutrient_Ratio_Profiles;

  if (!macroRoot || typeof macroRoot !== "object") {
    throw new Error("Macronutrient_Ratio_Profiles missing in JSON structure");
  }

  /* ----------------------------------
     🔹 Strategy Translation Layer
  ----------------------------------- */

  let profileKey = strategyMode;

  if (strategyMode === "Fat_Loss") {
    profileKey = "Fat_Loss_Priority";
  }

  if (strategyMode === "Weight_Gain") {
    profileKey = "Weight_Gain_Priority";
  }

  if (!macroRoot[profileKey]) {
    throw new Error(
      `Macro profile not found for strategy: ${profileKey}`
    );
  }

  const profile = macroRoot[profileKey];

  if (
    profile.Protein === undefined ||
    profile.Fat === undefined ||
    profile.Carbs === undefined
  ) {
    throw new Error(
      `Incomplete macro profile structure for ${profileKey}`
    );
  }

  /* ----------------------------------
     🔹 Convert Calories → Grams
     Protein = 4 kcal/g
     Carbs   = 4 kcal/g
     Fat     = 9 kcal/g
  ----------------------------------- */

  const proteinGrams = (calories * profile.Protein) / 4;
  const fatGrams = (calories * profile.Fat) / 9;
  const carbGrams = (calories * profile.Carbs) / 4;

  return {
    strategy_used: profileKey,
    macro_ratios: {
      protein_ratio: profile.Protein,
      fat_ratio: profile.Fat,
      carb_ratio: profile.Carbs
    },
    macro_grams: {
      protein: Math.round(proteinGrams),
      fat: Math.round(fatGrams),
      carbs: Math.round(carbGrams)
    }
  };
}