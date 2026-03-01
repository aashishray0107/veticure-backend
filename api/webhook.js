let users = {}; // simple memory store

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).send("Method Not Allowed");
  }

  const from = req.body.From;
  const message = req.body.Body?.trim();

  if (!users[from]) {
    users[from] = { step: "ask_name" };
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
      users[from].step = "completed";
      reply = "Thank you. Calculating BCS and nutrition plan...";
      console.log("User Data:", users[from]);
      break;

    default:
      reply = "Session complete. Type 'restart' to begin again.";
  }

  const twimlResponse = `
    <Response>
      <Message>${reply}</Message>
    </Response>
  `;

  res.setHeader("Content-Type", "text/xml");
  res.status(200).send(twimlResponse);
}