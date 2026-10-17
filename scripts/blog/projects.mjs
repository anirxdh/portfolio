// Builds the project list for /projects/ from three sources, in this order:
//   1. src/constants/index.js  myProjects (the homepage cards) and hackathons (results + blurbs)
//   2. published articles      every project that has a write-up, even if it is not on the homepage
//   3. content/pages/projects.md frontmatter `projects:`  per-project overrides, and extra projects
//      that have neither a homepage card nor a published article yet
// Entries are matched by live/repo URL first, then by base name ("ScreenSense (v1)" -> "ScreenSense").

import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { canonicalTag } from './topics.mjs';

// The homepage copy uses emoji, em dashes, "×" and "·"; the static pages use none of them.
export const cleanText = (s = '') =>
  String(s)
    .replace(/\p{Extended_Pictographic}️?/gu, '')
    .replace(/\s*[—–]\s*/g, ', ')
    .replace(/\s*·\s*/g, ', ')
    .replace(/×/g, 'x')
    .replace(/\s{2,}/g, ' ')
    .trim();

const baseName = (s = '') =>
  cleanText(String(s).split(/\s+[—–]\s+|:\s+/)[0])
    .replace(/\s*\([^)]*\)\s*$/, '')
    .trim();
const parenthetical = (s = '') => (/\(([^)]+)\)\s*$/.exec(String(s)) || [])[1];
export const projectKey = (name) =>
  String(name)
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
const normUrl = (u) => (u ? String(u).trim().toLowerCase().replace(/\/+$/, '') : '');
const isRepo = (u) => /^https:\/\/github\.com\//i.test(u || '');
const firstSentence = (s = '') => String(s).split(/(?<=[.!?])\s+(?=[A-Z])/)[0].trim();
// "🏆 Top 10 at the Y Combinator AI Hackathon. A hierarchical ..." -> "A hierarchical ..."
const dropAwardLead = (s = '') => (/^\p{Extended_Pictographic}/u.test(String(s).trim()) ? String(s).replace(/^[^.]*\.\s*/, '') : s);

async function loadConstants(root, warn) {
  const file = path.join(root, 'src', 'constants', 'index.js');
  try {
    return await import(pathToFileURL(file).href);
  } catch (e) {
    warn(`could not import src/constants/index.js (${e.message}); /projects/ is built from articles only`);
    return {};
  }
}

const OVERRIDABLE = ['name', 'blurb', 'award', 'tech', 'live', 'liveLabel', 'repo', 'accent'];
// Article tags that describe the project rather than its stack; kept off the "Built with" chips.
const NOT_TECH = new Set(['patent', 'hackathon']);

export async function loadProjects({ root, articles, overrides = [], warn = console.warn }) {
  const { myProjects = [], hackathons = [] } = await loadConstants(root, warn);
  const groups = new Map();
  const byUrl = new Map();
  const remember = (url, key) => {
    const u = normUrl(url);
    if (u && !byUrl.has(u)) byUrl.set(u, key);
  };
  const ensure = (name) => {
    const key = projectKey(name);
    if (!groups.has(key)) groups.set(key, { key, name, articles: [] });
    return groups.get(key);
  };

  for (const p of myProjects) {
    const proj = ensure(baseName(p.title));
    proj.href = p.href;
    proj.desc = cleanText(dropAwardLead(p.desc));
    proj.constTech = (p.tags || []).map((t) => canonicalTag(t.name));
    remember(p.href, proj.key);
  }

  for (const h of hackathons) {
    const key = byUrl.get(normUrl(h.href)) || projectKey(baseName(h.project));
    const proj = groups.get(key) || ensure(baseName(h.project));
    proj.hackathon = { result: cleanText(h.result), event: cleanText(h.event), order: hackathons.indexOf(h) };
    proj.hackBlurb = cleanText(h.blurb);
    proj.hackAccent = h.accent;
    proj.href = proj.href || h.href;
    remember(h.href, proj.key);
  }

  for (const a of articles) {
    const key = byUrl.get(normUrl(a.live)) || byUrl.get(normUrl(a.repo)) || projectKey(baseName(a.project));
    const proj = groups.get(key) || ensure(baseName(a.project));
    // The write-up whose links match the homepage card leads; other write-ups follow in article order.
    const matchesCard = proj.href && [normUrl(a.live), normUrl(a.repo)].includes(normUrl(proj.href));
    if (matchesCard) proj.articles.unshift(a);
    else proj.articles.push(a);
    remember(a.live, proj.key);
    remember(a.repo, proj.key);
  }

  for (const o of overrides) {
    const key = o.key || (o.name && projectKey(o.name));
    if (!key) {
      warn('projects.md: an entry has neither "key" nor "name"');
      continue;
    }
    let proj = groups.get(key);
    if (!proj) {
      if (!o.name) {
        warn(`projects.md: no project with key "${key}" (add a "name" to create it)`);
        continue;
      }
      proj = { key, name: o.name, articles: [] };
      groups.set(key, proj);
    }
    proj.override = Object.fromEntries(OVERRIDABLE.filter((k) => o[k] !== undefined).map((k) => [k, o[k]]));
  }

  const list = [...groups.values()].map((p) => {
    const o = p.override || {};
    const lead = p.articles[0];
    const award = o.award || lead?.award || (p.hackathon ? `${p.hackathon.result}, ${p.hackathon.event}` : undefined);
    const tech = o.tech || (lead ? lead.tags.map(canonicalTag) : p.constTech || []);
    return {
      key: p.key,
      name: o.name || p.name,
      blurb: cleanText(o.blurb || p.hackBlurb || firstSentence(lead?.summary) || p.desc || lead?.description || ''),
      award: award ? cleanText(award) : undefined,
      hackathon: p.hackathon,
      tech: [...new Set(tech.map((t) => cleanText(t)))].filter((t) => !NOT_TECH.has(t.toLowerCase())),
      live: o.live || lead?.live || (p.href && !isRepo(p.href) ? p.href : undefined),
      liveLabel: o.liveLabel,
      repo: o.repo || lead?.repo || (isRepo(p.href) ? p.href : undefined),
      accent: o.accent || p.hackAccent || lead?.accent,
      articles: p.articles.map((a) => ({ article: a, label: parenthetical(a.project) })),
    };
  });

  for (const p of list) if (!p.blurb) warn(`projects: "${p.name}" has no description`);

  // Hackathon wins first (in the homepage order), then everything else in source order.
  const wins = list.filter((p) => p.hackathon).sort((x, y) => x.hackathon.order - y.hackathon.order);
  const rest = list.filter((p) => !p.hackathon);
  return [...wins, ...rest];
}
