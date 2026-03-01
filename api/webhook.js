export default async function handler(req, res) {
  res.setHeader("Content-Type", "text/xml");
  res.status(200).send(`
    <Response>
      <Message>Server is alive</Message>
    </Response>
  `);
}