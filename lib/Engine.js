/**
 * index.js — Main API handler for VETiCure nutrition engine.
 *
 * Fixes applied vs old version:
 *  - HANDLER_01: detectLifeStage reads Senior boundary from JSON (not hardcoded 96mo)
 *  - HANDLER_02: systemHealth calcium threshold is lifecycle-aware (3.0 growth / 1.25 adult)
 *  - HANDLER_03: determineStrategy normalises activity to lowercase before comparison
 *  - CALORIE_01: neuter_status collected from request body
 *  - BCS_03:     normalizeBCS removed from handler (bcsEngine handles it)
 */

import fs   from "fs";
import path from "path";

import { calculateBCS }      from "../lib/bcsEngine.js";
import { calculateCalories } from "../lib/calorieEngine.js";
import { calculateMacros }   from "../lib/macroEngine.js";
import { generateDietPlan }  from "../lib/dietEngine.js";
import { simulateJourney }   from "../lib/progressionEngine.js";
import { calculateCalcium }  from "../lib/calciumEngine.js";

/* ── Dataset cache ──────────────────────────────────────────────────────── */
const datasetCache = {};

function normalizeBreedName(breed) {
  if (!breed) throw new Error("Breed required");
  return breed.toLowerCase().trim().replace(/\s+/g, "_");
}

function loadDataset(breed) {
  const fileName = `${normalizeBreedName(breed)}_engine.json`;
  if (datasetCache[fileName]) return datasetCache[fileName];

  const dataPath = path.join(process.cwd(), "data", "breeds", fileName);
  if (!fs.existsSync(dataPath)) {
    throw new Error(`Dataset not found for breed: "${breed}". Expected file: ${fileName}`);
  }

  const dataset = JSON.parse(fs.readFileSync(dataPath, "utf-8"));
  datasetCache[fileName] = dataset;
  return dataset;
}

/* ── Age resolver ───────────────────────────────────────────────────────── */
function resolveAgeMonths(body) {
  if (body.age_months !== undefined) {
    const m = Number(body.age_months);
    if (isNaN(m) || m < 0) throw new Error("Invalid age_months — must be a non-negative number");
    return m;
  }
  if (body.age_years !== undefined) {
    const y = Number(body.age_years);
    if (isNaN(y) || y < 0) throw new Error("Invalid age_years — must be a non-negative number");
    return Math.round(y * 12);
  }
  if (body.age !== undefined) {
    const m = Number(body.age);
    if (isNaN(m) || m < 0) throw new Error("Invalid age — must be a non-negative number");
    return m;
  }
  throw new Error("Age is required. Provide age_months, age_years, or age.");
}

/* ── Life stage detection — reads Senior boundary from JSON ─────────────── */
function detectLifeStage(ageMonths, engineData) {
  const stages = engineData?.Lifecycle_Growth_Model_20_Stages || [];

  /* Find Early_Senior start age from JSON */
  const earlySenior = stages.find(s => s.Stage_Name === "Early_Senior");
  const seniorStartMonths = earlySenior?.min_age_years != null
    ? earlySenior.min_age_years * 12
    : 84; // 7 years fallback

  /* Find Young_Adult_Early start (= end of puppy) from JSON */
  const youngAdult = stages.find(s => s.Stage_Name === "Young_Adult_Early");
  const adultStartMonths = youngAdult?.min_age_months ?? 12;

  if (ageMonths < adultStartMonths)    return "Puppy";
  if (ageMonths >= seniorStartMonths)  return "Senior";
  return "Adult";
}

/* ── Strategy engine ────────────────────────────────────────────────────── */
function determineStrategy(bcsCategory, goal, activity) {
  /* Normalise inputs — fixes HANDLER_03 case-sensitivity bug */
  const normActivity = (activity || "").toLowerCase().trim();
  const normGoal     = goal || "Maintenance";

  /* BCS-driven overrides */
  if (["Obese", "Overweight"].includes(bcsCategory))                  return "Fat_Loss";
  if (["Underweight", "Severely_Underweight"].includes(bcsCategory))  return "Weight_Gain";

  /* High activity + ideal BCS → muscle build */
  if (bcsCategory === "Ideal" && normActivity === "high")             return "Muscle_Build";

  return normGoal;
}

/* ── Lifecycle-aware Ca threshold ───────────────────────────────────────── */
function getCaThreshold(lifeStage, engineData) {
  /* Growth stages use the growth minimum (3.0) */
  const GROWTH_STAGES = new Set([
    "Socialization_Puppy", "Early_Puppy",
    "Juvenile_I", "Juvenile_II", "Juvenile_III",
    "Adolescence_Early", "Adolescence_Mid", "Adolescence_Late",
  ]);

  if (GROWTH_STAGES.has(lifeStage)) {
    return engineData
      ?.Nutrient_Standards
      ?.Growth_Large_Breed
      ?.Calcium_g_per_1000_kcal_Range?.[0]
      ?? 3.0;
  }

  /* Adult / Senior — use NRC adult minimum from JSON */
  return engineData
    ?.Calcium_Supplementation_Module
    ?.Adult_Ca_Monitoring
    ?.Alert_If_Ca_per_1000kcal_Below
    ?? 1.25;
}

