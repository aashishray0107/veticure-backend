import fs from "fs";
import path from "path";

const dataPath = path.join(process.cwd(), "data", "labrador_engine.json");
const engineData = JSON.parse(fs.readFileSync(dataPath, "utf-8"));

console.log("==== FULL STRUCTURE DEBUG ====");
console.log("Top Level:", Object.keys(engineData));

if (engineData.BCS_Automatic_Detection_Logic) {
  console.log(
    "Inside BCS:",
    Object.keys(engineData.BCS_Automatic_Detection_Logic)
  );
}

export function calculateMacros() {
  throw new Error("Debug only");
}