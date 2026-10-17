// AniBot knowledge base. Runs after build-blog.mjs and writes dist/anibot-kb.json: a compact,
// fact-only snapshot of the site that AniBot answers from when its LLM endpoint (/api/chat) is down.
//
// Sources, and nothing else, so an offline answer can never say more than the site already says:
//   content/pages/about.md     sections, list items, the hackathon table, and the FAQ
//   content/articles/*.md      frontmatter of published articles (drafts are skipped)
//   src/constants/index.js     projects, hackathons, work experience
//   scripts/blog/person.mjs    knowsAbout (the skills list in the Person schema)
//
// Text is rewritten to third person ("I built" becomes "Anirudh built") so AniBot can say it, and to
// house style (no em or en dashes, no emoji). The client half lives in src/data/anibotLocal.js.
//
// Usage: node scripts/build-anibot-kb.mjs [--out <file>] [--check]
//   --check also answers a set of sample questions with the client engine and prints the replies.

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import matter from 'gray-matter';
import { marked } from 'marked';
import { person } from './blog/person.mjs';

const ROOT = process.cwd();
const args = process.argv.slice(2);
const outIdx = args.indexOf('--out');
const OUT = path.resolve(ROOT, outIdx >= 0 ? args[outIdx + 1] : path.join('dist', 'anibot-kb.json'));
const CHECK = args.includes('--check');
const MAX_BYTES = 60 * 1024;
const ABOUT = path.join(ROOT, 'content', 'pages', 'about.md');
const ARTICLES = path.join(ROOT, 'content', 'articles');

let warnings = 0;
const warn = (m) => {
  warnings += 1;
  console.warn(`[anibot-kb] warn: ${m}`);
};

// Same slugify as build-blog.mjs, so /about/#anchors point at real headings.
const slugify = (s) =>
  String(s).toLowerCase().replace(/<[^>]+>/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const isoDay = (v) => (v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10));
// "ScreenSense (v3)" and "ScreenSense" share a topic; so do "LARK" and "LARK, Multi-Agent ...".
const topicKey = (s) => slugify(String(s).replace(/\(.*?\)/g, '').split(/\s+[\u2014\u2013]\s+/)[0]);

// ---------- house style ----------
function tidy(s) {
  return String(s ?? '')
    .replace(/((?:[A-Z][a-z]+ )?\d{4})\s*[\u2014\u2013]\s*(Present|(?:[A-Z][a-z]+ )?\d{4})/g, '$1 to $2')
    // A pair of dashes around an aside ("AI, dash, primarily voice agents, dash, in Python") becomes parentheses.
    .replace(/\s+[\u2014\u2013]\s+([^\u2014\u2013.()]{1,120}?)\s+[\u2014\u2013]\s+/g, ' ($1) ')
    .replace(/\s*[\u2014\u2013]\s*/g, ', ')
    .replace(/\p{Extended_Pictographic}\uFE0F?/gu, '')
    .replace(/×/g, 'x')
    .replace(/~(?=\d)/g, 'about ')
    .replace(/[ \t]+/g, ' ')
    .replace(/ +([,.;:])/g, '$1')
    .replace(/,\s*,/g, ',')
    .trim();
}

// ---------- first person to third person ----------
// The About page and the experience blurbs are written as "I". AniBot speaks about Anirudh, so the
// pronouns are swapped. Markers stand in for the pronouns until finalize() knows whether the name
// has already been said in that entry.
const SUBJ = '\u0001';
const POSS = '\u0002';
const OBJ = '\u0003';
const SEP = '\n\u0004\n';
const PRESENT = new Set(
  'add build care code deploy design do enjoy focus get go help host keep lead learn like live love maintain make mentor need own play prefer run see ship spend start study teach think try use want work write'.split(' '),
);
const PAST_OR_AUX = new Set(
  'am was were had did built rebuilt won grew made remade wrote rewrote ran led began took got spent went came put set found chose kept left met sent taught thought brought held told felt heard understood drew gave saw knew shipped can could will would should may might must'.split(' '),
);
const ADVERBS = 'also|still|now|then|just|never|always|often|first|recently|once|only|really|even|mostly|usually';
const third = (v) =>
  /(s|sh|ch|x|z|o)$/.test(v) ? `${v}es` : /[^aeiou]y$/.test(v) ? `${v.slice(0, -1)}ies` : `${v}s`;

