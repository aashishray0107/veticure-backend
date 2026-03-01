import fs from "fs";
import path from "path";

const dataPath = path.join(process.cwd(), "data", "labrador_engine.json");
const engineData = JSON.parse(fs.readFileSync(dataPath, "utf-8"));

function resolveStage(ageMonths) {
  const stages = engineData.Lifecycle_Stages || {};

  for (const stageName in stages) {
    const stage = stages[stageName];

    if (
      ageMonths >= stage.Min_Months &&
      ageMonths < stage.Max_Months
    ) {
      return stageName;
    }
  }

  return "Adult";
}

export function calculateBCS(weight, ageMonths, gender = "Male") {

  const stage = resolveStage(ageMonths);

  const genderBlock =
    engineData.Ideal_Weight_Range_kg?.[gender];

  if (!genderBlock) {
    throw new Error("Gender not found in JSON");
  }

  const stageRange = genderBlock?.[stage];

  if (!stageRange) {
    throw new Error("Missing Ideal Weight Range for stage: " + stage);
  }

  const idealMid =
    (stageRange.Min + stageRange.Max) / 2;

  const deviation =
    (weight - idealMid) / idealMid;

  const thresholds =
    engineData.BCS_Deviation_Thresholds;

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
    life_stage: stage,
    idealMid,
    deviation,
    category,
    estimatedBCS
  };
}