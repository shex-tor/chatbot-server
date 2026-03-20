"use strict";

const knowledge = require("./knowledge.json");

// ── Normalise input ────────────────────────────────────────────────────────────
function normalise(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s\+\-\*\/\^\.\(\)%√]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// ── Tokenise into words ────────────────────────────────────────────────────────
function tokenise(text) {
  return normalise(text).split(" ").filter(w => w.length > 1);
}

// ── Stopwords (ignored when scoring) ─────────────────────────────────────────
const STOPWORDS = new Set([
  "a","an","the","is","are","was","were","be","been","being","have","has","had",
  "do","does","did","will","would","could","should","may","might","shall","can",
  "to","of","in","for","on","with","at","by","from","as","or","and","but","if",
  "me","my","i","you","we","it","its","this","that","these","those",
  "what","how","why","when","where","who","which","please","tell","explain",
  "about","give","show","help","yes","no","ok","okay","sure","get","make",
  "let","just","so","then","than","also","some","any","all","more","very"
]);

// ── Build flat list of all KB entries ─────────────────────────────────────────
const KB = [];
for (const [category, entries] of Object.entries(knowledge)) {
  if (category === "unknown") continue;
  if (!Array.isArray(entries)) continue;
  for (const entry of entries) {
    if (!entry.triggers || !entry.response) continue;
    KB.push({
      category,
      entry,
      triggerTokens: entry.triggers.map(t => tokenise(t))
    });
  }
}

// ── Score a query against one KB entry ────────────────────────────────────────
function scoreEntry(queryTokens, item) {
  const queryPhrase = queryTokens.join(" ");
  let best = 0;

  for (const tToks of item.triggerTokens) {
    const tPhrase = tToks.join(" ");

    if (queryPhrase === tPhrase)       { best = Math.max(best, 100); continue; }
    if (queryPhrase.includes(tPhrase)) { best = Math.max(best, 85);  continue; }
    if (tPhrase.includes(queryPhrase)) { best = Math.max(best, 70);  continue; }

    // Token overlap (ignoring stopwords)
    const meaningful = tToks.filter(t => !STOPWORDS.has(t));
    if (meaningful.length === 0) continue;

    let hits = 0;
    for (const t of meaningful) {
      if (queryTokens.includes(t)) hits++;
    }

    const qMeaningful = queryTokens.filter(t => !STOPWORDS.has(t));
    const precision = hits / meaningful.length;
    const recall    = qMeaningful.length > 0 ? hits / qMeaningful.length : 0;
    const f1 = (precision + recall) > 0
      ? (2 * precision * recall) / (precision + recall)
      : 0;

    best = Math.max(best, Math.round(f1 * 60));
  }

  return best;
}

// ── Math evaluator ────────────────────────────────────────────────────────────
function tryMath(raw) {
  let expr = raw
    .replace(/what\s+is\s+/i, "")
    .replace(/calculate\s+/i, "")
    .replace(/compute\s+/i, "")
    .replace(/solve\s+/i, "")
    .replace(/\?/g, "")
    .trim();

  expr = expr
    .replace(/\bsquared\b/g, "**2")
    .replace(/\bcubed\b/g, "**3")
    .replace(/\btimes\b/g, "*")
    .replace(/\bdivided\s+by\b/g, "/")
    .replace(/\bmultiplied\s+by\b/g, "*")
    .replace(/\bplus\b/g, "+")
    .replace(/\bminus\b/g, "-")
    .replace(/\bto\s+the\s+power\s+of\b/g, "**")
    .replace(/\bsquare\s+root\s+of\s+(\d+)/g, "Math.sqrt($1)")
    .replace(/√(\d+)/g, "Math.sqrt($1)")
    .replace(/\^/g, "**");

  if (!/^[\d\s\+\-\*\/\.\(\)e]+$/.test(expr.replace(/Math\.sqrt/g, ""))) return null;

  try {
    // eslint-disable-next-line no-new-func
    const result = Function('"use strict"; return (' + expr + ')')();
    if (typeof result !== "number" || !isFinite(result)) return null;
    const formatted = Number.isInteger(result)
      ? result.toString()
      : parseFloat(result.toFixed(10)).toString();
    return "**Result:** " + formatted;
  } catch (_) {
    return null;
  }
}

function isMathQuery(norm) {
  return (
    /\d+\s*[\+\-\*\/\^]\s*\d+/.test(norm) ||
    /\bsquare\s+root\b/.test(norm) ||
    /\bsquared\b/.test(norm) ||
    /\bcubed\b/.test(norm) ||
    /\btimes\b.*\d/.test(norm) ||
    /\bdivided\s+by\b/.test(norm) ||
    /\b\d+\s+plus\s+\d+\b/.test(norm) ||
    /\b\d+\s+minus\s+\d+\b/.test(norm) ||
    /√\d+/.test(norm) ||
    /\d+\s*\^\s*\d+/.test(norm)
  );
}

// ── Session context ───────────────────────────────────────────────────────────
const sessions = new Map();

function getCtx(sid) {
  return sessions.get(sid) || { lastTopic: null, turns: 0 };
}

function setCtx(sid, ctx) {
  sessions.set(sid, ctx);
  if (sessions.size > 500) sessions.delete(sessions.keys().next().value);
}

// ── Unknown responses (cycle through them) ───────────────────────────────────
let unknownIdx = 0;
function unknownResponse() {
  const r = knowledge.unknown.responses;
  return r[unknownIdx++ % r.length];
}

// ── Main respond function ─────────────────────────────────────────────────────
function respond(userMessage, sessionId) {
  const sid  = sessionId || "default";
  const ctx  = getCtx(sid);
  const norm = normalise(userMessage);
  const toks = tokenise(norm);

  // 1. Math
  if (isMathQuery(norm)) {
    const result = tryMath(norm);
    if (result) {
      setCtx(sid, { ...ctx, turns: ctx.turns + 1 });
      return result;
    }
  }

  // 2. Score KB entries
  const scored = KB
    .map(item => ({ item, score: scoreEntry(toks, item) }))
    .filter(x => x.score >= 25)
    .sort((a, b) => b.score - a.score);

  if (scored.length > 0) {
    const best = scored[0];
    setCtx(sid, { lastTopic: best.item.entry.triggers[0], turns: ctx.turns + 1 });
    return best.item.entry.response;
  }

  // 3. Partial fallback — suggest closest topic
  const meaningful = toks.filter(t => !STOPWORDS.has(t));
  for (const item of KB) {
    for (const tToks of item.triggerTokens) {
      if (tToks.some(t => meaningful.includes(t))) {
        return "I found something related to **\"" + item.entry.triggers[0] + "\"**. Did you mean to ask about that?\n\nTry: *\"What is " + item.entry.triggers[0] + "?\"*";
      }
    }
  }

  // 4. Unknown
  setCtx(sid, { ...ctx, turns: ctx.turns + 1 });
  return unknownResponse();
}

module.exports = { respond };
