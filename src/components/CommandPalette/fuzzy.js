// Small fuzzy matcher for the command palette. No dependency; built for ~60 commands.
//
// Every whitespace-separated token in the query must match the command, either in its title or in
// one of its keywords. Title matches, best first:
//   1. substring that starts a word         "photo"  -> "Living Photos"
//   2. substring inside a word (3+ chars)   "sense"  -> "ScreenSense"
//   3. word-start subsequence               "tpdf"   -> "TalkativePDF", "ss" -> "ScreenSense"
//      (every matched letter starts a word or directly follows the previous match, so "patent"
//       does not match "aPArTmENT")
// Keyword matches score lower than title matches. Returns null when any token misses.

const isAlnum = (c) => /[a-z0-9]/i.test(c);

const isWordStart = (text, i) => {
  if (i === 0) return true;
  const prev = text[i - 1];
  const cur = text[i];
  if (!isAlnum(prev)) return isAlnum(cur);
  // camelCase and acronym edges: "talkativePDF", "ScreenSense"
  return prev === prev.toLowerCase() && cur !== cur.toLowerCase();
};

function wordStartSubstring(token, title, lower) {
  let at = lower.indexOf(token);
  while (at !== -1) {
    if (isWordStart(title, at)) return at;
    at = lower.indexOf(token, at + 1);
  }
  return -1;
}

// Best word-start subsequence alignment (small DFS with memo; titles are short).
function subsequence(token, title, lower) {
  const memo = new Map();
  const best = (ti, prev) => {
    if (ti === token.length) return { score: 0, path: [] };
    const key = ti * 1000 + prev + 1;
    if (memo.has(key)) return memo.get(key);
    const ch = token[ti];
    let result = null;
    for (let j = prev + 1; j < lower.length; j += 1) {
      if (lower[j] !== ch) continue;
      const consecutive = prev >= 0 && j === prev + 1;
      const start = isWordStart(title, j);
      if (!consecutive && !start) continue;
      const rest = best(ti + 1, j);
      if (!rest) continue;
      const score = 6 + (consecutive ? 8 : 0) + (start ? 10 : 0) + rest.score;
      if (!result || score > result.score) result = { score, path: [j, ...rest.path] };
    }
    memo.set(key, result);
    return result;
  };
  return best(0, -1);
}

function matchTitle(token, title, lower) {
  const range = (from) => Array.from({ length: token.length }, (_, k) => from + k);

  const start = wordStartSubstring(token, title, lower);
  if (start !== -1) {
    return { score: 100 + token.length * 4 + (start === 0 ? 40 : 0) - Math.min(start, 40) * 0.3, indices: range(start) };
  }
  if (token.length >= 3) {
    const at = lower.indexOf(token);
    if (at !== -1) return { score: 60 + token.length * 4 - Math.min(at, 40) * 0.3, indices: range(at) };
  }
  if (token.length >= 2) {
    const sub = subsequence(token, title, lower);
    if (sub) return { score: sub.score, indices: sub.path };
  }
  return null;
}

const initials = (phrase) =>
  phrase
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .map((w) => w[0])
    .join('');

function matchKeyword(token, keywords) {
  let best = 0;
  for (const k of keywords) {
    let s = 0;
    if (k === token) s = 50;
    else if (k.startsWith(token)) s = 38;
    else if (new RegExp(`(^|[^a-z0-9])${token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`).test(k)) s = 30;
    else if (token.length >= 2 && initials(k).startsWith(token) && k.includes(' ')) s = 30; // "yc" -> "y combinator"
    else if (token.length >= 3 && k.includes(token)) s = 15;
    if (s > best) best = s;
  }
  return best;
}

// Short forms people type that never appear in the text itself.
const ALIASES = { yc: ['y combinator'], ycombinator: ['y combinator'], cv: ['resume'] };

function matchToken(token, title, lower, keywords) {
  let best = null;
  for (const t of [token, ...(ALIASES[token] || [])]) {
    const inTitle = matchTitle(t, title, lower);
    const inKeywords = matchKeyword(t, keywords);
    const m = inTitle && inTitle.score >= inKeywords ? inTitle : inKeywords ? { score: inKeywords, indices: [] } : null;
    if (m && (!best || m.score > best.score)) best = m;
  }
  return best;
}

export function scoreCommand(query, command) {
  const phrase = query.toLowerCase().trim().replace(/\s+/g, ' ');
  const tokens = phrase.split(' ').filter(Boolean);
  if (tokens.length === 0) return { score: 0, indices: [] };

  const title = command.title;
  const lower = title.toLowerCase();
  const keywords = (command.keywords || []).map((k) => String(k).toLowerCase());
  const indices = new Set();
  let total = 0;

  for (const token of tokens) {
    const m = matchToken(token, title, lower, keywords);
    if (!m) return null;
    total += m.score;
    m.indices.forEach((i) => indices.add(i));
  }
  // A multi-word query that appears as written ("voice agent") beats the same words scattered.
  if (tokens.length > 1 && (lower.includes(phrase) || keywords.some((k) => k.includes(phrase)))) total += 40;
  return { score: total, indices: [...indices].sort((a, b) => a - b) };
}

// Ranked results, stable for ties (the command list order is the tie-breaker).
export function filterCommands(query, commands) {
  const out = [];
  commands.forEach((command, order) => {
    const m = scoreCommand(query, command);
    if (m) out.push({ command, order, score: m.score, indices: m.indices });
  });
  out.sort((a, b) => b.score - a.score || a.order - b.order);
  return out;
}
