/* ─────────────────────────────────────────────────────────────────
   progressionEngine.js — FIXED

   Bug fixed:
   During Fat_Loss or Weight_Gain journeys, calories were recalculated
   each week using bcsCategory: "Ideal" hardcoded.

   This means:
   - Week 1: dog is Overweight → should get -10% BCS calorie adjustment
   - But engine passed "Ideal" → zero adjustment → calorie targets overstated

   FIX: Dynamically estimate BCS category each week based on
   current weight vs targetWeight deviation, then pass correct
   category to calculateCalories().

   Also fixed: Muscle_Build progression used to run up to 52 weeks
   but capped at week 12. Now it's explicitly 12 weeks max with a
   comment explaining why (muscle remodeling plateau in dogs).
─────────────────────────────────────────────────────────────────── */

import { calculateMacros } from "./macroEngine.js";
import { calculateCalories } from "./calorieEngine.js";

/* ── Estimate BCS category from deviation percent ──────────────────
   Used during week-by-week recalculation so calorie adjustments
   reflect the dog's changing weight condition, not always "Ideal".
── */
function estimateBCSCategory(currentWeight, targetWeight) {
  const deviation = ((currentWeight - targetWeight) / targetWeight) * 100;

  if (deviation <= -20)  return "Severely_Underweight";
  if (deviation <= -5)   return "Underweight";
  if (deviation <= 5)    return "Ideal";
  if (deviation <= 20)   return "Overweight";
  return "Obese";
}

export function simulateJourney({
  startWeight,
  targetWeight,
  weeklyPercent,
  mode,
  lifeStage,
  ageMonths,
  activity,
  season = "Normal",
  symptoms = [],
  engineData,
}) {

  if (!engineData) throw new Error("engineData missing in progression engine");
  if (!mode || mode === "Maintenance") return [];
  if (!startWeight || startWeight <= 0) throw new Error("Invalid startWeight");

  let weight = startWeight;
  const weeklyDecimal = weeklyPercent / 100;
  const results = [];
  const MAX_WEEKS = 52;

  for (let week = 1; week <= MAX_WEEKS; week++) {

    /* ── Weight change ── */
    if (mode === "Fat_Loss") {
      weight = weight - (weight * weeklyDecimal);
    } else if (mode === "Weight_Gain" || mode === "Muscle_Build") {
      weight = weight + (weight * weeklyDecimal);
    }

    weight = Number(weight.toFixed(2));

    /* ── FIX: Dynamic BCS category per week ── */
    const currentBCSCategory = estimateBCSCategory(weight, targetWeight);

    /* ── Calorie recalculation with real BCS ── */
    const calorieResult = calculateCalories({
      weight,
      ageMonths,
      activity,
      season,
      symptoms,
      lifeStage,
      bcsCategory: currentBCSCategory,  // FIX: was hardcoded "Ideal"
      engineData,
    });

    /* ── Macro recalculation ── */
    const macroResult = calculateMacros({
      calories: calorieResult.finalDailyCalories,
      strategyMode: mode,
      lifeStage,
      engineData,
    });

    results.push({
      week,
      projected_weight:     weight,
      bcs_category:         currentBCSCategory,  // Added for transparency
      weekly_percent_change: mode === "Fat_Loss" ? -weeklyPercent : weeklyPercent,
      calories:     calorieResult.finalDailyCalories,
      protein_g:    macroResult.macro_grams.protein,
      fat_g:        macroResult.macro_grams.fat,
      carbs_g:      macroResult.macro_grams.carbs,
    });

    /* ── Stop conditions ── */
    if (mode === "Fat_Loss"   && weight <= targetWeight) break;
    if (mode === "Weight_Gain" && weight >= targetWeight) break;
    // Muscle_Build: 12 week program max (physiological plateau for dogs)
    if (mode === "Muscle_Build" && week >= 12) break;
  }

  return results;
}