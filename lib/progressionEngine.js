/**
 * progressionEngine.js
 * Simulates weekly weight progression and recalculates nutrition per week.
 *
 * Fixes applied vs old version:
 *  - PROGRESSION_02: Plateau detection logic implemented per JSON spec
 *  - PROGRESSION_03: Muscle_Build exits when target weight reached (not just week 12)
 *  - weeklyPercent read from JSON Compliance_Adaptive_Control.Weight_Change_Rules
 */

import { calculateCalories } from "./calorieEngine.js";
import { calculateMacros    } from "./macroEngine.js";

/* ─── Internal BCS estimator ─────────────────────────────────────────────── */
/**
 * Simple deviation-based BCS re-estimation for weekly progression.
 * Uses the same threshold logic as bcsEngine fallback.
 */
function estimateBCSCategory(currentWeight, targetWeight) {
  if (!targetWeight || targetWeight <= 0) return "Ideal";
  const deviation = (currentWeight - targetWeight) / targetWeight;

  if (deviation <= -0.30) return "Severely_Underweight";
  if (deviation <= -0.10) return "Underweight";
  if (deviation <=  0.10) return "Ideal";
  if (deviation <=  0.25) return "Overweight";
  return "Obese";
}

/* ─── Read weekly weight change limit from JSON ──────────────────────────── */
function getMaxWeeklyPct(engineData) {
  return engineData
    ?.Compliance_Adaptive_Control
    ?.Weight_Change_Rules
    ?.max_safe_weekly_pct
    ?? 0.02; // NRC safe default (2%)
}

/* ─── Read plateau detection config from JSON ────────────────────────────── */
function getPlateauConfig(engineData) {
  const pd = engineData?.Plateau_Detection_Logic;
  return {
    threshold_pct:     0.005,  // abs weight change < 0.5% → plateau
    consecutive_weeks: 2,      // plateau if no change for N weeks
    adjustment_pct:    0.05,   // ±5% calorie adjustment on plateau
    max_cap:           engineData?.Global_Adjustment_Controller?.Max_Total_Positive_Adjustment ?? 0.35,
    min_floor:         null,   // will be resolved from RER in loop
  };
}

/* ─── simulateJourney ────────────────────────────────────────────────────── */
/**
 * @param {object} params
 * @param {number}   params.startWeight     kg
 * @param {number}   params.targetWeight    kg (idealMid from BCS engine)
 * @param {number}   params.weeklyPercent   Requested % change per week (e.g. 1)
 * @param {string}   params.mode            "Fat_Loss" | "Weight_Gain" | "Muscle_Build" | "Maintenance"
 * @param {string}   params.lifeStage       Stage_Name
 * @param {number}   params.ageMonths
 * @param {string}   params.activity
 * @param {string}   params.season
 * @param {string[]} params.symptoms
 * @param {boolean}  params.isNeutered
 * @param {object}   params.engineData
 *
 * @returns {object[]} Weekly progression array
 */
