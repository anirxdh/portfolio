// AniBot's offline brain. When the live AI endpoint fails, useAiChat loads this module plus
// /anibot-kb.json (written at build time by scripts/build-anibot-kb.mjs) and answers locally.
//
// How an answer is picked:
//   1. Small talk (hi, thanks, who are you) gets a fixed reply.
//   2. Common questions ("what does he do at Rivo", "which hackathons") are routed to the exact
//      KB entries the build script tagged for them.
//   3. Everything else goes through a small BM25 ranker with synonym expansion.
// The composer only ever repeats KB text plus fixed framing lines, so it cannot invent facts.
// No React and no browser APIs, so node can import it for tests (`build-anibot-kb.mjs --check`).

export const KB_URL = '/anibot-kb.json';
export const NOTES_FOOTNOTE = 'Quick answer from my notes. The live AI is taking a break.';

// ---------- tokens ----------
const STOP = new Set(
  (
    'a an and are as at be been being but by can could did do does doing done for from get got had has have he her ' +
    'him his how i if in into is it its just me my of on or our she so some than that the their them then there ' +
    'these they this those to too us was we were what whats when where which who whom whose why will with would you ' +
    'your yours about any anything something tell know give show please also more much very really ani anirudh ' +
    'vasudevan hes isnt dont didnt doesnt im ive id ill youre thats theres heres lets want wanna like say said'
  ).split(' '),
);

// Forms a suffix stripper gets wrong, mapped to the form the rest of the index uses.
const IRREGULAR = {
  built: 'build', building: 'build', builds: 'build', rebuilt: 'build',
  won: 'win', wins: 'win', winning: 'win', winner: 'win', winners: 'win',
  wrote: 'write', written: 'write', writing: 'write', writes: 'write', writeup: 'write', writeups: 'write',
  ran: 'run', running: 'run', runs: 'run',
  grew: 'grow', grown: 'grow', growing: 'grow',
  made: 'make', making: 'make', makes: 'make',
  studied: 'study', studies: 'study', studying: 'study', student: 'study',
  based: 'base', located: 'locate', location: 'locate',
  lives: 'live', living: 'live', lived: 'live',
  caching: 'cache', cached: 'cache',
  hiring: 'hire', hired: 'hire',
  emails: 'email', emailing: 'email',
  agentic: 'agentic', elevenhacks: 'elevenhacks', elevenlabs: 'elevenlabs',
  analytics: 'analytics', ios: 'ios', news: 'news', mars: 'mars',
};

function stem(w) {
  if (IRREGULAR[w]) return IRREGULAR[w];
  if (w.length <= 4 || /\d/.test(w)) return w;
  if (/ie[sd]$/.test(w)) return `${w.slice(0, -3)}y`;
  if (/ing$/.test(w) && w.length > 6) return w.slice(0, -3);
  if (/ed$/.test(w) && w.length > 5) return w.slice(0, -2);
  if (/(ch|sh|x|ss|z)es$/.test(w)) return w.slice(0, -2);
  if (/s$/.test(w) && !/(ss|us|is)$/.test(w)) return w.slice(0, -1);
  return w;
}

