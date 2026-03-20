/**
 * macroEngine.js
 * Converts daily calories into macro grams, then validates against AAFCO floors.
 *
 * Fixes applied vs old version:
 *  - MACRO_01: Fiber_Info_Only excluded from totalRatio (not an energy fraction per NRC)
 *  - MACRO_02: adjustedCarbGrams uses (calories - protein*4 - fat*9) / 4 — fiber not subtracted
 *  - MACRO_03: Reads profile['Fiber_Info_Only'] not profile.Fiber
 */

import { validateAAFCO } from "./aafcoValidator.js";

/* ─── Strategy → profile key map ────────────────────────────────────────── */
const STRATEGY_TO_PROFILE = {
  Fat_Loss:     "Fat_Loss_Priority",
  Weight_Gain:  "Weight_Gain_Priority",
  Muscle_Build: "Muscle_Build",
  Maintenance:  "Maintenance",
};

/**
 * calculateMacros
 *
 * @param {object} params
 * @param {number}  params.calories      Final daily kcal from calorieEngine
 * @param {string}  params.strategyMode  "Fat_Loss" | "Weight_Gain" | "Muscle_Build" | "Maintenance"
 * @param {string}  params.lifeStage     Stage_Name from lifecycle model
 * @param {object}  params.engineData    Full breed JSON dataset
 *
 * @returns {object} Macro grams + debug info
 */
export function calculateMacros({
  calories,
  strategyMode,
  lifeStage,
  engineData,
}) {
  /* ── Guards ─────────────────────────────────────────────────────────────── */
  if (!engineData)                   throw new Error("engineData missing in macro engine");
  if (!calories || calories <= 0)    throw new Error("Invalid calories in macro engine");

  /* ── Step 1: Read macro profile from JSON ───────────────────────────────── */
  const macroRoot = engineData?.Macronutrient_Ratio_Profiles;
  if (!macroRoot) throw new Error("Macronutrient_Ratio_Profiles missing in engineData");

  const profileKey = STRATEGY_TO_PROFILE[strategyMode] ?? "Maintenance";
  const profile    = macroRoot[profileKey];

  if (!profile) {
    throw new Error(
      `Macro profile not found: "${profileKey}". ` +
      `Available: ${Object.keys(macroRoot).filter(k => !k.startsWith("_") && typeof macroRoot[k] === "object" && macroRoot[k].Protein).join(", ")}`
    );
  }

  /* ── Step 2: Extract ratios — Fiber_Info_Only is NOT an energy fraction ─── */
  /* Per JSON v1.2.2 note:
   *   "Fiber_Info_Only is a non-digestible carbohydrate fraction listed for
   *    dietary guidance only. ME calculation uses Protein*4 + Fat*9 + Carbs*4 only."
   * So we sum ONLY the 3 energy macros for the denominator.
   */
  const proteinRatio = profile.Protein ?? 0;
  const fatRatio     = profile.Fat     ?? 0;
  const carbRatio    = profile.Carbs   ?? 0;

  // Fiber is informational — read it but never include in energy calculations.
  // Support both JSON key variants:
  //   v1.2.x: "Fiber_Info_Only"  (new — NRC-correct naming)
  //   legacy : "Fiber"           (old labrador/other breed JSONs)
  const fiberInfoRatio =
    profile["Fiber_Info_Only"] ??
    profile["Fiber"]           ??
    0;

  const energySum = proteinRatio + fatRatio + carbRatio;
  if (energySum <= 0) throw new Error(`Invalid macro profile: energy sum = ${energySum}`);

  /* Normalise ratios in case they don't perfectly sum to 1.0 (tolerance ±0.02) */
  const pRatio = proteinRatio / energySum;
  const fRatio = fatRatio     / energySum;
  const cRatio = carbRatio    / energySum;

  /* ── Step 3: Compute raw macro grams ────────────────────────────────────── */
  /* ME factors (NRC 2006):  Protein = 4 kcal/g, Fat = 9 kcal/g, Carbs = 4 kcal/g */
  const rawProteinGrams = (calories * pRatio) / 4;
  const rawFatGrams     = (calories * fRatio) / 9;

  /* ── Step 4: AAFCO validation — enforce minimum floors ─────────────────── */
  const validated = validateAAFCO({
    calories,
    proteinGrams: rawProteinGrams,
    fatGrams:     rawFatGrams,
    lifeStage,
    engineData,
  });

  /* ── Step 5: Compute carbs from remaining calories ───────────────────────
   * Correct formula: remaining = total - (protein energy) - (fat energy)
   * Fiber is NOT subtracted here — it is informational only.
   */
  const usedCalories    = (validated.protein_grams * 4) + (validated.fat_grams * 9);
  const remaining       = Math.max(0, calories - usedCalories);
  const finalCarbGrams  = remaining / 4;

  /* ── Step 6: Fiber gram estimate (informational only, not energy-bearing) ─ */
  // Estimate as a fraction of total food weight (~fiberInfoRatio of carb fraction)
  // This is purely for display/logging — not used in calorie math
  const fiberInfoGrams  = (calories * fiberInfoRatio) / 4;

  /* ── Step 7: Build output ───────────────────────────────────────────────── */
  /* Rounding strategy to ensure macro_kcal == target_kcal exactly:
   * 1. Protein and fat are Math.round (AAFCO validated, small tolerance ok).
   * 2. Carbs = (target_kcal - rounded_protein_kcal - rounded_fat_kcal) / 4
   *    This absorbs all rounding remainders → perfect balance every time.
   */
  const roundedProtein = Math.round(validated.protein_grams);
  const roundedFat     = Math.round(validated.fat_grams);
  const exactCarbKcal  = calories - (roundedProtein * 4) - (roundedFat * 9);
  const exactCarbGrams = Math.max(0, Math.round(exactCarbKcal / 4));

  return {
    strategy_used:      strategyMode,
    macro_profile_used: profileKey,
    macro_grams: {
      protein:         roundedProtein,
      fat:             roundedFat,
      carbs:           exactCarbGrams,
      fiber_info_only: Math.round(fiberInfoGrams), // display only
    },
    calorie_check: {
      target_kcal:   calories,
      macro_kcal:    (roundedProtein * 4) + (roundedFat * 9) + (exactCarbGrams * 4),
    },
    aafco_debug: {
      lifecycle_tier:        validated.lifecycle_tier,
      lifecycle_stage_input: validated.lifecycle_stage_input,
      aafco_protein_floor_g: validated.aafco_protein_floor_g,
      aafco_fat_floor_g:     validated.aafco_fat_floor_g,
      protein_was_bumped:    validated.protein_was_bumped,
      fat_was_bumped:        validated.fat_was_bumped,
      standard_used:         validated.standard_used,
    },
  };
}