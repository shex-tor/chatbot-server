"use strict";

const express = require("express");
const path    = require("path");
const app     = express();
const PORT    = process.env.PORT || 3000;

// ── API Keys (server-side only, never exposed to frontend) ────────────────────
const SERPER_API_KEY = "5a43cb9dbe3553f4f3586bc34803728c979530de";
const SERPER_URL     = "https://google.serper.dev/search";

const HF_TOKEN       = "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";
const HF_MODEL       = "mistralai/Mistral-7B-Instruct-v0.3";
const HF_API_URL     = `https://api-inference.huggingface.co/models/${HF_MODEL}`;

// ── Venaura system personality ─────────────────────────────────────────────────
const SYSTEM_PROMPT = `You are Venaura, a smart, friendly, and helpful AI assistant (version 1.0). 
You respond naturally and conversationally. You are concise but thorough.
When given web search results, you summarise them clearly in your own words and add helpful context.
Never just copy-paste raw results. Always respond as a knowledgeable, friendly assistant.`;

// ── Call Hugging Face Inference API ───────────────────────────────────────────
async function callHuggingFace(prompt) {
  console.log("[HF] Calling model:", HF_MODEL);

  const res = await fetch(HF_API_URL, {
    method:  "POST",
    headers: {
      "Authorization": `Bearer ${HF_TOKEN}`,
      "Content-Type":  "application/json",
      "x-wait-for-model": "true"  // wait if model is loading instead of erroring
    },
    body: JSON.stringify({
      inputs: prompt,
      parameters: {
        max_new_tokens:  512,
        temperature:     0.7,
        top_p:           0.9,
        do_sample:       true,
        return_full_text: false  // only return generated text, not the input
      }
    })
  });

  const data = await res.json();
  console.log("[HF] Status:", res.status);

  if (!res.ok) {
    // Model may be loading — return a friendly message
    if (res.status === 503) {
      throw new Error("Model is warming up. Please try again in a few seconds.");
    }
    throw new Error(data.error || `HF API error: ${res.status}`);
  }

  // Extract generated text
  if (Array.isArray(data) && data[0]?.generated_text) {
    return data[0].generated_text.trim();
  }

  if (data.generated_text) {
    return data.generated_text.trim();
  }

  throw new Error("No text returned from model");
}

// ── Format prompt for Mistral instruct format ─────────────────────────────────
function buildChatPrompt(userMessage) {
  return `<s>[INST] ${SYSTEM_PROMPT}\n\nUser: ${userMessage} [/INST]`;
}

// ── Format prompt when web search results are available ───────────────────────
function buildSearchPrompt(userMessage, searchContext) {
  return `<s>[INST] ${SYSTEM_PROMPT}\n\nThe user asked: "${userMessage}"\n\nHere are web search results to help answer:\n${searchContext}\n\nBased on these results, give a helpful, natural response. [/INST]`;
}

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

// ── Detect if message needs web search ───────────────────────────────────────
function needsWebSearch(text) {
  const norm = text.toLowerCase();
  const searchTriggers = [
    /^what is\b/, /^what are\b/, /^who is\b/, /^who was\b/,
    /^when is\b/, /^when did\b/, /^where is\b/, /^how does\b/,
    /^how do\b/,  /^why is\b/,   /^why does\b/, /^explain\b/,
    /^define\b/,  /^tell me about\b/, /^search\b/, /^find\b/,
    /\bnews\b/,   /\blatest\b/,  /\bcurrent\b/, /\bprice\b/,
    /\bweather\b/,/\bwho won\b/, /\bwhat happened\b/, /\brecent\b/
  ];
  return searchTriggers.some(p => p.test(norm));
}

// ── Fetch raw search results from Serper ─────────────────────────────────────
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

  const context = [];

  if (data.answerBox) {
    const ab = data.answerBox;
    if (ab.answer)  context.push(`Direct answer: ${ab.answer}`);
    if (ab.snippet) context.push(`Detail: ${ab.snippet}`);
  }

  if (data.knowledgeGraph) {
    const kg = data.knowledgeGraph;
    if (kg.title)       context.push(`Topic: ${kg.title}${kg.type ? ` (${kg.type})` : ""}`);
    if (kg.description) context.push(`Description: ${kg.description}`);
    if (kg.attributes) {
      Object.entries(kg.attributes).slice(0, 4).forEach(([k, v]) => {
        context.push(`${k}: ${v}`);
      });
    }
  }

  if (data.news && data.news.length > 0) {
    data.news.slice(0, 3).forEach(n => {
      context.push(`News: "${n.title}"${n.date ? ` (${n.date})` : ""} — ${n.snippet || ""}`);
    });
  }

  if (data.organic && data.organic.length > 0) {
    data.organic.slice(0, 3).forEach(r => {
      context.push(`Result: "${r.title}" — ${r.snippet?.replace(/\n/g, " ") || ""}`);
    });
  }

  return context.join("\n");
}

// ── Main response pipeline ────────────────────────────────────────────────────
async function getResponse(userMessage, useSearch) {
  let prompt;

  if (useSearch) {
    // Fetch web results then compose AI response with them
    try {
      const searchContext = await fetchSearchResults(userMessage);
      prompt = buildSearchPrompt(userMessage, searchContext);
    } catch (err) {
      console.error("[Search failed, falling back to plain AI]", err.message);
      prompt = buildChatPrompt(userMessage);
    }
  } else {
    prompt = buildChatPrompt(userMessage);
  }

  return await callHuggingFace(prompt);
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
  res.json({ status: "ok", engine: `Venaura v1.0 — HF ${HF_MODEL} + Serper` });
});

// ── POST /api/chat ─────────────────────────────────────────────────────────────
app.post("/api/chat", async (req, res) => {
  const { messages, mode, prompt, files } = req.body;

  try {
    // ── Vision mode — file upload ────────────────────────────────────────────
    if (mode === "vision") {
      if (!files || files.length === 0) {
        return res.status(400).json({ error: "No files provided." });
      }
      const fileList = files.map(f =>
        f.mediaType?.startsWith("image/")
          ? `an image (${f.name || "image"})`
          : `a document (${f.name || "file"})`
      ).join(" and ");

      // Ask HF to analyse the file description + user prompt
      const visionPrompt = buildChatPrompt(
        prompt
          ? `The user uploaded ${fileList} and asks: "${prompt}". Respond helpfully.`
          : `The user uploaded ${fileList}. Acknowledge it and ask what they'd like to know about it.`
      );

      const reply = await callHuggingFace(visionPrompt);
      return res.json({ reply });
    }

    // ── Chat / Search mode ───────────────────────────────────────────────────
    if (!Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: "'messages' array is required." });
    }

    const last = messages[messages.length - 1];
    if (!last || last.role !== "user" || typeof last.text !== "string") {
      return res.status(400).json({ error: "Last message must be a user message with text." });
    }

    const userMessage = last.text.trim();
    console.log(`[Chat] User: "${userMessage}"`);

    // Decide whether to search the web first
    const useSearch = needsWebSearch(userMessage);
    console.log(`[Chat] Mode: ${useSearch ? "Search + AI" : "AI only"}`);

    const reply = await getResponse(userMessage, useSearch);
    console.log(`[Chat] Reply: "${reply.slice(0, 80)}..."`);

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
  console.log("✦ Venaura v1.0 — Hugging Face AI + Serper Search");
  console.log(`  Model: ${HF_MODEL}`);
  console.log(`  Port:  ${PORT}`);
});