export function tokenize(text) {
  const out = [];
  const s = String(text || '')
    .toLowerCase()
    .replace(/\]\([^)]*\)/g, ']') // keep a markdown link's words, drop its URL
    .replace(/[‘’]/g, "'")
    .replace(/'s\b/g, '')
    .replace(/'/g, '');
  for (const raw of s.split(/[^a-z0-9]+/)) {
    if (raw.length < 2 || STOP.has(raw)) continue;
    const t = stem(raw);
    if (t.length >= 2 && !STOP.has(t)) out.push(t);
  }
  return out;
}

const words = (s) => new Set(tokenize(s));

// Query-side synonyms: asking about a "job" should find Rivo; "school" should find the degrees.
const EXPAND = new Map(
  Object.entries({
    win: 'hackathon award place prize',
    hackathon: 'win award place elevenhacks',
    award: 'win hackathon',
    prize: 'win hackathon',
    job: 'rivo role staff',
    work: 'rivo role',
    company: 'rivo',
    employer: 'rivo',
    role: 'rivo staff engineer',
    study: 'education university degree',
    school: 'education university',
    college: 'university education',
    education: 'university degree diploma',
    degree: 'education university',
    contact: 'email form linkedin',
    email: 'contact',
    hire: 'contact email',
    reach: 'contact email',
    patent: 'civs voting contactless',
    voting: 'patent civs',
    paper: 'research emnlp publication',
    research: 'paper emnlp',
    publication: 'paper emnlp',
    voice: 'speech livekit elevenlabs conversational',
    speech: 'voice',
    call: 'voice phone twilio',
    phone: 'twilio call',
    agent: 'agentic mcp',
    agentic: 'agent',
    mcp: 'agent gateway',
    rag: 'retrieval pinecone langchain',
    retrieval: 'rag',
    game: 'horror three',
    '3d': 'three fiber splat',
    yc: 'combinator',
    combinator: 'yc',
    frontend: 'react',
    backend: 'python fastapi',
    mobile: 'ios native',
    github: 'code repo',
    resume: 'pdf',
    fast: 'speed latency load',
    speed: 'fast latency load',
    slow: 'speed latency load',
  }).map(([k, v]) => [stem(k), [...words(v)]]),
);

// Words that carry no topic on their own ("tell me about his AI stuff").
const FILLER = words(
  'ai thing things stuff kind type cool interesting favorite favourite best main big biggest recent latest list all ' +
  'lot lots detail details explain describe summary summarize overview quick brief short go mean anything else him',
);
// Generic verbs and nouns that should not decide whether an entry answers the question.
const LOOSE = new Set([...FILLER, ...words('build built make made ship shipped project projects work use used do')]);

// Phrases rewritten before tokenizing. A marker token ("zzcontact") names the intent; `keep`
// leaves the original words in the query as well.
const PHRASES = [
  [/\b(get|be|keep|got) in touch\b|\bwork(ing)? (with|together with|for) (him|anirudh)\b|\bwork together\b|\breach (him|out|anirudh)\b|\bopen to (new )?(work|roles?|jobs?|opportunit\w*|offers?)\b|\bhow (do|can|should) i (contact|reach|hire|email|message)\b/g, 'zzcontact', false],
  [/\btech ?stack\b|\bwhat (tech|technologies|languages|tools|frameworks|stack)\b/g, 'zzstack', true],
  [/\bbefore (rivo|that|his current (job|role))\b/g, 'zzprevious', false],
  [/\bwhere (does|did) (he|anirudh) (go to (school|college|university)|study|graduate)\b/g, 'zzeducation', true],
  [/\bwhere (does|do) (he|anirudh) work\b|\bwhat (does|do) (he|anirudh) do( for (work|a living))?\b|\b(works?|working) (at|for)\b|\bworking on\b|\bday job\b|\bcurrent(ly)? (role|job|work|position|company)\b|\bemployed\b/g, 'zzwork', true],
  [/\bwho (is|was) (he|anirudh)\b|\bwho'?s (he|anirudh)\b|\btell me about (him|anirudh)( vasudevan)?\s*[?.!]*$|\bintroduce (him|anirudh)\b|^about (him|anirudh)\b/g, 'zzwho', false],
  [/\bwhere (is|does) (he|anirudh) (live|based|located|from)\b|\bwhere'?s (he|anirudh)( from)?\b|\bwhere is (he|anirudh)( from)?\b|\bgr[eo]w up\b|\blive[sd]? in\b/g, 'zzlocation', true],
  [/\bdeep dives?\b|\bwrite-?ups?\b/g, 'zzwrite', true],
  [/\bvoice (ai|agents?|bots?|assistants?|work)\b/g, 'zzvoice', true],
];

// Intents in priority order. An intent fires when one of its trigger words is still unclaimed by
// a higher-priority intent; it then claims its triggers and `consumes` words.
const INTENTS = [
  ['contact', 'zzcontact contact contacting email mail hire hiring recruit recruiter recruiting reach linkedin available availability collaborate collaboration opportunity opportunities phone', 'touch connect message role job work number'],
  ['who', 'zzwho', ''],
  ['research', 'research paper papers publication publications publish published emnlp scholar academic journal conference', 'write written wrote patent patents'],
  ['patent', 'patent patents patented invention', 'grant granted hold file filed own'],
  ['writing', 'zzwrite write written wrote writing blog blogs article articles post posts essay', 'read topic topics cover covered dive dives deep'],
  ['hackathons', 'hackathon hackathons hack hacks win wins won winner award awards prize prizes podium compete competition competitions trophy', 'place placed result results event events many'],
  ['work', 'zzwork rivo job jobs employer company', 'work works build building built role position title current currently now today day fintech team staff member technical'],
  ['previous', 'zzprevious previous previously prior past earlier', 'role job work company engineer before'],
  ['experience', 'experience experiences career background history employment', 'work professional job jobs'],
  ['education', 'zzeducation study studied school schools education degree degrees university universities college master masters bachelor bachelors btech gpa graduate graduated alma diploma', 'major field go went'],
  ['voice', 'zzvoice voice voices speech livekit conversational', 'agent agents work build built project projects'],
  ['agents', 'agent agents agentic mcp autonomous', 'ai build built project projects work multi'],
  ['stack', 'zzstack stack skill skills technology technologies tech language languages framework frameworks tool tools programming', 'use uses know good'],
  ['location', 'zzlocation base located location city country hometown', 'live from now currently'],
  ['profiles', 'github resume cv social socials twitter youtube devpost orcid leetcode profile profiles', 'link links account accounts find online'],
  ['projects', 'project projects build built building made make ship shipped side app apps', 'work cool own'],
].map(([id, triggers, consumes]) => ({ id, triggers: words(triggers), consumes: words(consumes) }));
const BY_ID = Object.fromEntries(INTENTS.map((i) => [i.id, i]));
// Broad intents that only answer on their own; next to anything more specific they step aside.
const WEAK = new Set(['projects', 'who']);

const GREETING = /^(hi|hello|hey|hiya|yo|howdy|sup|good (morning|afternoon|evening))( there)?( anibot)?[\s!.,?]*$/i;
// "Write me a poem" is a task, not a question about Anirudh, unless it names him.
const TASK = /^(can you |could you |would you |please )?(write|draft|compose|generate|create|code|solve|translate|calculate|debug)\b/i;
const ABOUT_HIM = /\b(anirudh|he|his|him|he's)\b/i;
const FOLLOW_UP = /\b(it|its|that|this|those|they|them|there)\b|^(and|also|more|tell me more|go on|what else)\b/i;
const THANKS = /^(thanks|thank you|thx|ty|cheers|cool|great|awesome|nice|ok|okay|got it|perfect)( so much| a lot)?( anibot)?[\s!.,?]*$/i;
const ABOUT_BOT = /\b(who|what) are you\b|\bare you (a |an )?(bot|ai|human|real|robot|person)\b|\bwhat is anibot\b|\bwho (made|built) you\b/i;

// ---------- index ----------
const K1 = 1.2;
const B = 0.75;
const PRIOR = { block: 0.95, experience: 0.95 };
// An entry about the very thing the question names ("Nonlinear", "ScreenSense") gets a lift.
const TOPIC_BOOST = 1.45;
const MIN_SCORE = 1.6;
const MIN_COVERAGE = 0.5;

export function buildIndex(kb) {
  const raw = kb?.docs || [];
  const leadOf = new Map(raw.filter((d) => d.lead).map((d) => [d.id, d.lead]));
  const docs = raw.map((d) => {
    const tf = new Map();
    let len = 0;
    const add = (text, w) => {
      for (const t of tokenize(text)) {
        tf.set(t, (tf.get(t) || 0) + w);
        len += w;
      }
    };
    add(d.title, 2);
    add(d.project, 2);
    add(d.section && d.section !== d.title ? d.section : '', 1);
    add(d.lead, 1);
    add((d.items || []).join(' '), 1);
    add(d.text, 1);
    add(d.keys, 1);
    add(d.award, 1);
    add((d.tags || []).join(' '), 1);
    // A bullet inherits its lead-in ("Anirudh is ... at Rivo"), so "growth at Rivo" finds the Growth bullet.
    if (d.parent) add(leadOf.get(d.parent), 0.5);
    const topicTerms = d.topic ? tokenize(d.topic.replace(/-/g, ' ')) : [];
    return { ...d, tf, len: len || 1, topicTerms };
  });
  const df = new Map();
  for (const d of docs) for (const t of d.tf.keys()) df.set(t, (df.get(t) || 0) + 1);
  const articles = docs.filter((d) => d.kind === 'article').sort((a, b) => (a.date < b.date ? 1 : -1));
  const articleByTopic = new Map();
  for (const a of articles) {
    const cur = articleByTopic.get(a.topic);
    if (!cur || (!cur.award && a.award)) articleByTopic.set(a.topic, a);
  }
  return {
    kb,
    docs,
    df,
    N: docs.length,
    avgdl: docs.reduce((s, d) => s + d.len, 0) / (docs.length || 1),
    byId: new Map(docs.map((d) => [d.id, d])),
    articles,
    articleByTopic,
  };
}

const idf = (index, t) => {
  const n = index.df.get(t) || 0;
  return Math.log(1 + (index.N - n + 0.5) / (n + 0.5));
};

// BM25 over the KB. `terms` are the literal query tokens (weight 1); synonyms join at 0.4 and
// `extra` adds weighted context (the previous question). Coverage is the share of the literal,
// non-filler query (by idf) that a doc answers, directly or through a synonym, so one lucky word
// cannot carry an answer on its own.
function search(index, terms, { filter, seen, extra = [] } = {}) {
  const q = new Map();
  for (const t of terms) if (!t.startsWith('zz')) q.set(t, 1);
  for (const t of [...q.keys()]) for (const e of EXPAND.get(t) || []) if (!q.has(e)) q.set(e, 0.4);
  for (const [t, w] of extra) if (!q.has(t) && !t.startsWith('zz')) q.set(t, w);
  const literal = [...q.entries()].filter(([t, w]) => w === 1 && !LOOSE.has(t)).map(([t]) => t);
  const total = literal.reduce((s, t) => s + idf(index, t), 0);
  // Words the visitor actually used, here or in the question a follow-up refers to.
  const asked = new Set([...q.entries()].filter(([, w]) => w >= 0.6).map(([t]) => t));
  const ranked = [];
  for (const d of index.docs) {
    if (filter && !filter(d)) continue;
    let score = 0;
    for (const [t, w] of q) {
      const tf = d.tf.get(t);
      if (!tf) continue;
      score += (w * idf(index, t) * tf * (K1 + 1)) / (tf + K1 * (1 - B + (B * d.len) / index.avgdl));
    }
    if (score <= 0) continue;
    let covered = 0;
    for (const t of literal) {
      if (d.tf.has(t)) covered += idf(index, t);
      else if ((EXPAND.get(t) || []).some((e) => d.tf.has(e))) covered += 0.7 * idf(index, t);
    }
    const coverage = total ? covered / total : 0;
    score *= PRIOR[d.kind] || 1;
    if (d.topicTerms.length && d.topicTerms.every((t) => asked.has(t))) score *= TOPIC_BOOST;
    if (seen?.has(d.id)) score *= 0.55;
    // An entry that answers every part of the question beats one that repeats a single part.
    score *= 0.4 + 0.6 * coverage;
    ranked.push({ doc: d, score, coverage });
  }
  return ranked.sort((a, b) => b.score - a.score);
}

const strong = (r) => !!r && r.score >= MIN_SCORE && r.coverage >= MIN_COVERAGE;

// ---------- rendering ----------
const articleFor = (index, d) => (d.kind === 'article' ? d : d.topic ? index.articleByTopic.get(d.topic) : undefined);
// "RUA (native app)" reads as "RUA"; version tags like "ScreenSense (v3)" stay.
const shortProject = (a) => a.project.replace(/\s*\((?!v\d+\))[^)]*\)/gi, '').trim();
const bullet = (a) => `- [${a.title}](${a.url})${a.award ? ` · ${a.award}` : ''}`;
const byAwardThenDate = (a, b) => (b.award ? 1 : 0) - (a.award ? 1 : 0) || (a.date < b.date ? 1 : -1);

// Sentence split that ignores dots inside links, parentheses, and words like "Next.js".
function sentences(md) {
  const out = [];
  let start = 0;
  let depth = 0;
  for (let i = 0; i < md.length; i += 1) {
    const c = md[i];
    if (c === '[' || c === '(') depth += 1;
    else if ((c === ']' || c === ')') && depth > 0) depth -= 1;
    else if (depth === 0 && (c === '.' || c === '!' || c === '?')) {
      let j = i + 1;
      while (j < md.length && /[*_"'”)]/.test(md[j])) j += 1;
      let k = j;
      while (k < md.length && /\s/.test(md[k])) k += 1;
      if (k >= md.length || (k > j && /[A-Z0-9*[_"“(]/.test(md[k]))) {
        out.push(md.slice(start, j).trim());
        start = k;
        i = k - 1;
      }
    }
  }
  if (start < md.length && md.slice(start).trim()) out.push(md.slice(start).trim());
  // A bold lead like "**Speed.**" is not a sentence on its own.
  for (let i = out.length - 2; i >= 0; i -= 1) {
    if (/^\*\*[^*]+\*\*$/.test(out[i])) out.splice(i, 2, `${out[i]} ${out[i + 1]}`);
  }
  return out;
}

// Shorten to `max` characters on sentence boundaries. With `terms`, keep the sentences that mention
// the most of them (in their original order) instead of just the first few.
function clip(md, max, terms) {
  if (!md || md.length <= max) return md || '';
  const parts = sentences(md);
  if (!parts.length) return md;
  let keep = [0];
  if (terms?.size) {
    const scored = parts
      .map((s, i) => ({ i, hits: tokenize(s).filter((t) => terms.has(t)).length }))
      .filter((x) => x.hits > 0)
      .sort((a, b) => b.hits - a.hits || a.i - b.i);
    if (scored.length) {
      keep = [];
      let len = 0;
      for (const { i } of scored) {
        if (len + parts[i].length + 1 > max && keep.length) continue;
        keep.push(i);
        len += parts[i].length + 1;
      }
      keep.sort((a, b) => a - b);
    }
  }
  if (keep.length === 1 && keep[0] === 0) {
    let len = parts[0].length;
    for (let i = 1; i < parts.length && len + parts[i].length + 1 <= max; i += 1) {
      keep.push(i);
      len += parts[i].length + 1;
    }
  }
  // A snippet that starts mid-story needs its context back: "He implemented ..." gets the name,
  // and "There he built ..." gets the sentence that says where "there" is.
  if (keep[0] > 0 && /^(There|Then|It|Its|This|That|These|Those|They|Their)\b/.test(parts[keep[0]])) keep.unshift(0);
  const out = keep.map((i) => parts[i]).join(' ');
  return keep[0] > 0 ? out.replace(/^(\*\*[^*]+\*\* )?(He|His)\b/, (m, bold = '', w) => `${bold}${w === 'He' ? 'Anirudh' : "Anirudh's"}`) : out;
}

const firstSentence = (md) => sentences(md)[0] || md;

function render(doc, budget, terms) {
  if (doc.kind === 'block') {
    // A list with no lead-in sentence gets its section name, so "- **MS in Computer Science** ..."
    // does not arrive without context.
    const lead = doc.lead ? clip(doc.lead, budget, terms) : doc.items?.length ? `**${doc.title}**` : '';
    const items = doc.items || [];
    const lines = [];
    let used = lead.length;
    for (const item of items) {
      const line = `- ${firstSentence(item)}`;
      // Short lists are the answer itself, so they are never cut.
      if (items.length > 6 && used + line.length > budget && lines.length >= 3) break;
      lines.push(line);
      used += line.length;
    }
    return [lead, lines.join('\n')].filter(Boolean).join('\n\n');
  }
  if (doc.kind === 'article') {
    const text = clip(doc.text, budget, terms);
    return doc.award ? `**${shortProject(doc)}** · ${doc.award}\n\n${text}` : text;
  }
  return clip(doc.text, budget, terms);
}

const docText = (d) => [d.title, d.lead, ...(d.items || []), d.text].filter(Boolean).join(' ');

function related(a, b) {
  if (a.id === b.id || a.parent === b.id || b.parent === a.id) return true;
  if (a.topic && a.topic === b.topic) return true;
  const x = words(docText(a));
  const y = words(docText(b));
  let shared = 0;
  for (const t of x) if (y.has(t)) shared += 1;
  return shared / (x.size + y.size - shared || 1) > 0.45;
}

// Routes that close with a short list of related write-ups, picked by article tag.
const ROUTE_ARTICLES = {
  voice: { tag: /voice/i, label: 'Voice projects he has written about:' },
  agents: { tag: /agent|mcp/i, label: 'Agent projects he has written about:' },
};
// How a route's second entry is trimmed. "Where is he based" keeps only the Bay Area line.
const ROUTE_SECOND = {
  default: { budget: 360 },
  location: { budget: 120, terms: words('based live lives grew india bay area san francisco') },
};

function pickLinks(index, used, ranked, body) {
  const links = [];
  const add = (label, url) => {
    if (!url || links.length >= 3) return;
    if (body.includes(`](${url})`) || links.some((l) => l.url === url || l.label === label)) return;
    links.push({ label, url });
  };
  for (const d of used) {
    const art = articleFor(index, d);
    if (art) add(`${shortProject(art)} write-up`, art.url);
  }
  for (const d of used) {
    if (d.url?.startsWith('/about/')) add('About page', d.url);
    else if (d.url === '/#work') add('Work experience', d.url);
    if (d.kind === 'project' && d.href && !index.articleByTopic.get(d.topic)) {
      add(/github\.com/.test(d.href) ? 'Code on GitHub' : 'Live demo', d.href);
    }
    if (d.kind === 'article' && d.live) add('Live demo', d.live);
  }
  const top = ranked[0]?.score || 0;
  for (const r of ranked.slice(0, 6)) {
    if (r.score < top * 0.5) break;
    const art = articleFor(index, r.doc);
    if (art) add(`${shortProject(art)} write-up`, art.url);
  }
  if (!links.length && !/\]\(/.test(body)) add('About page', '/about/');
  return links;
}

function finish(body, links, used, kind = 'answer', route) {
  const more = links.length ? `\n\n**Read more:** ${links.map((l) => `[${l.label}](${l.url})`).join(' · ')}` : '';
  return { text: `${body}${more}`, note: NOTES_FOOTNOTE, ids: used.map((d) => d.id), kind, ...(route ? { route } : {}) };
}

const joinAnd = (xs) => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);

// ---------- answer paths ----------
function noMatch() {
  return finish(
    'I could not find that in my notes. The [About page](/about/) has the full story, and you can reach Anirudh through the [contact form](/#contact).',
    [],
    [],
    'nomatch',
  );
}

function smallTalk(index, question) {
  if (GREETING.test(question)) {
    return finish(
      "Hi! I'm AniBot. Ask me about Anirudh's work at Rivo, his hackathon wins, his patent, or what he has written.",
      [],
      [],
      'smalltalk',
    );
  }
  if (THANKS.test(question)) {
    return finish('Happy to help. Anything else you want to know about Anirudh?', [], [], 'smalltalk');
  }
  if (TASK.test(question) && !ABOUT_HIM.test(question)) {
    return finish(
      "I'm only here to answer questions about Anirudh: his work at Rivo, his projects, his hackathon wins, and what he has written.",
      [],
      [],
      'smalltalk',
    );
  }
  if (ABOUT_BOT.test(question)) {
    const how = index.articles.find((a) => a.topic === 'anibot');
    return finish(
      `I'm AniBot, the assistant on Anirudh's site. He built me along with the rest of this website. Right now I'm answering from notes made from his About page, his project write-ups, and his portfolio, so my answers are short.${
        how ? ` Here is [how AniBot works](${how.url}).` : ''
      }`,
      [],
      [],
      'smalltalk',
    );
  }
  return null;
}

function writingAnswer(index, topical) {
  const arts = index.articles;
  if (!arts.length) return null;
  const n = arts.length;
  if (topical.length) {
    const ranked = search(index, topical, { filter: (d) => d.kind === 'article' });
    if (strong(ranked[0])) {
      const hits = ranked.filter((r) => r.coverage >= MIN_COVERAGE && r.score >= ranked[0].score * 0.3).slice(0, 3);
      return finish(
        `These write-ups match best:\n\n${hits.map((r) => bullet(r.doc)).join('\n')}\n\nAll ${n} are on the [Writing page](/blog/).`,
        [],
        hits.map((r) => r.doc),
        'answer',
        'writing',
      );
    }
  }
  const picks = [...arts].sort(byAwardThenDate).slice(0, 3);
  const topics = (index.kb.meta?.topTags || []).slice(0, 4);
  const miss = topical.length ? "I couldn't find a write-up on that exact topic. " : '';
  const lead = `${miss}Anirudh has written ${n} deep dives on projects he built.${
    topics.length ? ` The topics that come up most are ${joinAnd(topics)}.` : ''
  } A few good places to start:`;
  return finish(
    `${lead}\n\n${picks.map(bullet).join('\n')}\n\nThe full list is on the [Writing page](/blog/).`,
    [],
    picks,
    'answer',
    'writing',
  );
}

function routeAnswer(index, intents) {
  const docs = [];
  for (const intent of intents) {
    const ids = index.kb.routes?.[intent] || [];
    // One intent may use two entries; when two intents share an answer, each gets its first.
    for (const id of intents.length > 1 ? ids.slice(0, 1) : ids.slice(0, 2)) {
      const d = index.byId.get(id);
      if (d && !docs.some((x) => related(x, d))) docs.push(d);
    }
  }
  if (!docs.length) return null;
  const second = ROUTE_SECOND[intents[0]] || ROUTE_SECOND.default;
  let body = docs.map((d, i) => (i === 0 ? render(d, 900) : render(d, second.budget, second.terms))).join('\n\n');
  const list = ROUTE_ARTICLES[intents[0]];
  if (list) {
    const arts = index.articles.filter((a) => (a.tags || []).some((t) => list.tag.test(t))).sort(byAwardThenDate).slice(0, 3);
    if (arts.length) body += `\n\n${list.label}\n\n${arts.map(bullet).join('\n')}`;
  }
  return finish(body, pickLinks(index, docs, [], body), docs, 'answer', intents.join('+'));
}

function compose(index, ranked, terms) {
  const top = ranked[0];
  const used = [top.doc];
  const parts = [render(top.doc, 760, terms)];
  // One more distinct entry when the top answer is short, or when the extra entry is a short,
  // complete answer of its own (the "Growth" bullet next to the long Rivo summary).
  if (top.doc.kind !== 'block') {
    for (const r of ranked.slice(1, 8)) {
      if (r.score < top.score * 0.72) break;
      const d = r.doc;
      if (d.kind === 'block' || d.kind === 'links' || r.coverage < MIN_COVERAGE || used.some((u) => related(u, d))) continue;
      const snippet = render(d, 300, terms);
      if (parts[0].length >= 400 && (snippet.length > 280 || r.coverage < top.coverage)) continue;
      parts.push(snippet);
      used.push(d);
      break;
    }
  }
  const body = parts.join('\n\n');
  return finish(body, pickLinks(index, used, ranked, body), used);
}

function analyze(question) {
  let q = String(question || '').toLowerCase().replace(/[‘’]/g, "'").trim();
  for (const [re, marker, keep] of PHRASES) q = q.replace(re, (m) => ` ${marker} ${keep ? m : ''} `);
  const tokens = tokenize(q);
  const fired = [];
  const claimed = new Set();
  for (const intent of INTENTS) {
    if (!tokens.some((t) => intent.triggers.has(t) && !claimed.has(t))) continue;
    fired.push(intent.id);
    intent.triggers.forEach((t) => claimed.add(t));
    intent.consumes.forEach((t) => claimed.add(t));
  }
  const remaining = tokens.filter((t) => !claimed.has(t) && !FILLER.has(t) && !t.startsWith('zz'));
  return { tokens, fired, remaining };
}

/**
 * Answer a question from the knowledge base.
 * @param index    result of buildIndex(kb)
 * @param question the visitor's message
 * @param opts.previous earlier user questions (oldest first), used for follow-ups like "tell me more"
 * @param opts.seen     ids of entries already shown, so a follow-up surfaces something new
 * @returns {{ text: string, note: string, ids: string[], kind: 'answer'|'nomatch'|'smalltalk', route?: string }}
 */
export function answerLocally(index, question, { previous = [], seen } = {}) {
  const raw = String(question || '').trim();
  const talk = smallTalk(index, raw);
  if (talk) return talk;

  const { tokens, fired, remaining } = analyze(raw);
  // The most recent earlier question that had something in it ("tell me more" does not).
  const prev = [...previous].reverse().map(tokenize).find((t) => t.some((x) => !FILLER.has(x))) || [];
  // "What did it win?" is about whatever the last question was about.
  const followUp = prev.length > 0 && raw.length < 60 && FOLLOW_UP.test(raw);

  // "What has he written about (voice agents)?" lists articles. Research questions about papers
  // claim "written" first, so they never land here.
  if (fired.includes('writing') && !followUp) {
    const own = BY_ID.writing;
    const topical = tokens.filter((t) => !own.triggers.has(t) && !own.consumes.has(t) && !FILLER.has(t) && !t.startsWith('zz'));
    const w = writingAnswer(index, topical);
    if (w) return w;
  }

  // A common question with nothing more specific in it goes to its tagged entries.
  const routed = fired.length > 1 ? fired.filter((id) => !WEAK.has(id)) : fired;
  if (routed.length && !remaining.length && !followUp) {
    const r = routeAnswer(index, routed.slice(0, 2));
    if (r) return r;
  }

  const literal = tokens.filter((t) => !t.startsWith('zz') && !FILLER.has(t));
  let ranked = followUp && literal.length ? [] : search(index, tokens, { seen });
  if (!strong(ranked[0]) && prev.length) {
    // Follow-ups ("tell me more", "what did it win?") borrow the last question's words.
    ranked = literal.length
      ? search(index, tokens, { seen, extra: prev.map((t) => [t, 0.6]) })
      : search(index, prev, { seen });
  }
  if (!strong(ranked[0])) return noMatch();
  return compose(index, ranked, new Set([...literal, ...(followUp || !literal.length ? prev : [])]));
}
