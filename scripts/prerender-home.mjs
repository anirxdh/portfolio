// Homepage prerender. Runs last in `npm run build` and writes a text-first copy of the homepage
// sections into dist/index.html, inside #root, after the static intro:
//   About, the stats band, Projects, Hackathons, Writing, Work Experience, Contact, footer links.
//
// Why: the homepage is a React app. Crawlers that do not run JavaScript (most AI crawlers, and
// Google's first pass) used to see only the short static intro. Now they get the same content
// a visitor sees after React mounts.
//
// Where the content comes from, so it stays in step with what React renders:
//   src/constants/index.js     projects, hackathons, work experience, stats (the arrays React maps)
//   dist/blog/index.json       latest articles (the file the Writing section fetches)
//   scripts/blog/person.mjs    email address and profile links
//   src/sections/*.jsx         section headings, intro paragraphs and the About card text, read
//                              from the JSX source. A warning is printed if a pattern stops matching.
// Text is put in house style (no emoji, no em or en dashes, "x" for "×") with cleanText().
//
// React mounts with createRoot(), which empties #root first, so none of this markup survives the
// mount and none of it can collide with the app. Rules it keeps:
//   - only class names the React sections already use, so the copy is styled for the moment
//     before React mounts (checked against the built CSS; a missing class is a warning)
//   - no h1 (the static intro has the only one)
//   - no ids, so links like /#contact keep landing on React's sections, not on this copy
//   - no images, so it downloads nothing
// Running it twice is safe: the previous copy is replaced.
//
// Usage: node scripts/prerender-home.mjs   (after vite build and scripts/build-blog.mjs)

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { SAME_AS, person } from './blog/person.mjs';
import { cleanText, projectKey } from './blog/projects.mjs';

const ROOT = process.cwd();
const DIST = path.join(ROOT, 'dist');
const HOME = path.join(DIST, 'index.html');
const SECTIONS = path.join(ROOT, 'src', 'sections');
const RESUME_PDF = '/assets/anirudh-vasudevan-resume.pdf';
const DEFAULT_ACCENT = '#7C9CFF';

const OPEN = '<!--home-prerender:open-->';
const CONTENT = '<!--home-prerender:content-->';
const END = '<!--home-prerender:end-->';

let warnings = 0;
const warn = (m) => {
  warnings += 1;
  console.warn(`[prerender] warn: ${m}`);
};

if (!fs.existsSync(HOME)) {
  console.error('[prerender] dist/index.html not found. Run `vite build` first.');
  process.exit(1);
}

// ---------- text helpers ----------
const esc = (s = '') =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
// House style, plus "applications , with" -> "applications, with".
const tidy = (s) => cleanText(s).replace(/\s+([,.;:!?])/g, '$1');
const t = (s) => esc(tidy(s));
// Six-digit colors only: the pill background appends an alpha byte ("#f97316" + "22").
const hex = (c) => (/^#[0-9a-f]{6}$/i.test(String(c || '')) ? c : DEFAULT_ACCENT);
const normUrl = (u) => (u ? String(u).trim().toLowerCase().replace(/\/+$/, '') : '');
// "Apartment 4B: Horror Mystery Game" and "ScreenSense (v3)" -> the project's base name.
const baseName = (s = '') =>
  cleanText(String(s).split(/:\s+/)[0])
    .replace(/\s*\([^)]*\)\s*$/, '')
    .trim();
const exists = (route) => fs.existsSync(path.join(DIST, route, 'index.html'));
const NEW_TAB = ' target="_blank" rel="noopener noreferrer"';

// ---------- reading text out of the section JSX ----------
const jsxSource = new Map();
const readJsx = (name) => {
  if (!jsxSource.has(name)) {
    const file = path.join(SECTIONS, name);
    jsxSource.set(name, fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '');
  }
  return jsxSource.get(name);
};
const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
const decodeEntities = (s) =>
  s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === '#') return String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : Number(e.slice(1)));
    return ENTITIES[e.toLowerCase()] ?? m;
  });