/* ── Validate symptoms against known keys ──────────────────────────────── */
function validateSymptoms(symptoms, engineData) {
  if (!Array.isArray(symptoms)) return [];

  const knownSymptoms = new Set(
    Object.keys(engineData?.Master_Calorie_Adjustment_Pipeline?.Symptom_Adjustment || {})
  );

  const valid   = [];
  const unknown = [];

  for (const s of symptoms) {
    if (knownSymptoms.has(s)) {
      valid.push(s);
    } else {
      unknown.push(s);
    }
  }

  if (unknown.length > 0) {
    console.warn(
      `[Handler] Unknown symptoms ignored: ${unknown.join(", ")}. ` +
      `Known: ${[...knownSymptoms].join(", ")}`
    );
  }

  return valid;
}

/* ── Main handler ───────────────────────────────────────────────────────── */
export default async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      return res.status(405).json({ error: "Method not allowed. Use POST." });
    }

    const body = req.body || {};

    const {
      breed,
      weight,
      gender,
      activity      = "Moderate",
      season        = "Normal",
      goal          = "Maintenance",
      symptoms      = [],
      neuter_status = "neutered",   // "neutered" | "intact" — new field
    } = body;

    /* ── Strict input validation ──────────────────────────────────────────── */
    if (!breed) {
      throw new Error("breed is required (e.g. 'Golden Retriever' or 'Labrador')");
    }
    if (!weight || Number(weight) <= 0) {
      throw new Error("weight is required and must be a positive number (kg)");
    }
    if (!gender) {
      throw new Error("gender is required: 'male' or 'female'");
    }

    const normalizedGender = gender.toLowerCase().trim();
    if (!["male", "female"].includes(normalizedGender)) {
      throw new Error("gender must be 'male' or 'female'");
    }

    const ageMonths = resolveAgeMonths(body);

    /* ── Neuter status — read directly from body (not from destructured var)
     * Reason: if body.neuter_status is missing, destructuring default fires.
     * But if the field IS present with value "intact", it must be respected.
     * Accepted values: "intact", "neutered", "spayed" (spayed = neutered).
     * Default: "neutered" (safest metabolic assumption if not provided).
     * ─────────────────────────────────────────────────────────────────────── */
    const rawNeuterInput  = (body?.neuter_status ?? body?.neuter ?? "neutered")
                              .toString()
                              .toLowerCase()
                              .trim();
    const isNeutered      = rawNeuterInput !== "intact";

    /* ── Load breed dataset ──────────────────────────────────────────────── */
    const engineData = loadDataset(breed);

    /* ── Life stage (reads from JSON) ────────────────────────────────────── */
    const lifeStage  = detectLifeStage(ageMonths, engineData);

    /* ── Symptom validation ──────────────────────────────────────────────── */
    const validSymptoms = validateSymptoms(symptoms, engineData);

    /* ── BCS ─────────────────────────────────────────────────────────────── */
    const bcsResult = calculateBCS({
      weight:     Number(weight),
      ageMonths,
      gender:     normalizedGender,
      engineData,
    });

    const bcsCategory  = bcsResult.category;
    const idealWeight  = bcsResult.idealMid;
    const deviationPct = bcsResult.deviation_percent;

    /* ── Strategy ────────────────────────────────────────────────────────── */
    const strategyMode = determineStrategy(bcsCategory, goal, activity);

    /* ── Calories ────────────────────────────────────────────────────────── */
    const calorieResult = calculateCalories({
      weight:     Number(weight),
      ageMonths,
      activity,
      season,
      symptoms:   validSymptoms,
      lifeStage:  bcsResult.life_stage,   // Stage_Name (more precise than broad lifeStage)
      bcsCategory,
      isNeutered,
      engineData,
    });

    /* ── Macros ──────────────────────────────────────────────────────────── */
    const macroResult = calculateMacros({
      calories:     calorieResult.finalDailyCalories,
      strategyMode,
      lifeStage:    bcsResult.life_stage,   // Stage_Name (precise), not broad "Adult/Senior/Puppy"
      engineData,
    });

    /* ── Progression ─────────────────────────────────────────────────────── */
    const journey = simulateJourney({
      startWeight:  Number(weight),
      targetWeight: idealWeight,
      weeklyPercent: 1,
      mode:          strategyMode,
      lifeStage:     bcsResult.life_stage,
      ageMonths,
      activity,
      season,
      symptoms:      validSymptoms,
      isNeutered,
      engineData,
    });

    /* ── Diet plan ───────────────────────────────────────────────────────── */
    const diet = generateDietPlan({
      macros:     macroResult.macro_grams,
      calories:   calorieResult.finalDailyCalories,
      bcsCategory,
      bodyWeight: Number(weight),
      ageMonths,
      lifeStage:  bcsResult.life_stage,  // needed for senior P substitution
      symptoms:   validSymptoms,
      engineData,
    });

    /* ── Calcium ─────────────────────────────────────────────────────────── */
    let calciumReport = null;

    if (diet?.length > 0) {
      try {
        calciumReport = calculateCalcium({
          dayPlan:            diet[0],
          finalDailyCalories: calorieResult.finalDailyCalories,
          bodyWeight:         Number(weight),
          lifeStage:          bcsResult.life_stage,
          engineData,
        });
      } catch (err) {
        console.error("[Handler] Calcium engine error:", err.message);
        calciumReport = { error: err.message };
      }
    }

    /* ── System health — lifecycle-aware Ca threshold ────────────────────── */
    let systemHealth = "optimal";

    const caThreshold = getCaThreshold(bcsResult.life_stage, engineData);

    if (
      calciumReport?.minerals?.calcium_per_1000kcal != null &&
      calciumReport.minerals.calcium_per_1000kcal < caThreshold
    ) {
      systemHealth = "critical_calcium_deficit";
    }

    if (calciumReport?.calcium_supplement?.required === true) {
      systemHealth = "requires_intervention";
    }

    if (calciumReport?.calcium_supplement?.warning) {
      systemHealth = systemHealth === "optimal" ? "attention_needed" : systemHealth;
    }

    /* ── Progression summary ─────────────────────────────────────────────── */
    let progressionSummary = null;
    if (journey.length > 0) {
      const firstWeek      = journey[0];
      const lastWeek       = journey[journey.length - 1];
      const totalWeeks     = lastWeek.week;
      const direction      = strategyMode === "Fat_Loss" ? "loss" : "gain";
      const rateLabel      = `${firstWeek.weekly_percent_change > 0 ? "+" : ""}${firstWeek.weekly_percent_change}% per week`;
      const reachesTarget  = (
        strategyMode === "Fat_Loss"    && lastWeek.projected_weight <= idealWeight ||
        strategyMode === "Weight_Gain" && lastWeek.projected_weight >= idealWeight ||
        strategyMode === "Muscle_Build"
      );

      progressionSummary = {
        start_weight_kg:    Number(weight),
        target_weight_kg:   idealWeight,
        weight_to_change_kg: Number((idealWeight - Number(weight)).toFixed(2)),
        direction,
        weekly_change_rate: rateLabel,
        total_weeks_estimated: totalWeeks,
        reaches_target: reachesTarget,
        summary: reachesTarget
          ? `At ${rateLabel}, ${breed} should reach target weight of ${idealWeight}kg ` +
            `from ${weight}kg in approximately ${totalWeeks} week${totalWeeks !== 1 ? "s" : ""}.`
          : `Simulation ran ${totalWeeks} weeks. Manual reassessment recommended.`,
        weekly_breakdown_label:
          "Each week below shows: projected weight, BCS category, daily calories, " +
          "and macro targets after weight-adjusted recalculation.",
      };
    } else if (strategyMode === "Maintenance") {
      progressionSummary = {
        start_weight_kg:    Number(weight),
        target_weight_kg:   idealWeight,
        weight_to_change_kg: Number((idealWeight - Number(weight)).toFixed(2)),
        direction:          "none",
        weekly_change_rate: "0% (maintenance)",
        total_weeks_estimated: 0,
        reaches_target:     Math.abs(Number(weight) - idealWeight) / idealWeight <= 0.05,
        summary: `Dog is in ${bcsCategory} condition. Maintaining current weight at ${calorieResult.finalDailyCalories} kcal/day.`,
        weekly_breakdown_label: null,
      };
    }

    /* ── Response ────────────────────────────────────────────────────────── */
    return res.status(200).json({
      breed,
      neuter_status:    isNeutered ? "neutered" : "intact",
      neuter_input_received: rawNeuterInput,  // debug: shows exactly what was parsed
      life_stage_broad: lifeStage,

      bcs_report: {
        ideal_weight:             idealWeight,
        ideal_range:              bcsResult.ideal_range,
        weight_deviation_percent: deviationPct,
        bcs_category:             bcsCategory,
        estimated_bcs_score:      bcsResult.estimatedBCS,
        life_stage_detected:      bcsResult.life_stage,
        gender_used:              bcsResult.gender_used,
        bcs_source:               bcsResult.bcs_source,
      },

      strategy_used:  strategyMode,
      calorie_report: calorieResult,
      macro_report:   macroResult,

      progression_summary: progressionSummary,

      weight_progression:
        journey.length > 0
          ? journey
          : [],

      weekly_diet_plan: diet,
      calcium_report:   calciumReport,
      system_health:    systemHealth,

      unknown_symptoms_ignored:
        symptoms.length !== validSymptoms.length
          ? symptoms.filter(s => !validSymptoms.includes(s))
          : undefined,
    });

  } catch (err) {
    console.error("ENGINE ERROR:", err.message);
    return res.status(500).json({
      error:   err.message,
      details: process.env.NODE_ENV !== "production" ? err.stack : undefined,
    });
  }
}