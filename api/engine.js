import engineData from "../data/labrador_engine.json" assert { type: "json" };

function resolveStage(ageMonths) {
  const stages = engineData.Lifecycle_Stages || {};

  for (const stageName in stages) {
    const stage = stages[stageName];

    const min = stage.Min_Months ?? stage.Min_Age_Months ?? 0;
    const max = stage.Max_Months ?? stage.Max_Age_Months ?? 999;

    if (ageMonths >= min && ageMonths < max) {
      return stageName;
    }
  }

  return Object.keys(stages)[0] || "Adult";
}

export function calculateBCS(weight, ageMonths) {
  const stage = resolveStage(ageMonths);

  const idealRange =
    engineData.Ideal_Weight_Ranges?.[stage];

  if (!idealRange) {
    throw new Error("Ideal weight range missing for stage: " + stage);
  }

  const minKg = idealRange.Min_kg ?? idealRange.min ?? 0;
  const maxKg = idealRange.Max_kg ?? idealRange.max ?? 0;

  const idealMid = (minKg + maxKg) / 2;

  const deviation = (weight - idealMid) / idealMid;

  const thresholds = engineData.BCS_Deviation_Thresholds || {};

  const obeseT = thresholds.Obese ?? 0.2;
  const overweightT = thresholds.Overweight ?? 0.06;
  const underweightT = thresholds.Underweight ?? -0.06;

  let category = "Ideal";
  let estimatedBCS = 5;

  if (deviation >= obeseT) {
    category = "Obese";
    estimatedBCS = 8;
  } else if (deviation >= overweightT) {
    category = "Overweight";
    estimatedBCS = 6;
  } else if (deviation <= underweightT) {
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