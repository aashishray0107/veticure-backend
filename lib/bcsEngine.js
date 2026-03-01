import fs from "fs";
import path from "path";

const dataPath = path.join(process.cwd(), "data", "labrador_engine.json");
const engineData = JSON.parse(fs.readFileSync(dataPath, "utf-8"));

function resolveStage(ageMonths) {
  const stages = engineData.Lifecycle_Growth_Model_20_Stages || [];

  const ageWeeks = ageMonths * 4.345; // convert months → weeks

  for (const stage of stages) {

    // Stage defined in weeks
    if (stage.min_age_weeks !== undefined) {
      if (
        ageWeeks >= stage.min_age_weeks &&
        ageWeeks < stage.max_age_weeks
      ) {
        return stage;
      }
    }

    // Stage defined in months
    if (stage.min_age_months !== undefined) {
      if (
        ageMonths >= stage.min_age_months &&
        ageMonths < stage.max_age_months
      ) {
        return stage;
      }
    }
  }

  return null;
}

export function calculateBCS(weight, ageMonths, gender = "Male") {

  const stage = resolveStage(ageMonths);

  if (!stage) {
    throw new Error("No matching lifecycle stage found");
  }

  const range =
    gender === "Female"
      ? stage.Female_Ideal_Weight_Range_kg
      : stage.Male_Ideal_Weight_Range_kg;

  if (!range || range.length !== 2) {
    throw new Error("Ideal weight range missing for stage: " + stage.Stage_Name);
  }

  const idealMid = (range[0] + range[1]) / 2;

  const deviation = (weight - idealMid) / idealMid;

  // Use global thresholds (add these in JSON root if missing)
  const thresholds = engineData.BCS_Deviation_Thresholds || {
    Obese: 0.20,
    Overweight: 0.06,
    Underweight: -0.06
  };

  let category = "Ideal";
  let estimatedBCS = 5;

  if (deviation >= thresholds.Obese) {
    category = "Obese";
    estimatedBCS = 8;
  }
  else if (deviation >= thresholds.Overweight) {
    category = "Overweight";
    estimatedBCS = 6;
  }
  else if (deviation <= thresholds.Underweight) {
    category = "Underweight";
    estimatedBCS = 3;
  }

  return {
    life_stage: stage.Stage_Name,
    idealMid,
    deviation,
    category,
    estimatedBCS
  };
}