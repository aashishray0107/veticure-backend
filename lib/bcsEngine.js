export function calculateBCS({

  weight,
  ageMonths,
  gender = "Male",
  engineData

}) {

  if (!engineData) {
    throw new Error("engineData missing in BCS engine");
  }

  if (!weight || weight <= 0) {
    throw new Error("Invalid weight for BCS calculation");
  }

  const stages =
    engineData.Lifecycle_Growth_Model_20_Stages || [];

  if (!stages.length) {
    throw new Error("Lifecycle_Growth_Model_20_Stages missing");
  }

  /* ---------------- RESOLVE LIFECYCLE STAGE ---------------- */

  let matchedStage = null;

  for (const stage of stages) {

    let minMonths = null;
    let maxMonths = null;

    if (stage.min_age_weeks !== undefined) {

      minMonths = stage.min_age_weeks / 4.345;

      maxMonths =
        stage.max_age_weeks !== null &&
        stage.max_age_weeks !== undefined
          ? stage.max_age_weeks / 4.345
          : null;

    }

    else if (stage.min_age_months !== undefined) {

      minMonths = stage.min_age_months;

      maxMonths =
        stage.max_age_months !== null &&
        stage.max_age_months !== undefined
          ? stage.max_age_months
          : null;

    }

    else if (stage.min_age_years !== undefined) {

      minMonths = stage.min_age_years * 12;

      maxMonths =
        stage.max_age_years !== null &&
        stage.max_age_years !== undefined
          ? stage.max_age_years * 12
          : null;

    }

    if (minMonths !== null) {

      if (maxMonths === null) {

        if (ageMonths >= minMonths) {
          matchedStage = stage;
          break;
        }

      }

      else {

        if (ageMonths >= minMonths && ageMonths < maxMonths) {
          matchedStage = stage;
          break;
        }

      }

    }

  }

  if (!matchedStage) {
    throw new Error("No matching lifecycle stage found");
  }

  /* ---------------- IDEAL WEIGHT RANGE ---------------- */

  const range =
    gender.toLowerCase() === "female"
      ? matchedStage.Female_Ideal_Weight_Range_kg
      : matchedStage.Male_Ideal_Weight_Range_kg;

  if (!range || range.length !== 2) {
    throw new Error(
      "Ideal weight range missing for stage: " +
      matchedStage.Stage_Name
    );
  }

  const idealMid = (range[0] + range[1]) / 2;

  /* ---------------- WEIGHT DEVIATION ---------------- */

  const deviationDecimal =
    (weight - idealMid) / idealMid;

  const deviationPercent =
    deviationDecimal * 100;

  /* ---------------- BCS CONFIG ---------------- */

  const bcsConfig =
    engineData.BCS_Automatic_Detection_Logic;

  if (!bcsConfig) {
    throw new Error(
      "BCS_Automatic_Detection_Logic missing in JSON"
    );
  }

  const thresholds =
    bcsConfig.Deviation_Thresholds;

  const estimateMap =
    bcsConfig.Deviation_To_BCS_Estimate;

  if (!thresholds || !estimateMap) {
    throw new Error(
      "Deviation configuration missing in JSON"
    );
  }

  /* ---------------- CATEGORY MATCH ---------------- */

  let matchedCategory = null;

  for (const key of Object.keys(thresholds)) {

    const rule = thresholds[key];

    const min = rule.Min_Deviation_Decimal;
    const max = rule.Max_Deviation_Decimal;

    if (min !== undefined && max !== undefined) {

      if (
        deviationDecimal >= min &&
        deviationDecimal <= max
      ) {
        matchedCategory = key;
        break;
      }

    }

    if (min !== undefined && max === undefined) {

      if (deviationDecimal >= min) {
        matchedCategory = key;
        break;
      }

    }

    if (max !== undefined && min === undefined) {

      if (deviationDecimal <= max) {
        matchedCategory = key;
        break;
      }

    }

  }

  if (!matchedCategory) {
    matchedCategory = "Ideal";
  }

  /* ---------------- BCS SCORE ESTIMATION ---------------- */

  const estimate = estimateMap[matchedCategory];

  if (!estimate) {
    throw new Error(
      "No BCS estimate mapping for category: " +
      matchedCategory
    );
  }

  const estimatedBCS =
    estimate.min_bcs === estimate.max_bcs
      ? estimate.min_bcs
      : Math.round(
          (estimate.min_bcs + estimate.max_bcs) / 2
        );

  /* ---------------- RESULT ---------------- */

  return {

    life_stage: matchedStage.Stage_Name,

    idealMid,

    deviation_percent:
      Number(deviationPercent.toFixed(2)),

    category: matchedCategory,

    estimatedBCS

  };

}