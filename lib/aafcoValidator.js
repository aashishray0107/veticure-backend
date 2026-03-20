/**
 * aafcoValidator.js
 * AAFCO / NRC minimum nutrient floor enforcer.
 * 100% data-driven — reads all thresholds from engineData JSON.
 * No hardcoded numbers except DM_ENERGY_DENSITY (3.5 kcal/g — AAFCO standard).
 */

/* ─── Constants ──────────────────────────────────────────────────────────────
 * DM_ENERGY_DENSITY: 3.5 kcal/g dry matter — AAFCO standard reference basis.
 * This is the ONLY constant that may remain here; it is an AAFCO publication
 * value, not a dataset-specific number.
 * ─────────────────────────────────────────────────────────────────────────── */
const DM_ENERGY_DENSITY = 3.5;

/**
 * Resolve AAFCO lifecycle tier from a lifecycle stage name.
 * Uses the same stage name strings as Lifecycle_Growth_Model_20_Stages.
 *
 * Growth stages → "Puppy"
 * Senior/Geriatric stages → "Senior"
 * Everything else → "Adult"
 */
function resolveLifecycleTier(lifeStage) {
  if (!lifeStage) return "Adult";

  const GROWTH_KEYWORDS = [
    "Neonatal", "Transitional", "Socialization",
    "Puppy", "Juvenile", "Adolescence",
  ];
  const SENIOR_KEYWORDS = ["Senior", "Geriatric"];

  for (const kw of GROWTH_KEYWORDS) {
    if (lifeStage.includes(kw)) return "Puppy";
  }
  for (const kw of SENIOR_KEYWORDS) {
    if (lifeStage.includes(kw)) return "Senior";
  }

  return "Adult";
}

/**
 * validateAAFCO
 *
 * Enforces minimum protein and fat floors per AAFCO/NRC standards.
 * All minimum values are read from:
 *   engineData.Macronutrient_Ratio_Profiles.Nutrient_Minimum_Standards
 *
 * @param {object} params
 * @param {number} params.calories          - Final daily kcal
 * @param {number} params.proteinGrams      - Calculated protein grams (pre-floor)
 * @param {number} params.fatGrams          - Calculated fat grams (pre-floor)
 * @param {string} params.lifeStage         - Stage_Name from lifecycle model
 * @param {object} params.engineData        - Full breed JSON dataset
 *
 * @returns {object} Validated protein/fat grams + debug info
 */
export function validateAAFCO({
  calories,
  proteinGrams,
  fatGrams,
  lifeStage,
  engineData,
}) {
  /* ── Guards ─────────────────────────────────────────────────────────────── */
  if (!engineData) throw new Error("engineData missing in AAFCO validator");
  if (!calories || calories <= 0) throw new Error("Invalid calories in AAFCO validator");
  if (proteinGrams == null || proteinGrams < 0) throw new Error("Invalid proteinGrams");
  if (fatGrams == null || fatGrams < 0) throw new Error("Invalid fatGrams");

  /* ── Read standards from JSON ───────────────────────────────────────────── */
  const standardsRoot =
    engineData?.Macronutrient_Ratio_Profiles?.Nutrient_Minimum_Standards;

  if (!standardsRoot) {
    throw new Error("Macronutrient_Ratio_Profiles.Nutrient_Minimum_Standards missing in engineData");
  }

  const tier     = resolveLifecycleTier(lifeStage);
  const standard = standardsRoot[tier];

  if (!standard) {
    throw new Error(
      `No AAFCO standard found for lifecycle tier: "${tier}" ` +
      `(stage: "${lifeStage}"). ` +
      `Available tiers: ${Object.keys(standardsRoot).join(", ")}`
    );
  }

  const proteinMinDM = standard.Protein_Min;
  const fatMinDM     = standard.Fat_Min;

  if (proteinMinDM == null) throw new Error(`Protein_Min missing for tier: ${tier}`);
  if (fatMinDM     == null) throw new Error(`Fat_Min missing for tier: ${tier}`);

  /* ── Compute floors ─────────────────────────────────────────────────────── */
  /* Formula derivation:
   *   DM amount (g) = calories / DM_ENERGY_DENSITY
   *   Min nutrient g = DM_amount * Min_DM_fraction
   *   → Min_g = (calories * Min_DM_fraction) / DM_ENERGY_DENSITY
   */
  const minProteinGrams = (calories * proteinMinDM) / DM_ENERGY_DENSITY;
  const minFatGrams     = (calories * fatMinDM)     / DM_ENERGY_DENSITY;

  /* ── Apply floors ───────────────────────────────────────────────────────── */
  const finalProtein = Math.max(proteinGrams, minProteinGrams);
  const finalFat     = Math.max(fatGrams,     minFatGrams);

  /* ── Also check calcium & phosphorus min DM for info ───────────────────── */
  const caMinDM = standard.Calcium_Min  ?? null;
  const pMinDM  = standard.Phosphorus_Min ?? null;

  return {
    protein_grams:         finalProtein,
    fat_grams:             finalFat,
    lifecycle_tier:        tier,
    lifecycle_stage_input: lifeStage,
    aafco_protein_floor_g: Math.round(minProteinGrams * 10) / 10,
    aafco_fat_floor_g:     Math.round(minFatGrams     * 10) / 10,
    protein_was_bumped:    finalProtein > proteinGrams,
    fat_was_bumped:        finalFat     > fatGrams,
    standard_used: {
      Protein_Min:    proteinMinDM,
      Fat_Min:        fatMinDM,
      Calcium_Min:    caMinDM,
      Phosphorus_Min: pMinDM,
    },
  };
}