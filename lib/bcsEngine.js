/**
 * bcsEngine.js
 * Determines Body Condition Score category and estimated numeric BCS.
 * Fully data-driven — reads thresholds and BCS mappings from engineData JSON.
 *
 * Fixes applied vs old version:
 *  - BCS_01: Uses JSON BCS_Automatic_Detection_Logic if present; hardcoded fallback documented
 *  - BCS_02: estimatedBCS no longer always returns 5 — proper derivation from JSON or deviation math
 *  - BCS_03: Normalisation moved inside bcsEngine only (removed from handler)
 */

/* ─── Fallback deviation thresholds ─────────────────────────────────────────
 * Used ONLY when BCS_Automatic_Detection_Logic is absent from the JSON dataset.
 * Based on standard veterinary weight-deviation BCS estimation.
 * Values are decimal fractions of idealMid weight.
 */
const FALLBACK_THRESHOLDS = [
  { category: "Severely_Underweight", max: -0.30              },
  { category: "Underweight",          min: -0.30, max: -0.10  },
  { category: "Ideal",                min: -0.10, max:  0.10  },
  { category: "Overweight",           min:  0.10, max:  0.25  },
  { category: "Obese",                min:  0.25              },
];

/* ─── Fallback BCS numeric scores per category ──────────────────────────────
 * Used when Deviation_To_BCS_Estimate is absent from JSON.
 */
const FALLBACK_BCS_SCORES = {
  Severely_Underweight: 1,
  Underweight:          3,
  Ideal:                5,
  Overweight:           6,
  Obese:                8,
};

/* ─── Normalization map ──────────────────────────────────────────────────── */
const NORMALIZE_MAP = {
  Lean:       "Underweight",
  Very_Thin:  "Severely_Underweight",
};

/**
 * Resolve the lifecycle stage that matches the given age.
 * Handles week-based, month-based, and year-based stage definitions.
 */
function resolveStage(stages, ageMonths) {
  for (const stage of stages) {
    let minMonths = null;
    let maxMonths = null;

    if (stage.min_age_weeks !== undefined) {
      /* Use exact Julian week→month: 1 week = 7/30.4375 months */
      minMonths = stage.min_age_weeks * (7 / 30.4375);
      maxMonths = stage.max_age_weeks != null
        ? stage.max_age_weeks * (7 / 30.4375)
        : null;
    } else if (stage.min_age_months !== undefined) {
      minMonths = stage.min_age_months;
      maxMonths = stage.max_age_months ?? null;
    } else if (stage.min_age_years !== undefined) {
      minMonths = stage.min_age_years * 12;
      maxMonths = stage.max_age_years != null ? stage.max_age_years * 12 : null;
    }

    if (minMonths === null) continue;

    const inRange = maxMonths === null
      ? ageMonths >= minMonths
      : ageMonths >= minMonths && ageMonths < maxMonths;

    if (inRange) return stage;
  }
  return null;
}

/**
 * Determine BCS category from deviation decimal using JSON thresholds.
 * Falls back to hardcoded thresholds if JSON block is absent.
 */
function deriveBCSCategory(deviationDecimal, bcsConfig) {
  /* Try JSON-defined thresholds first */
  const thresholds = bcsConfig?.Deviation_Thresholds;

  if (thresholds && typeof thresholds === "object") {
    // Sort by Min_Deviation_Decimal ascending to ensure correct range matching
    const ordered = Object.entries(thresholds).sort((a, b) => {
      const aMin = a[1].Min_Deviation_Decimal ?? -Infinity;
      const bMin = b[1].Min_Deviation_Decimal ?? -Infinity;
      return aMin - bMin;
    });

    for (const [key, rule] of ordered) {
      const min = rule.Min_Deviation_Decimal;
      const max = rule.Max_Deviation_Decimal;

      const aboveMin = min !== undefined ? deviationDecimal >= min : true;
      const belowMax = max !== undefined ? deviationDecimal <= max : true;

      if (aboveMin && belowMax) {
        return NORMALIZE_MAP[key] ?? key;
      }
    }
  }

  /* Fallback thresholds */
  for (const rule of FALLBACK_THRESHOLDS) {
    const aboveMin = rule.min !== undefined ? deviationDecimal > rule.min : true;
    const belowMax = rule.max !== undefined ? deviationDecimal <= rule.max : true;
    if (aboveMin && belowMax) return rule.category;
  }

  return "Ideal"; // ultimate fallback
}

/**
 * Derive numeric BCS score from category using JSON mapping.
 * Falls back to hardcoded map if JSON block is absent.
 */
