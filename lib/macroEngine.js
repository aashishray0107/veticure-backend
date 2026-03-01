import fs from "fs";
import path from "path";

const dataPath = path.join(process.cwd(), "data", "labrador_engine.json");
const engineData = JSON.parse(fs.readFileSync(dataPath, "utf-8"));

export function calculateMacros({
  calories,
  bcsCategory,
  strategyMode
}) {

  const profiles =
    engineData.BCS_Automatic_Detection_Logic
      ?.Macronutrient_Ratio_Profiles;

  if (!profiles) {
    throw new Error("Macronutrient_Ratio_Profiles missing in JSON");
  }

  /* ----------------------------------
     1️⃣ Select Profile
  ----------------------------------- */

  let selectedProfile = null;

  if (strategyMode === "Fat_Loss") {
    selectedProfile = profiles.Fat_Loss;
  }
  else if (strategyMode === "Weight_Gain") {
    selectedProfile = profiles.Weight_Gain;
  }
  else if (strategyMode === "Muscle_Build") {
    selectedProfile = profiles.Muscle_Build;
  }
  else {
    selectedProfile = profiles.Maintenance;
  }

  if (!selectedProfile) {
    throw new Error("Macro profile not found for strategy");
  }

  /* ----------------------------------
     2️⃣ Extract Ratios
  ----------------------------------- */

  const proteinRatio = selectedProfile.Protein;
  const fatRatio = selectedProfile.Fat;
  const carbRatio = selectedProfile.Carbs;

  if (
    proteinRatio === undefined ||
    fatRatio === undefined ||
    carbRatio === undefined
  ) {
    throw new Error("Incomplete macro ratios in selected profile");
  }

  /* ----------------------------------
     3️⃣ Convert to kcal
  ----------------------------------- */

  const proteinKcal = calories * proteinRatio;
  const fatKcal = calories * fatRatio;
  const carbKcal = calories * carbRatio;

  /* ----------------------------------
     4️⃣ Convert kcal → grams
     (Protein 4, Carbs 4, Fat 9)
  ----------------------------------- */

  const proteinGrams = proteinKcal / 4;
  const carbGrams = carbKcal / 4;
  const fatGrams = fatKcal / 9;

  return {
    profile_used: selectedProfile.Profile_Name || "Custom_Profile",
    ratios: {
      protein: proteinRatio,
      fat: fatRatio,
      carbs: carbRatio
    },
    grams_per_day: {
      protein: Number(proteinGrams.toFixed(1)),
      fat: Number(fatGrams.toFixed(1)),
      carbs: Number(carbGrams.toFixed(1))
    }
  };
}