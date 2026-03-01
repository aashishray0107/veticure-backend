export function calculateBCS(weight, ageMonths) {
  // Temporary: assume adult Labrador ideal 30kg mid
  const idealMid = 30;

  const deviation = (weight - idealMid) / idealMid;

  let category = "";
  let estimatedBCS = 5;

  if (deviation <= -0.06) {
    category = "Underweight";
    estimatedBCS = 3;
  } else if (deviation >= 0.2) {
    category = "Obese";
    estimatedBCS = 8;
  } else if (deviation >= 0.06) {
    category = "Overweight";
    estimatedBCS = 6;
  } else {
    category = "Ideal";
    estimatedBCS = 5;
  }

  return {
    idealMid,
    deviation,
    category,
    estimatedBCS
  };
}