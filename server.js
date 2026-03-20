const express = require("express");
const path    = require("path");

const app  = express();
const PORT = process.env.PORT || 3000;

// ── SECURE: API key lives ONLY on the server ──────────────────────────────────
const GEMINI_API_KEY = "AIzaSyC_TB5ZV5-2Fp3h1D8fBjnm6tNT9hgxTwg";
const GEMINI_MODEL   = "gemini-2.0-flash";
const GEMINI_URL     = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`;

// ── CORS — allow any origin ────────────────────────────────────────────────────
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin",  "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

// ── Middleware ─────────────────────────────────────────────────────────────────
app.use(express.json({ limit: "4mb" }));
app.use(express.static(path.join(__dirname, "public")));

// ── Health check (Render pings this to confirm the server is up) ───────────────
app.get("/health", (req, res) => res.status(200).send("OK"));

// ── POST /api/chat ─────────────────────────────────────────────────────────────
app.post("/api/chat", async (req, res) => {
  const { messages } = req.body;

  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: "Invalid request: 'messages' array required." });
  }

  const contents = messages.map((m) => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: [{ text: String(m.text) }],
  }));

  const body = {
    contents,
    systemInstruction: {
      parts: [{
        text:
          "You are Venaura, a powerful, precise, and elegant AI assistant (version 1.0). " +
          "You are helpful, clear, and thoughtful. You were built to help users think, create, " +
          "learn, and explore. Always respond in a friendly, professional tone. " +
          "Format your responses with Markdown where appropriate (code blocks, bold, lists, etc).",
      }],
    },
    generationConfig: {
      temperature:     0.85,
      topK:            40,
      topP:            0.95,
      maxOutputTokens: 4096,
    },
    safetySettings: [
      { category: "HARM_CATEGORY_HARASSMENT",        threshold: "BLOCK_MEDIUM_AND_ABOVE" },
      { category: "HARM_CATEGORY_HATE_SPEECH",        threshold: "BLOCK_MEDIUM_AND_ABOVE" },
      { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT",  threshold: "BLOCK_MEDIUM_AND_ABOVE" },
      { category: "HARM_CATEGORY_DANGEROUS_CONTENT",  threshold: "BLOCK_MEDIUM_AND_ABOVE" },
    ],
  };

  try {
    const geminiRes = await fetch(GEMINI_URL, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify(body),
    });

    if (!geminiRes.ok) {
      const errData = await geminiRes.json().catch(() => ({}));
      console.error("Gemini API error:", errData);
      return res.status(geminiRes.status).json({
        error: errData?.error?.message || `Gemini API error: ${geminiRes.status}`,
      });
    }

    const data  = await geminiRes.json();
    const reply = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? "";

    if (!reply) {
      return res.status(500).json({ error: "Empty response from Gemini." });
    }

    return res.json({ reply });

  } catch (err) {
    console.error("Server error:", err);
    return res.status(500).json({ error: "Internal server error: " + err.message });
  }
});

// ── Catch-all: serve index.html ────────────────────────────────────────────────
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// ── Start — MUST bind to 0.0.0.0 for Render to detect the port ────────────────
app.listen(PORT, "0.0.0.0", () => {
  console.log(`✦ Venaura v1.0 running on port ${PORT}`);
});
