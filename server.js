"use strict";

const express = require("express");
const path    = require("path");
const app     = express();
const PORT    = process.env.PORT || 3000;

// ── Serper API key (server-side only) ─────────────────────────────────────────
const SERPER_API_KEY = "5a43cb9dbe3553f4f3586bc34803728c979530de";
const SERPER_URL     = "https://google.serper.dev/search";

// ── Clean natural language into a search query ────────────────────────────────
function toSearchQuery(text) {
  return text
    .trim()
    .replace(/^(hey|hi|hello)\s*/i, "")
    .replace(/^(can you|could you|please|would you)\s*/i, "")
    .replace(/^(tell me|show me|give me|find me|search for|look up|what is|what are|who is|who are|how do|how does|i want to know about|get me|fetch|find|search)\s*/i, "")
    .replace(/\?+$/, "")
    .trim() || text.trim();
}

// ── Format raw Serper results into a clean natural response ───────────────────
function formatResults(query, data) {
  const parts = [];

  // 1. Direct answer box
  if (data.answerBox) {
    const ab     = data.answerBox;
    const answer = ab.answer || ab.snippet || "";
    if (answer) {
      parts.push(`Here's what I found about **${query}**:\n\n${answer}`);
      if (ab.snippetHighlighted?.length) {
        parts.push(ab.snippetHighlighted.join(" • "));
      }
    }
  }

  // 2. Knowledge graph
  if (data.knowledgeGraph) {
    const kg = data.knowledgeGraph;
    let summary = "";
    if (kg.title)       summary += `**${kg.title}**`;
    if (kg.type)        summary += ` *(${kg.type})*`;
    if (kg.description) summary += `\n\n${kg.description}`;
    if (kg.attributes && Object.keys(kg.attributes).length > 0) {
      const attrs = Object.entries(kg.attributes)
        .slice(0, 5)
        .map(([k, v]) => `- **${k}:** ${v}`)
        .join("\n");
      summary += `\n\n${attrs}`;
    }
    if (summary) parts.push(summary);
  }

  // 3. News results
  if (data.news && data.news.length > 0) {
    const intro = parts.length === 0
      ? `Here are the latest results for **${query}**:\n\n`
      : "\n\n**Latest news:**\n\n";
    const news = data.news.slice(0, 3).map(n => {
      const date    = n.date ? ` *(${n.date})*` : "";
      const snippet = n.snippet ? `\n${n.snippet}` : "";
      return `**${n.title}**${date}${snippet}\n[Read more](${n.link})`;
    });
    parts.push(intro + news.join("\n\n"));
  }

  // 4. Organic results — only if nothing better found
  if (parts.length === 0 && data.organic && data.organic.length > 0) {
    const intro   = `Here's what I found for **${query}**:\n\n`;
    const results = data.organic.slice(0, 3).map(r => {
      const snippet = r.snippet?.replace(/\n/g, " ").trim() || "";
      return `**${r.title}**\n${snippet}\n[Read more](${r.link})`;
    });
    parts.push(intro + results.join("\n\n"));
  }

  // 5. Related searches hint
  if (data.relatedSearches && data.relatedSearches.length > 0 && parts.length > 0) {
    const related = data.relatedSearches.slice(0, 3).map(r => `*${r.query}*`).join(", ");
    parts.push(`\n**Related:** ${related}`);
  }

  if (parts.length === 0) {
    return `I searched for **"${query}"** but couldn't find relevant results. Try rephrasing your question.`;
  }

  return parts.join("\n\n");
}

// ── Search the web via Serper ──────────────────────────────────────────────────
async function searchWeb(query) {
  const searchQuery = toSearchQuery(query);
  console.log("[Serper] Query:", searchQuery);

  const res  = await fetch(SERPER_URL, {
    method:  "POST",
    headers: { "X-API-KEY": SERPER_API_KEY, "Content-Type": "application/json" },
    body:    JSON.stringify({ q: searchQuery, num: 5 })
  });

  const data = await res.json();
  console.log("[Serper] Status:", res.status);

  if (!res.ok) {
    console.error("[Serper Error]", JSON.stringify(data));
    return `Search error: ${data.message || "Unknown error"}`;
  }

  return formatResults(searchQuery, data);
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
app.use(express.json({ limit: "20mb" }));
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
  console.log("✦ Venaura v1.0 — Serper Search Only");
  console.log(`  Port: ${PORT}`);
});
