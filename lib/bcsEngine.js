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

export function calculateBCS(weight, ageMonths) {

  const stage = resolveStage(ageMonths);

  const idealRange =
    engineData.Ideal_Weight_Ranges?.[stage];

  if (!idealRange) {
    throw new Error("Missing Ideal Weight Range for stage: " + stage);
  }

  const idealMid =
    (idealRange.Min_kg + idealRange.Max_kg) / 2;

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