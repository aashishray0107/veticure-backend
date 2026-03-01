import fs from "fs";
import path from "path";

const dataPath = path.join(process.cwd(), "data", "labrador_engine.json");

if (!fs.existsSync(dataPath)) {
  throw new Error("labrador_engine.json not found in /data");
}

const engineData = JSON.parse(
  fs.readFileSync(dataPath, "utf-8")
);

export function validateAAFCO({
  calories,
  proteinGrams,
  fatGrams,
  lifeStage
}) {

  if (!lifeStage) {
    throw new Error("Life stage missing in AAFCO validation");
  }

  const nutritionBlock = engineData[lifeStage];

  if (!nutritionBlock) {
    throw new Error("Nutrition block not found for: " + lifeStage);
  }

  console.log("=== DEBUG NUTRITION BLOCK START ===");
  console.log("LifeStage:", lifeStage);
  console.log("Keys:", Object.keys(nutritionBlock));
  console.log("Full Block:", JSON.stringify(nutritionBlock, null, 2));
  console.log("=== DEBUG NUTRITION BLOCK END ===");

  throw new Error("Debug Stop");
}