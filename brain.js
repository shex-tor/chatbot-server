"use strict";

const knowledge = require("./knowledge.json");

// ── Text normalisation ─────────────────────────────────────────────────────────
function normalise(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s\.\+\-\*\/\^\%\(\)√]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// ── Tokenise into words ────────────────────────────────────────────────────────
function tokenise(text) {
  return normalise(text).split(" ").filter(Boolean);
}

// ── Stopwords to ignore when scoring ─────────────────────────────────────────
const STOPWORDS = new Set([
  "a","an","the","is","are","was","were","be","been","being",
  "have","has","had","do","does","did","will","would","could",
  "should","may","might","shall","can","to","of","in","for",
  "on","with","at","by","from","as","or","and","but","if",
  "me","my","i","you","we","it","its","this","that","these",
  "those","what","how","why","when","where","who","which",
  "please","tell","explain","about","give","show","help",
  "yes","no","ok","okay","sure","get","make","let","just",
  "so","then","than","also","some","any","all","more","very"
]);

// ── Flatten knowledge into searchable entries ─────────────────────────────────
let KB = [];
function buildIndex() {
  KB = [];
  for (const [category, entries] of Object.entries(knowledge)) {
    if (category === "unknown" || category === "math_compute") continue;
    const arr = Array.isArray(entries) ? entries : [];
    for (const entry of arr) {
      if (!entry.triggers || !entry.response) continue;
      // Pre-tokenise each trigger for fast matching
      const tokenisedTriggers = entry.triggers.map(t => tokenise(t));
      KB.push({ category, entry, tokenisedTriggers });
    }
  }
}
buildIndex();

// ── Score how well a query matches an entry ───────────────────────────────────
function scoreEntry(queryTokens, item) {
  const { entry, tokenisedTriggers } = item;
  let best = 0;

  for (const trigTokens of tokenisedTriggers) {
    // Exact phrase match — highest score
    const trigPhrase  = trigTokens.join(" ");
    const queryPhrase = queryTokens.join(" ");
    if (queryPhrase === trigPhrase)       { best = Math.max(best, 100); continue; }
    if (queryPhrase.includes(trigPhrase)) { best = Math.max(best, 85);  continue; }
    if (trigPhrase.includes(queryPhrase)) { best = Math.max(best, 70);  continue; }

    // Token overlap score
    const meaningful = trigTokens.filter(t => !STOPWORDS.has(t));
    if (meaningful.length === 0) continue;

    let hits = 0;
    for (const t of meaningful) {
      if (queryTokens.includes(t)) hits++;
    }

    const precision = hits / meaningful.length;
    const recall    = hits / Math.max(queryTokens.filter(t => !STOPWORDS.has(t)).length, 1);
    const f1        = precision + recall > 0
      ? (2 * precision * recall) / (precision + recall)
      : 0;

    best = Math.max(best, Math.round(f1 * 65));
  }

  return best;
}

// ── Math evaluator ────────────────────────────────────────────────────────────
function tryMath(raw) {
  // Strip leading question words
  let expr = raw
    .replace(/what\s+is\s+/i, "")
    .replace(/calculate\s+/i, "")
    .replace(/compute\s+/i, "")
    .replace(/solve\s+/i, "")
    .replace(/equals?\s+/i, "")
    .replace(/\?/g, "")
    .trim();

  // Word operators
  expr = expr
    .replace(/\bsquared\b/g, "**2")
    .replace(/\bcubed\b/g, "**3")
    .replace(/\btimes\b/g, "*")
    .replace(/\bdivided\s+by\b/g, "/")
    .replace(/\bmultiplied\s+by\b/g, "*")
    .replace(/\bplus\b/g, "+")
    .replace(/\bminus\b/g, "-")
    .replace(/\bto\s+the\s+power\s+of\b/g, "**")
    .replace(/\bsquare\s+root\s+of\b/g, "Math.sqrt")
    .replace(/√(\d+)/g, "Math.sqrt($1)")
    .replace(/\^/g, "**");

  // Only allow safe characters
  if (!/^[\d\s\+\-\*\/\.\(\)Math\.sqrtpow%]+$/.test(expr)) return null;

  try {
    // eslint-disable-next-line no-new-func
    const result = Function(`"use strict"; return (${expr})`)();
    if (typeof result !== "number" || !isFinite(result)) return null;

    // Format nicely
    const formatted = Number.isInteger(result)
      ? result.toString()
      : parseFloat(result.toFixed(10)).toString();

    return `**${raw.trim()}**\n\n= **${formatted}**`;
  } catch {
    return null;
  }
}

