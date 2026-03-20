"use strict";

const express = require("express");
const path    = require("path");
const app     = express();
const PORT    = process.env.PORT || 3000;

// ── Keys (server-side only) ───────────────────────────────────────────────────
const GOOGLE_API_KEY    = "AIzaSyBXxA5Hfzg133nyttEqQNCnZsBgGktMA8I";
const GOOGLE_CX         = "a1a963603bf46435a";
const GOOGLE_SEARCH_URL = "https://www.googleapis.com/customsearch/v1";

// ── Google Custom Search ───────────────────────────────────────────────────────
async function searchWeb(query) {
  const params = new URLSearchParams({
    key: GOOGLE_API_KEY,
    cx:  GOOGLE_CX,
    q:   query,
    num: "5"
  });

  const url = `${GOOGLE_SEARCH_URL}?${params.toString()}`;

  console.log("[Search] Query:", query);

  const res  = await fetch(url);
  const data = await res.json();

  console.log("[Google] HTTP status:", res.status);
  console.log("[Google] Full response:", JSON.stringify(data));

  if (data.error) {
    console.error("[Google Error]", data.error.message);
    return `Search error: ${data.error.message}`;
  }

  if (!data.items || data.items.length === 0) {
    return `I couldn't find any results for **"${query}"**. Try rephrasing.`;
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

// ── POST /api/chat ─────────────────────────────────────────────────────────────
app.post("/api/chat", async (req, res) => {
  const { messages } = req.body;

  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: "'messages' array is required." });
  }

  const last = messages[messages.length - 1];
  if (!last || last.role !== "user" || typeof last.text !== "string") {
    return res.status(400).json({ error: "Last message must be a user message with text." });
  }

  console.log(`[Chat] User asked: "${last.text}"`);

  try {
    const reply = await searchWeb(last.text.trim());
    return res.json({ reply });
  } catch (err) {
    console.error("[Search failed]", err.message);
    return res.status(500).json({ error: "Search failed: " + err.message });
  }
});

// ── Catch-all → index.html ────────────────────────────────────────────────────
app.get("*", (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// ── Listen on 0.0.0.0 so Render detects the port ─────────────────────────────
app.listen(PORT, "0.0.0.0", () => {
  console.log(`✦ Venaura v1.0 — Google Search`);
  console.log(`  Port: ${PORT}`);
});
