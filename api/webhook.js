import { calculateBCS } from "../lib/bcsEngine.js";

let users = {};

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      return res.status(405).send("Method Not Allowed");
    }

    const from = req.body?.From;
    const message = (req.body?.Body || "").trim();

    if (!from) {
      return res.status(400).send("Invalid request");
    }

    if (!users[from]) {
      users[from] = { step: "ask_name" };
    }

    // 🔁 Restart logic
    if (message.toLowerCase() === "restart") {
      users[from] = { step: "ask_name" };

      return sendReply(res, "Session restarted.\nPlease enter your name:");
    }

    let reply = "";

    switch (users[from].step) {

      case "ask_name":
        users[from].name = message;
        users[from].step = "ask_email";
        reply = "Please enter your email address:";
        break;

      case "ask_email":
        users[from].email = message;
        users[from].step = "ask_area";
        reply = "Enter your city/area:";
        break;

      case "ask_area":
        users[from].area = message;
        users[from].step = "ask_weight";
        reply = "Enter your dog's weight in kg:";
        break;

      case "ask_weight":
        users[from].weight = message;
        users[from].step = "ask_age";
        reply = "Enter your dog's age in months:";
        break;

      case "ask_age":
        users[from].age = message;
        users[from].step = "ask_activity";
        reply = "Select activity level:\n1. Low\n2. Moderate\n3. High";
        break;

      case "ask_activity":
        users[from].activity = message;

        try {
          const weight = parseFloat(users[from].weight);
          const age = parseInt(users[from].age);

          const result = calculateBCS(weight, age);

          users[from].bcsData = result;
          users[from].step = "ask_ribs";

          reply =
            `Initial BCS Estimate: ${result.category}\n\n` +
            "1️⃣ Can you easily feel your dog's ribs?\nReply: Yes / No";

        } catch (err) {
          console.error("BCS calculation error:", err);
          reply = "Internal calculation error. Type restart.";
        }

        break;

      case "ask_ribs":
        users[from].ribs = message;
        users[from].step = "ask_waist";
        reply = "2️⃣ Is a clear waist visible from above? (Yes / No)";
        break;

      case "ask_waist":
        users[from].waist = message;
        users[from].step = "ask_tuck";
        reply = "3️⃣ Is there an abdominal tuck from side view? (Yes / No)";
        break;

      case "ask_tuck":
        users[from].tuck = message;

        try {
          const deviationBCS = users[from].bcsData?.estimatedBCS || 5;

          const ribs = (users[from].ribs || "").toLowerCase();
          const waist = (users[from].waist || "").toLowerCase();
          const tuck = (users[from].tuck || "").toLowerCase();

          let questionnaireScore = 0;

          if (ribs === "no") questionnaireScore += 2;
          if (waist === "no") questionnaireScore += 2;
          if (tuck === "no") questionnaireScore += 2;

          let questionnaireBCS = 5;

          if (questionnaireScore <= 1) questionnaireBCS = 4;
          else if (questionnaireScore <= 3) questionnaireBCS = 5;
          else if (questionnaireScore <= 4) questionnaireBCS = 6;
          else questionnaireBCS = 8;

          const finalBCSRaw =
            deviationBCS * 0.6 + questionnaireBCS * 0.4;

          const finalBCS = Math.round(finalBCSRaw);

          users[from].finalBCS = finalBCS;
          users[from].step = "completed";

          reply =
            `Final BCS Score: ${finalBCS} / 9\n\n` +
            "Type 'restart' to begin again.";

        } catch (err) {
          console.error("Fusion error:", err);
          reply = "Internal processing error. Type restart.";
        }

        break;

      default:
        reply = "Session complete. Type 'restart' to begin again.";
    }

    return sendReply(res, reply);

  } catch (error) {
    console.error("Fatal webhook error:", error);
    return sendReply(res, "System error. Please type restart.");
  }
}


// 🔒 Safe Twilio XML response
function sendReply(res, message) {
  const twiml = `
    <Response>
      <Message>${message}</Message>
    </Response>
  `;
  res.setHeader("Content-Type", "text/xml");
  res.status(200).send(twiml);
}