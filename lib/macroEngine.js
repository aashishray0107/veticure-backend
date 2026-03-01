import fs from "fs";
import path from "path";
import { validateAAFCO } from "./aafcoValidator.js";

const dataPath = path.join(process.cwd(), "data", "labrador_engine.json");
const engineData = JSON.parse(fs.readFileSync(dataPath, "utf-8"));

/* ----------------------------------
   🔹 Map 20-Stage LifeStage → Nutrition Bucket
----------------------------------- */
function mapToNutritionStage(lifeStage) {

  if (!lifeStage) return "Adult_Stage_Nutrition_1_7Y";

  if (
    lifeStage.includes("Neonatal") ||
    lifeStage.includes("Transitional") ||
    lifeStage.includes("Puppy") ||
    lifeStage.includes("Juvenile")
  ) {
    return "Puppy_Month_By_Month_Nutrition_0_12M";
  }

  if (
    lifeStage.includes("Senior") ||
    lifeStage.includes("Geriatric")
  ) {
    return "Senior_Stage_Nutrition_7Y_plus";
  }

  return "Adult_Stage_Nutrition_1_7Y";
}

/* ----------------------------------
   🔹 Macro Engine (Fully Data Driven)
----------------------------------- */
export function calculateMacros({ calories, strategyMode, lifeStage }) {

  if (!calories || calories <= 0) {
    throw new Error("Invalid calories passed to macro engine");
  }

  const macroRoot = engineData.Macronutrient_Ratio_Profiles;

  if (!macroRoot) {
    throw new Error("Macronutrient_Ratio_Profiles missing at top level");
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
     🔹 Convert kcal → grams
  -------------------------- */

  const proteinGrams = (calories * profile.Protein) / 4;
  const fatGrams = (calories * profile.Fat) / 9;
  const carbGrams = (calories * profile.Carbs) / 4;

  /* -------------------------
     🔹 AAFCO Validation
  -------------------------- */

  const nutritionStage = mapToNutritionStage(lifeStage);

  const validated = validateAAFCO({
    calories,
    proteinGrams,
    fatGrams,
    nutritionStage
  });

  return {
    strategy_used: strategyMode,
    nutrition_stage_used: nutritionStage,
    macro_grams: {
      protein: validated.protein_grams,
      fat: validated.fat_grams,
      carbs: Math.round(carbGrams)
    }
  };
}