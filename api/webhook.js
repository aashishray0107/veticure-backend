export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).send("Method Not Allowed");
  }

  const incomingMsg = req.body.Body;
  const from = req.body.From;

  console.log("Message from:", from);
  console.log("Message:", incomingMsg);

  const twimlResponse = `
    <Response>
      <Message>
        Welcome to VETiCure 🐶
        Please enter your name to begin.
      </Message>
    </Response>
  `;

  res.setHeader("Content-Type", "text/xml");
  res.status(200).send(twimlResponse);
}