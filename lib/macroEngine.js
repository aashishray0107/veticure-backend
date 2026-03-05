import fs from "fs";
import path from "path";
import { validateAAFCO } from "./aafcoValidator.js";

const dataPath = path.join(process.cwd(), "data", "labrador_engine.json");
const engineData = JSON.parse(fs.readFileSync(dataPath, "utf-8"));

export function calculateMacros({ calories, strategyMode, lifeStage }) {

  if (!calories || calories <= 0) {
    throw new Error("Invalid calories passed to macro engine");
  }

  const macroRoot = engineData.Macronutrient_Ratio_Profiles;

  if (!macroRoot) {
    throw new Error("Macronutrient_Ratio_Profiles missing at top level");
  }

  /* -------------------------------
     🔹 Strategy Routing Layer
  --------------------------------*/

  let profileKey = "Maintenance";

  if (strategyMode === "Fat_Loss") {
    profileKey = "Fat_Loss_Priority";
  }
  else if (strategyMode === "Weight_Gain") {
    profileKey = "Weight_Gain_Priority";
  }
  else if (strategyMode === "Muscle_Build") {
  profileKey = "Muscle_Build_Priority";
}
  else if (strategyMode === "Growth_Slowdown") {
    profileKey = "Fat_Loss_Priority";
  }
  else if (strategyMode === "Growth_Acceleration") {
    profileKey = "Weight_Gain_Priority";
  }
  else if (strategyMode === "Optimal_Growth") {
    profileKey = "Maintenance";
  }

  const profile = macroRoot[profileKey];

  if (!profile) {
    throw new Error(`Macro profile not found for strategy: ${profileKey}`);
  }

  /* -------------------------------
   🔹 Normalize Profile Ratios
--------------------------------*/

const totalRatio =
  profile.Protein + profile.Fat + profile.Carbs;

if (totalRatio <= 0) {
  throw new Error("Invalid macro profile ratios");
}

const normalizedProtein = profile.Protein / totalRatio;
const normalizedFat = profile.Fat / totalRatio;
const normalizedCarbs = profile.Carbs / totalRatio;

/* -------------------------------
   🔹 Calorie → Gram Conversion
--------------------------------*/

const proteinGrams = (calories * normalizedProtein) / 4;
const fatGrams = (calories * normalizedFat) / 9;
const carbGrams = (calories * normalizedCarbs) / 4;

  /* -------------------------------
     🔹 AAFCO Validation
  --------------------------------*/

  const validated = validateAAFCO({
    calories,
    proteinGrams,
    fatGrams,
    lifeStage
  });

  return {
    strategy_used: strategyMode,
    macro_profile_used: profileKey,
    macro_grams: {
      protein: validated.protein_grams,
      fat: validated.fat_grams,
      carbs: Math.round(carbGrams)
    }
  };
}