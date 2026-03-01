import fs from "fs";
import path from "path";

/* ----------------------------------
   🔹 Load JSON Safely
----------------------------------- */
const dataPath = path.join(process.cwd(), "data", "labrador_engine.json");

if (!fs.existsSync(dataPath)) {
  throw new Error(`JSON file not found at: ${dataPath}`);
}

const engineData = JSON.parse(fs.readFileSync(dataPath, "utf-8"));

console.log("=== JSON FILE LOADED ===");
console.log("Data path:", dataPath);
console.log("Top level keys:", Object.keys(engineData));

/* ----------------------------------
   🔹 Resolve Lifecycle Stage
----------------------------------- */
function resolveStage(ageMonths) {

  const stages = engineData.Lifecycle_Growth_Model_20_Stages;

  if (!Array.isArray(stages)) {
    throw new Error("Lifecycle_Growth_Model_20_Stages missing or invalid");
  }

  for (const stage of stages) {

    let minMonths = null;
    let maxMonths = null;

    if (stage.min_age_weeks !== undefined) {
      minMonths = stage.min_age_weeks / 4.345;
      maxMonths =
        stage.max_age_weeks !== undefined && stage.max_age_weeks !== null
          ? stage.max_age_weeks / 4.345
          : null;
    }

    if (stage.min_age_months !== undefined) {
      minMonths = stage.min_age_months;
      maxMonths =
        stage.max_age_months !== undefined && stage.max_age_months !== null
          ? stage.max_age_months
          : null;
    }

    if (stage.min_age_years !== undefined) {
      minMonths = stage.min_age_years * 12;
      maxMonths =
        stage.max_age_years !== undefined && stage.max_age_years !== null
          ? stage.max_age_years * 12
          : null;
    }

    if (minMonths !== null) {

      if (maxMonths === null) {
        if (ageMonths >= minMonths) return stage;
      } else {
        if (ageMonths >= minMonths && ageMonths < maxMonths)
          return stage;
      }
    }
  }

  return null;
}

/* ----------------------------------
   🔹 Dynamically Locate BCS Block
----------------------------------- */
function getBCSConfig() {

  // Try common wrapper names safely
  const possibleKeys = [
    "BCS_Automatic_Detection_Logic",
    "BCS_System",
    "BCS_Config",
    "BCS_System_Config"
  ];

  for (const key of possibleKeys) {
    if (engineData[key]) {
      console.log("BCS wrapper found:", key);
      return engineData[key];
    }
  }

  console.log("Available keys:", Object.keys(engineData));
  throw new Error("No valid BCS wrapper block found in JSON");
}

/* ----------------------------------
   🔹 Fully Data-Driven BCS Engine
----------------------------------- */
export function calculateBCS(weight, ageMonths, gender = "Male") {

  if (!weight || !ageMonths) {
    throw new Error("Weight and ageMonths required");
  }

  const stage = resolveStage(ageMonths);

  if (!stage) {
    throw new Error("No matching lifecycle stage found");
  }

  const range =
    gender === "Female"
      ? stage.Female_Ideal_Weight_Range_kg
      : stage.Male_Ideal_Weight_Range_kg;

  if (!Array.isArray(range) || range.length !== 2) {
    throw new Error(
      `Ideal weight range missing for stage: ${stage.Stage_Name}`
    );
  }

  const idealMid = (range[0] + range[1]) / 2;

  const deviationDecimal = (weight - idealMid) / idealMid;
  const deviationPercent = deviationDecimal * 100;

  const bcsRoot = getBCSConfig();

  const thresholds = bcsRoot.Deviation_Thresholds;
  const estimateMap = bcsRoot.Deviation_To_BCS_Estimate;

  if (!thresholds || !estimateMap) {
    console.log("BCS root keys:", Object.keys(bcsRoot));
    throw new Error("Deviation configuration missing in JSON");
  }

  let matchedCategory = null;

  for (const categoryKey of Object.keys(thresholds)) {

    const rule = thresholds[categoryKey];

    const min = rule.Min_Deviation_Decimal;
    const max = rule.Max_Deviation_Decimal;

    if (min !== undefined && max !== undefined) {
      if (deviationDecimal >= min && deviationDecimal <= max) {
        matchedCategory = categoryKey;
        break;
      }
    }

    else if (min !== undefined && max === undefined) {
      if (deviationDecimal >= min) {
        matchedCategory = categoryKey;
        break;
      }
    }

    else if (max !== undefined && min === undefined) {
      if (deviationDecimal <= max) {
        matchedCategory = categoryKey;
        break;
      }
    }
  }

  if (!matchedCategory) matchedCategory = "Ideal";

  const estimate = estimateMap[matchedCategory];

  if (!estimate) {
    throw new Error(
      `No BCS estimate mapping found for category: ${matchedCategory}`
    );
  }

  const estimatedBCS =
    estimate.min_bcs === estimate.max_bcs
      ? estimate.min_bcs
      : Math.round((estimate.min_bcs + estimate.max_bcs) / 2);

  return {
    life_stage: stage.Stage_Name,
    idealMid: Number(idealMid.toFixed(2)),
    deviation_percent: Number(deviationPercent.toFixed(2)),
    category: matchedCategory,
    estimatedBCS
  };
}