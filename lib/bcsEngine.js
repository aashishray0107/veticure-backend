export function calculateBCS({
  weight,
  ageMonths,
  gender = "Male",
  engineData,
}) {

  if (!engineData) throw new Error("engineData missing in BCS engine");
  if (!weight || weight <= 0) throw new Error("Invalid weight");

  const stages = engineData.Lifecycle_Growth_Model_20_Stages || [];
  if (!stages.length) throw new Error("Lifecycle_Growth_Model_20_Stages missing");

  let matchedStage = null;

  for (const stage of stages) {
    let minMonths = null;
    let maxMonths = null;

    if (stage.min_age_weeks !== undefined) {
      minMonths = stage.min_age_weeks / 4.345;
      maxMonths = (stage.max_age_weeks != null) ? stage.max_age_weeks / 4.345 : null;
    } else if (stage.min_age_months !== undefined) {
      minMonths = stage.min_age_months;
      maxMonths = (stage.max_age_months != null) ? stage.max_age_months : null;
    } else if (stage.min_age_years !== undefined) {
      minMonths = stage.min_age_years * 12;
      maxMonths = (stage.max_age_years != null) ? stage.max_age_years * 12 : null;
    }

    if (minMonths === null) continue;

    const inRange = maxMonths === null
      ? ageMonths >= minMonths
      : ageMonths >= minMonths && ageMonths < maxMonths;

    if (inRange) {
      matchedStage = stage;
      break;
    }
  }

  if (!matchedStage) throw new Error(`No lifecycle stage found for age: ${ageMonths} months`);

  const range = gender.toLowerCase() === "female"
    ? matchedStage.Female_Ideal_Weight_Range_kg
    : matchedStage.Male_Ideal_Weight_Range_kg;

  if (!range || range.length !== 2) {
    throw new Error(`Ideal weight range missing for stage: ${matchedStage.Stage_Name}`);
  }

  const idealMid = (range[0] + range[1]) / 2;

  const deviationDecimal = (weight - idealMid) / idealMid;
  const deviationPercent = deviationDecimal * 100;

  let matchedCategory = null;

  const bcsConfig  = engineData.BCS_Automatic_Detection_Logic;
  const thresholds = bcsConfig?.Deviation_Thresholds;

  if (thresholds) {
    for (const key of Object.keys(thresholds)) {
      const rule = thresholds[key];
      const min  = rule.Min_Deviation_Decimal;
      const max  = rule.Max_Deviation_Decimal;

      const aboveMin = (min !== undefined) ? deviationDecimal >= min : true;
      const belowMax = (max !== undefined) ? deviationDecimal <= max : true;

      if (aboveMin && belowMax) {
        matchedCategory = key;
        break;
      }
    }
  }

  if (!matchedCategory) {
    if (deviationDecimal <= -0.20)      matchedCategory = "Severely_Underweight";
    else if (deviationDecimal <= -0.05) matchedCategory = "Underweight";
    else if (deviationDecimal <= 0.05)  matchedCategory = "Ideal";
    else if (deviationDecimal <= 0.20)  matchedCategory = "Overweight";
    else                                matchedCategory = "Obese";
  }

  const estimateMap = bcsConfig?.Deviation_To_BCS_Estimate;
  let estimatedBCS  = 5;

  if (estimateMap?.[matchedCategory]) {
    const est = estimateMap[matchedCategory];
    estimatedBCS = est.min_bcs === est.max_bcs
      ? est.min_bcs
      : Math.round((est.min_bcs + est.max_bcs) / 2);
  } else {
    const fallbackBCS = {
      "Severely_Underweight": 1,
      "Underweight":          3,
      "Ideal":                5,
      "Overweight":           7,
      "Obese":                9,
    };
    estimatedBCS = fallbackBCS[matchedCategory] ?? 5;
  }

  return {
    life_stage:        matchedStage.Stage_Name,
    idealMid:          Number(idealMid.toFixed(1)),
    deviation_percent: Number(deviationPercent.toFixed(2)),
    category:          matchedCategory,
    estimatedBCS,
  };
}