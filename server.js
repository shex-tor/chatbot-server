const express = require("express");
const path    = require("path");
const { respond } = require("./engine/nlp");

const app  = express();
const PORT = process.env.PORT || 3000;

// ── CORS ──────────────────────────────────────────────────────────────────────
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin",  "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

// ── Middleware ─────────────────────────────────────────────────────────────────
app.use(express.json({ limit: "2mb" }));
app.use(express.static(path.join(__dirname, "public")));

// ── Health check ───────────────────────────────────────────────────────────────
app.get("/health", (req, res) => {
  res.status(200).json({ status: "ok", engine: "Venaura NLP v1.0" });
});

// ── POST /api/chat ─────────────────────────────────────────────────────────────
app.post("/api/chat", (req, res) => {
  const { messages } = req.body;

  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: "Invalid request: 'messages' array required." });
  }

  const lastMsg = messages[messages.length - 1];
  if (!lastMsg || lastMsg.role !== "user" || !lastMsg.text) {
    return res.status(400).json({ error: "Last message must be from the user." });
  }

  try {
    const reply = respond(lastMsg.text, messages);
    return res.json({ reply });
  } catch (err) {
    console.error("[Venaura] Engine error:", err);
    return res.status(500).json({ error: "Engine error: " + err.message });
  }
});

// ── Catch-all: serve index.html ────────────────────────────────────────────────
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// ── Start — bind 0.0.0.0 so Render detects the port ──────────────────────────
app.listen(PORT, "0.0.0.0", () => {
  console.log(`\n✦ Venaura v1.0 — Custom NLP Engine`);
  console.log(`  No external APIs. No keys. Pure code.`);
  console.log(`  → http://localhost:${PORT}\n`);
});
