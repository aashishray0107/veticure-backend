import fs from "fs";
import path from "path";

const dataPath = path.join(process.cwd(), "data", "labrador_engine.json");
const engineData = JSON.parse(fs.readFileSync(dataPath, "utf-8"));

function resolveStage(ageMonths) {
  const stages = engineData.Lifecycle_Growth_Model_20_Stages || [];

  for (const stage of stages) {

    let minMonths = null;
    let maxMonths = null;

    // 1️⃣ Weeks-based stage
    if (stage.min_age_weeks !== undefined) {
      minMonths = stage.min_age_weeks / 4.345;
      maxMonths =
        stage.max_age_weeks !== null &&
        stage.max_age_weeks !== undefined
          ? stage.max_age_weeks / 4.345
          : null;
    }

    // 2️⃣ Months-based stage
    if (stage.min_age_months !== undefined) {
      minMonths = stage.min_age_months;
      maxMonths =
        stage.max_age_months !== null &&
        stage.max_age_months !== undefined
          ? stage.max_age_months
          : null;
    }

    // 3️⃣ Years-based stage (IMPORTANT FOR 5+ YEARS)
    if (stage.min_age_years !== undefined) {
      minMonths = stage.min_age_years * 12;
      maxMonths =
        stage.max_age_years !== null &&
        stage.max_age_years !== undefined
          ? stage.max_age_years * 12
          : null;
    }

    if (minMonths !== null) {

      // Open-ended stage (like 5+ years)
      if (maxMonths === null) {
        if (ageMonths >= minMonths) {
          return stage;
        }
      }

      // Normal bounded stage
      else {
        if (ageMonths >= minMonths && ageMonths < maxMonths) {
          return stage;
        }
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

  const deviationPercent = deviation * 100;

return {
  life_stage: stage.Stage_Name,
  idealMid,
  deviation_percent: Number(deviationPercent.toFixed(2)),
  category,
  estimatedBCS
};
}