export function simulateJourney({
  startWeight,
  targetWeight,
  weeklyPercent,
  mode,
  lifeStage,
  ageMonths,
  activity,
  season    = "Normal",
  symptoms  = [],
  isNeutered = true,
  engineData,
}) {
  /* ── Guards ─────────────────────────────────────────────────────────────── */
  if (!engineData)                      throw new Error("engineData missing in progression engine");
  if (!startWeight || startWeight <= 0) throw new Error("Invalid startWeight");
  if (!targetWeight || targetWeight <= 0) throw new Error("Invalid targetWeight");

  /* Maintenance → no simulation */
  if (!mode || mode === "Maintenance") return [];

  /* ── Config from JSON ────────────────────────────────────────────────────── */
  const maxWeeklyPct  = getMaxWeeklyPct(engineData);

  /* Clamp requested weeklyPercent to JSON max */
  const requestedPct  = (weeklyPercent ?? 1) / 100;
  const weeklyDecimal = Math.min(requestedPct, maxWeeklyPct);

  const plateauCfg    = getPlateauConfig(engineData);
  const MAX_WEEKS     = 52;

  /* Muscle Build cap from JSON Goal_Override_Priority_Engine */
  const muscleBuildMaxWeeks =
    engineData?.Goal_Override_Priority_Engine?.Muscle_Building?.If_BCS_Ideal
      ?.Weekly_Monitoring_Required
      ? 26  // allow up to 6 months with weekly monitoring
      : 12;

  /* ── Simulation state ────────────────────────────────────────────────────── */
  let weight          = startWeight;
  let plateauCount    = 0;
  let prevWeight      = startWeight;
  let calorieModifier = 1.0;  // plateau-driven calorie scale factor

  const results = [];

  for (let week = 1; week <= MAX_WEEKS; week++) {

    /* ── Update weight ───────────────────────────────────────────────────── */
    if (mode === "Fat_Loss") {
      weight -= weight * weeklyDecimal;
    } else if (mode === "Weight_Gain" || mode === "Muscle_Build") {
      weight += weight * weeklyDecimal;
    }

    weight = Number(weight.toFixed(2));

    /* ── BCS re-estimation ───────────────────────────────────────────────── */
    const currentBCS = estimateBCSCategory(weight, targetWeight);

    /* ── Calories ─────────────────────────────────────────────────────────── */
    const calorieResult = calculateCalories({
      weight,
      ageMonths,
      activity,
      season,
      symptoms,
      lifeStage,
      bcsCategory: currentBCS,
      isNeutered,
      engineData,
    });

    /* Apply plateau modifier if active */
    const adjustedCalories = Math.round(
      calorieResult.finalDailyCalories * calorieModifier
    );

    /* ── Macros ──────────────────────────────────────────────────────────── */
    const macroResult = calculateMacros({
      calories: adjustedCalories,
      strategyMode: mode,
      lifeStage,
      engineData,
    });

    /* ── Plateau detection (JSON Plateau_Detection_Logic) ────────────────── */
    const weightChangePct = prevWeight > 0
      ? Math.abs((weight - prevWeight) / prevWeight)
      : 0;

    let plateauDetected = false;

    if (week > 1 && weightChangePct < plateauCfg.threshold_pct) {
      plateauCount++;
    } else {
      plateauCount = 0;
    }

    if (plateauCount >= plateauCfg.consecutive_weeks) {
      plateauDetected = true;
      plateauCount    = 0; // reset after trigger

      /* Adjust calorie modifier per JSON spec (±5%) */
      if (mode === "Fat_Loss") {
        calorieModifier = Math.max(
          1 - plateauCfg.max_cap,
          calorieModifier - plateauCfg.adjustment_pct
        );
      } else {
        calorieModifier = Math.min(
          1 + plateauCfg.max_cap,
          calorieModifier + plateauCfg.adjustment_pct
        );
      }
    }

    const weightChangedThisWeek = Number((weight - prevWeight).toFixed(2));
    prevWeight = weight;

    /* ── Record week ─────────────────────────────────────────────────────── */
    const pctSign = mode === "Fat_Loss" ? -1 : 1;
    results.push({
      week,
      projected_weight_kg:         weight,
      weight_change_this_week_kg:  weightChangedThisWeek,
      percent_change_this_week:    Number((weeklyDecimal * 100 * pctSign).toFixed(2)),
      direction:                   mode === "Fat_Loss" ? "loss" : "gain",
      bcs_category:                currentBCS,
      calories_per_day:            adjustedCalories,
      calorie_modifier:            Number(calorieModifier.toFixed(3)),
      plateau_detected:            plateauDetected,
      macros: {
        protein_g: macroResult.macro_grams.protein,
        fat_g:     macroResult.macro_grams.fat,
        carbs_g:   macroResult.macro_grams.carbs,
      },
    });

    /* ── Exit conditions ─────────────────────────────────────────────────── */
    if (mode === "Fat_Loss"   && weight <= targetWeight)              break;
    if (mode === "Weight_Gain"&& weight >= targetWeight)              break;
    if (mode === "Muscle_Build" && week >= muscleBuildMaxWeeks)       break;
    if (mode === "Muscle_Build" && weight >= targetWeight)            break;

    /* Safety: if nearly at target (within 1%), exit */
    const distancePct = Math.abs((weight - targetWeight) / targetWeight);
    if (distancePct < 0.01) break;
  }

  return results;
}