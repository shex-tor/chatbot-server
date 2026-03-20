"use strict";

const express = require("express");
const path    = require("path");
const app     = express();
const PORT    = process.env.PORT || 3000;

// ── Keys (server-side only, never exposed to frontend) ────────────────────────
const SERPER_API_KEY = "5a43cb9dbe3553f4f3586bc34803728c979530de";
const SERPER_URL     = "https://google.serper.dev/search";

const GEMINI_API_KEY = "AIzaSyAo2NEvJsnUcmKI1t0b3A-9FgW605gN2sU";
const GEMINI_URL     = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`;

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

// ── Google Search via Serper ───────────────────────────────────────────────────
async function searchWeb(query) {
  const searchQuery = toSearchQuery(query);
  console.log("[Serper] Query:", searchQuery);

  const res  = await fetch(SERPER_URL, {
    method:  "POST",
    headers: { "X-API-KEY": SERPER_API_KEY, "Content-Type": "application/json" },
    body:    JSON.stringify({ q: searchQuery, num: 5 })
  });

  const data = await res.json();
  if (!res.ok) return `Search error: ${data.message || "Unknown error"}`;

  const parts = [];

  if (data.answerBox) {
    const ab = data.answerBox;
    if (ab.answer)  parts.push(`**${ab.answer}**`);
    if (ab.snippet) parts.push(ab.snippet);
    if (ab.snippetHighlighted?.length) parts.push(ab.snippetHighlighted.join(" • "));
  }

  if (data.knowledgeGraph) {
    const kg = data.knowledgeGraph;
    let t = `**${kg.title}**`;
    if (kg.type)        t += ` *(${kg.type})*`;
    if (kg.description) t += `\n${kg.description}`;
    if (kg.attributes)  t += "\n" + Object.entries(kg.attributes).slice(0,4).map(([k,v])=>`• **${k}:** ${v}`).join("\n");
    parts.push(t);
  }

  if (data.news && data.news.length > 0) {
    parts.push(data.news.slice(0,3).map(n =>
      `**${n.title}**${n.date?` *(${n.date})*`:""}\n${n.snippet||""}\n[Read more](${n.link})`
    ).join("\n\n"));
  }

  if (data.organic && data.organic.length > 0 && parts.length < 2) {
    parts.push(data.organic.slice(0,3).map(r =>
      `**${r.title}**\n${r.snippet?.replace(/\n/g," ").trim()||""}\n[Read more](${r.link})`
    ).join("\n\n"));
  }

  return parts.length > 0
    ? parts.join("\n\n")
    : `I couldn't find results for **"${searchQuery}"**. Try rephrasing.`;
}

// ── Gemini Vision — analyse images and documents ──────────────────────────────
async function analyseWithVision(prompt, files) {
  console.log("[Vision] Analysing", files.length, "file(s). Prompt:", prompt);

  const parts = [];

  // Add each file as inline_data
  files.forEach(f => {
    parts.push({
      inline_data: {
        mime_type: f.mediaType,
        data:      f.base64
      }
    });
  });

  // Add text prompt
  parts.push({ text: prompt || "Describe what you see in this file in detail." });

  const res  = await fetch(GEMINI_URL, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ role: "user", parts }],
      generationConfig: { temperature: 0.7, maxOutputTokens: 2048 }
    })
  });

  const data = await res.json();
  console.log("[Vision] Status:", res.status);

  if (data.error) {
    console.error("[Vision Error]", data.error.message);
    throw new Error(data.error.message);
  }

  return data?.candidates?.[0]?.content?.parts?.[0]?.text || "No response from vision model.";
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
app.use(express.json({ limit: "20mb" })); // large limit for base64 file uploads
app.use(express.static(path.join(__dirname, "public")));

// ── Health check ───────────────────────────────────────────────────────────────
app.get("/health", (_req, res) => {
  res.json({ status: "ok", engine: "Venaura v1.0 — Serper + Gemini Vision" });
});

// ── POST /api/chat ─────────────────────────────────────────────────────────────
app.post("/api/chat", async (req, res) => {
  const { messages, mode, prompt, files } = req.body;

  try {
    // ── Vision mode — file analysis ──────────────────────────────────────────
    if (mode === "vision") {
      if (!files || files.length === 0) {
        return res.status(400).json({ error: "No files provided for vision analysis." });
      }
      const reply = await analyseWithVision(prompt || "", files);
      return res.json({ reply });
    }

    // ── Search mode — web search ─────────────────────────────────────────────
    if (!Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: "'messages' array is required." });
    }

    const last = messages[messages.length - 1];
    if (!last || last.role !== "user" || typeof last.text !== "string") {
      return res.status(400).json({ error: "Last message must be a user message with text." });
    }

    console.log(`[Chat] User asked: "${last.text}"`);
    const reply = await searchWeb(last.text.trim());
    return res.json({ reply });

  } catch (err) {
    console.error("[Error]", err.message);
    return res.status(500).json({ error: err.message });
  }
});

// ── Catch-all → index.html ────────────────────────────────────────────────────
app.get("*", (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// ── Listen on 0.0.0.0 so Render detects the port ─────────────────────────────
app.listen(PORT, "0.0.0.0", () => {
  console.log("✦ Venaura v1.0 — Serper Search + Gemini Vision");
  console.log(`  Port: ${PORT}`);
});
