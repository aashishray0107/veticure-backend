import fs from "fs";
import path from "path";

const dataPath = path.join(process.cwd(), "data", "labrador_engine.json");

const engineData = JSON.parse(fs.readFileSync(dataPath, "utf-8"));

export function calculateMacros({ calories, strategyMode }) {

  console.log("=== MACRO DEBUG START ===");
  console.log("Top level keys:", Object.keys(engineData));

  const bcsRoot = engineData.BCS_Automatic_Detection_Logic;

  if (!bcsRoot) {
    throw new Error("BCS_Automatic_Detection_Logic missing in JSON");
  }

  console.log("BCS root keys:", Object.keys(bcsRoot));

  if (!bcsRoot.Macronutrient_Ratio_Profiles) {
    console.log("Macronutrient_Ratio_Profiles DOES NOT EXIST");
  } else {
    console.log(
      "Macronutrient_Ratio_Profiles keys:",
      Object.keys(bcsRoot.Macronutrient_Ratio_Profiles)
    );
  }

  throw new Error("Debug Stop");
}