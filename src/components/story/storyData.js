// What the homepage sky and the universe are made of. Everything is read from src/constants
// (myProjects, hackathons) and /blog/index.json (published write-ups), so a new project or article
// shows up as a star without touching this file. scripts/prerender-home.mjs uses the same rules.
import { hackathons, myProjects } from '../../constants/index.js';

// House style for the homepage copy: no emoji, no em or en dashes, "x" for "×", ", " for "·".
export const cleanText = (s = '') =>
  String(s)
    .replace(/\p{Extended_Pictographic}️?/gu, '')
    .replace(/\s*[—–]\s*/g, ', ')
    .replace(/\s*·\s*/g, ', ')
    .replace(/×/g, 'x')
    .replace(/\s{2,}/g, ' ')
    .trim();

// "Apartment 4B: Horror Mystery Game" and "ScreenSense (v3)" -> the project's base name.
export const baseName = (s = '') =>
  cleanText(String(s).split(/:\s+/)[0])
    .replace(/\s*\([^)]*\)\s*$/, '')
    .trim();

export const projectKey = (name = '') =>
  String(name)
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

const normUrl = (u) => (u ? String(u).trim().toLowerCase().replace(/\/+$/, '') : '');
const firstSentence = (s = '') => String(s).split(/(?<=[.!?])\s+(?=[A-Z])/)[0].trim();

// "🏆 Top 10 at the Y Combinator AI Hackathon. A hierarchical ..." -> award lead + the rest.
const splitAward = (desc = '') => {
  const s = String(desc).trim();
  if (!/^\p{Extended_Pictographic}/u.test(s)) return { award: null, rest: s };
  const m = /^([^.]*)\.\s*([\s\S]*)$/.exec(s);
  return m ? { award: cleanText(m[1]), rest: m[2] } : { award: null, rest: s };
};

// Kickers for the two projects that have no hackathon result, in the site's own words
// (TalkativePDF's card calls it "a production SaaS"; CIVS is "the basis of a granted patent").
const KICKER = {
  talkativepdf: 'Production SaaS',
  civs: 'Granted patent',
};

// The planets: one per homepage project card, with its hackathon result when it has one.
export const PLANETS = myProjects.map((p) => {
  const h = hackathons.find((x) => normUrl(x.href) === normUrl(p.href));
  const { award, rest } = splitAward(p.desc);
  const name = baseName(p.title);
  const isSource = /github\.com/i.test(p.href || '');
  return {
    id: p.id,
    name,
    key: projectKey(name),
    title: cleanText(p.title),
    result: h ? `${h.result}, ${cleanText(h.event)}` : award || KICKER[p.id] || '',
    line: cleanText(h ? h.blurb : firstSentence(rest)),
    article: p.article || null,
    href: p.href || null,
    hrefLabel: isSource ? 'Source' : 'Live site',
    award: Boolean(h) || p.id === 'civs',
    accent: h?.accent || null,
  };
});

// Fill in a write-up for planets whose card has no `article` (matched by base name, like
// scripts/prerender-home.mjs does), once the article list is known.
export const linkPlanetArticles = (articles = []) => {
  const published = new Set(articles.map((a) => a.slug));
  for (const p of PLANETS) {
    if (p.article && published.has(p.article)) continue;
    if (p.article && articles.length && !published.has(p.article)) p.article = null;
    const matches = articles.filter((a) => projectKey(baseName(a.project)) === p.key);
    const hit = matches.find((a) => a.award) || matches[0];
    if (hit) p.article = hit.slug;
  }
  return PLANETS;
};

export const writeUpHref = (slug) => (slug ? `/blog/${slug}/` : null);

// Stars for the hero sky: every planet, then every other published write-up.
// mag: 1 = a win or the patent (bright), 2 = another homepage project, 3 = a write-up.
export const buildStars = (articles = []) => {
  linkPlanetArticles(articles);
  const used = new Set(PLANETS.map((p) => p.article).filter(Boolean));
  const stars = PLANETS.map((p, i) => ({
    key: `p-${p.id}`,
    planet: i,
    name: p.name,
    kicker: p.result || 'Project',
    line: p.line,
    href: writeUpHref(p.article) || p.href,
    external: !p.article,
    linkLabel: p.article ? 'Read the write-up' : p.hrefLabel,
    mag: p.award ? 1 : 2,
  }));
  for (const a of articles) {
    if (used.has(a.slug)) continue;
    used.add(a.slug);
    stars.push({
      key: `a-${a.slug}`,
      planet: -1,
      name: cleanText(a.project || a.title),
      kicker: a.award ? cleanText(a.award) : a.readingMinutes ? `Write-up, ${a.readingMinutes} min read` : 'Write-up',
      line: cleanText(firstSentence(a.description || '')),
      href: writeUpHref(a.slug),
      external: false,
      linkLabel: 'Read the write-up',
      mag: a.award ? 1 : 3,
    });
  }
  return stars;
};

// The article list the Writing section also reads. One request per page view.
let articlesPromise = null;
export const loadArticles = () => {
  if (!articlesPromise) {
    articlesPromise = fetch('/blog/index.json')
      .then((r) => (r.ok ? r.json() : []))
      .then((list) => (Array.isArray(list) ? list : []))
      .catch(() => []);
  }
  return articlesPromise;
};