// Quoted speech ("add the cheapest cable to my cart") belongs to whoever is quoted; leave it alone.
const markFirstPerson = (md, where) =>
  String(md)
    .split(/(“[^”]*”|"[^"]*")/)
    .map((part, i) => (i % 2 ? part : markPart(part, where)))
    .join('');

function markPart(md, where) {
  let s = md
    .replace(/\bI am\b|\bI'm\b/g, `${SUBJ} is`)
    .replace(/\bI have\b|\bI've\b/g, `${SUBJ} has`)
    .replace(/\bI'll\b/g, `${SUBJ} will`)
    .replace(/\bI'd\b/g, `${SUBJ} would`);
  s = s.replace(new RegExp(`\\bI((?: (?:${ADVERBS}))?) ([a-z]+)\\b`, 'g'), (m, adv, verb) => {
    if (PRESENT.has(verb)) return `${SUBJ}${adv} ${third(verb)}`;
    if (!PAST_OR_AUX.has(verb) && !/ed$/.test(verb)) warn(`${where}: check the verb after "I": "${verb}"`);
    return `${SUBJ}${adv} ${verb}`;
  });
  if (/\bI\b/.test(s)) {
    warn(`${where}: a bare "I" was left as "he"`);
    s = s.replace(/\bI\b/g, SUBJ);
  }
  // Verbs that share a converted subject: "I have been ... and have solved", "I grew up ... and now live".
  s = s.replace(new RegExp(`${SUBJ}[^.!?]*`, 'g'), (seg) =>
    seg.replace(new RegExp(`\\b(and|or)((?: (?:${ADVERBS}))?) ([a-z]+)\\b`, 'g'), (m, conj, adv, verb) => {
      if (verb === 'have') return `${conj}${adv} has`;
      return PRESENT.has(verb) ? `${conj}${adv} ${third(verb)}` : m;
    }),
  );
  return s
    .replace(/\bmy\b/gi, POSS)
    .replace(/\bme\b/g, OBJ)
    .replace(/\bmyself\b/gi, 'himself')
    .replace(/\bmine\b/g, 'his');
}

function finalize(s) {
  const firstMarker = s.search(/[\u0001-\u0003]/);
  let named = firstMarker < 0 || /Anirudh/.test(s.slice(0, firstMarker));
  const out = s.replace(/[\u0001-\u0003]/g, (m) => {
    if (!named) {
      named = true;
      return m === POSS ? "Anirudh's" : 'Anirudh';
    }
    return m === SUBJ ? 'he' : m === POSS ? 'his' : 'him';
  });
  // Capitalize a pronoun that opens a sentence, a list item, or follows a bold lead like "**Speed.**".
  return out.replace(/(^|[.!?][*_"')\]]*\s+|\n\s*(?:- )?)(he|his|him)\b/g, (m, pre, w) => pre + w[0].toUpperCase() + w.slice(1));
}

const voice = (md, where) => finalize(markFirstPerson(md, where));

// ---------- published articles ----------
if (!fs.existsSync(ARTICLES) || !fs.existsSync(ABOUT)) {
  console.log('[anibot-kb] content/articles or content/pages/about.md missing, skipping');
  process.exit(0);
}

const articles = fs
  .readdirSync(ARTICLES)
  .filter((f) => f.endsWith('.md'))
  .map((f) => ({ f, ...matter(fs.readFileSync(path.join(ARTICLES, f), 'utf8')) }))
  .filter(({ data }) => !data.draft && data.slug && data.title)
  .map(({ f, data }) => ({
    f,
    slug: data.slug,
    title: tidy(data.title),
    project: tidy(data.project || data.title),
    award: data.award ? tidy(data.award) : undefined,
    description: tidy(data.description || ''),
    summary: tidy(data.summary || data.description || ''),
    tags: (Array.isArray(data.tags) ? data.tags : String(data.tags || '').split(',')).map((t) => tidy(t)).filter(Boolean),
    live: data.live || undefined,
    date: isoDay(data.date),
  }))
  .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));

const PUBLISHED = new Set(articles.map((a) => a.slug));
// A link to a draft would 404, so keep the words and drop the link (same rule as build-blog.mjs).
const stripDraftLinks = (md) =>
  md.replace(/\[([^\]]+)\]\(\/blog\/([a-z0-9-]+)\/?(#[^)]*)?\)/g, (m, text, slug) => (PUBLISHED.has(slug) ? m : text));

const articleByTopic = new Map();
for (const a of articles) {
  const key = topicKey(a.project);
  const cur = articleByTopic.get(key);
  if (!cur || (!cur.award && a.award)) articleByTopic.set(key, a);
}

const docs = [];

for (const a of articles) {
  docs.push({
    id: `article:${a.slug}`,
    kind: 'article',
    title: a.title,
    project: a.project,
    ...(a.award ? { award: a.award } : {}),
    url: `/blog/${a.slug}/`,
    ...(a.live ? { live: a.live } : {}),
    date: a.date,
    tags: a.tags,
    topic: topicKey(a.project),
    text: voice(a.summary, a.f),
    keys: voice(a.description, a.f),
  });
}

// ---------- about.md ----------
const about = matter(fs.readFileSync(ABOUT, 'utf8'));
const sections = [{ heading: '', anchor: '', blocks: [] }];
const faqs = [];
{
  let sec = sections[0];
  let inFaq = false;
  let q = null;
  for (const t of marked.lexer(about.content)) {
    if (t.type === 'heading' && t.depth === 2) {
      inFaq = /^(faq|frequently asked questions?)$/i.test(t.text.trim());
      sec = { heading: t.text.trim(), anchor: slugify(t.text), blocks: [] };
      sections.push(sec);
      q = null;
      continue;
    }
    if (inFaq) {
      if (t.type === 'heading' && t.depth === 3) {
        q = { q: t.text.trim(), anchor: slugify(t.text), a: [] };
        faqs.push(q);
      } else if (q && t.type === 'paragraph') q.a.push(t.text);
      else if (q && t.type === 'list') q.a.push(t.items.map((i) => i.text.trim()).join('; '));
      continue;
    }
    const last = sec.blocks[sec.blocks.length - 1];
    const leadsIn = last && !last.items.length && /:\s*$/.test(last.lead);
    if (t.type === 'paragraph') {
      sec.blocks.push({ lead: t.text.trim(), items: [] });
    } else if (t.type === 'list') {
      const items = t.items.map((i) => i.text.trim());
      if (leadsIn) last.items = items;
      else sec.blocks.push({ lead: '', items });
    } else if (t.type === 'table') {
      const head = t.header.map((c) => c.text.trim().toLowerCase());
      const rows = t.rows.map((r) => Object.fromEntries(r.map((c, i) => [head[i], c.text.trim()])));
      const items = rows.map((r) =>
        r.result && r.event ? `**${r.result}** at ${r.event}: ${r.project || ''}`.trim() : Object.values(r).join(', '),
      );
      const block = leadsIn ? last : { lead: '', items: [] };
      block.items = items;
      block.rows = rows;
      if (!leadsIn) sec.blocks.push(block);
    }
  }
}

for (const sec of sections) {
  const where = `about.md#${sec.anchor || 'intro'}`;
  const url = sec.anchor ? `/about/#${sec.anchor}` : '/about/';
  // "Things I have built" becomes "Things Anirudh has built" when AniBot shows it as a heading.
  const title = sec.heading ? voice(tidy(sec.heading), where) : 'About Anirudh';
  sec.blocks.forEach((b, bi) => {
    // Page navigation copy ("this page is about ...") is not something to repeat in a chat.
    if (/\bthis page\b/i.test(b.lead)) return;
    const id = `about:${sec.anchor || 'intro'}:${bi}`;
    const marked2 = [b.lead, ...b.items].map((x) => markFirstPerson(tidy(stripDraftLinks(x)), where));

    // A list of bare links (the "Elsewhere" section) reads better as one line.
    if (b.items.length && b.items.every((it) => /^\[[^\]]+\]\([^)]+\)$/.test(it))) {
      docs.push({
        id,
        kind: 'links',
        section: sec.heading,
        title,
        url,
        text: finalize(`Anirudh's profiles and links: ${marked2.slice(1).join(' · ')}`),
        keys: 'profiles links social online accounts find',
      });
      return;
    }

    const [lead, ...items] = finalize(marked2.join(SEP)).split(SEP);
    if (`${lead}${items.join('')}`.length < 60) return;
    docs.push({ id, kind: 'block', section: sec.heading, title, url, lead, items });
    if (items.length < 2) return;
    items.forEach((_, ii) => {
      const bold = /^\*\*([^*]+)\*\*/.exec(b.items[ii]);
      const row = b.rows?.[ii];
      const linkText = row && /^\[([^\]]+)\]/.exec(row.project || '');
      const topicName = linkText?.[1] || bold?.[1]?.replace(/[.:]$/, '');
      docs.push({
        id: `${id}.${ii}`,
        kind: 'item',
        parent: id,
        section: sec.heading,
        title,
        url,
        ...(topicName ? { topic: topicKey(topicName) } : {}),
        text: finalize(marked2[ii + 1]),
      });
    });
  });
}

for (const f of faqs) {
  docs.push({
    id: `faq:${f.anchor}`,
    kind: 'faq',
    title: tidy(f.q),
    url: `/about/#${f.anchor}`,
    text: voice(tidy(stripDraftLinks(f.a.join(' '))), `about.md FAQ "${f.q}"`),
  });
}

// ---------- src/constants/index.js ----------
const constants = await import(pathToFileURL(path.join(ROOT, 'src', 'constants', 'index.js')).href);

for (const p of constants.myProjects || []) {
  const [name, tagline] = p.title.split(/\s+[\u2014\u2013]\s+/).map((s) => tidy(s));
  const topic = topicKey(name);
  const art = articleByTopic.get(topic);
  docs.push({
    id: `project:${topic}`,
    kind: 'project',
    title: name,
    topic,
    url: art ? `/blog/${art.slug}/` : p.href,
    href: p.href,
    text: voice(tidy(`**${name}**${tagline ? ` (${tagline})` : ''}. ${p.desc} ${p.subdesc}`), `constants project ${name}`),
    ...(tagline ? { keys: tagline } : {}),
  });
}

// Hackathon cards repeat the About table; fold their blurbs into the matching row as search terms.
for (const h of constants.hackathons || []) {
  const name = tidy(String(h.project).split(/\s+[\u2014\u2013]\s+/)[0]);
  const topic = topicKey(name);
  const row = docs.find((d) => d.kind === 'item' && d.topic === topic && /hackathon/i.test(d.section || ''));
  const extra = tidy(`${h.event} ${h.blurb}`);
  if (row) row.keys = [row.keys, extra].filter(Boolean).join(' ');
  else {
    docs.push({
      id: `hackathon:${topic}`,
      kind: 'item',
      section: 'Hackathons',
      title: 'Hackathons',
      url: '/#hackathons',
      topic,
      text: tidy(`**${h.result}** at ${h.event}: ${name}. ${h.blurb}`),
    });
  }
}

const work = (constants.workExperiences || []).map((w) => {
  const [company, place] = String(w.name).split('|').map((s) => tidy(s));
  return { ...w, company, place, duration: tidy(w.duration), pos: tidy(w.pos) };
});
for (const w of work) {
  const topic = topicKey(w.company);
  docs.push({
    id: `exp:${topic}`,
    kind: 'experience',
    title: `${w.pos}, ${w.company}`,
    topic,
    url: '/#work',
    text: voice(tidy(`**${w.pos}, ${w.company}** (${w.place}, ${w.duration}). ${w.title}`), `constants experience ${w.company}`),
  });
}
if (work.length) {
  docs.push({
    id: 'exp:overview',
    kind: 'block',
    section: 'Work experience',
    title: 'Work experience',
    url: '/#work',
    lead: "Anirudh's work history:",
    items: work.map((w) => `**${w.pos}**, ${w.company}, ${w.place} (${w.duration})`),
  });
}

// ---------- skills ----------
const tagCounts = new Map();
for (const a of articles) for (const t of a.tags) tagCounts.set(t, (tagCounts.get(t) || 0) + 1);
const topTags = [...tagCounts.entries()]
  .filter(([, n]) => n >= 2)
  .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
  .slice(0, 12);
const knowsAbout = person().knowsAbout || [];
docs.push({
  id: 'skills',
  kind: 'skills',
  title: 'Skills and tools',
  url: '/about/',
  text: tidy(
    `**Areas Anirudh works in:** ${knowsAbout.join(', ')}.\n\n**Topics and tools that come up most in his project write-ups:** ${topTags
      .map(([t]) => t)
      .join(', ')}.`,
  ),
  keys: 'skills stack tech technologies languages frameworks tools',
});

// ---------- intent routes ----------
// The client answers the most common questions ("what does he do at Rivo", "which hackathons") from
// these exact entries instead of the ranker. Each rule picks the first entry that matches.
const routes = {};
const route = (intent, pred) => {
  const taken = routes[intent] || [];
  const d = docs.find((x) => !taken.includes(x.id) && pred(x));
  if (!d) return warn(`no entry for route "${intent}" (about.md structure changed?)`);
  routes[intent] = [...taken, d.id];
};
const inSection = (re) => (d) => re.test(d.section || '');
route('who', (d) => d.id.startsWith('about:intro:'));
route('work', (d) => d.kind === 'block' && inSection(/what i do now/i)(d) && /Rivo/.test(d.lead) && d.items.length > 0);
route('voice', (d) => d.kind === 'item' && inSection(/what i do now/i)(d) && /\bvoice\b/i.test(d.text));
route('agents', (d) => d.kind === 'item' && inSection(/what i do now/i)(d) && /\bagentic\b/i.test(d.text));
route('agents', (d) => d.kind === 'block' && inSection(/what i do now/i)(d) && /Nonlinear/.test(d.lead));
route('previous', (d) => d.kind === 'block' && inSection(/what i do now/i)(d) && /Nonlinear/.test(d.lead));
route('previous', (d) => d.kind === 'block' && inSection(/what i do now/i)(d) && /research assistant/i.test(d.lead));
route('experience', (d) => d.id === 'exp:overview');
route('hackathons', (d) => d.kind === 'block' && inSection(/hackathon/i)(d) && d.items.length > 0);
route('hackathons', (d) => d.kind === 'block' && inSection(/hackathon/i)(d) && /season/i.test(d.lead));
route('projects', (d) => d.kind === 'block' && inSection(/things i have built/i)(d) && d.items.length > 0);
route('patent', (d) => d.kind === 'item' && inSection(/patent/i)(d) && /patent/i.test(d.text));
route('research', (d) => d.kind === 'block' && inSection(/research/i)(d) && d.items.length > 0);
route('education', (d) => d.kind === 'block' && inSection(/education/i)(d) && d.items.length > 0);
route('location', (d) => d.id.startsWith('about:intro:'));
route('location', (d) => d.kind === 'block' && /grew up/i.test(d.lead));
route('contact', (d) => d.kind === 'faq' && /contact/i.test(d.title));
route('profiles', (d) => d.kind === 'links');
route('stack', (d) => d.id === 'skills');

// ---------- write ----------
const kb = {
  version: 1,
  generated: isoDay(about.data.date || new Date()),
  meta: {
    articles: articles.length,
    topTags: topTags.map(([t]) => t),
  },
  routes,
  docs,
};

// Last line of defence for the house style: no em or en dashes anywhere in what AniBot can say.
let json = JSON.stringify(kb);
const dashes = (json.match(/[\u2014\u2013]/g) || []).length;
if (dashes) {
  warn(`${dashes} em/en dash(es) survived tidy(); replacing with commas`);
  json = json.replace(/\s*[\u2014\u2013]\s*/g, ', ');
}
const leftovers = json.match(/[\u0001-\u0004]/g);
if (leftovers) throw new Error('[anibot-kb] pronoun markers leaked into the output');
for (const m of json.matchAll(/\]\(\/blog\/([a-z0-9-]+)\//g)) {
  if (!PUBLISHED.has(m[1])) throw new Error(`[anibot-kb] link to unpublished article /blog/${m[1]}/`);
}

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, json);
const bytes = Buffer.byteLength(json);
if (bytes > MAX_BYTES) warn(`knowledge base is ${(bytes / 1024).toFixed(1)} KB (budget ${MAX_BYTES / 1024} KB)`);
console.log(
  `[anibot-kb] ${docs.length} entries (${articles.length} articles, ${faqs.length} FAQ) → ${path.relative(ROOT, OUT)} (${(
    bytes / 1024
  ).toFixed(1)} KB)${warnings ? `, ${warnings} warning(s)` : ''}`,
);

// ---------- optional self-check ----------
if (CHECK) {
  const engine = await import(pathToFileURL(path.join(ROOT, 'src', 'data', 'anibotLocal.js')).href);
  const index = engine.buildIndex(JSON.parse(json));
  const QUESTIONS = [
    'What is Anirudh building at Rivo?',
    'Which hackathons has he won?',
    'What is his patent about?',
    'Tell me about his voice agent work',
    'What has he written about?',
    'Where did he study?',
    'How can I contact him?',
    'Tell me about LARK',
    'What AI agents has he built?',
    'What was his role at Nonlinear?',
    'Has he written about RAG?',
    "What's his tech stack?",
    'Tell me about his patents & publications',
    'How can I work with him?',
    'Does he need visa sponsorship?',
  ];
  let failures = 0;
  const seen = new Set();
  const asked = [];
  for (const q of QUESTIONS) {
    const r = engine.answerLocally(index, q, { previous: asked.slice(-3), seen });
    asked.push(q);
    r.ids.forEach((id) => seen.add(id));
    const bad = /[\u2014\u2013]/.test(r.text) || !r.text.trim();
    if (bad) failures += 1;
    console.log(`\n### ${q}\n[${r.kind}${r.route ? `:${r.route}` : ''}] ${r.ids.join(', ')}\n${r.text}\n_${r.note}_`);
  }
  if (failures) {
    console.error(`[anibot-kb] check: ${failures} bad answer(s)`);
    process.exit(1);
  }
}
