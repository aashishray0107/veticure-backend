import fs from "fs";
import path from "path";

import { calculateBCS }         from "../lib/bcsEngine.js";
import { calculateCalories }    from "../lib/calorieEngine.js";
import { calculateMacros }      from "../lib/macroEngine.js";
import { generateDietPlan }     from "../lib/dietEngine.js";
import { simulateJourney }      from "../lib/progressionEngine.js";
import { calculateCalcium }     from "../lib/calciumEngine.js";

/* ── Dataset cache ─────────────────────────────────────────────── */
const datasetCache = {};

function normalizeBreedName(breed) {
  if (!breed) throw new Error("Breed required");
  return breed.toLowerCase().trim().replace(/\s+/g, "_");
}

function loadDataset(breed) {
  if (!breed) throw new Error("Breed required");
  const fileName = `${normalizeBreedName(breed)}_engine.json`;
  if (datasetCache[fileName]) return datasetCache[fileName];
  const dataPath = path.join(process.cwd(), "data", "breeds", fileName);
  if (!fs.existsSync(dataPath)) throw new Error(`Dataset not found for breed: ${breed}`);
  const dataset = JSON.parse(fs.readFileSync(dataPath, "utf-8"));
  datasetCache[fileName] = dataset;
  return dataset;
}

/* ── Age resolver — supports age, age_months, age_years ───────── */
function resolveAgeMonths(body) {
  if (body.age_months !== undefined) {
    const m = Number(body.age_months);
    if (isNaN(m) || m < 0) throw new Error("Invalid age_months");
    return m;
  }
  if (body.age_years !== undefined) {
    const y = Number(body.age_years);
    if (isNaN(y) || y < 0) throw new Error("Invalid age_years");
    return Math.round(y * 12);
  }
  if (body.age !== undefined) {
    const m = Number(body.age);
    if (isNaN(m) || m < 0) throw new Error("Invalid age");
    return m;
  }
  throw new Error("Age is required. Send age, age_months, or age_years.");
}

/* ── Life stage ────────────────────────────────────────────────── */
function detectLifeStage(ageMonths) {
  if (ageMonths < 12) return "Puppy";
  if (ageMonths < 96) return "Adult";
  return "Senior";
}

/* ── Strategy ──────────────────────────────────────────────────── */
function determineStrategy(bcsCategory, goal = "Maintenance", activity = "Moderate") {
  if (bcsCategory === "Obese"       || bcsCategory === "Overweight")           return "Fat_Loss";
  if (bcsCategory === "Underweight" || bcsCategory === "Severely_Underweight") return "Weight_Gain";
  if (bcsCategory === "Ideal"       && activity    === "High")                 return "Muscle_Build";
  return goal;
}

/* ── Main handler ──────────────────────────────────────────────── */
export default async function handler(req, res) {
  try {

    if (req.method !== "POST") {
      return res.status(405).json({ error: "Method not allowed. Use POST." });
    }

    const body = req.body || {};

    /* Basic input checks */
    const { breed = "Golden Retriever", weight, gender = "unknown",
            activity = "Moderate", season = "Normal",
            goal = "Maintenance", symptoms = [] } = body;

    if (!weight || Number(weight) <= 0) throw new Error("Invalid weight. Must be > 0.");
    const ageMonths = resolveAgeMonths(body);

    /* Load breed data */
    const engineData = loadDataset(breed);
    const lifeStage  = detectLifeStage(ageMonths);

    /* BCS */
    const bcsResult = calculateBCS({ weight: Number(weight), ageMonths, gender, engineData });
    const bcsCategory    = bcsResult.category;
    const idealWeight    = bcsResult.idealMid;
    const deviationPct   = bcsResult.deviation_percent;

    /* Strategy */
    const strategyMode = determineStrategy(bcsCategory, goal, activity);

    /* Calories */
    const calorieResult = calculateCalories({
      weight: Number(weight), ageMonths, activity, season,
      symptoms, lifeStage, bcsCategory, engineData,
    });

    /* Macros */
    const macroResult = calculateMacros({
      calories: calorieResult.finalDailyCalories,
      strategyMode, lifeStage, engineData,
    });

    /* Weight progression */
    const journey = simulateJourney({
      startWeight: Number(weight), targetWeight: idealWeight,
      weeklyPercent: 1, mode: strategyMode,
      lifeStage, ageMonths, activity, season, symptoms, engineData,
    });

    /* Diet plan */
    const diet = generateDietPlan({
      macros: macroResult.macro_grams,
      calories: calorieResult.finalDailyCalories,
      bcsCategory, bodyWeight: Number(weight), symptoms, engineData,
    });

    /* Calcium report */
    let calciumReport = null;
    if (diet && diet.length > 0) {
      try {
        calciumReport = calculateCalcium({
          dayPlan:            diet[0],
          finalDailyCalories: calorieResult.finalDailyCalories,
          bodyWeight:         Number(weight),
          lifeStage:          bcsResult.life_stage,
          engineData,
        });
      } catch (calcErr) {
        console.error("[CALCIUM ERROR]", calcErr.message);
        calciumReport = { error: calcErr.message };
      }
    }

    /* Final response */
    return res.status(200).json({
      breed,
      bcs_report: {
        ideal_weight:             idealWeight,
        weight_deviation_percent: deviationPct,
        bcs_category:             bcsCategory,
        estimated_bcs_score:      bcsResult.estimatedBCS,
        life_stage_detected:      bcsResult.life_stage,
      },
      strategy_used:      strategyMode,
      calorie_report:     calorieResult,
      macro_report:       macroResult,
      weight_progression: journey,
      weekly_diet_plan:   diet,
      calcium_report:     calciumReport,
    });

  } catch (err) {
    console.error("ENGINE ERROR:", err.message);
    return res.status(500).json({ error: err.message });
  }
}