// Plain text of a JSX child list. String-literal expressions such as {' '} become their text and
// tags are dropped. Any other {expression} cannot be evaluated here, so the block is rejected.
const jsxText = (inner) => {
  const s = String(inner).replace(/\{\s*(['"`])([^'"`{}]*)\1\s*\}/g, '$2');
  if (/[{}]/.test(s)) return null;
  const text = decodeEntities(s.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ')).trim();
  return text || null;
};
const reEsc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const jsxBlocks = (file, tag, className) => {
  const re = new RegExp(`<${tag}\\s+className="${reEsc(className)}"(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, 'g');
  return [...readJsx(file).matchAll(re)].map((m) => jsxText(m[1])).filter(Boolean);
};
const jsxFirst = (file, tag, className, fallback, what) => {
  const [first] = jsxBlocks(file, tag, className);
  if (first) return first;
  warn(`src/sections/${file}: could not read the ${what}; using ${fallback ? `"${fallback}"` : 'nothing'}`);
  return fallback;
};

// ---------- data ----------
const constants = await import(pathToFileURL(path.join(ROOT, 'src', 'constants', 'index.js')).href);
const { myProjects = [], hackathons = [], workExperiences = [], stats = [] } = constants;

const articlesFile = path.join(DIST, 'blog', 'index.json');
let articles = [];
if (fs.existsSync(articlesFile)) {
  articles = JSON.parse(fs.readFileSync(articlesFile, 'utf8'));
  if (!Array.isArray(articles)) articles = [];
} else {
  warn('dist/blog/index.json not found (run scripts/build-blog.mjs first); the Writing section is left out');
}
const PUBLISHED = new Set(articles.map((a) => a.slug));

// The write-up to link for a project card: its `article` slug when that article is published, else
// a published article about the same project (matched by base name, award-winning one first).
const writeUp = (slug, name) => {
  if (slug) {
    if (PUBLISHED.has(slug)) return slug;
    warn(`src/constants/index.js: "${name}" links article "${slug}", which is not published (the homepage link would 404)`);
  }
  const key = projectKey(baseName(name));
  const matches = articles.filter((a) => projectKey(baseName(a.project)) === key);
  return (matches.find((a) => a.award) || matches[0])?.slug;
};

const accentByUrl = new Map(hackathons.map((h) => [normUrl(h.href), h.accent]));

// "🏆 Top 10 at the Y Combinator AI Hackathon. A hierarchical ..." -> award + the rest.
const splitAward = (desc = '') => {
  const s = String(desc).trim();
  if (!/^\p{Extended_Pictographic}/u.test(s)) return { award: null, rest: s };
  const m = /^([^.]*)\.\s*([\s\S]*)$/.exec(s);
  return m ? { award: tidy(m[1]), rest: m[2] } : { award: null, rest: s };
};

const pill = (label, accent) => {
  const c = hex(accent);
  return `<span class="text-xs font-semibold px-2.5 py-1 rounded-full" style="background-color: ${c}22; color: ${c}">${t(label)}</span>`;
};
const textLink = (href, label, srOnly = '', { external = false, arrow = '' } = {}) =>
  `<a href="${esc(href)}"${external ? NEW_TAB : ''} class="text-white-600 hover:text-white transition-colors underline underline-offset-4">${esc(label)}${
    srOnly ? `<span class="sr-only">${esc(srOnly)}</span>` : ''
  }${arrow ? `<span aria-hidden="true"> ${arrow}</span>` : ''}</a>`;

// ---------- sections ----------
const sectionHead = (file, fallbackTitle, introClass, { link = '' } = {}) => {
  const title = jsxFirst(file, 'h2', 'head-text', fallbackTitle, 'section heading');
  const intro = introClass ? jsxFirst(file, 'p', introClass, '', 'intro paragraph') : '';
  const head = `<h2 class="head-text">${t(title)}</h2>${intro ? `<p class="text-white-600 mt-3 max-w-2xl">${t(intro)}</p>` : ''}`;
  if (!link) return head;
  return `<div class="flex items-end justify-between gap-5 flex-wrap"><div>${head}</div>${link}</div>`;
};

function aboutSection() {
  const re = /<(h[23])\s+className="grid-headtext"\s*>([\s\S]*?)<\/\1>\s*<p\s+className="grid-subtext"\s*>([\s\S]*?)<\/p>/g;
  let cards = [...readJsx('About.jsx').matchAll(re)]
    .map((m) => ({ level: m[1], title: jsxText(m[2]), body: jsxText(m[3]) }))
    .filter((c) => c.title && c.body);
  if (!cards.length) {
    warn('src/sections/About.jsx: could not read the About cards; using the Person description');
    cards = [{ level: 'h2', title: 'About Anirudh Vasudevan', body: person().description }];
  }
  const email = String(person().email || '').replace(/^mailto:/, '');
  const html = cards.map((c, i) => {
    const more =
      i === 0 && exists('about') ? `<p class="mt-3">${textLink('/about/', 'More about me', '', { arrow: '→' })}</p>` : '';
    return `<div class="grid-container"><div><${c.level} class="grid-headtext">${t(c.title)}</${c.level}><p class="grid-subtext">${t(
      c.body,
    )}</p>${more}</div></div>`;
  });
  html.push(
    `<div class="grid-container"><div class="space-y-2"><h3 class="grid-headtext">Contact me</h3>${
      email ? `<p class="grid-subtext"><a href="mailto:${esc(email)}" class="text-white underline underline-offset-4">${esc(email)}</a></p>` : ''
    }<p class="grid-subtext"><a href="${RESUME_PDF}" class="text-white-600 hover:text-white transition-colors underline underline-offset-4">Download Resume</a></p></div></div>`,
  );
  return `<section class="c-space my-20" aria-label="About Anirudh Vasudevan"><div class="grid xl:grid-cols-3 md:grid-cols-2 grid-cols-1 gap-5">${html.join(
    '',
  )}</div></section>`;
}

function statsSection() {
  if (!stats.length) return '';
  const items = stats.map(
    (s) =>
      `<div class="flex flex-col items-center text-center"><p class="text-4xl sm:text-5xl font-bold text-white">${esc(s.value)}${
        s.suffix ? `<span class="bg-gradient-to-r from-blue-400 to-purple-400 bg-clip-text text-transparent">${t(s.suffix)}</span>` : ''
      }</p><p class="text-sm text-white-600 mt-2">${t(s.label)}</p></div>`,
  );
  return `<section class="c-space my-20" aria-label="At a glance"><div class="grid grid-cols-2 lg:grid-cols-4 gap-8 rounded-2xl border border-black-300 bg-black-200 py-12 px-6">${items.join(
    '',
  )}</div></section>`;
}

function projectsSection() {
  if (!myProjects.length) return '';
  const cards = myProjects.map((p) => {
    const { award, rest } = splitAward(p.desc);
    const slug = writeUp(p.article, p.title);
    const isSource = String(p.href || '').includes('github.com');
    const links = [
      slug && textLink(`/blog/${slug}/`, 'Read the deep dive', ` on ${tidy(p.title)}`, { arrow: '→' }),
      p.href &&
        textLink(p.href, isSource ? 'View Source' : 'Check Live Site', ` for ${tidy(p.title)} (opens in a new tab)`, {
          external: true,
          arrow: '↗',
        }),
    ].filter(Boolean);
    return `<article class="flex flex-col gap-3 rounded-2xl border border-black-300 bg-black-200 p-6">${
      award ? `<div class="flex items-center gap-2 flex-wrap">${pill(award, accentByUrl.get(normUrl(p.href)))}</div>` : ''
    }<h3 class="text-white text-xl font-semibold">${t(p.title)}</h3>${rest ? `<p class="text-sm text-white-600">${t(rest)}</p>` : ''}${
      p.subdesc ? `<p class="text-sm text-white-600">${t(p.subdesc)}</p>` : ''
    }${links.length ? `<div class="flex items-center gap-x-6 gap-y-3 flex-wrap mt-auto pt-1">${links.join('')}</div>` : ''}</article>`;
  });
  const all = exists('projects') ? textLink('/projects/', 'All projects', '', { arrow: '→' }) : '';
  return `<section class="c-space my-20">${sectionHead('Projects.jsx', 'My Selected Work', '', { link: all })}<div class="grid md:grid-cols-2 lg:grid-cols-3 gap-5 mt-10">${cards.join(
    '',
  )}</div></section>`;
}

function hackathonsSection() {
  if (!hackathons.length) return '';
  const devpost = SAME_AS.find((u) => /devpost\.com/.test(u)) || 'https://devpost.com/anirxdh';
  const cards = hackathons.map((h) => {
    const slug = writeUp(h.article, h.project);
    return `<article class="group relative flex flex-col gap-3 rounded-2xl border border-black-300 bg-black-200 p-6 transition-colors hover:border-black-500 focus-within:border-black-500"><div class="flex items-center justify-between">${pill(
      h.result,
      h.accent,
    )}</div><p class="text-[11px] uppercase tracking-widest text-white-600">${t(h.event)}</p><h3 class="text-white text-lg font-semibold leading-tight"><a href="${esc(
      h.href,
    )}"${NEW_TAB} class="focus:outline-none after:absolute after:inset-0 after:rounded-2xl focus-visible:after:ring-2 focus-visible:after:ring-blue-400">${t(
      h.project,
    )}<span class="sr-only"> (opens in a new tab)</span></a></h3><p class="text-sm text-white-600">${t(h.blurb)}</p>${
      slug
        ? `<a href="/blog/${esc(slug)}/" class="relative z-10 mt-auto w-fit pt-1 text-sm text-white-600 hover:text-white transition-colors underline underline-offset-4 decoration-white/30 hover:decoration-white focus:outline-none focus-visible:rounded focus-visible:ring-2 focus-visible:ring-blue-400">Read how I built it<span class="sr-only">: ${t(
            h.project,
          )}</span><span aria-hidden="true"> →</span></a>`
        : ''
    }</article>`;
  });
  const link = textLink(devpost, 'My Devpost profile', ' (opens in a new tab)', { external: true, arrow: '↗' });
  return `<section class="c-space my-20">${sectionHead('Hackathons.jsx', 'Hackathons', 'text-white-600 mt-3 max-w-2xl', {
    link,
  })}<div class="grid md:grid-cols-2 lg:grid-cols-3 gap-5 mt-10">${cards.join('')}</div></section>`;
}

// Writing.jsx shows list.slice(0, N); read N so both always show the same articles.
const WRITING_COUNT = Number((/\.slice\(\s*0\s*,\s*(\d+)\s*\)/.exec(readJsx('Writing.jsx')) || [])[1]) || 3;

function writingSection() {
  const latest = articles.slice(0, WRITING_COUNT);
  if (!latest.length) return '';
  const cards = latest.map(
    (a) =>
      `<a href="/blog/${esc(a.slug)}/" class="group flex flex-col gap-3 rounded-2xl border border-black-300 bg-black-200 p-6 transition-colors hover:border-black-500 focus:outline-none focus:ring-2 focus:ring-blue-400"><div class="flex items-center gap-2 flex-wrap">${
        a.award ? pill(a.award, a.accent) : ''
      }<span class="text-[11px] uppercase tracking-widest text-white-600">${t(a.project)}</span></div><h3 class="text-white text-lg font-semibold leading-tight">${t(
        a.title,
      )}</h3><p class="text-sm text-white-600">${t(a.description)}</p>${
        a.readingMinutes ? `<p class="text-xs text-white-600 mt-auto pt-2">${esc(a.readingMinutes)} min read</p>` : ''
      }</a>`,
  );
  const link = textLink('/blog/', 'All articles', '', { arrow: '→' });
  return `<section class="c-space my-20">${sectionHead('Writing.jsx', 'Writing', 'text-white-600 mt-3 max-w-2xl', {
    link,
  })}<div class="grid md:grid-cols-3 gap-5 mt-10">${cards.join('')}</div></section>`;
}

function workSection() {
  if (!workExperiences.length) return '';
  const items = workExperiences.map(
    (w) =>
      `<article class="sm:p-5 px-2.5 py-5"><h3 class="font-bold text-white-800">${t(w.name)}</h3><p class="text-sm mb-5">${t(w.pos)}, <span>${t(
        w.duration,
      )}</span></p><p>${t(w.title)}</p></article>`,
  );
  return `<section class="c-space my-20"><div class="w-full text-white-600">${sectionHead(
    'Experience.jsx',
    'My Work Experience',
  )}<div class="mt-12 rounded-lg bg-black-200 border border-black-300"><div class="sm:py-10 py-5 sm:px-5 px-2.5">${items.join(
    '',
  )}</div></div></div></section>`;
}

const PROFILE_NAMES = {
  'linkedin.com': 'LinkedIn',
  'github.com': 'GitHub',
  'scholar.google.com': 'Google Scholar',
  'orcid.org': 'ORCID',
  'devpost.com': 'Devpost',
  'x.com': 'X',
  'youtube.com': 'YouTube',
  'leetcode.com': 'LeetCode',
  'instagram.com': 'Instagram',
};
const profileName = (url) => {
  const host = new URL(url).hostname.replace(/^www\./, '');
  return PROFILE_NAMES[host] || host;
};

function contactSection() {
  const title = jsxFirst('Contact.jsx', 'h2', 'head-text', "Let's talk", 'section heading');
  const intro = jsxFirst('Contact.jsx', 'p', 'text-lg text-white-600 mt-3', '', 'intro paragraph');
  const email = String(person().email || '').replace(/^mailto:/, '');
  const profiles = SAME_AS.map(
    (u) => `<li>${textLink(u, profileName(u), ' (opens in a new tab)', { external: true })}</li>`,
  ).join('');
  return `<section class="c-space my-20"><div class="contact-container"><h2 class="head-text">${t(title)}</h2>${
    intro ? `<p class="text-lg text-white-600 mt-3">${t(intro)}</p>` : ''
  }${
    email
      ? `<p class="text-lg text-white-600 mt-3">Email: <a href="mailto:${esc(email)}" class="text-white underline underline-offset-4">${esc(email)}</a></p>`
      : ''
  }<ul class="mt-4 flex gap-x-6 gap-y-3 flex-wrap" aria-label="Anirudh Vasudevan elsewhere">${profiles}</ul></div></section>`;
}

function footer() {
  const links = [
    exists('about') && ['/about/', 'About'],
    exists('projects') && ['/projects/', 'Projects'],
    exists('hackathons') && ['/hackathons/', 'Hackathons'],
    exists('research') && ['/research/', 'Research'],
    exists('uses') && ['/uses/', 'Uses'],
    exists('blog') && ['/blog/', 'Writing'],
    exists('resume') ? ['/resume/', 'Resume'] : ['/assets/anirudh-vasudevan-resume.pdf', 'Resume'],
  ].filter(Boolean);
  return `<div class="max-w-7xl mx-auto relative"><footer class="c-space pt-7 pb-3 border-t border-black-300 flex justify-between items-center flex-wrap gap-5"><nav aria-label="Footer" class="flex gap-4 flex-wrap text-sm text-white-600">${links
    .map(([href, label]) => `<a href="${href}" class="hover:text-white transition-colors">${label}</a>`)
    .join('')}</nav></footer></div>`;
}

// ---------- inject ----------
const sections = [aboutSection(), statsSection(), projectsSection(), hackathonsSection(), writingSection(), workSection(), contactSection()]
  .filter(Boolean)
  .join('\n');
const tail = footer();
const injected = `${sections}\n${tail}`;

// Guards on what this script adds.
if (/<h1[\s>]/i.test(injected)) throw new Error('[prerender] the prerendered copy must not contain an h1');
if (/\sid\s*=/i.test(injected)) throw new Error('[prerender] the prerendered copy must not contain ids');
{
  const text = injected.replace(/<[^>]+>/g, ' ');
  const dash = text.match(/[^\s]{0,20}[—–][^\s]{0,20}/);
  if (dash) warn(`em or en dash in the prerendered copy, e.g. "${dash[0]}"`);
}

let html = fs.readFileSync(HOME, 'utf8');
// Undo a previous run so the script is idempotent.
html = html.replace(new RegExp(`${OPEN}(?:<main>)?([\\s\\S]*?)${CONTENT}[\\s\\S]*?${END}`), (_, intro) => intro.replace(/\s+$/, ''));

const rootOpen = /<div\s+id="root"\s*>/.exec(html);
if (!rootOpen) throw new Error('[prerender] dist/index.html has no <div id="root">');
const innerStart = rootOpen.index + rootOpen[0].length;
// Find the </div> that closes #root.
let depth = 1;
let innerEnd = -1;
const tag = /<div\b[^>]*>|<\/div\s*>/gi;
tag.lastIndex = innerStart;
for (let m; (m = tag.exec(html)); ) {
  depth += m[0][1] === '/' ? -1 : 1;
  if (depth === 0) {
    innerEnd = m.index;
    break;
  }
}
if (innerEnd < 0) throw new Error('[prerender] could not find the end of #root in dist/index.html');

const intro = html.slice(innerStart, innerEnd);
const trimmed = intro.replace(/\s+$/, '');
const trailing = intro.slice(trimmed.length);
// One <main> around the static intro and the sections, like the React app (unless the intro
// already has one). A bare <main> has no styles, so the intro looks exactly the same.
const wrap = !/<main[\s>]/i.test(intro);
const body = wrap
  ? `${OPEN}<main>${trimmed}\n${CONTENT}<div class="max-w-7xl mx-auto relative">\n${sections}\n</div></main>\n${tail}${END}${trailing}`
  : `${OPEN}${trimmed}\n${CONTENT}<div class="max-w-7xl mx-auto relative">\n${sections}\n</div>\n${tail}${END}${trailing}`;
html = html.slice(0, innerStart) + body + html.slice(innerEnd);

const h1s = (html.match(/<h1[\s>]/gi) || []).length;
if (h1s !== 1) warn(`dist/index.html has ${h1s} h1 elements before React mounts (expected 1, in the static intro)`);

// Every class used above must exist in the built stylesheet, or the copy is unstyled before mount.
{
  const cssHref = /<link\b[^>]*rel="stylesheet"[^>]*href="(\/assets\/[^"]+\.css)"/.exec(html)?.[1];
  const cssFile = cssHref && path.join(DIST, cssHref);
  if (cssFile && fs.existsSync(cssFile)) {
    const css = fs.readFileSync(cssFile, 'utf8');
    const classes = new Set([...injected.matchAll(/\sclass="([^"]*)"/g)].flatMap((m) => m[1].split(/\s+/).filter(Boolean)));
    const has = (cls) => {
      const sel = `.${cls.replace(/[^a-zA-Z0-9_-]/g, (c) => `\\${c}`)}`;
      for (let i = css.indexOf(sel); i !== -1; i = css.indexOf(sel, i + 1)) {
        if (!/[\w\\-]/.test(css[i + sel.length] || '')) return true;
      }
      return false;
    };
    // "group" is a marker for group-hover variants and may have no rule of its own.
    const missing = [...classes].filter((c) => c !== 'group' && !has(c));
    if (missing.length) warn(`classes not in ${cssHref}: ${missing.join(', ')} (use class names the React sections already use)`);
  } else {
    warn('could not find the built stylesheet to check class names');
  }
}

fs.writeFileSync(HOME, html);

const kb = (Buffer.byteLength(injected) / 1024).toFixed(1);
console.log(
  `[prerender] dist/index.html: ${myProjects.length} projects, ${hackathons.length} hackathons, ${Math.min(articles.length, WRITING_COUNT)} articles, ${workExperiences.length} roles (${kb} KB of HTML)${warnings ? `, ${warnings} warning(s)` : ''}`,
);
