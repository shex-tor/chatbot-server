"use strict";

const express = require("express");
const path    = require("path");
const app     = express();
const PORT    = process.env.PORT || 3000;

// ── Keys (server-side only) ───────────────────────────────────────────────────
const SERPER_API_KEY = "5a43cb9dbe3553f4f3586bc34803728c979530de";
const SERPER_URL     = "https://google.serper.dev/search";

const GEMINI_API_KEY = "AIzaSyA2rzFD6K_fKG7CJTcOBBI8z8Y5aZDU-XU";
const GEMINI_URL     = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`;

// ── Venaura system personality ────────────────────────────────────────────────
const SYSTEM_PROMPT = `You are Venaura, a smart and friendly AI assistant (v1.0). 
When given web search results, you must:
1. Read and understand the results carefully
2. Write a natural, conversational response in your own words
3. Summarise and explain the key information clearly
4. Add helpful context or your own perspective where relevant
5. Keep responses concise but informative
6. Use markdown formatting (bold, lists) where it helps clarity
7. At the end, mention 1-2 sources if relevant

Never just copy-paste the raw results. Always respond as a knowledgeable, friendly assistant who has read the results and is explaining them to the user.`;

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

// ── Step 1: Fetch raw search results from Serper ─────────────────────────────
async function fetchSearchResults(query) {
  const searchQuery = toSearchQuery(query);
  console.log("[Serper] Query:", searchQuery);

  const res  = await fetch(SERPER_URL, {
    method:  "POST",
    headers: { "X-API-KEY": SERPER_API_KEY, "Content-Type": "application/json" },
    body:    JSON.stringify({ q: searchQuery, num: 5 })
  });

  const data = await res.json();
  if (!res.ok) throw new Error(`Serper error: ${data.message || res.status}`);

  // Extract all useful text from results
  const context = [];

  if (data.answerBox) {
    const ab = data.answerBox;
    if (ab.answer)  context.push(`Direct answer: ${ab.answer}`);
    if (ab.snippet) context.push(`Answer detail: ${ab.snippet}`);
  }

  if (data.knowledgeGraph) {
    const kg = data.knowledgeGraph;
    if (kg.title)       context.push(`Topic: ${kg.title}${kg.type ? ` (${kg.type})` : ""}`);
    if (kg.description) context.push(`Description: ${kg.description}`);
    if (kg.attributes) {
      Object.entries(kg.attributes).slice(0, 5).forEach(([k, v]) => {
        context.push(`${k}: ${v}`);
      });
    }
  }

  if (data.news && data.news.length > 0) {
    data.news.slice(0, 4).forEach(n => {
      context.push(`News: "${n.title}"${n.date ? ` (${n.date})` : ""} — ${n.snippet || ""} [${n.link}]`);
    });
  }

  if (data.organic && data.organic.length > 0) {
    data.organic.slice(0, 4).forEach(r => {
      context.push(`Result: "${r.title}" — ${r.snippet?.replace(/\n/g, " ") || ""} [${r.link}]`);
    });
  }

  return { searchQuery, context };
}

// ── Step 2: Send results to Gemini to compose a natural response ──────────────
async function composeResponse(userQuery, context) {
  const contextText = context.length > 0
    ? context.join("\n")
    : "No relevant search results were found.";

  const prompt = `The user asked: "${userQuery}"

Here are the web search results I found:
${contextText}

Based on these results, write a helpful, natural response to the user's question. Respond as Venaura — a friendly, knowledgeable AI assistant.`;

  const res = await fetch(GEMINI_URL, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      system_instruction: { parts: [{ text: SYSTEM_PROMPT }] },
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.7, maxOutputTokens: 1024 }
    })
  });

  const data = await res.json();
  console.log("[Gemini] Status:", res.status);

  if (data.error) throw new Error(data.error.message);
  return data?.candidates?.[0]?.content?.parts?.[0]?.text || "I found some results but couldn't compose a response.";
}

// ── Step 3: Full search + compose pipeline ────────────────────────────────────
async function searchAndRespond(query) {
  const { searchQuery, context } = await fetchSearchResults(query);
  const reply = await composeResponse(query, context);
  return reply;
}

// ── Gemini Vision — analyse images and documents ──────────────────────────────
async function analyseWithVision(prompt, files) {
  console.log("[Vision] Analysing", files.length, "file(s).");

  const parts = [];
  files.forEach(f => {
    parts.push({ inline_data: { mime_type: f.mediaType, data: f.base64 } });
  });
  parts.push({ text: prompt || "Describe what you see in this file in detail." });

  const res  = await fetch(GEMINI_URL, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      system_instruction: { parts: [{ text: SYSTEM_PROMPT }] },
      contents: [{ role: "user", parts }],
      generationConfig: { temperature: 0.7, maxOutputTokens: 2048 }
    })
  });

  const data = await res.json();
  if (data.error) throw new Error(data.error.message);
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
app.use(express.json({ limit: "20mb" }));
app.use(express.static(path.join(__dirname, "public")));

// ── Health check ───────────────────────────────────────────────────────────────
app.get("/health", (_req, res) => {
  res.json({ status: "ok", engine: "Venaura v1.0 — Serper + Gemini" });
});

// ── POST /api/chat ─────────────────────────────────────────────────────────────
app.post("/api/chat", async (req, res) => {
  const { messages, mode, prompt, files } = req.body;

  try {
    // ── Vision mode ──────────────────────────────────────────────────────────
    if (mode === "vision") {
      if (!files || files.length === 0) {
        return res.status(400).json({ error: "No files provided." });
      }
      const reply = await analyseWithVision(prompt || "", files);
      return res.json({ reply });
    }

    // ── Search + Gemini compose mode ─────────────────────────────────────────
    if (!Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: "'messages' array is required." });
    }

    const last = messages[messages.length - 1];
    if (!last || last.role !== "user" || typeof last.text !== "string") {
      return res.status(400).json({ error: "Last message must be a user message with text." });
    }

    console.log(`[Chat] User asked: "${last.text}"`);
    const reply = await searchAndRespond(last.text.trim());
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
  console.log("✦ Venaura v1.0 — Serper + Gemini AI Responses");
  console.log(`  Port: ${PORT}`);
});
