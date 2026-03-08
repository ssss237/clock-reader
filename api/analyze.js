// api/analyze.js — Vercel Serverless Function
// APIキーをサーバー側に隠してフロントエンドに露出させない

export default async function handler(req, res) {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { base64, mediaType, hint } = req.body;
  if (!base64 || !mediaType) return res.status(400).json({ error: "base64 and mediaType are required" });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: "API key not configured" });

  const system =
    "You are a precise optical measurement instrument. " +
    "Your only job is to report the pixel coordinates of clock hand tips. " +
    "You do NOT interpret or guess the time — you only measure positions.";

  const prompt = [
    "Carefully examine this analog clock/watch image.",
    "",
    "Your task: report the (x, y) pixel coordinates of each hand tip.",
    "Express coordinates as percentages of image dimensions (0-100).",
    "  x=0 is left edge, x=100 is right edge",
    "  y=0 is top edge, y=100 is bottom edge",
    "",
    "Instructions:",
    "1. Find the clock CENTER (the pivot point where all hands meet). Report as center_x, center_y.",
    "2. Find the tip of the LONGEST hand (minute hand). It sweeps the full dial.",
    "3. Find the tip of the SHORTER/THICKER hand (hour hand). It is always shorter than the minute hand.",
    "4. Find the tip of the THINNEST hand (second hand) if it exists. It is often a different color.",
    "",
    "CRITICAL: Do NOT output 10:10 by default. Look carefully at where each hand tip actually points.",
    hint ? ("User note: " + hint) : "",
    "",
    "Output ONLY this JSON, nothing else:",
    '{"center_x":<0-100>,"center_y":<0-100>,"minute_tip_x":<0-100>,"minute_tip_y":<0-100>,"hour_tip_x":<0-100>,"hour_tip_y":<0-100>,"has_second":<true|false>,"second_tip_x":<0-100>,"second_tip_y":<0-100>,"notes":"<one sentence>"}',
  ].filter(Boolean).join("\n");

  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 400,
        system,
        messages: [{
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: mediaType, data: base64 } },
            { type: "text", text: prompt },
          ],
        }],
      }),
    });

    const data = await response.json();
    if (data.error) return res.status(500).json({ error: data.error.message });

    const txt = data.content.map(b => b.text || "").join("");
    const m = txt.match(/\{[\s\S]*\}/);
    if (!m) return res.status(500).json({ error: "No JSON in response: " + txt.slice(0, 100) });

    return res.status(200).json({ result: JSON.parse(m[0]) });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
