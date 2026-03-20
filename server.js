"use strict";

const express     = require("express");
const path        = require("path");
const { respond } = require("./brain");

const app  = express();
const PORT = process.env.PORT || 3000;

// ── Hardcoded keys (server-side only, never exposed to frontend) ───────────────
const GOOGLE_API_KEY   = "AIzaSyCG5X4B--Gekf8Mj7Ab8VURAqztzrxHxDY";
const GOOGLE_CX        = "03b7042653d714437";
const GOOGLE_SEARCH_URL = "https://www.googleapis.com/customsearch/v1";

// ── Fallback phrases brain.js returns when it has no match ────────────────────
const FALLBACK_PHRASES = [
  "that's interesting! tell me more about that.",
  "i'm not quite sure i follow — could you tell me more?",
  "hmm, i'd love to understand better. can you expand on that?",
  "that's got me thinking! what do you mean exactly?",
  "i'm still learning! could you rephrase that for me?",
  "interesting! i'd love to hear more about what you mean.",
  "i want to make sure i understand you properly — could you say more?"
];

function isFallback(reply) {
  const norm = reply.toLowerCase().trim();
  return FALLBACK_PHRASES.some(f => norm.includes(f.slice(0, 30)));
}

// ── Google Custom Search ───────────────────────────────────────────────────────
async function searchWeb(query) {
  const url = `${GOOGLE_SEARCH_URL}?key=${GOOGLE_API_KEY}&cx=${GOOGLE_CX}&q=${encodeURIComponent(query)}&num=3`;

  const res  = await fetch(url);
  const data = await res.json();

  if (!data.items || data.items.length === 0) return null;

  // Build a clean answer from the top snippets
  const results = data.items.slice(0, 3).map((item, i) => {
    return `**${item.title}**\n${item.snippet}`;
  });

  return results.join("\n\n");
}

// ── CORS ───────────────────────────────────────────────────────────────────────
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
app.get("/health", (_req, res) => {
  res.json({ status: "ok", engine: "Venaura Brain v1.0 + Google Search" });
});

// ── POST /api/chat ─────────────────────────────────────────────────────────────
app.post("/api/chat", async (req, res) => {
  const { messages, sessionId } = req.body;

  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: "'messages' array is required." });
  }

  const last = messages[messages.length - 1];
  if (!last || last.role !== "user" || typeof last.text !== "string") {
    return res.status(400).json({ error: "Last message must be a user message with text." });
  }

  try {
    // 1. Try the local brain first
    let reply = respond(last.text, sessionId || "anon");

    // 2. If brain returned a fallback, search the web instead
    if (isFallback(reply)) {
      console.log(`[Search] Brain fallback — searching web for: "${last.text}"`);

      const searchResult = await searchWeb(last.text).catch(() => null);

      if (searchResult) {
        reply = `Here's what I found on the web:\n\n${searchResult}`;
      }
      // If search also fails, keep the brain's fallback reply
    }

    return res.json({ reply });

  } catch (err) {
    console.error("Server error:", err);
    return res.status(500).json({ error: "Engine error: " + err.message });
  }
});

// ── Catch-all → index.html ─────────────────────────────────────────────────────
app.get("*", (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// ── Listen on 0.0.0.0 so Render detects the port ──────────────────────────────
app.listen(PORT, "0.0.0.0", () => {
  console.log("✦ Venaura v1.0 — Brain + Google Search");
  console.log("  Port: " + PORT);
});