function deriveBCSScore(category, bcsConfig) {
  const estimateMap = bcsConfig?.Deviation_To_BCS_Estimate;

  if (estimateMap?.[category]) {
    const est = estimateMap[category];
    if (est.min_bcs != null && est.max_bcs != null) {
      return est.min_bcs === est.max_bcs
        ? est.min_bcs
        : Math.round((est.min_bcs + est.max_bcs) / 2);
    }
  }

  /* Fallback: derive from deviation-to-score table */
  return FALLBACK_BCS_SCORES[category] ?? 5;
}

/**
 * calculateBCS
 *
 * @param {object} params
 * @param {number}  params.weight      Current body weight (kg)
 * @param {number}  params.ageMonths   Age in months
 * @param {string}  params.gender      "male" | "female"
 * @param {object}  params.engineData  Full breed JSON dataset
 *
 * @returns {object} BCS result
 */
export function calculateBCS({ weight, ageMonths, gender, engineData }) {
  /* ── Guards ─────────────────────────────────────────────────────────────── */
  if (!engineData)             throw new Error("engineData missing in BCS engine");
  if (!weight || weight <= 0)  throw new Error("Invalid weight in BCS engine");
  if (ageMonths == null || ageMonths < 0) throw new Error("Invalid ageMonths");

  /* ── Step 1: Resolve lifecycle stage ────────────────────────────────────── */
  const stages = engineData?.Lifecycle_Growth_Model_20_Stages || [];
  if (!stages.length) throw new Error("Lifecycle_Growth_Model_20_Stages missing or empty");

  const matchedStage = resolveStage(stages, ageMonths);
  if (!matchedStage) {
    throw new Error(`No lifecycle stage found for age: ${ageMonths} months`);
  }

  /* ── Step 2: Ideal weight range for gender ──────────────────────────────── */
  const maleRange   = matchedStage.Male_Ideal_Weight_Range_kg;
  const femaleRange = matchedStage.Female_Ideal_Weight_Range_kg;

  if (!maleRange || !femaleRange) {
    throw new Error(
      `Weight ranges missing in stage: ${matchedStage.Stage_Name}`
    );
  }

  const normalizedGender = (gender || "").toLowerCase().trim();
  const avgRange = [
    (maleRange[0] + femaleRange[0]) / 2,
    (maleRange[1] + femaleRange[1]) / 2,
  ];

  const range =
    normalizedGender === "female" ? femaleRange :
    normalizedGender === "male"   ? maleRange   :
    avgRange; // fallback for unknown gender

  const idealMin = range[0];
  const idealMax = range[1];
  const idealMid = (idealMin + idealMax) / 2;

  /* ── Step 3: Weight deviation ───────────────────────────────────────────── */
  const deviationDecimal = (weight - idealMid) / idealMid;
  const deviationPercent = deviationDecimal * 100;

  /* ── Step 4: BCS category ───────────────────────────────────────────────── */
  const bcsConfig       = engineData?.BCS_Automatic_Detection_Logic ?? null;
  let   bcsCategory     = deriveBCSCategory(deviationDecimal, bcsConfig);

  // Final normalisation pass
  bcsCategory = NORMALIZE_MAP[bcsCategory] ?? bcsCategory;

  /* ── Step 5: Numeric BCS score ──────────────────────────────────────────── */
  const estimatedBCS = deriveBCSScore(bcsCategory, bcsConfig);

  /* ── Step 6: Ideal weight range from Ideal_Weight_Reference_Table ─────────
   * Secondary lookup for more granular min/max reference if available.
   */
  const refTable = engineData?.Ideal_Weight_Reference_Table || [];
  const refEntry = refTable.find(entry => {
    const minM = entry.min_age_months ?? (entry.min_age_weeks != null ? entry.min_age_weeks * (7 / 30.4375) : null);
    const maxM = entry.max_age_months ?? (entry.max_age_weeks != null ? entry.max_age_weeks * (7 / 30.4375) : null);
    if (minM == null) return false;
    return maxM === null ? ageMonths >= minM : ageMonths >= minM && ageMonths < maxM;
  });

  const refIdealMin = refEntry
    ? (normalizedGender === "female" ? refEntry.Female_Min_kg : refEntry.Male_Min_kg)
    : idealMin;
  const refIdealMax = refEntry
    ? (normalizedGender === "female" ? refEntry.Female_Max_kg : refEntry.Male_Max_kg)
    : idealMax;

  return {
    life_stage:          matchedStage.Stage_Name,
    idealMid:            Number(idealMid.toFixed(1)),
    ideal_range:         [Number(refIdealMin.toFixed(1)), Number(refIdealMax.toFixed(1))],
    deviation_percent:   Number(deviationPercent.toFixed(2)),
    deviation_decimal:   Number(deviationDecimal.toFixed(4)),
    category:            bcsCategory,
    estimatedBCS,
    bcs_source:          bcsConfig ? "JSON_BCS_Automatic_Detection_Logic" : "fallback_thresholds",
    gender_used:         normalizedGender || "average",
  };
}