"use strict";

const knowledge = require("./knowledge.json");

// ── Normalise text ─────────────────────────────────────────────────────────────
function normalise(text) {
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// ── Tokenise ───────────────────────────────────────────────────────────────────
function tokenise(text) {
  return normalise(text).split(" ").filter(w => w.length > 0);
}

// ── Stopwords ──────────────────────────────────────────────────────────────────
const STOPWORDS = new Set([
  "a","an","the","is","are","was","were","be","been","being","have","has","had",
  "do","does","did","will","would","could","should","may","might","shall","can",
  "to","of","in","for","on","with","at","by","from","as","or","and","but","if",
  "me","my","i","you","we","it","its","this","that","these","those","so","just",
  "very","really","quite","pretty","bit","little","lot","get","got","let","make"
]);

function meaningful(tokens) {
  return tokens.filter(t => !STOPWORDS.has(t) && t.length > 1);
}

// ── Pre-process intents (AFTER normalise is defined) ──────────────────────────
const intents = knowledge.intents.map(intent => ({
  ...intent,
  normPatterns: intent.patterns.map(p => normalise(p))
}));

// ── Tags that are purely conversational ───────────────────────────────────────
const CONVERSATIONAL_TAGS = new Set([
  "greeting", "farewell", "howareyou", "userfeeling_good", "userfeeling_bad",
  "whoami", "capabilities", "thanks", "age", "creator", "compliment", "insult",
  "joke", "yes", "no", "agree", "disagree", "apology", "repeat",
  "bored", "thinking", "motivation", "happiness", "love", "friendship"
]);

// ── Patterns that always trigger Google search ────────────────────────────────
// If message starts with or contains these → always search web
const SEARCH_TRIGGERS = [
  /^what is\b/,  /^what are\b/, /^what was\b/, /^what were\b/,
  /^who is\b/,   /^who was\b/,  /^who are\b(?! you)/,  /^who were\b/,
  /^where is\b/, /^where are\b/,/^where was\b/,
  /^when is\b/,  /^when was\b/, /^when did\b/,
  /^why is\b/,   /^why are\b/,  /^why did\b/,  /^why does\b/,
  /^how does\b/, /^how do\b/,   /^how did\b/,  /^how much\b/, /^how many\b/,
  /^explain\b/,  /^define\b/,   /^describe\b/,
  /^tell me about\b/, /^give me info\b/, /^search\b/,
  /\bweather\b/, /\bnews\b/,    /\bprice\b/,   /\bcost\b/,
  /\bcapital\b/, /\bpopulation\b/, /\bhistory of\b/, /\blatest\b/,
  /\bcurrent\b/, /\btoday\b/,
  /\bwhat time\b/,   /\bright now\b/
];

function forcesSearch(text) {
  const norm = normalise(text);
  return SEARCH_TRIGGERS.some(pattern => pattern.test(norm));
}

// ── Pick a random response ─────────────────────────────────────────────────────
function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

// ── Score query against one intent ────────────────────────────────────────────
function scoreIntent(queryTokens, queryNorm, intent) {
  let best = 0;

  for (const pattern of intent.normPatterns) {
    if (queryNorm === pattern)       return 100;
    if (queryNorm.includes(pattern)) { best = Math.max(best, 90); continue; }
    if (pattern.includes(queryNorm)) { best = Math.max(best, 75); continue; }

    const patternTokens   = meaningful(pattern.split(" "));
    const queryMeaningful = meaningful(queryTokens);
    if (patternTokens.length === 0 || queryMeaningful.length === 0) continue;

    let hits = 0;
    for (const t of patternTokens) {
      if (queryMeaningful.includes(t)) hits++;
    }

    const precision = hits / patternTokens.length;
    const recall    = hits / queryMeaningful.length;
    const f1 = (precision + recall) > 0
      ? (2 * precision * recall) / (precision + recall)
      : 0;

    best = Math.max(best, Math.round(f1 * 65));
  }

  return best;
}

// ── Session context ────────────────────────────────────────────────────────────
const sessions = new Map();

function getCtx(sid) {
  return sessions.get(sid) || { lastTag: null, lastResponse: null };
}

function setCtx(sid, ctx) {
  sessions.set(sid, ctx);
  if (sessions.size > 1000) sessions.delete(sessions.keys().next().value);
}

// ── Fallback responses ─────────────────────────────────────────────────────────
const FALLBACKS = [
  "That's interesting! Tell me more about that.",
  "I'm not quite sure I follow — could you tell me more?",
  "Hmm, I'd love to understand better. Can you expand on that?",
  "That's got me thinking! What do you mean exactly?",
  "I'm still learning! Could you rephrase that for me?",
  "Interesting! I'd love to hear more about what you mean.",
  "I want to make sure I understand you properly — could you say more?"
];

// ── isConversational: true = use brain, false = use Google ────────────────────
function isConversational(userMessage) {
  // If it matches a search trigger pattern → always Google
  if (forcesSearch(userMessage)) return false;

  const norm   = normalise(userMessage);
  const tokens = tokenise(norm);

  const scored = intents
    .map(intent => ({ intent, score: scoreIntent(tokens, norm, intent) }))
    .filter(x => x.score >= 40)
    .sort((a, b) => b.score - a.score);

  // Only conversational if top match is a known conversational tag
  return scored.length > 0 && CONVERSATIONAL_TAGS.has(scored[0].intent.tag);
}

// ── Main respond function ──────────────────────────────────────────────────────
function respond(userMessage, sessionId) {
  const sid    = sessionId || "default";
  const ctx    = getCtx(sid);
  const norm   = normalise(userMessage);
  const tokens = tokenise(norm);

  const scored = intents
    .map(intent => ({ intent, score: scoreIntent(tokens, norm, intent) }))
    .filter(x => x.score >= 30)
    .sort((a, b) => b.score - a.score);

  let response;
  let tag = null;

  if (scored.length > 0) {
    const best       = scored[0];
    tag              = best.intent.tag;
    const candidates = best.intent.responses.filter(r => r !== ctx.lastResponse);
    const pool       = candidates.length > 0 ? candidates : best.intent.responses;
    response         = pick(pool);
  } else {
    const candidates = FALLBACKS.filter(r => r !== ctx.lastResponse);
    response         = pick(candidates.length > 0 ? candidates : FALLBACKS);
  }

  setCtx(sid, { lastTag: tag, lastResponse: response });
  return response;
}

module.exports = { respond, isConversational };
