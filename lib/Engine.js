/**
 * Engine.js — VETiCure main API handler
 * POST /api/engine
 * Clinical basis: NRC 2006, AAFCO 2023, WSAVA nutrition guidelines
 */

import fs   from "fs";
import path from "path";

import { calculateBCS }      from "../lib/bcsEngine.js";
import { calculateCalories } from "../lib/calorieEngine.js";
import { calculateMacros }   from "../lib/macroEngine.js";
import { generateDietPlan }  from "../lib/dietEngine.js";
import { simulateJourney }   from "../lib/progressionEngine.js";
import { calculateCalcium }  from "../lib/calciumEngine.js";

const datasetCache = {};

function normalizeBreedName(breed) {
  if (!breed) throw new Error("breed is required");
  return breed.toLowerCase().trim().replace(/\s+/g, "_");
}

function loadDataset(breed) {
  const fileName = `${normalizeBreedName(breed)}_engine.json`;
  if (datasetCache[fileName]) return datasetCache[fileName];
  const dataPath = path.join(process.cwd(), "data", "breeds", fileName);
  if (!fs.existsSync(dataPath)) throw new Error(`Dataset not found: "${breed}" → ${fileName}`);
  const dataset = JSON.parse(fs.readFileSync(dataPath, "utf-8"));
  datasetCache[fileName] = dataset;
  return dataset;
}

function resolveAgeMonths(body) {
  if (body.age_months !== undefined) { const m = Number(body.age_months); if (isNaN(m)||m<0) throw new Error("Invalid age_months"); return m; }
  if (body.age_years  !== undefined) { const y = Number(body.age_years);  if (isNaN(y)||y<0) throw new Error("Invalid age_years");  return Math.round(y*12); }
  if (body.age        !== undefined) { const m = Number(body.age);        if (isNaN(m)||m<0) throw new Error("Invalid age");        return m; }
  throw new Error("Age required: provide age_months, age_years, or age.");
}

function detectBroadLifeStage(ageMonths, engineData) {
  const stages = engineData?.Lifecycle_Growth_Model_20_Stages ?? [];
  const earlySenior  = stages.find(s => s.Stage_Name === "Early_Senior");
  const seniorStartMo = (earlySenior?.min_age_years ?? 7) * 12;
  const youngAdult   = stages.find(s => s.Stage_Name === "Young_Adult_Early");
  const adultStartMo = youngAdult?.min_age_months ?? 12;
  if (ageMonths < adultStartMo)   return "Puppy";
  if (ageMonths >= seniorStartMo) return "Senior";
  return "Adult";
}

function determineStrategy(bcsCategory, goal, activity) {
  const normActivity = (activity ?? "").toLowerCase().trim();
  const normGoal     = goal ?? "Maintenance";
  if (["Obese", "Overweight", "Severely_Obese"].includes(bcsCategory))                    return "Fat_Loss";
if (["Underweight", "Severely_Underweight", "Emaciated", "Very_Thin"].includes(bcsCategory)) return "Weight_Gain";
  if (bcsCategory === "Ideal" && (normActivity === "high" || normActivity === "high_activity")) return "Muscle_Build";
  return normGoal;
}

function getCaThreshold(lifeStage, engineData) {
  const GROWTH = new Set(["Socialization_Puppy","Early_Puppy","Juvenile_I","Juvenile_II","Juvenile_III","Adolescence_Early","Adolescence_Mid","Adolescence_Late"]);
  if (GROWTH.has(lifeStage)) return engineData?.Nutrient_Standards?.Growth_Large_Breed?.Calcium_g_per_1000_kcal_Range?.[0] ?? 3.0;
  return engineData?.Calcium_Supplementation_Module?.Adult_Ca_Monitoring?.Alert_If_Ca_per_1000kcal_Below ?? 1.25;
}

