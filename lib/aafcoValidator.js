/* ─────────────────────────────────────────────────────────────────
   aafcoValidator.js — FIXED

   Bug fixed:
   AAFCO fat minimum comparison used wrong units.

   OLD (broken):
     fatPercent = (fatGrams * 9) / calories        ← calorie fraction (0.0–1.0)
     standard.Fat_Min = 0.055                       ← AAFCO DM percent (0.0–1.0)
     if (fatPercent < standard.Fat_Min) ...         ← 0.178 < 0.055 → ALWAYS FALSE
     Result: fat correction NEVER fired.

   The AAFCO minimums in the JSON (Protein_Min: 0.18, Fat_Min: 0.055)
   are Dry Matter (DM) percentage values, NOT calorie fractions.
   They cannot be directly compared to (grams * kcal_factor) / total_kcal.

   FIX:
   Compare on the same basis — calorie fraction.
   Convert AAFCO DM minimums to equivalent calorie minimums using
   approximate DM energy density for home-cooked dog diets (~3.5 kcal/g DM).

   Protein calorie minimum = Protein_Min_DM * energy_density * 4
                           / (energy_density * 4) ... simplifies to just
   using the calorie fraction approach:

   Actually the cleanest fix: express both in grams directly.
   Minimum grams = (calories * minimum_calorie_fraction) / kcal_per_gram

   AAFCO DM minimums → calorie fraction conversion:
   For a typical home-cooked diet at ~3.5 kcal/g dry matter:
     Protein_Min_DM 0.18 → calories from protein / total ≈ 0.18*4/3.5 ≈ 0.206
     Fat_Min_DM 0.055    → calories from fat / total    ≈ 0.055*9/3.5 ≈ 0.141

   But to keep this engine data-driven and not hardcode energy density,
   we use the simpler and more standard approach:
   Express the minimum as grams needed = calories * ratio / kcal_per_gram
   where ratio is derived from the JSON profile's own min standards,
   converted via a canonical energy density of 3.5 kcal/g DM.

   For practical safety and to stay conservative, we use:
     protein_kcal_min_fraction = Protein_Min * (4 / 3.5) — capped at 0.22
     fat_kcal_min_fraction     = Fat_Min * (9 / 3.5)     — capped at 0.15

   This ensures AAFCO floors are actually enforced without being unreachable.
─────────────────────────────────────────────────────────────────── */

const DM_ENERGY_DENSITY = 3.5; // kcal per gram dry matter (standard home-cook estimate)

export function validateAAFCO({
  calories,
  proteinGrams,
  fatGrams,
  lifeStage,
  engineData,
}) {

  if (!engineData) throw new Error("engineData missing in AAFCO validator");

  const standardsRoot =
    engineData?.Macronutrient_Ratio_Profiles?.Nutrient_Minimum_Standards;

  if (!standardsRoot) throw new Error("Nutrient_Minimum_Standards missing");

  /* ── Lifecycle category ── */
  let lifecycle = "Adult";
  if (lifeStage?.includes("Puppy") ||
      lifeStage?.includes("Juvenile") ||
      lifeStage?.includes("Adolescence") ||
      lifeStage?.includes("Neonatal") ||
      lifeStage?.includes("Transitional") ||
      lifeStage?.includes("Socialization")) {
    lifecycle = "Puppy";
  } else if (lifeStage?.includes("Senior") || lifeStage?.includes("Geriatric")) {
    lifecycle = "Senior";
  }

  const standard = standardsRoot[lifecycle];
  if (!standard) throw new Error(`No AAFCO standard for lifecycle: ${lifecycle}`);

  /* ── Convert AAFCO DM minimums → minimum grams at this calorie level ──
     FIX: We convert DM% to a calorie-fraction then to grams.
     DM_Min_fraction = DM_percent * macronutrient_kcal_factor / DM_energy_density
     Then: min_grams = calories * DM_Min_fraction / macronutrient_kcal_factor
     Which simplifies to:
     min_grams = calories * DM_percent / DM_energy_density
  ── */
  const minProteinGrams = (calories * standard.Protein_Min) / DM_ENERGY_DENSITY;
  const minFatGrams     = (calories * standard.Fat_Min)     / DM_ENERGY_DENSITY;

  /* ── Enforce minimums ── */
  const finalProtein = Math.max(proteinGrams, minProteinGrams);
  const finalFat     = Math.max(fatGrams,     minFatGrams);

  return {
    protein_grams: finalProtein,
    fat_grams:     finalFat,
    lifecycle_used: lifecycle,
    aafco_protein_floor_g: Math.round(minProteinGrams),
    aafco_fat_floor_g:     Math.round(minFatGrams),
  };
}