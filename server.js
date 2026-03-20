"use strict";

const express = require("express");
const path    = require("path");
const app     = express();
const PORT    = process.env.PORT || 3000;

// ── Keys (server-side only, never exposed to frontend) ────────────────────────
const GOOGLE_API_KEY    = "AIzaSyCG5X4B--Gekf8Mj7Ab8VURAqztzrxHxDY";
const GOOGLE_CX         = "03b7042653d714437";
const GOOGLE_SEARCH_URL = "https://www.googleapis.com/customsearch/v1";

// ── Google Custom Search ───────────────────────────────────────────────────────
async function searchWeb(query) {
  const url  = `${GOOGLE_SEARCH_URL}?key=${GOOGLE_API_KEY}&cx=${GOOGLE_CX}&q=${encodeURIComponent(query)}&num=5`;
  const res  = await fetch(url);
  const data = await res.json();

  if (!data.items || data.items.length === 0) {
    return "I couldn't find anything on that. Try rephrasing your question.";
  }

  const results = data.items.slice(0, 3).map(item => {
    const snippet = item.snippet.replace(/\n/g, " ").trim();
    return `**${item.title}**\n${snippet}\n[Read more](${item.link})`;
  });

  return `Here's what I found:\n\n${results.join("\n\n")}`;
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
  res.json({ status: "ok", engine: "Venaura v1.0 — Google Search" });
});

// ── POST /api/chat — pure Google search, no brain ─────────────────────────────
app.post("/api/chat", async (req, res) => {
  const { messages } = req.body;

  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: "'messages' array is required." });
  }

  const last = messages[messages.length - 1];
  if (!last || last.role !== "user" || typeof last.text !== "string") {
    return res.status(400).json({ error: "Last message must be a user message with text." });
  }

  try {
    const reply = await searchWeb(last.text.trim());
    return res.json({ reply });
  } catch (err) {
    console.error("Search error:", err);
    return res.status(500).json({ error: "Search failed: " + err.message });
  }
});

// ── Catch-all → index.html ────────────────────────────────────────────────────
app.get("*", (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// ── Listen on 0.0.0.0 so Render detects the port ─────────────────────────────
app.listen(PORT, "0.0.0.0", () => {
  console.log(`✦ Venaura v1.0 — Google Search Engine`);
  console.log(`  Port: ${PORT}`);
});
