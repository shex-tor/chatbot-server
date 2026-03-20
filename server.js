"use strict";

const express = require("express");
const path    = require("path");
const app     = express();
const PORT    = process.env.PORT || 3000;

// ── Serper API key (server-side only, never exposed to frontend) ───────────────
const SERPER_API_KEY = "5a43cb9dbe3553f4f3586bc34803728c979530de";
const SERPER_URL     = "https://google.serper.dev/search";

// ── Search the web via Serper ──────────────────────────────────────────────────
async function searchWeb(query) {
  const res = await fetch(SERPER_URL, {
    method:  "POST",
    headers: {
      "X-API-KEY":    SERPER_API_KEY,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ q: query, num: 5 })
  });

  const data = await res.json();

  console.log("[Serper] Query:", query);
  console.log("[Serper] HTTP status:", res.status);

  if (!res.ok) {
    console.error("[Serper Error]", JSON.stringify(data));
    return `Search error: ${data.message || "Unknown error from Serper"}`;
  }

  const parts = [];

  // 1. Answer box — direct answer at the top (best result)
  if (data.answerBox) {
    const ab = data.answerBox;
    if (ab.answer)   parts.push(`**${ab.answer}**`);
    if (ab.snippet)  parts.push(ab.snippet);
    if (ab.snippetHighlighted?.length) {
      parts.push(ab.snippetHighlighted.join(" • "));
    }
  }

  // 2. Knowledge graph — rich info panel
  if (data.knowledgeGraph) {
    const kg = data.knowledgeGraph;
    let kg_text = `**${kg.title}**`;
    if (kg.type)        kg_text += ` *(${kg.type})*`;
    if (kg.description) kg_text += `\n${kg.description}`;
    if (kg.attributes) {
      const attrs = Object.entries(kg.attributes)
        .slice(0, 4)
        .map(([k, v]) => `• **${k}:** ${v}`)
        .join("\n");
      kg_text += `\n${attrs}`;
    }
    parts.push(kg_text);
  }

  // 3. Organic results — regular search results
  if (data.organic && data.organic.length > 0) {
    const results = data.organic.slice(0, 3).map(r => {
      const snippet = r.snippet?.replace(/\n/g, " ").trim() || "";
      return `**${r.title}**\n${snippet}\n[Read more](${r.link})`;
    });
    parts.push(results.join("\n\n"));
  }

  if (parts.length === 0) {
    return `I couldn't find any results for **"${query}"**. Try rephrasing your question.`;
  }

  return parts.join("\n\n");
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
  res.json({ status: "ok", engine: "Venaura v1.0 — Serper Search" });
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
  console.log("✦ Venaura v1.0 — Serper Search Engine");
  console.log("  No Google API config needed. Just works.");
  console.log(`  Port: ${PORT}`);
});