function validateSymptoms(symptoms, engineData) {
  if (!Array.isArray(symptoms)) return [];
  const known = new Set(Object.keys(engineData?.Master_Calorie_Adjustment_Pipeline?.Symptom_Adjustment ?? {}));
  const valid = [], unknown = [];
  for (const s of symptoms) { if (known.has(s)) valid.push(s); else unknown.push(s); }
  if (unknown.length > 0) console.warn(`[Engine] Unknown symptoms ignored: ${unknown.join(", ")}`);
  return valid;
}

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed. Use POST." });

    const body = req.body ?? {};
    const { breed, weight, gender } = body;
    if (!breed)                         throw new Error("breed is required");
    if (!weight || Number(weight) <= 0) throw new Error("weight must be a positive number (kg)");
    if (!gender)                        throw new Error("gender is required: 'male' or 'female'");

    const normalizedGender = gender.toLowerCase().trim();
    if (!["male","female"].includes(normalizedGender)) throw new Error("gender must be 'male' or 'female'");

    const activity = body.activity ?? "Moderate";
    const season   = body.season   ?? "Normal";
    const goal     = body.goal     ?? "Maintenance";
    const symptoms = body.symptoms ?? [];
    const ageMonths = resolveAgeMonths(body);

    const rawNeuterInput = (body?.neuter_status ?? body?.neuter ?? "neutered").toString().toLowerCase().trim();
    const isNeutered     = rawNeuterInput !== "intact";

    const engineData       = loadDataset(breed);
    const broadLifeStage   = detectBroadLifeStage(ageMonths, engineData);
    const validSymptoms    = validateSymptoms(symptoms, engineData);

    const bcsResult = calculateBCS({ weight: Number(weight), ageMonths, gender: normalizedGender, engineData });
    const { category: bcsCategory, idealMid: idealWeight, deviation_percent: deviationPct } = bcsResult;

    const strategyMode  = determineStrategy(bcsCategory, goal, activity);

    const calorieResult = calculateCalories({
      weight: Number(weight), ageMonths, activity, season,
      symptoms: validSymptoms, lifeStage: bcsResult.life_stage,
      bcsCategory, isNeutered, engineData,
    });

    const macroResult = calculateMacros({
      calories: calorieResult.finalDailyCalories,
      strategyMode, lifeStage: bcsResult.life_stage, engineData,
    });

    const journey = simulateJourney({
      startWeight: Number(weight), targetWeight: idealWeight, weeklyPercent: 1,
      mode: strategyMode, lifeStage: bcsResult.life_stage, ageMonths,
      activity, season, symptoms: validSymptoms, isNeutered, engineData,
    });

    const diet = generateDietPlan({
      macros: macroResult.macro_grams, calories: calorieResult.finalDailyCalories,
      bcsCategory, bodyWeight: Number(weight), ageMonths,
      lifeStage: bcsResult.life_stage, symptoms: validSymptoms, engineData,
    });

    let calciumReport = null;
    if (diet?.length > 0) {
      try {
        calciumReport = calculateCalcium({
          dayPlan: diet[0], finalDailyCalories: calorieResult.finalDailyCalories,
          bodyWeight: Number(weight), lifeStage: bcsResult.life_stage, engineData,
        });
      } catch (err) {
        console.error("[Engine] Calcium error:", err.message);
        calciumReport = { error: err.message };
      }
    }

    let systemHealth = "optimal";
    const caThreshold = getCaThreshold(bcsResult.life_stage, engineData);
    if (calciumReport?.minerals?.calcium_per_1000kcal != null && calciumReport.minerals.calcium_per_1000kcal < caThreshold) systemHealth = "critical_calcium_deficit";
    if (calciumReport?.calcium_supplement?.required === true)  systemHealth = "requires_intervention";
    if (calciumReport?.calcium_supplement?.warning)            systemHealth = systemHealth === "optimal" ? "attention_needed" : systemHealth;

    let progressionSummary = null;
    if (journey.length > 0) {
      const first = journey[0], last = journey[journey.length - 1];
      const direction = strategyMode === "Fat_Loss" ? "loss" : "gain";
      const weeklyRate = Math.abs(first.percent_change_this_week ?? 0);
      const rateLabel  = `${direction === "loss" ? "-" : "+"}${weeklyRate}% per week`;
      const reachesTarget =
        (strategyMode === "Fat_Loss"    && last.projected_weight_kg <= idealWeight) ||
        (strategyMode === "Weight_Gain" && last.projected_weight_kg >= idealWeight) ||
        strategyMode === "Muscle_Build";

      progressionSummary = {
        start_weight_kg:       Number(weight),
        target_weight_kg:      idealWeight,
        weight_to_change_kg:   Number((idealWeight - Number(weight)).toFixed(2)),
        direction,
        weekly_change_rate:    rateLabel,
        total_weeks_estimated: last.week,
        reaches_target:        reachesTarget,
        summary: reachesTarget
          ? `At ${rateLabel}, ${breed} reaches ${idealWeight}kg from ${weight}kg in ~${last.week} week${last.week !== 1 ? "s" : ""}.`
          : `Simulation ran ${last.week} weeks — target not reached. Reassess and consult vet.`,
        weekly_breakdown_label: "Each week: projected weight, BCS, daily calories, macros.",
      };
    } else if (strategyMode === "Maintenance") {
      progressionSummary = {
        start_weight_kg:       Number(weight),
        target_weight_kg:      idealWeight,
        weight_to_change_kg:   Number((idealWeight - Number(weight)).toFixed(2)),
        direction:             "none",
        weekly_change_rate:    "0% (maintenance)",
        total_weeks_estimated: 0,
        reaches_target:        Math.abs(Number(weight) - idealWeight) / idealWeight <= 0.05,
        summary:               `Dog is in ${bcsCategory} condition. Maintaining at ${calorieResult.finalDailyCalories} kcal/day.`,
        weekly_breakdown_label: null,
      };
    }

    return res.status(200).json({
      breed,
      neuter_status:         isNeutered ? "neutered" : "intact",
      neuter_input_received: rawNeuterInput,
      life_stage_broad:      broadLifeStage,
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
      strategy_used:       strategyMode,
      calorie_report:      calorieResult,
      macro_report:        macroResult,
      progression_summary: progressionSummary,
      weight_progression:  journey,
      weekly_diet_plan:    diet,
      calcium_report:      calciumReport,
      system_health:       systemHealth,
      ...(symptoms.length !== validSymptoms.length && {
        unknown_symptoms_ignored: symptoms.filter(s => !validSymptoms.includes(s)),
      }),
    });

  } catch (err) {
    console.error("[Engine] ERROR:", err.message);
    return res.status(500).json({
      error:   err.message,
      details: process.env.NODE_ENV !== "production" ? err.stack : undefined,
    });
  }
}