// ── Check if query is a math expression ──────────────────────────────────────
function isMathQuery(q) {
  const norm = normalise(q);
  const mathPatterns = [
    /\d+\s*[\+\-\*\/\^]\s*\d+/,
    /\bsquare\s+root\b/,
    /\bsquared\b/,
    /\bcubed\b/,
    /\btimes\b.*\d/,
    /\bdivided\s+by\b/,
    /\bmultiplied\s+by\b/,
    /\b\d+\s+plus\s+\d+\b/,
    /\b\d+\s+minus\s+\d+\b/,
    /√\d+/,
    /\d+\s*\^\s*\d+/
  ];
  return mathPatterns.some(p => p.test(norm));
}

// ── Context tracker — remember last topic per session ────────────────────────
const sessionContext = new Map();

function getContext(sessionId) {
  return sessionContext.get(sessionId) || { lastCategory: null, lastEntry: null, turnCount: 0 };
}

function setContext(sessionId, ctx) {
  sessionContext.set(sessionId, ctx);
  // Clean up old sessions (keep last 500)
  if (sessionContext.size > 500) {
    const firstKey = sessionContext.keys().next().value;
    sessionContext.delete(firstKey);
  }
}

// ── Follow-up detection ───────────────────────────────────────────────────────
const FOLLOWUP_WORDS = ["more", "elaborate", "continue", "go on", "tell me more",
  "expand", "detail", "example", "examples", "show me", "can you explain more",
  "what else", "anything else", "more detail", "further"];

function isFollowUp(tokens) {
  const phrase = tokens.join(" ");
  return FOLLOWUP_WORDS.some(f => phrase.includes(f)) && tokens.length <= 6;
}

// ── Response variation — pick different responses when same intent is hit ─────
const usageCount = new Map();

function pickResponse(responses) {
  if (!Array.isArray(responses)) return responses;
  if (responses.length === 1)   return responses[0];
  // Round-robin through responses
  const key = responses[0].slice(0, 30);
  const count = (usageCount.get(key) || 0);
  usageCount.set(key, count + 1);
  return responses[count % responses.length];
}

// ── Main respond function ─────────────────────────────────────────────────────
function respond(userMessage, sessionId = "default", history = []) {
  const raw    = userMessage.trim();
  const norm   = normalise(raw);
  const tokens = tokenise(norm).filter(t => t.length > 1);
  const ctx    = getContext(sessionId);

  // ── 1. Math computation ───────────────────────────────────────────────────
  if (isMathQuery(norm)) {
    const mathResult = tryMath(norm);
    if (mathResult) {
      setContext(sessionId, { ...ctx, lastCategory: "math_compute", turnCount: ctx.turnCount + 1 });
      return mathResult;
    }
  }

  // ── 2. Follow-up to previous topic ───────────────────────────────────────
  if (isFollowUp(tokens) && ctx.lastEntry) {
    const followUps = [
      `Here's more on **${ctx.lastEntry}**:\n\nI've shared the key information above. To go deeper, I'd suggest:\n- Searching for dedicated tutorials or documentation\n- Trying it hands-on with small experiments\n- Breaking the topic into sub-questions and asking me each one\n\nWhat specific aspect would you like me to focus on?`,
      `Great — let's dig deeper into **${ctx.lastEntry}**. What specific part interests you most? For example, you could ask about a specific sub-concept, a practical example, or how it connects to something else.`
    ];
    return pickResponse(followUps);
  }

  // ── 3. Score all KB entries ───────────────────────────────────────────────
  const scored = KB.map(item => ({
    ...item,
    score: scoreEntry(tokens, item)
  })).filter(item => item.score > 0);

  scored.sort((a, b) => b.score - a.score);

  // Threshold: must be confident enough
  if (scored.length > 0 && scored[0].score >= 30) {
    const best = scored[0];
    let response = best.entry.response;

    // Update context
    const entryTitle = best.entry.triggers[0];
    setContext(sessionId, {
      lastCategory: best.category,
      lastEntry: entryTitle,
      turnCount: ctx.turnCount + 1
    });

    // Add contextual follow-up hint occasionally
    if (ctx.turnCount > 0 && ctx.turnCount % 3 === 0) {
      response += "\n\n*Have more questions? I'm here to help!*";
    }

    return response;
  }

  // ── 4. Partial keyword fallback ───────────────────────────────────────────
  const meaningful = tokens.filter(t => !STOPWORDS.has(t));
  if (meaningful.length > 0) {
    // Look for any single keyword match
    const partial = KB.filter(item =>
      item.tokenisedTriggers.some(trig =>
        trig.some(t => meaningful.includes(t))
      )
    );

    if (partial.length > 0) {
      // Pick the one whose trigger has the most overlap
      const best = partial[0];
      const topicName = best.entry.triggers[0];
      return `I found something related to **"${topicName}"**. Did you mean to ask about that? If so, try:\n\n*"What is ${topicName}?"*\n\nOr rephrase your question and I'll do my best to help!`;
    }
  }

  // ── 5. Unknown ────────────────────────────────────────────────────────────
  setContext(sessionId, { ...ctx, turnCount: ctx.turnCount + 1 });
  return pickResponse(knowledge.unknown.responses);
}

module.exports = { respond };
