// Static page generator. Runs after `vite build` and emits real HTML pages so search engines and
// LLM crawlers get full content without executing the React app:
//   /blog/<slug>/          every published article in content/articles/*.md
//   /blog/                 the article index
//   /blog/topics/[<tag>/]  one page per tag shared by 2+ articles, plus a topics index
//   /about/                content/pages/about.md
//   /resume/               content/pages/resume.md (web version of the resume PDF)
//   /projects/             src/constants/index.js + articles + content/pages/projects.md
//   /research/             content/pages/research.md (patent and papers, ScholarlyArticle data)
//   /hackathons/           content/pages/hackathons.md + articles (Event data per hackathon)
//   /uses/                 content/pages/uses.md + the stack tables of the articles
// It also rewrites dist/sitemap.xml (with image entries) and writes the RSS feed, llms.txt,
// llms-full.txt (the full text of the profile pages and every article) and /blog/index.json.
//
// Article frontmatter (all required unless noted):
//   title, description (<=160 chars), date (YYYY-MM-DD), slug, project, tags[]
//   optional: updated, repo, live, award, accent (hex), cover (/path), summary (1-2 sentence TL;DR)
//
// Diagrams: reference an SVG in public/blog/diagrams/ as a markdown image
// (`![caption](/blog/diagrams/name.svg)`) and it is inlined as a <figure>.

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import matter from 'gray-matter';
import { marked } from 'marked';
import { PERSON_ID, PERSON_URL, person } from './blog/person.mjs';
import { articleTags, buildTopics, tagSlug } from './blog/topics.mjs';
import { seriesFor } from './blog/series.mjs';
import { loadProjects } from './blog/projects.mjs';
import { ARTICLE_SCRIPT, ARTICLE_SCRIPT_HASH } from './blog/enhance.mjs';
import { loadHackathons } from './blog/hackathons.mjs';
import { loadUses } from './blog/uses.mjs';
import { markdownToText, inlineToText } from './blog/plaintext.mjs';

const ROOT = process.cwd();
const SRC = path.join(ROOT, 'content', 'articles');
const PAGES = path.join(ROOT, 'content', 'pages');
const DIST = path.join(ROOT, 'dist');
const OUT = path.join(DIST, 'blog');
const DIAGRAMS = path.join(ROOT, 'public', 'blog', 'diagrams');
const SITE = 'https://anirudhvasudevan.com';
const AUTHOR = 'Anirudh Vasudevan';
const DEFAULT_OG = `${SITE}/assets/og-image.png`;
const DEFAULT_ACCENT = '#7C9CFF';
const RESUME_PDF = '/assets/anirudh-vasudevan-resume.pdf';
// Paths under /blog/ that are not articles (so links to them are never mistaken for draft links).
const BLOG_RESERVED = new Set(['topics']);

const esc = (s = '') =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const slugify = (s) =>
  String(s).toLowerCase().replace(/<[^>]+>/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const fmtDate = (iso) =>
  new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
const fmtMonth = (iso) => new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-US', { year: 'numeric', month: 'long' });
// YAML `date: 2026-09-27` arrives as a Date (UTC midnight); strings pass through.
const isoDay = (v) => (v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10));
const isExternal = (href) => /^https?:\/\//.test(href) && !href.startsWith(SITE);
const extAttrs = (href) => (isExternal(href) ? ' target="_blank" rel="noopener noreferrer"' : '');
// JSON-LD in a <script>: escape "<" so a string can never close the tag.
const ld = (o) => `<script type="application/ld+json">${JSON.stringify(o).replace(/</g, '\\u003c')}</script>`;
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const andList = (items) => (items.length > 1 ? `${items.slice(0, -1).join(', ')} and ${items.at(-1)}` : items[0] || '');
// Undo the HTML escaping marked applies to inline text (for plain-text uses such as the TOC).
const decodeEntities = (s) =>
  String(s)
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&');
// Markdown-safe text for llms.txt list items: one line, brackets escaped.
const mdText = (s) => String(s ?? '').replace(/\s+/g, ' ').replace(/[[\]]/g, '\\$&').trim();
// The author/publisher everywhere points at the one Person node (same @id and url on every page).
const PERSON_REF = { '@type': 'Person', '@id': PERSON_ID, name: AUTHOR, url: PERSON_URL };
const TODAY = new Date().toISOString().slice(0, 10);
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const maxDay = (...days) => days.filter((d) => DAY.test(d || '')).sort().at(-1);
// Last day any of these paths changed: today if they have uncommitted edits, else the last commit
// that touched them. Falls back to today when git is unavailable (e.g. a tarball build).
const gitDay = (...paths) => {
  try {
    const run = (args) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    if (run(['status', '--porcelain', '--', ...paths])) return TODAY;
    const day = run(['log', '-1', '--format=%cs', '--', ...paths]);
    return DAY.test(day) ? day : TODAY;
  } catch {
    return TODAY;
  }
};

const warned = new Set();
const warn = (msg) => {
  if (warned.has(msg)) return;
  warned.add(msg);
  console.warn(`[blog] ${msg}`);
};

// ---------- load articles ----------
if (!fs.existsSync(DIST)) {
  console.error('[blog] dist/ not found — run `vite build` first');
  process.exit(1);
}

const REQUIRED = ['title', 'description', 'date', 'slug', 'project', 'tags'];
// A missing articles folder is not fatal: /about/, /resume/, /projects/, the sitemap, llms.txt and
// blog.css (which public/404.html uses) are still built.
if (!fs.existsSync(SRC)) warn('no content/articles directory; building the other pages without articles');
const articles = (fs.existsSync(SRC) ? fs.readdirSync(SRC) : [])
  .filter((f) => f.endsWith('.md'))
  .sort() // readdir order differs between macOS and Linux; keep builds identical everywhere
  .map((file) => {
    const raw = fs.readFileSync(path.join(SRC, file), 'utf8');
    const { data, content } = matter(raw);
    for (const k of REQUIRED) {
      if (data[k] === undefined || data[k] === null || data[k] === '') {
        throw new Error(`[blog] ${file}: missing frontmatter field "${k}"`);
      }
    }
    if (data.description.length > 170) {
      warn(`${file}: description is ${data.description.length} chars (aim for <=160)`);
    }
    if (data.draft) return null;
    const words = content.split(/\s+/).filter(Boolean).length;
    // Per-article share image, generated locally by scripts/gen-og.py and committed.
    const ogFile = path.join(ROOT, 'public', 'blog', 'og', `${data.slug}.png`);
    const cover = data.cover || (fs.existsSync(ogFile) ? `/blog/og/${data.slug}.png` : undefined);
    return {
      ...data,
      cover,
      date: isoDay(data.date),
      updated: data.updated ? isoDay(data.updated) : undefined,
      accent: data.accent || DEFAULT_ACCENT,
      tags: Array.isArray(data.tags) ? data.tags : String(data.tags).split(',').map((t) => t.trim()),
      content,
      file,
      readingMinutes: Math.max(1, Math.round(words / 230)),
      words,
    };
  })
  .filter(Boolean)
  .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : a.slug.localeCompare(b.slug)));

const PUBLISHED = new Set(articles.map((a) => a.slug));
const BY_SLUG = new Map(articles.map((a) => [a.slug, a]));
const slugs = new Set();
for (const a of articles) {
  if (slugs.has(a.slug)) throw new Error(`[blog] duplicate slug "${a.slug}"`);
  if (BLOG_RESERVED.has(a.slug)) throw new Error(`[blog] slug "${a.slug}" is reserved`);
  slugs.add(a.slug);
}

const TOPICS = buildTopics(articles);
const TOPIC_SLUGS = new Set(TOPICS.map((t) => t.slug));
const topicHref = (slug) => `/blog/topics/${slug}/`;
const updatedOf = (list) => list.reduce((max, a) => ((a.updated || a.date) > max ? a.updated || a.date : max), '');

// A link to /blog/<slug>/ whose article is still a draft (or does not exist) would 404. The href
// is resolved against the page it appears on, so absolute (https://anirudhvasudevan.com/blog/x/),
// relative (../x/), no-trailing-slash, query-string and mixed-case forms are all caught.
const SITE_HOSTS = new Set([new URL(SITE).host, `www.${new URL(SITE).host}`]);
const isDraftLink = (href, base = `${SITE}/`) => {
  if (!href || href.startsWith('#')) return false;
  let u;
  try {
    u = new URL(href, base);
  } catch {
    return false;
  }
  if (!/^https?:$/.test(u.protocol) || !SITE_HOSTS.has(u.host)) return false;
  const m = /^\/blog\/([^/.]+)\/?$/i.exec(u.pathname);
  if (!m) return false;
  const slug = decodeURIComponent(m[1]).toLowerCase();
  return !BLOG_RESERVED.has(slug) && !PUBLISHED.has(slug);
};
// Public URL of the page a markdown source renders to (used to resolve its relative links).
const pageBase = (src) => `${SITE}${src.route || (src.slug ? `/blog/${src.slug}/` : '/')}`;

const loadPage = (name) => {
  const file = path.join(PAGES, `${name}.md`);
  if (!fs.existsSync(file)) return null;
  const { data, content } = matter(fs.readFileSync(file, 'utf8'));
  const rel = `pages/${name}.md`;
  for (const k of ['title', 'description']) {
    if (!data[k] || typeof data[k] !== 'string') throw new Error(`[blog] ${rel}: missing frontmatter field "${k}"`);
  }
  const date = data.date === undefined ? '' : isoDay(data.date);
  if (!DAY.test(date)) throw new Error(`[blog] ${rel}: "date" must be YYYY-MM-DD (got ${JSON.stringify(data.date)})`);
  const updated = data.updated === undefined ? undefined : isoDay(data.updated);
  if (updated !== undefined && !DAY.test(updated)) throw new Error(`[blog] ${rel}: "updated" must be YYYY-MM-DD`);
  // Last real change: the newest of date, updated and the file's own git history.
  const modified = maxDay(date, updated, gitDay(path.relative(ROOT, file)));
  return { ...data, date, updated, modified, content, file: rel, route: `/${name}/`, tags: [] };
};

// ---------- markdown rendering ----------
// Mermaid SVGs reuse generic ids (actor0, root-4, arrowhead...) and two diagrams on one page would
// clash. Namespace every id with the figure's own prefix and rewrite the references to it
// (url(#..), href="#..", aria-*by, and #id selectors in the embedded <style>). `base` is the root
// id render-diagrams.sh gives the file (d-<name>); ids already under it keep their name, unless the
// same diagram appears twice on the page, in which case `root` is d-<name>-2 and so on.
function uniqueSvgIds(svg, base, root) {
  const ids = new Map();
  let dup = 0;
  const rename = (id) =>
    id === base ? root : id.startsWith(`${base}-`) ? root + id.slice(base.length) : `${root}-${id}`;
  let out = svg.replace(/(\s)id="([^"]+)"/g, (m, sp, id) => {
    let next = rename(id);
    if (ids.has(id)) next = `${next}-dup${(dup += 1)}`;
    else ids.set(id, next);
    return `${sp}id="${next}"`;
  });
  const ref = (id) => ids.get(id) ?? id;
  out = out.replace(/(<style[^>]*>)([\s\S]*?)(<\/style>)/g, (m, open, css, close) =>
    `${open}${css.replace(/#([A-Za-z_][\w-]*)/g, (h, id) => (ids.has(id) ? `#${ids.get(id)}` : h))}${close}`,
  );
  // Outside <style>: url(#id), (xlink:)href="#id" and aria id lists.
  return out.replace(/(<style[^>]*>[\s\S]*?<\/style>)|url\(\s*#([^)\s]+)\s*\)|((?:xlink:)?href)="#([^"]+)"|(aria-(?:labelledby|describedby|controls|owns))="([^"]+)"/g,
    (m, style, urlId, hrefAttr, hrefId, ariaAttr, ariaIds) => {
      if (style) return style;
      if (urlId) return `url(#${ref(urlId)})`;
      if (hrefAttr) return `${hrefAttr}="#${ref(hrefId)}"`;
      return `${ariaAttr}="${ariaIds.split(/\s+/).map(ref).join(' ')}"`;
    },
  );
}

function makeRenderer(article, toc) {
  const renderer = new marked.Renderer();
  const base = pageBase(article);
  const figures = new Map(); // diagram name -> times inlined on this page

  renderer.heading = ({ tokens, depth }) => {
    const text = renderer.parser.parseInline(tokens);
    // parseInline returns escaped HTML; the TOC and the id use the decoded plain text (escaped once later).
    const plainText = decodeEntities(text.replace(/<[^>]+>/g, '')).trim();
    const id = slugify(plainText);
    if (depth === 2) toc.push({ id, text: plainText });
    return `<h${depth} id="${id}"><a class="anchor" href="#${id}" aria-hidden="true" tabindex="-1">#</a>${text}</h${depth}>\n`;
  };

  renderer.link = ({ href, title, tokens }) => {
    const text = renderer.parser.parseInline(tokens);
    // Never link to an article that is still a draft (it would 404); keep the words, drop the link.
    if (isDraftLink(href, base)) {
      warn(`${article.file}: unlinked draft reference ${href}`);
      return text;
    }
    return `<a href="${esc(href)}"${title ? ` title="${esc(title)}"` : ''}${extAttrs(href)}>${text}</a>`;
  };

  renderer.image = ({ href, title, text }) => {
    if (href.startsWith('/blog/diagrams/') && href.endsWith('.svg')) {
      const file = path.join(DIAGRAMS, path.basename(href));
      if (!fs.existsSync(file)) {
        warn(`${article.file}: diagram not found: ${href}`);
        return `<figure class="diagram diagram--missing"><figcaption>${esc(text)}</figcaption></figure>`;
      }
      const name = path.basename(href, '.svg');
      const n = (figures.get(name) || 0) + 1;
      figures.set(name, n);
      const svg = uniqueSvgIds(
        fs.readFileSync(file, 'utf8').replace(/<\?xml[^>]*\?>/, ''),
        `d-${name}`,
        n > 1 ? `d-${name}-${n}` : `d-${name}`,
      ).replace(/<svg /, '<svg role="img" ');
      return `<figure class="diagram"><div class="diagram__canvas">${svg}</div>${
        text ? `<figcaption>${esc(text)}</figcaption>` : ''
      }</figure>`;
    }
    return `<figure class="image"><img src="${esc(href)}" alt="${esc(text)}" loading="lazy" decoding="async"${
      title ? ` title="${esc(title)}"` : ''
    } />${title ? `<figcaption>${esc(title)}</figcaption>` : ''}</figure>`;
  };

  // Code blocks get a wrapper so the copy button (added by the inline script) sits in a header bar
  // instead of over the first line of code.
  renderer.code = ({ text, lang }) => {
    const language = String(lang || '').trim().split(/\s+/)[0];
    const cls = language ? ` class="language-${esc(language)}"` : '';
    const bar = language ? `<div class="code__bar"><span class="code__lang">${esc(language)}</span></div>` : '';
    return `<div class="code">${bar}<pre><code${cls}>${esc(text)}</code></pre></div>\n`;
  };

  renderer.table = ({ header, rows }) => {
    const cell = (c, tag) =>
      `<${tag}${c.align ? ` style="text-align:${c.align}"` : ''}>${renderer.parser.parseInline(c.tokens)}</${tag}>`;
    const head = `<tr>${header.map((c) => cell(c, 'th')).join('')}</tr>`;
    const body = rows.map((r) => `<tr>${r.map((c) => cell(c, 'td')).join('')}</tr>`).join('');
    return `<div class="table-wrap"><table><thead>${head}</thead><tbody>${body}</tbody></table></div>\n`;
  };

  return renderer;
}

// Inline Markdown (bold, italics, links) for short strings that live in page frontmatter.
const inlineMd = (md, src) => marked.parseInline(String(md ?? ''), { renderer: makeRenderer(src, []) });

// Pull "## FAQ" → "### question" / answer paragraphs out of the markdown so they can be
// emitted as FAQPage structured data (search engines and LLM crawlers read it directly).
// The answer text is built from marked's tokens (not regexes), so it matches the rendered page
// exactly: markup is dropped, but underscores in identifiers like has_voted or code spans survive.
const tokenText = (tokens = []) =>
  tokens
    .map((t) => {
      if (t.type === 'list') return t.items.map((i) => tokenText(i.tokens)).join(' ');
      if (t.type === 'html') return ''; // raw HTML tags are not visible text
      if (t.type === 'br' || t.type === 'space') return ' ';
      if (t.type === 'image') return t.text || '';
      if (t.tokens) return `${tokenText(t.tokens)}${t.type === 'paragraph' ? ' ' : ''}`;
      return t.text ?? '';
    })
    .join('');
const plain = (tokens) => tokenText(tokens).replace(/\s+/g, ' ').trim();

function extractFaq(content) {
  const tokens = marked.lexer(content);
  const faqs = [];
  let inFaq = false;
  let current = null;
  for (const t of tokens) {
    if (t.type === 'heading' && t.depth <= 2) {
      inFaq = t.depth === 2 && /^(faq|frequently asked questions?)$/i.test(t.text.trim());
      current = null;
      continue;
    }
    if (!inFaq) continue;
    if (t.type === 'heading' && t.depth === 3) {
      current = { question: plain(t.tokens), answer: '' };
      faqs.push(current);
    } else if (current && (t.type === 'paragraph' || t.type === 'list')) {
      const text = plain([t]);
      current.answer = `${current.answer} ${text}`.trim();
    }
  }
  return faqs.filter((f) => f.question && f.answer);
}

function renderMarkdown(article) {
  const toc = [];
  const html = marked.parse(article.content, {
    renderer: makeRenderer(article, toc),
    gfm: true,
    breaks: false,
  });
  return { html, toc, faqs: extractFaq(article.content) };
}

// ---------- shared templates ----------
const head = ({ title, description, url, ogImage = DEFAULT_OG, ogType = 'website', extra = '' }) => `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${esc(title)}</title>
    <meta name="description" content="${esc(description)}" />
    <meta name="author" content="${AUTHOR}" />
    <meta name="robots" content="index, follow, max-image-preview:large" />
    <meta name="theme-color" content="#0a0a0a" />
    <link rel="canonical" href="${url}" />
    <link rel="icon" href="/favicon.ico" sizes="any" />
    <link rel="icon" type="image/png" sizes="96x96" href="/icon-96.png" />
    <link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png" />
    <link rel="manifest" href="/site.webmanifest" />
    <link rel="alternate" type="application/rss+xml" title="${AUTHOR} | Writing" href="${SITE}/blog/feed.xml" />
    <meta property="og:type" content="${ogType}" />
    <meta property="og:url" content="${url}" />
    <meta property="og:title" content="${esc(title)}" />
    <meta property="og:description" content="${esc(description)}" />
    <meta property="og:image" content="${ogImage}" />
    <meta property="og:image:width" content="1200" />
    <meta property="og:image:height" content="630" />
    <meta property="og:site_name" content="${AUTHOR}" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${esc(title)}" />
    <meta name="twitter:description" content="${esc(description)}" />
    <meta name="twitter:image" content="${ogImage}" />
    <link rel="preconnect" href="https://fonts.cdnfonts.com" crossorigin />
    <link rel="preload" as="font" type="font/woff" href="https://fonts.cdnfonts.com/s/85793/GeneralSans-Regular.woff" crossorigin />
    <link rel="stylesheet" href="/blog/blog.css" />
    ${extra}
  </head>`;

// The three .topbar__extra links only show where the whole nav still fits on one row (see blog.css);
// on narrower screens they are left to the footer, so the header never grows a second row.
const siteNav = (current) => {
  const cur = (k) => (current === k ? ' aria-current="page"' : '');
  return `
    <header class="topbar">
      <div class="topbar__inner">
        <a class="topbar__home" href="/">Anirudh's Website &lt;/&gt;</a>
        <nav class="topbar__nav" aria-label="Site">
          <a href="/">Home</a>
          <a href="/about/"${cur('about')}>About</a>
          <a href="/projects/"${cur('projects')}>Projects</a>
          <a class="topbar__extra" href="/hackathons/"${cur('hackathons')}>Hackathons</a>
          <a class="topbar__extra" href="/research/"${cur('research')}>Research</a>
          <a href="/blog/"${cur('blog')}>Writing</a>
          <a class="topbar__extra" href="/uses/"${cur('uses')}>Uses</a>
          <a href="/resume/"${cur('resume')}>Resume</a>
          <a href="/#contact">Contact</a>
        </nav>
      </div>
    </header>`;
};

const siteFooter = () => `
    <footer class="sitefoot">
      <p>© ${new Date().getFullYear()} <a href="/about/">${AUTHOR}</a>. Full-stack &amp; AI engineer in San Francisco.</p>
      <p class="sitefoot__links">
        <a href="/about/">About</a>
        <a href="/projects/">Projects</a>
        <a href="/blog/">Writing</a>
        <a href="/resume/">Resume</a>
        <a href="/hackathons/">Hackathons</a>
        <a href="/research/">Research</a>
        <a href="/uses/">Uses</a>
        <a href="https://github.com/anirxdh" target="_blank" rel="noopener noreferrer">GitHub</a>
        <a href="https://www.linkedin.com/in/anirudhvasudev/" target="_blank" rel="noopener noreferrer">LinkedIn</a>
        <a href="/blog/feed.xml">RSS</a>
      </p>
    </footer>`;

// One page = head + nav + main + footer. `after` goes right before </body> (inline scripts).
const shell = ({ headOpts, nav, main, bodyClass = 'index-body', bodyStyle = '', skipLabel = 'Skip to content', after = '' }) => `${head(headOpts)}
  <body class="${bodyClass}"${bodyStyle ? ` style="${bodyStyle}"` : ''}>
    <a class="skip" href="#content">${skipLabel}</a>
    <div class="glow" aria-hidden="true"></div>
    ${siteNav(nav)}
    ${main}
    ${siteFooter()}${after}
  </body>
</html>
`;

// [{ name, href }] → a visible breadcrumb trail and the matching BreadcrumbList.
const crumbs = (items) => `<nav class="crumbs" aria-label="Breadcrumb"><ol>${items
  .map((it, i) =>
    i === items.length - 1 ? `<li><span aria-current="page">${esc(it.name)}</span></li>` : `<li><a href="${it.href}">${esc(it.name)}</a></li>`,
  )
  .join('')}</ol></nav>`;
const breadcrumbLd = (items) => ({
  '@context': 'https://schema.org',
  '@type': 'BreadcrumbList',
  itemListElement: items.map((it, i) => ({ '@type': 'ListItem', position: i + 1, name: it.name, item: SITE + it.href })),
});

const tocBlock = (toc) =>
  toc.length > 2
    ? `<aside class="toc" aria-label="On this page"><p class="toc__title">On this page</p><ol>${toc
        .map((t) => `<li><a href="#${t.id}">${esc(t.text)}</a></li>`)
        .join('')}</ol></aside>`
    : '';

const faqLd = (faqs) =>
  faqs.length
    ? {
        '@context': 'https://schema.org',
        '@type': 'FAQPage',
        mainEntity: faqs.map((f) => ({
          '@type': 'Question',
          name: f.question,
          acceptedAnswer: { '@type': 'Answer', text: f.answer },
        })),
      }
    : null;

const authorBox = () => `
      <aside class="author" aria-label="About the author">
        <img src="/assets/anirudh-avatar.png" alt="Anirudh Vasudevan" width="56" height="56" loading="lazy" />
        <div>
          <p class="author__name"><a href="/about/">Anirudh Vasudevan</a></p>
          <p class="author__bio">Full-stack and AI engineer in San Francisco. Member of Technical Staff at Rivo, building production voice AI agents. <a href="/hackathons/">5x hackathon winner</a>, <a href="/research/">granted patent, EMNLP author</a>.</p>
        </div>
      </aside>`;

const articleCard = (a) => `
        <a class="card" href="/blog/${a.slug}/" style="--accent:${a.accent}">
          <p class="card__eyebrow">${a.award ? `<span class="badge">${esc(a.award)}</span>` : ''}<span>${esc(a.project)}</span></p>
          <h3 class="card__title">${esc(a.title)}</h3>
          <p class="card__desc">${esc(a.description)}</p>
          <p class="card__meta"><time datetime="${a.date}">${fmtDate(a.date)}</time> · ${a.readingMinutes} min read</p>
        </a>`;

const chipCount = (n) => `<span class="chip__count">${n}<span class="sr-only"> ${n === 1 ? 'article' : 'articles'}</span></span>`;
const topicChip = (t) => `<a class="chip" href="${topicHref(t.slug)}">${esc(t.name)} ${chipCount(t.articles.length)}</a>`;

// Tag chips under an article: linked when the tag has a topic page.
const tagList = (a) =>
  `<p class="tags">${articleTags(a)
    .map((t) => (TOPIC_SLUGS.has(t.slug) ? `<a href="${topicHref(t.slug)}" rel="tag">${esc(t.name)}</a>` : `<span>${esc(t.name)}</span>`))
    .join('')}</p>`;

// ---------- article ----------
const seriesBox = (s, current) => `
        <nav class="series" aria-label="${esc(s.series.name)}">
          <p class="series__title">Part of <strong>${esc(s.series.name)}</strong></p>
          ${s.series.blurb ? `<p class="series__blurb">${esc(s.series.blurb)}</p>` : ''}
          <ol class="series__list">${s.parts
            .map(({ label, article }) =>
              article.slug === current
                ? `<li><span class="series__item" aria-current="page"><span class="series__label">${esc(label)}</span><span>${esc(article.title)}</span><span class="series__here" aria-hidden="true">You are here</span></span></li>`
                : `<li><a class="series__item" href="/blog/${article.slug}/"><span class="series__label">${esc(label)}</span><span>${esc(article.title)}</span></a></li>`,
            )
            .join('')}</ol>
        </nav>`;

const pager = (prev, next) =>
  prev || next
    ? `<nav class="pager" aria-label="Previous and next article">${
        prev
          ? `<a class="pager__link pager__link--prev" href="/blog/${prev.slug}/" rel="prev"><span class="pager__dir">← Previous</span><span class="pager__title">${esc(prev.title)}</span></a>`
          : ''
      }${
        next
          ? `<a class="pager__link pager__link--next" href="/blog/${next.slug}/" rel="next"><span class="pager__dir">Next →</span><span class="pager__title">${esc(next.title)}</span></a>`
          : ''
      }</nav>`
    : '';

function articlePage(a, { html, toc, faqs }, { related, prev, next, series }) {
  const url = `${SITE}/blog/${a.slug}/`;
  const ogImage = a.cover ? `${SITE}${a.cover}` : DEFAULT_OG;
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'BlogPosting',
    headline: a.title,
    description: a.description,
    datePublished: a.date,
    dateModified: a.updated || a.date,
    author: PERSON_REF,
    publisher: PERSON_REF,
    mainEntityOfPage: url,
    image: ogImage,
    keywords: a.tags.join(', '),
    wordCount: a.words,
    // codeRepository is not a BlogPosting property; the post is about the source code instead.
    ...(a.repo
      ? { about: { '@type': 'SoftwareSourceCode', name: String(a.project), codeRepository: a.repo, author: { '@id': PERSON_ID } } }
      : {}),
    ...(series ? { isPartOf: { '@type': 'CreativeWorkSeries', name: series.series.name } } : {}),
  };
  const breadcrumbs = breadcrumbLd([
    { name: 'Home', href: '/' },
    { name: 'Writing', href: '/blog/' },
    { name: a.title, href: `/blog/${a.slug}/` },
  ]);
  const extra = [jsonLd, breadcrumbs, faqLd(faqs)].filter(Boolean).map(ld).join('\n    ');

  return shell({
    headOpts: { title: `${a.title} | ${AUTHOR}`, description: a.description, url, ogImage, ogType: 'article', extra },
    nav: 'blog',
    bodyClass: 'article-body',
    bodyStyle: `--accent:${a.accent}`,
    skipLabel: 'Skip to article',
    after: `\n    <script>${ARTICLE_SCRIPT}</script>`,
    main: `<main id="content" class="article">
      <header class="article__head">
        <p class="eyebrow">
          ${a.award ? `<span class="badge">${esc(a.award)}</span>` : ''}
          <span>${esc(a.project)}</span>
          <span class="dot">·</span>
          <time datetime="${a.date}">${fmtDate(a.date)}</time>
          <span class="dot">·</span>
          <span>${a.readingMinutes} min read</span>
        </p>
        <h1>${esc(a.title)}</h1>
        <p class="standfirst">${esc(a.description)}</p>
        ${
          a.repo || a.live
            ? `<p class="links">${
                a.live ? `<a class="pill" href="${esc(a.live)}"${extAttrs(a.live)}>Live demo ↗</a>` : ''
              }${a.repo ? `<a class="pill" href="${esc(a.repo)}"${extAttrs(a.repo)}>Source on GitHub ↗</a>` : ''}</p>`
            : ''
        }
        ${a.summary ? `<div class="tldr"><strong>TL;DR</strong> ${esc(a.summary)}</div>` : ''}
        ${series ? seriesBox(series, a.slug) : ''}
      </header>

      <div class="article__layout">
        ${tocBlock(toc)}
        <article class="prose">
          ${html}
          ${tagList(a)}
          ${authorBox()}
        </article>
      </div>

      ${pager(prev, next)}

      ${
        related.length
          ? `<section class="related" aria-labelledby="related-title">
        <h2 id="related-title">More writing</h2>
        <div class="cards">${related.map(articleCard).join('')}</div>
      </section>`
          : ''
      }
    </main>`,
  });
}

// ---------- about ----------
function profilePage(page, { html, toc, faqs }) {
  const url = `${SITE}/about/`;
  const profileLd = {
    '@context': 'https://schema.org',
    '@type': 'ProfilePage',
    url,
    name: page.title,
    description: page.description,
    dateModified: page.modified,
    mainEntity: person({ mainEntityOfPage: url }),
    // The other pages about him, so a crawler that lands here finds the whole record.
    relatedLink: ['/resume/', '/projects/', '/hackathons/', '/research/', '/uses/', '/blog/'].map((p) => SITE + p),
  };
  const breadcrumbs = breadcrumbLd([
    { name: 'Home', href: '/' },
    { name: 'About', href: '/about/' },
  ]);
  const extra = [profileLd, breadcrumbs, faqLd(faqs)].filter(Boolean).map(ld).join('\n    ');
  return shell({
    // The title comes from about.md and is kept distinct from the homepage title.
    headOpts: { title: page.title, description: page.description, url, ogType: 'profile', extra },
    nav: 'about',
    bodyClass: 'article-body profile-body',
    main: `<main id="content" class="article">
      <header class="article__head profile__head">
        <img class="profile__avatar" src="/assets/anirudh-avatar.png" alt="Anirudh Vasudevan" width="96" height="96" />
        <div>
          <p class="eyebrow"><span>About</span><span class="dot">·</span><span>San Francisco</span></p>
          <h1>Anirudh Vasudevan</h1>
          <p class="standfirst">Full-stack and AI engineer. Member of Technical Staff at Rivo. 5x hackathon winner, granted patent, EMNLP author.</p>
          <p class="links">
            <a class="pill" href="/resume/">Resume</a>
            <a class="pill" href="/projects/">Projects</a>
            <a class="pill" href="https://www.linkedin.com/in/anirudhvasudev/" target="_blank" rel="noopener noreferrer">LinkedIn ↗</a>
            <a class="pill" href="https://github.com/anirxdh" target="_blank" rel="noopener noreferrer">GitHub ↗</a>
            <a class="pill" href="/#contact">Contact</a>
          </p>
        </div>
      </header>
      <div class="article__layout">
        ${tocBlock(toc)}
        <article class="prose">
          ${html}
        </article>
      </div>
    </main>`,
  });
}

// ---------- blog index ----------
function indexPage(list) {
  const url = `${SITE}/blog/`;
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Blog',
    name: `${AUTHOR} | Writing`,
    url,
    author: PERSON_REF,
    blogPost: list.map((a) => ({
      '@type': 'BlogPosting',
      headline: a.title,
      url: `${SITE}/blog/${a.slug}/`,
      datePublished: a.date,
    })),
  };
  const [featured, ...rest] = list;
  const topTopics = TOPICS.slice(0, 10);
  return shell({
    headOpts: {
      title: `Writing | ${AUTHOR}`,
      description:
        'Deep dives into the AI products, voice agents, and hackathon builds Anirudh Vasudevan shipped: architecture, decisions, and what actually worked.',
      url,
      extra: ld(jsonLd),
    },
    nav: 'blog',
    main: `<main id="content" class="index">
      <header class="index__head">
        <p class="eyebrow"><span>Writing</span><span class="dot">·</span><span>${plural(list.length, 'article')}</span></p>
        <h1>How I built the things I built.</h1>
        <p class="standfirst">Architecture, trade-offs, and the honest story behind each project: the hackathon wins, the products, and the experiments.</p>
      </header>
      ${
        topTopics.length
          ? `<nav class="topics-row" aria-label="Browse by topic">${topTopics.map((t) => topicChip(t)).join('')}<a class="chip chip--more" href="/blog/topics/">All topics →</a></nav>`
          : ''
      }
      ${
        featured
          ? `<section class="featured" aria-label="Latest article">${articleCard(featured).replace('class="card"', 'class="card card--featured"')}</section>`
          : ''
      }
      ${rest.length ? `<section class="cards" aria-label="All articles">${rest.map(articleCard).join('')}</section>` : ''}
    </main>`,
  });
}

// ---------- topics ----------
const projectNames = (list) => [...new Set(list.map((a) => String(a.project).replace(/\s*\([^)]*\)\s*$/, '')))];

function topicDescription(t) {
  const names = projectNames(t.articles);
  const lead = `${plural(t.articles.length, 'project write-up')} by ${AUTHOR} tagged ${t.name}`;
  for (let n = Math.min(4, names.length); n >= 1; n -= 1) {
    const text = `${lead}, ${n === names.length ? 'covering' : 'including'} ${andList(names.slice(0, n))}.`;
    if (text.length <= 160) return text;
  }
  return `${lead}.`;
}

function topicPage(t) {
  const href = topicHref(t.slug);
  const url = SITE + href;
  const description = topicDescription(t);
  const trail = [
    { name: 'Home', href: '/' },
    { name: 'Writing', href: '/blog/' },
    { name: 'Topics', href: '/blog/topics/' },
    { name: t.name, href },
  ];
  const collection = {
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    name: `${t.name} articles by ${AUTHOR}`,
    url,
    description,
    about: { '@type': 'Thing', name: t.name },
    isPartOf: { '@type': 'Blog', name: `${AUTHOR} | Writing`, url: `${SITE}/blog/` },
    author: { '@id': PERSON_ID },
    mainEntity: {
      '@type': 'ItemList',
      numberOfItems: t.articles.length,
      itemListElement: t.articles.map((a, i) => ({
        '@type': 'ListItem',
        position: i + 1,
        url: `${SITE}/blog/${a.slug}/`,
        name: a.title,
      })),
    },
  };
  const others = TOPICS.filter((o) => o.slug !== t.slug);
  return shell({
    headOpts: { title: `${t.name} articles | ${AUTHOR}`, description, url, extra: [collection, breadcrumbLd(trail)].map(ld).join('\n    ') },
    nav: 'blog',
    main: `<main id="content" class="index">
      ${crumbs(trail.slice(1))}
      <header class="index__head">
        <p class="eyebrow"><span>Topic</span><span class="dot">·</span><span>${plural(t.articles.length, 'article')}</span></p>
        <h1>${esc(t.name)}</h1>
        <p class="standfirst">Every project write-up tagged ${esc(t.name)}.</p>
      </header>
      <section class="cards" aria-label="Articles tagged ${esc(t.name)}">${t.articles.map(articleCard).join('')}</section>
      ${
        others.length
          ? `<section class="more-topics" aria-labelledby="more-topics-title">
        <h2 id="more-topics-title" class="section-title">Other topics</h2>
        <nav class="topics-row" aria-label="Other topics">${others.map((o) => topicChip(o)).join('')}</nav>
      </section>`
          : ''
      }
    </main>`,
  });
}

function topicsIndexPage() {
  const url = `${SITE}/blog/topics/`;
  const trail = [
    { name: 'Home', href: '/' },
    { name: 'Writing', href: '/blog/' },
    { name: 'Topics', href: '/blog/topics/' },
  ];
  const description = `${AUTHOR}'s project write-ups grouped by topic, including ${andList(TOPICS.slice(0, 5).map((t) => t.name))}.`;
  const collection = {
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    name: `Writing by topic | ${AUTHOR}`,
    url,
    description,
    isPartOf: { '@type': 'Blog', name: `${AUTHOR} | Writing`, url: `${SITE}/blog/` },
    mainEntity: {
      '@type': 'ItemList',
      numberOfItems: TOPICS.length,
      itemListElement: TOPICS.map((t, i) => ({ '@type': 'ListItem', position: i + 1, url: SITE + topicHref(t.slug), name: t.name })),
    },
  };
  const topicCard = (t) => `
        <a class="card" href="${topicHref(t.slug)}">
          <p class="card__eyebrow"><span>${plural(t.articles.length, 'article')}</span></p>
          <h3 class="card__title">${esc(t.name)}</h3>
          <p class="card__desc">${esc(projectNames(t.articles).join(', '))}</p>
        </a>`;
  return shell({
    headOpts: { title: `Writing by topic | ${AUTHOR}`, description, url, extra: [collection, breadcrumbLd(trail)].map(ld).join('\n    ') },
    nav: 'blog',
    main: `<main id="content" class="index">
      ${crumbs(trail.slice(1))}
      <header class="index__head">
        <p class="eyebrow"><span>Writing</span><span class="dot">·</span><span>${plural(TOPICS.length, 'topic')}</span></p>
        <h1>Writing by topic.</h1>
        <p class="standfirst">Every topic that at least two articles share. Pick one to read those articles side by side.</p>
      </header>
      <section class="cards" aria-label="Topics">${TOPICS.map(topicCard).join('')}</section>
    </main>`,
  });
}

// ---------- resume-style blocks (/resume/, /research/) ----------
// Titled entries (title, place, role, dates, bullets, links) grouped in one card per section.
function rentryKit(src) {
  const inline = (md) => inlineMd(md, src);
  const link = (href, label) =>
    isDraftLink(href, pageBase(src)) ? '' : `<a href="${esc(href)}"${extAttrs(href)}>${esc(label)}${isExternal(href) ? ' ↗' : ''}</a>`;
  const entry = ({ id, title, href, where, role, note, when, bullets = [], links = [] }) => {
    const linkRow = links.map((l) => link(l.url, l.label)).filter(Boolean);
    return `
          <article class="rentry"${id ? ` id="${esc(id)}"` : ''}>
            <div class="rentry__head">
              <h3 class="rentry__title">${href ? `<a href="${esc(href)}"${extAttrs(href)}>${esc(title)}</a>` : esc(title)}</h3>
              ${where ? `<p class="rentry__where">${esc(where)}</p>` : ''}
              ${role ? `<p class="rentry__role">${esc(role)}${note ? ` <span class="rentry__note">${esc(note)}</span>` : ''}</p>` : ''}
              ${when ? `<p class="rentry__when">${esc(when)}</p>` : ''}
            </div>
            ${bullets.length ? `<ul class="rentry__list">${bullets.map((b) => `<li>${inline(b)}</li>`).join('')}</ul>` : ''}
            ${linkRow.length ? `<p class="rentry__links">${linkRow.join('')}</p>` : ''}
          </article>`;
  };
  const section = (id, title, body) =>
    body
      ? `
      <section class="rsec" aria-labelledby="${id}">
        <h2 id="${id}" class="rsec__title">${title}</h2>
        <div class="rsec__card">${body}
        </div>
      </section>`
      : '';
  return { inline, link, entry, section };
}

// ---------- resume ----------
function resumePage(r, pdfBytes) {
  const url = `${SITE}/resume/`;
  const pdf = r.pdf || RESUME_PDF;
  const { inline, link, entry, section } = rentryKit(r);

  const education = (r.education || [])
    .map((e) => entry({ title: e.school, where: e.location, role: e.degree, note: e.gpa ? `GPA ${e.gpa}` : '', when: e.dates }))
    .join('');
  const skills = (r.skills || []).length
    ? `
          <dl class="skills">${r.skills
            .map(
              (g) => `
            <div class="skills__row"><dt>${esc(g.group)}</dt><dd><ul class="chips">${(g.items || [])
              .map((s) => `<li>${esc(s)}</li>`)
              .join('')}</ul></dd></div>`,
            )
            .join('')}
          </dl>`
    : '';
  const experience = (r.experience || [])
    .map((x) => entry({ title: x.org, href: x.url, where: x.location, role: x.role, when: x.dates, bullets: x.bullets }))
    .join('');
  const projects = (r.projects || [])
    .map((p) => entry({ title: p.name, role: p.subtitle, bullets: p.bullets, links: p.links }))
    .join('');
  const achievements = (r.achievements || []).length
    ? `
          <ul class="rentry__list rentry__list--flush">${r.achievements.map((m) => `<li>${inline(m)}</li>`).join('')}</ul>`
    : '';

  const contact = [
    r.email ? `<a href="mailto:${esc(r.email)}">${esc(r.email)}</a>` : '',
    ...(r.links || []).map((l) => link(l.url, l.label)),
  ].filter(Boolean);
  const size = pdfBytes ? ` <span class="btn__meta">${Math.max(1, Math.round(pdfBytes / 1024))} KB</span>` : '';

  const credentials = (r.education || []).map((e) => ({
    '@type': 'EducationalOccupationalCredential',
    name: e.degree,
    credentialCategory: /^diploma/i.test(e.degree) ? 'diploma' : 'degree',
    recognizedBy: { '@type': 'CollegeOrUniversity', name: e.fullName || e.school },
  }));
  const profileLd = {
    '@context': 'https://schema.org',
    '@type': 'ProfilePage',
    url,
    name: `Resume of ${AUTHOR}`,
    description: r.description,
    dateModified: r.modified || maxDay(r.date, r.updated),
    mainEntity: person({ hasCredential: credentials }),
  };
  const trail = [
    { name: 'Home', href: '/' },
    { name: 'Resume', href: '/resume/' },
  ];
  const extra = `<link rel="alternate" type="application/pdf" href="${SITE}${pdf}" title="${AUTHOR} resume (PDF)" />
    ${[profileLd, breadcrumbLd(trail)].map(ld).join('\n    ')}`;

  return shell({
    headOpts: { title: `Resume | ${AUTHOR}`, description: r.description, url, ogType: 'profile', extra },
    nav: 'resume',
    bodyClass: 'index-body resume-body',
    main: `<main id="content" class="index resume">
      <header class="index__head resume__head">
        <p class="eyebrow"><span>Resume</span>${r.pronouns ? `<span class="dot">·</span><span>${esc(r.pronouns)}</span>` : ''}<span class="dot">·</span><span>Updated ${fmtMonth(r.modified || maxDay(r.date, r.updated))}</span></p>
        <h1>${esc(r.name || AUTHOR)}</h1>
        ${r.headline ? `<p class="standfirst">${esc(r.headline)}</p>` : ''}
        ${contact.length ? `<p class="resume__contact">${contact.join('')}</p>` : ''}
        <p class="resume__actions">
          <a class="btn" href="${pdf}" download="Anirudh-Vasudevan-Resume.pdf"><svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M5 21h14"/></svg>Download PDF${size}</a>
          <a class="pill" href="${pdf}" target="_blank" rel="noopener">Open the PDF ↗</a>
        </p>
      </header>
      <div class="resume__body">${section('education', 'Education', education)}${section('skills', 'Skills', skills)}${section(
        'experience',
        'Professional experience',
        experience,
      )}${section('projects', 'Project experience', projects)}${section('achievements', 'Patents, publications, and achievements', achievements)}
      </div>
    </main>`,
  });
}

// ---------- projects ----------
function projectCard(p) {
  const lead = p.articles[0]?.article;
  const titleHref = lead ? `/blog/${lead.slug}/` : p.live || p.repo;
  const links = [];
  if (p.live) links.push(`<a href="${esc(p.live)}"${extAttrs(p.live)}>${esc(p.liveLabel || 'Live site')}${isExternal(p.live) ? ' ↗' : ''}</a>`);
  if (p.repo) links.push(`<a href="${esc(p.repo)}"${extAttrs(p.repo)}>Source ↗</a>`);
  for (const { article, label } of p.articles) {
    const text = p.articles.length > 1 && label ? `Write-up (${label})` : 'Write-up';
    links.push(`<a href="/blog/${article.slug}/">${esc(text)}</a>`);
  }
  const tech = p.tech
    .map((name) => {
      const slug = tagSlug(name);
      return TOPIC_SLUGS.has(slug) ? `<li><a href="${topicHref(slug)}">${esc(name)}</a></li>` : `<li>${esc(name)}</li>`;
    })
    .join('');
  return `
        <article class="card pcard" id="${p.key}" style="--accent:${p.accent || DEFAULT_ACCENT}">
          ${p.award ? `<p class="card__eyebrow"><span class="badge">${esc(p.award)}</span></p>` : ''}
          <h3 class="card__title">${titleHref ? `<a href="${esc(titleHref)}"${extAttrs(titleHref)}>${esc(p.name)}</a>` : esc(p.name)}</h3>
          ${p.blurb ? `<p class="card__desc">${esc(p.blurb)}</p>` : ''}
          ${tech ? `<ul class="pcard__tech" aria-label="Built with">${tech}</ul>` : ''}
          ${links.length ? `<p class="pcard__links">${links.join('')}</p>` : ''}
        </article>`;
}

function projectsPage(page, projects) {
  const url = `${SITE}/projects/`;
  const wins = projects.filter((p) => p.hackathon);
  const rest = projects.filter((p) => !p.hackathon);
  const intro = page.content.trim() ? inlineMd(page.content.trim(), page) : '';
  const itemList = {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    name: `Projects by ${AUTHOR}`,
    url,
    description: page.description,
    numberOfItems: projects.length,
    itemListElement: projects.map((p, i) => {
      const lead = p.articles[0]?.article;
      const sameAs = [p.live, p.repo].filter((u) => u && isExternal(u));
      return {
        '@type': 'ListItem',
        position: i + 1,
        item: {
          '@type': 'CreativeWork',
          '@id': `${url}#${p.key}`,
          name: p.name,
          ...(p.blurb ? { description: p.blurb } : {}),
          url: lead ? `${SITE}/blog/${lead.slug}/` : p.live || `${url}#${p.key}`,
          creator: { '@id': PERSON_ID },
          ...(p.award ? { award: p.award } : {}),
          ...(p.tech.length ? { keywords: p.tech.join(', ') } : {}),
          ...(sameAs.length ? { sameAs } : {}),
          ...(p.articles.length
            ? { subjectOf: p.articles.map(({ article }) => ({ '@type': 'BlogPosting', headline: article.title, url: `${SITE}/blog/${article.slug}/` })) }
            : {}),
        },
      };
    }),
  };
  const trail = [
    { name: 'Home', href: '/' },
    { name: 'Projects', href: '/projects/' },
  ];
  const block = (id, title, list) =>
    list.length
      ? `
      <section class="psec" aria-labelledby="${id}">
        <h2 id="${id}" class="section-title">${title} <span class="section-title__count">${list.length}</span></h2>
        <div class="cards">${list.map(projectCard).join('')}</div>
      </section>`
      : '';
  return shell({
    headOpts: { title: `Projects | ${AUTHOR}`, description: page.description, url, extra: [itemList, breadcrumbLd(trail)].map(ld).join('\n    ') },
    nav: 'projects',
    main: `<main id="content" class="index">
      <header class="index__head">
        <p class="eyebrow"><span>Projects</span><span class="dot">·</span><span>${plural(projects.length, 'project')}</span></p>
        <h1>${esc(page.headline || 'Projects')}</h1>
        ${intro ? `<p class="standfirst">${intro}</p>` : ''}
      </header>${block('hackathon-wins', 'Hackathon wins', wins)}${block('more-projects', wins.length ? 'More projects' : 'Projects', rest)}
    </main>`,
  });
}

// ---------- shared bits for /research/, /hackathons/, /uses/ ----------
// Where a job named in `at:` is described ("At Rivo" links there).
const AT_LINKS = {
  Rivo: '/resume/#experience',
  Nonlinear: '/resume/#experience',
  'University of Minnesota': '/research/#research-experience',
};
const atLink = (name) => (AT_LINKS[name] ? `<a href="${AT_LINKS[name]}">${esc(name)}</a>` : esc(name));
const articleUrl = (a) => `${SITE}/blog/${a.slug}/`;
const blogPostingRef = (a) => ({ '@type': 'BlogPosting', headline: a.title, url: articleUrl(a) });
// Intro copy from a page's Markdown body (rendered with the article renderer, so draft links drop).
const pageIntro = (page) => (page.content.trim() ? renderMarkdown(page).html : '');
// "400-412" -> "400 to 412" (house style reads ranges with "to").
const pageRange = (p) => String(p).replace(/^(\d+)\s*-\s*(\d+)$/, '$1 to $2');

// ---------- research ----------
const paperAuthors = (p) => (p.authors?.length ? p.authors : [AUTHOR, ...(p.coauthors || [])]);
const personNode = (name) => (name === AUTHOR ? { '@id': PERSON_ID } : { '@type': 'Person', name });
const visiblePapers = (r) => (r.papers || []).filter((x) => !x.draft);

function researchLd(r, url) {
  const p = r.patent;
  const civs = p?.article && BY_SLUG.get(p.article);
  const patent = p && {
    '@type': 'CreativeWork',
    '@id': `${url}#${p.id || 'patent'}`,
    name: p.name,
    ...(p.filedAs ? { alternateName: p.filedAs } : {}),
    description: [
      `${p.status}.`,
      p.filedAs ? `Filed as "${p.filedAs}", ${p.numberLabel || 'application'} ${p.number}, ${p.when}.` : '',
      p.assignee ? `Assigned to ${p.assignee}.` : '',
      p.summary || '',
    ]
      .filter(Boolean)
      .join(' '),
    ...(p.number
      ? { identifier: { '@type': 'PropertyValue', propertyID: `${p.numberLabel || 'Patent application'} number`, value: String(p.number) } }
      : {}),
    creator: { '@id': PERSON_ID },
    ...(p.assignee ? { sourceOrganization: { '@type': 'CollegeOrUniversity', name: p.assignee } } : {}),
    url: `${url}#${p.id || 'patent'}`,
    ...(civs ? { subjectOf: blogPostingRef(civs) } : {}),
  };
  const papers = visiblePapers(r).map((x) => {
    const doiUrl = x.doi ? `https://doi.org/${x.doi}` : x.url;
    const description = [x.venue, x.coauthors?.length ? `With ${andList(x.coauthors)}` : ''].filter(Boolean).join('. ');
    return {
      '@type': 'ScholarlyArticle',
      '@id': `${url}#${x.id}`,
      headline: x.title,
      name: x.title,
      author: paperAuthors(x).map(personNode),
      ...(x.year ? { datePublished: String(x.year) } : {}),
      ...(description ? { description: `${description}.` } : {}),
      ...(x.book
        ? { isPartOf: { '@type': 'Book', name: x.book, ...(x.series ? { isPartOf: { '@type': 'BookSeries', name: x.series } } : {}) } }
        : x.series
          ? { isPartOf: { '@type': 'CreativeWorkSeries', name: x.series } }
          : {}),
      ...(x.publisher ? { publisher: { '@type': 'Organization', name: x.publisher } } : {}),
      ...(x.pages ? { pagination: String(x.pages) } : {}),
      ...(x.doi ? { identifier: { '@type': 'PropertyValue', propertyID: 'DOI', value: x.doi }, sameAs: doiUrl } : {}),
      url: doiUrl || `${url}#${x.id}`,
    };
  });
  return [patent, ...papers].filter(Boolean);
}

// Plain text of one paper's byline and source, shared by the page and llms-full.txt.
const paperByline = (x) => (x.authors?.length ? `By ${andList(x.authors)}.` : x.coauthors?.length ? `With ${andList(x.coauthors)}.` : '');
const paperSource = (x) =>
  x.book ? `In *${x.book}*${x.series ? ` (${x.series})` : ''}${x.pages ? `, pages ${pageRange(x.pages)}` : ''}.` : '';
const patentLines = (p) =>
  [
    p.filedAs ? `Filed as *${p.filedAs}*, ${p.numberLabel || 'application'} ${p.number}, ${p.when}.` : '',
    p.assignee ? `Assigned to ${p.assignee}.` : '',
    p.summary || '',
  ].filter(Boolean);

function researchPage(r) {
  const url = `${SITE}/research/`;
  const { entry, section, link } = rentryKit(r);
  const p = r.patent;
  const papers = visiblePapers(r);
  const patentBlock = p
    ? entry({ id: p.id || 'patent', title: p.name, role: p.status, when: p.when, bullets: patentLines(p), links: p.links || [] })
    : '';
  const paperBlocks = papers
    .map((x) => {
      const doiUrl = x.doi ? `https://doi.org/${x.doi}` : x.url;
      return entry({
        id: x.id,
        title: x.title,
        href: doiUrl,
        role: x.venue,
        when: x.when ? String(x.when) : '',
        bullets: [paperByline(x), paperSource(x), x.note].filter(Boolean),
        links: x.doi ? [{ url: doiUrl, label: `DOI ${x.doi}` }] : [],
      });
    })
    .join('');
  const experience = (r.experience || [])
    .map((x) => entry({ title: x.title, href: x.url, where: x.where, role: x.role, when: x.when, bullets: x.bullets || [], links: x.links || [] }))
    .join('');
  const profiles = (r.profiles || []).map((l) => link(l.url, l.label)).filter(Boolean);
  const intro = pageIntro(r);
  const works = researchLd(r, url);
  const trail = [
    { name: 'Home', href: '/' },
    { name: 'Research', href: '/research/' },
  ];
  const pageLd = {
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    name: `Patent and research by ${AUTHOR}`,
    url,
    description: r.description,
    dateModified: r.modified,
    about: { '@id': PERSON_ID },
    author: { '@id': PERSON_ID },
    mainEntity: {
      '@type': 'ItemList',
      numberOfItems: works.length,
      itemListElement: works.map((w, i) => ({ '@type': 'ListItem', position: i + 1, item: w })),
    },
  };
  const counts = [p ? plural(1, 'patent') : '', papers.length ? plural(papers.length, 'paper') : ''].filter(Boolean);
  return shell({
    headOpts: { title: `${r.title} | ${AUTHOR}`, description: r.description, url, extra: [pageLd, breadcrumbLd(trail)].map(ld).join('\n    ') },
    nav: 'research',
    bodyClass: 'index-body resume-body',
    main: `<main id="content" class="index resume">
      <header class="index__head resume__head">
        <p class="eyebrow"><span>Research</span>${counts.map((c) => `<span class="dot">·</span><span>${c}</span>`).join('')}</p>
        <h1>${esc(r.headline || r.title)}</h1>
        ${r.standfirst ? `<p class="standfirst">${esc(r.standfirst)}</p>` : ''}
        ${profiles.length ? `<p class="resume__contact">${profiles.join('')}</p>` : ''}
      </header>
      <div class="resume__body">
        ${intro ? `<div class="prose page-intro">${intro}</div>` : ''}${section('patent-title', 'Patent', patentBlock)}${section(
          'papers',
          'Papers',
          paperBlocks,
        )}${section('research-experience', 'Research experience', experience)}
      </div>
    </main>`,
  });
}

// ---------- hackathons ----------
const writeupLabel = (e, a) => (e.articles.length > 1 ? `Write-up (${String(a.project).match(/\(([^)]+)\)\s*$/)?.[1] || a.title})` : 'Write-up');
const hackLinks = (e) => {
  const links = e.articles.map((a) => `<a href="/blog/${a.slug}/">${esc(writeupLabel(e, a))}</a>`);
  if (e.live) links.push(`<a href="${esc(e.live)}"${extAttrs(e.live)}>${esc(e.liveLabel || 'Live demo')}${isExternal(e.live) ? ' ↗' : ''}</a>`);
  if (e.repo) links.push(`<a href="${esc(e.repo)}"${extAttrs(e.repo)}>Source ↗</a>`);
  return links;
};
const eventWhere = (e) => [e.place, e.online ? 'Online' : ''].filter(Boolean).join(', ');

function hackathonCard(e) {
  const lead = e.articles[0];
  const titleHref = lead ? `/blog/${lead.slug}/` : e.live || e.repo;
  const eventName = e.eventUrl ? `<a href="${esc(e.eventUrl)}"${extAttrs(e.eventUrl)}>${esc(e.event)}</a>` : esc(e.event);
  const where = eventWhere(e);
  const links = hackLinks(e);
  return `
        <article class="card pcard hcard" id="${esc(e.key)}" style="--accent:${e.accent || DEFAULT_ACCENT}">
          <p class="card__eyebrow"><span class="badge${e.entry ? ' badge--muted' : ''}">${esc(e.result)}</span><time datetime="${e.date}">${esc(e.when)}</time></p>
          <h3 class="card__title">${titleHref ? `<a href="${esc(titleHref)}"${extAttrs(titleHref)}>${esc(e.project)}</a>` : esc(e.project)}</h3>
          <p class="hcard__event">${eventName}${where ? `<span class="hcard__where">, ${esc(where)}</span>` : ''}</p>
          <p class="card__desc">${esc(e.built)}</p>
          ${e.note ? `<p class="card__desc hcard__note">${esc(e.note)}</p>` : ''}
          ${links.length ? `<p class="pcard__links">${links.join('')}</p>` : ''}
        </article>`;
}

function hackathonEventLd(e, url) {
  const lead = e.articles[0];
  const sameAs = [e.live, e.repo].filter((u) => u && isExternal(u));
  return {
    '@type': 'Event',
    '@id': `${url}#${e.key}`,
    name: e.event,
    startDate: e.date,
    ...(e.end ? { endDate: e.end } : {}),
    eventStatus: 'https://schema.org/EventScheduled',
    ...(e.online
      ? { eventAttendanceMode: 'https://schema.org/OnlineEventAttendanceMode', location: { '@type': 'VirtualLocation', name: 'Online' } }
      : e.place
        ? { eventAttendanceMode: 'https://schema.org/OfflineEventAttendanceMode', location: { '@type': 'Place', name: e.place } }
        : {}),
    ...(e.eventUrl ? { url: e.eventUrl } : {}),
    description: e.entry
      ? `${AUTHOR} entered ${e.project}. ${e.built} No placement is recorded.`
      : `Result: ${e.result}. ${AUTHOR} built ${e.project}. ${e.built}`,
    attendee: { '@id': PERSON_ID },
    workFeatured: {
      '@type': 'CreativeWork',
      name: e.project,
      url: lead ? articleUrl(lead) : e.live || `${url}#${e.key}`,
      description: e.built,
      creator: { '@id': PERSON_ID },
      ...(e.entry ? {} : { award: e.award || `${e.result}, ${e.event}` }),
      ...(sameAs.length ? { sameAs } : {}),
      ...(e.articles.length ? { subjectOf: e.articles.map(blogPostingRef) } : {}),
    },
  };
}

function hackathonsPage(page, sections) {
  const url = `${SITE}/hackathons/`;
  const all = sections.flatMap((s) => s.events);
  const wins = all.filter((e) => !e.entry);
  const seasons = sections.filter((s) => s.season);
  const intro = pageIntro(page);
  const trail = [
    { name: 'Home', href: '/' },
    { name: 'Hackathons', href: '/hackathons/' },
  ];
  const items = [];
  for (const s of sections) {
    if (s.season) {
      items.push({
        '@type': 'Event',
        '@id': `${url}#${s.id}`,
        name: s.season.name,
        eventStatus: 'https://schema.org/EventScheduled',
        description: `Result: ${s.season.result}. ${s.season.summary || s.season.text}`,
        attendee: { '@id': PERSON_ID },
      });
    }
    for (const e of s.events) items.push(hackathonEventLd(e, url));
  }
  const listLd = {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    name: `Hackathons ${AUTHOR} has competed in`,
    url,
    description: page.description,
    numberOfItems: items.length,
    itemListElement: items.map((item, i) => ({ '@type': 'ListItem', position: i + 1, item })),
  };
  const block = (s) => `
      <section class="psec" aria-labelledby="${esc(s.id)}-title"${s.season ? ` id="${esc(s.id)}"` : ''}>
        <h2 id="${esc(s.id)}-title" class="section-title">${esc(s.title)} <span class="section-title__count">${s.events.length}</span></h2>
        ${
          s.season
            ? `<div class="callout"><p class="card__eyebrow"><span class="badge">${esc(s.season.result)}</span><span>${esc(s.season.name)}</span></p><p>${esc(s.season.text)}</p></div>`
            : ''
        }
        <div class="cards">${s.events.map(hackathonCard).join('')}</div>
      </section>`;
  return shell({
    headOpts: { title: `${page.title} | ${AUTHOR}`, description: page.description, url, extra: [listLd, breadcrumbLd(trail)].map(ld).join('\n    ') },
    nav: 'hackathons',
    main: `<main id="content" class="index">
      <header class="index__head">
        <p class="eyebrow"><span>Hackathons</span><span class="dot">·</span><span>${wins.length} wins and placements</span>${seasons
          .map((s) => `<span class="dot">·</span><span>${esc(s.season.result)}, ${esc(s.season.name)}</span>`)
          .join('')}</p>
        <h1>${esc(page.headline || page.title)}</h1>
        ${page.standfirst ? `<p class="standfirst">${esc(page.standfirst)}</p>` : ''}
      </header>
      ${intro ? `<div class="prose page-intro">${intro}</div>` : ''}${sections.map(block).join('')}
    </main>`,
  });
}

// ---------- uses ----------
function usesRow(t) {
  const parts = [];
  if (t.at.length) parts.push(`At ${andList(t.at.map(atLink))}.`);
  if (t.articles.length) parts.push(`Used in ${andList(t.articles.map(({ article, label }) => `<a href="/blog/${article.slug}/">${esc(label)}</a>`))}.`);
  if (t.note) parts.push(esc(t.note));
  return `
            <li class="uses__row"><span class="uses__name">${esc(t.name)}</span>${parts.length ? `<span class="uses__where">${parts.join(' ')}</span>` : ''}</li>`;
}

function usesPage(page, groups) {
  const url = `${SITE}/uses/`;
  const { section } = rentryKit(page);
  const tools = groups.flatMap((g) => g.tools);
  const intro = pageIntro(page);
  const trail = [
    { name: 'Home', href: '/' },
    { name: 'Uses', href: '/uses/' },
  ];
  const pageLd = {
    '@context': 'https://schema.org',
    '@type': 'WebPage',
    name: `Tools ${AUTHOR} uses`,
    url,
    description: page.description,
    dateModified: page.modified,
    about: { '@id': PERSON_ID },
    author: { '@id': PERSON_ID },
    mainEntity: {
      '@type': 'ItemList',
      name: `Tools ${AUTHOR} uses`,
      numberOfItems: tools.length,
      itemListElement: tools.map((t, i) => ({ '@type': 'ListItem', position: i + 1, name: t.name })),
    },
  };
  return shell({
    headOpts: { title: `${page.title} | ${AUTHOR}`, description: page.description, url, extra: [pageLd, breadcrumbLd(trail)].map(ld).join('\n    ') },
    nav: 'uses',
    bodyClass: 'index-body resume-body',
    main: `<main id="content" class="index resume uses-page">
      <header class="index__head resume__head">
        <p class="eyebrow"><span>Uses</span><span class="dot">·</span><span>${plural(tools.length, 'tool')}</span><span class="dot">·</span><span>Updated ${fmtMonth(page.modified)}</span></p>
        <h1>${esc(page.headline || page.title)}</h1>
        ${page.standfirst ? `<p class="standfirst">${esc(page.standfirst)}</p>` : ''}
      </header>
      <div class="resume__body">
        ${intro ? `<div class="prose page-intro">${intro}</div>` : ''}${groups
          .map((g) => section(g.id, esc(g.name), `\n          <ul class="uses">${g.tools.map(usesRow).join('')}\n          </ul>`))
          .join('')}
      </div>
    </main>`,
  });
}

// ---------- write output ----------
const writePage = (rel, html) => {
  const dir = path.join(DIST, rel);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'index.html'), html);
  return html;
};
const generated = {}; // route -> html, for the copy checks at the end

fs.mkdirSync(OUT, { recursive: true });
fs.copyFileSync(path.join(ROOT, 'scripts', 'blog', 'blog.css'), path.join(OUT, 'blog.css'));

articles.forEach((a, i) => {
  const rendered = renderMarkdown(a);
  const mine = new Set(articleTags(a).map((t) => t.slug));
  const related = articles
    .filter((b) => b.slug !== a.slug)
    .map((b) => ({ b, score: articleTags(b).filter((t) => mine.has(t.slug)).length }))
    .sort((x, y) => y.score - x.score)
    .slice(0, 3)
    .map((x) => x.b);
  // Previous/next follow the order of the Writing index.
  writePage(
    path.join('blog', a.slug),
    articlePage(a, rendered, { related, prev: articles[i - 1], next: articles[i + 1], series: seriesFor(a.slug, BY_SLUG) }),
  );
});
generated['/blog/'] = writePage('blog', indexPage(articles));

if (TOPICS.length) {
  generated['/blog/topics/'] = writePage(path.join('blog', 'topics'), topicsIndexPage());
  for (const t of TOPICS) generated[topicHref(t.slug)] = writePage(path.join('blog', 'topics', t.slug), topicPage(t));
}

// About page (the canonical "who is Anirudh Vasudevan" page).
const aboutPage = loadPage('about');
if (aboutPage) generated['/about/'] = writePage('about', profilePage(aboutPage, renderMarkdown(aboutPage)));

// Resume: web version of the PDF.
const resume = loadPage('resume');
if (resume) {
  const pdfFile = path.join(ROOT, 'public', resume.pdf || RESUME_PDF);
  const pdfBytes = fs.existsSync(pdfFile) ? fs.statSync(pdfFile).size : 0;
  if (!pdfBytes) warn(`resume PDF not found at public${resume.pdf || RESUME_PDF}`);
  generated['/resume/'] = writePage('resume', resumePage(resume, pdfBytes));
}

// Projects: homepage cards + hackathons + every published article + content/pages/projects.md.
const projectsSrc = loadPage('projects');
let projects = [];
if (projectsSrc) {
  projects = await loadProjects({ root: ROOT, articles, overrides: projectsSrc.projects || [], warn });
  generated['/projects/'] = writePage('projects', projectsPage(projectsSrc, projects));
}

// Research: the patent and the papers, each with structured data that points back to the Person.
const research = loadPage('research');
if (research) generated['/research/'] = writePage('research', researchPage(research));

// Hackathons: every event with its date, result and project, cross-checked with the homepage list.
const hackathonsSrc = loadPage('hackathons');
let hackathonSections = [];
if (hackathonsSrc) {
  hackathonSections = await loadHackathons({ root: ROOT, page: hackathonsSrc, bySlug: BY_SLUG, warn });
  generated['/hackathons/'] = writePage('hackathons', hackathonsPage(hackathonsSrc, hackathonSections));
}
const hackathonArticles = hackathonSections.flatMap((s) => s.events.flatMap((e) => e.articles));

// Uses: tool groups, each tool linked to the write-ups whose stack used it.
const usesSrc = loadPage('uses');
let usesGroups = [];
if (usesSrc) {
  usesGroups = loadUses({ page: usesSrc, articles, bySlug: BY_SLUG, warn });
  generated['/uses/'] = writePage('uses', usesPage(usesSrc, usesGroups));
}

// llms.txt: a plain-text map of the site for LLM crawlers (https://llmstxt.org).
// Sections with nothing in them are left out; titles and descriptions are markdown-escaped.
const llmsItem = (name, url, note) => `- [${mdText(name)}](${url})${note ? `: ${mdText(note)}` : ''}`;
const llmsSection = (title, lines) => (lines.length ? `## ${title}\n${lines.join('\n')}` : '');
const LLMS_SUMMARY =
  'Anirudh Vasudevan is a full-stack and AI engineer in San Francisco. He is a Member of Technical Staff at Rivo (voice AI agents, React Native apps, analytics and growth), was previously the founding engineer at Nonlinear, holds an MS in Computer Science from the University of Minnesota, is a 5x hackathon winner (Y Combinator AI Hackathon top 10, ElevenLabs hackathon wins), holds a granted patent for a contactless voting system, and co-wrote an EMNLP paper.';
const llms = [
  '# Anirudh Vasudevan',
  `> ${LLMS_SUMMARY}`,
  `The full text of the profile pages and every article is in one file: ${SITE}/llms-full.txt`,
  llmsSection(
    'Profile',
    [
      aboutPage && llmsItem('About Anirudh Vasudevan', `${SITE}/about/`, 'biography, current work, hackathons, patent, research, education, contact'),
      resume && llmsItem('Resume', `${SITE}/resume/`, 'education, skills, experience, projects, patent, and publications as a web page'),
      llmsItem('Resume (PDF)', `${SITE}${RESUME_PDF}`),
      hackathonsSrc && llmsItem('Hackathons', `${SITE}/hackathons/`, 'the hackathon record: each event with its date, result, project, and links'),
      research && llmsItem('Research', `${SITE}/research/`, 'the granted patent and the papers, with coauthors, venues, and DOI links'),
      usesSrc && llmsItem('Tools I use', `${SITE}/uses/`, 'languages, frameworks, AI and voice tools, data, testing, growth, and infrastructure, linked to the write-ups'),
      projectsSrc && llmsItem('Projects', `${SITE}/projects/`, 'every project with its award, tech stack, and links to the live site, source, and write-up'),
      llmsItem('Full text (llms-full.txt)', `${SITE}/llms-full.txt`, 'about, resume, research, hackathons, tools, and every article as plain text in one file'),
      llmsItem('Portfolio home', `${SITE}/`, 'projects, experience, hackathons, AniBot chat assistant'),
      llmsItem('LinkedIn', 'https://www.linkedin.com/in/anirudhvasudev/'),
      llmsItem('GitHub', 'https://github.com/anirxdh'),
    ].filter(Boolean),
  ),
  llmsSection(
    'Projects',
    projects.map((p) => llmsItem(p.name, `${SITE}/projects/#${p.key}`, [p.award, p.blurb].filter(Boolean).join('. '))),
  ),
  llmsSection(
    'Writing (project deep dives)',
    articles.map((a) => llmsItem(a.title, `${SITE}/blog/${a.slug}/`, a.description)),
  ),
  llmsSection(
    'Writing by topic',
    TOPICS.map((t) => llmsItem(t.name, `${SITE}${topicHref(t.slug)}`, plural(t.articles.length, 'article'))),
  ),
].filter(Boolean);
fs.writeFileSync(path.join(DIST, 'llms.txt'), `${llms.join('\n\n')}\n`);

// llms-full.txt: the full text of the profile pages and every published article in one file, so an
// LLM can read the whole site in one fetch. Markdown-ish plain text: no code blocks, no HTML, every
// link absolute, links to unpublished articles reduced to their text. No phone number anywhere.
const textLinks = (src) => {
  const base = pageBase(src);
  return (href) => {
    if (!href || isDraftLink(href, base)) return null;
    try {
      return new URL(href, base).href;
    } catch {
      return href;
    }
  };
};
const mdToText = (src, md) => markdownToText(md, { link: textLinks(src) });
const lineText = (src, md) => inlineToText(md, { link: textLinks(src) });
const doc = (title, url, meta, body) =>
  [`# ${title}`, `URL: ${url}`, ...meta.filter(Boolean), '', body].join('\n').replace(/\n{3,}/g, '\n\n').trim();
const linkList = (src, links = []) =>
  links
    .map((l) => {
      const href = textLinks(src)(l.url);
      return href ? `${l.label}: ${href}` : '';
    })
    .filter(Boolean);

function resumeText(r) {
  const out = [];
  if (r.headline) out.push(r.headline);
  if (r.email) out.push(`Email: ${r.email}`);
  const links = linkList(r, r.links);
  if (links.length) out.push(links.join('\n'));
  if ((r.education || []).length) {
    out.push(
      `## Education\n${r.education
        .map((e) => `- ${e.degree}, ${e.fullName || e.school}${e.location ? ` (${e.location})` : ''}, ${e.dates}${e.gpa ? `, GPA ${e.gpa}` : ''}`)
        .join('\n')}`,
    );
  }
  if ((r.skills || []).length) out.push(`## Skills\n${r.skills.map((g) => `- ${g.group}: ${(g.items || []).join(', ')}`).join('\n')}`);
  if ((r.experience || []).length) {
    out.push(
      `## Professional experience\n${r.experience
        .map((x) => `### ${x.role}, ${x.org}${x.location ? ` (${x.location})` : ''}, ${x.dates}\n${(x.bullets || []).map((b) => `- ${lineText(r, b)}`).join('\n')}`)
        .join('\n\n')}`,
    );
  }
  if ((r.projects || []).length) {
    out.push(
      `## Project experience\n${r.projects
        .map((p) => [`### ${p.name}${p.subtitle ? `: ${p.subtitle}` : ''}`, ...(p.bullets || []).map((b) => `- ${lineText(r, b)}`), ...linkList(r, p.links)].join('\n'))
        .join('\n\n')}`,
    );
  }
  if ((r.achievements || []).length) out.push(`## Patents, publications, and achievements\n${r.achievements.map((m) => `- ${lineText(r, m)}`).join('\n')}`);
  return out.join('\n\n');
}

function researchText(r) {
  const out = [];
  if (r.content.trim()) out.push(mdToText(r, r.content));
  const p = r.patent;
  if (p) {
    out.push(
      [`## Patent`, `### ${p.name} (${p.status}, ${p.when})`, ...patentLines(p).map((l) => `- ${lineText(r, l)}`), ...linkList(r, p.links)].join('\n'),
    );
  }
  const papers = visiblePapers(r);
  if (papers.length) {
    out.push(
      `## Papers\n${papers
        .map((x) =>
          [
            `### ${x.title}`,
            `- Venue: ${x.venue}`,
            paperByline(x) && `- ${paperByline(x)}`,
            paperSource(x) && `- ${lineText(r, paperSource(x))}`,
            x.doi && `- DOI: https://doi.org/${x.doi}`,
          ]
            .filter(Boolean)
            .join('\n'),
        )
        .join('\n\n')}`,
    );
  }
  if ((r.experience || []).length) {
    out.push(
      `## Research experience\n${r.experience
        .map((x) => [`### ${x.title}${x.role ? ` (${x.role})` : ''}${x.when ? `, ${x.when}` : ''}`, ...(x.bullets || []).map((b) => `- ${lineText(r, b)}`)].join('\n'))
        .join('\n\n')}`,
    );
  }
  const profiles = linkList(r, r.profiles);
  if (profiles.length) out.push(`## Profiles\n${profiles.map((l) => `- ${l}`).join('\n')}`);
  return out.join('\n\n');
}

function hackathonsText(page, sections) {
  const out = [];
  if (page.content.trim()) out.push(mdToText(page, page.content));
  for (const s of sections) {
    const lines = [`## ${s.title}`];
    if (s.season) lines.push(`${s.season.name}: ${s.season.result}. ${s.season.text}`);
    for (const e of s.events) {
      const where = eventWhere(e);
      lines.push(
        [
          `### ${e.project}: ${e.result}, ${e.event}`,
          `- When: ${e.when}${where ? ` (${where})` : ''}`,
          `- What it is: ${e.built}`,
          e.note && `- Note: ${e.note}`,
          ...e.articles.map((a) => `- ${writeupLabel(e, a)}: ${articleUrl(a)}`),
          e.live && `- ${e.liveLabel || 'Live demo'}: ${e.live}`,
          e.repo && `- Source: ${e.repo}`,
          e.eventUrl && `- Event page: ${e.eventUrl}`,
        ]
          .filter(Boolean)
          .join('\n'),
      );
    }
    out.push(lines.join('\n\n'));
  }
  return out.join('\n\n');
}

function usesText(page, groups) {
  const out = [];
  if (page.content.trim()) out.push(mdToText(page, page.content));
  for (const g of groups) {
    out.push(
      `## ${g.name}\n${g.tools
        .map((t) => {
          const bits = [t.at.length ? `at ${andList(t.at)}` : '', t.articles.length ? `used in ${andList(t.articles.map((x) => x.label))}` : '', t.note || '']
            .filter(Boolean)
            .join('; ');
          return `- ${t.name}${bits ? `: ${bits}` : ''}`;
        })
        .join('\n')}`,
    );
  }
  return out.join('\n\n');
}

const fullDocs = [
  [
    '# Anirudh Vasudevan: the full text of anirudhvasudevan.com',
    `> ${LLMS_SUMMARY}`,
    `This file holds the plain text of the profile pages and every published article on ${SITE}, so the whole site can be read in one request. Code samples and diagrams are left out; each article's page has them. A shorter map of the site is at ${SITE}/llms.txt. Generated ${TODAY}.`,
  ].join('\n\n'),
  aboutPage && doc(aboutPage.title, `${SITE}/about/`, [`Description: ${aboutPage.description}`], mdToText(aboutPage, aboutPage.content)),
  resume && doc(`Resume of ${resume.name || AUTHOR}`, `${SITE}/resume/`, [`PDF: ${SITE}${resume.pdf || RESUME_PDF}`], resumeText(resume)),
  research && doc(`${research.title}: ${AUTHOR}`, `${SITE}/research/`, [`Description: ${research.description}`], researchText(research)),
  hackathonsSrc &&
    doc(`${hackathonsSrc.title}: ${AUTHOR}`, `${SITE}/hackathons/`, [`Description: ${hackathonsSrc.description}`], hackathonsText(hackathonsSrc, hackathonSections)),
  usesSrc && doc(`${usesSrc.title}: ${AUTHOR}`, `${SITE}/uses/`, [`Description: ${usesSrc.description}`], usesText(usesSrc, usesGroups)),
  ...articles.map((a) =>
    doc(
      a.title,
      `${SITE}/blog/${a.slug}/`,
      [
        `Author: ${AUTHOR}`,
        `Project: ${a.project}`,
        `Published: ${a.date}${a.updated ? ` (updated ${a.updated})` : ''}`,
        a.award && `Result: ${a.award}`,
        a.live && `Live: ${a.live}`,
        a.repo && `Source: ${a.repo}`,
        `Tags: ${articleTags(a)
          .map((t) => t.name)
          .join(', ')}`,
        a.summary && `Summary: ${a.summary}`,
      ],
      mdToText(a, a.content),
    ),
  ),
].filter(Boolean);
const llmsFull = `${fullDocs.join('\n\n---\n\n')}\n`;
fs.writeFileSync(path.join(DIST, 'llms-full.txt'), llmsFull);

// Machine-readable index for the homepage "Writing" section.
fs.writeFileSync(
  path.join(OUT, 'index.json'),
  JSON.stringify(
    articles.map((a) => ({
      title: a.title,
      slug: a.slug,
      description: a.description,
      date: a.date,
      project: a.project,
      award: a.award || null,
      accent: a.accent,
      readingMinutes: a.readingMinutes,
      tags: a.tags,
    })),
    null,
    2,
  ),
);

// RSS
const rss = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${AUTHOR} | Writing</title>
    <link>${SITE}/blog/</link>
    <description>Deep dives into the AI products, voice agents, and hackathon builds Anirudh Vasudevan shipped.</description>
    <language>en-us</language>
    <atom:link href="${SITE}/blog/feed.xml" rel="self" type="application/rss+xml" />
${articles
  .map(
    (a) => `    <item>
      <title>${esc(a.title)}</title>
      <link>${SITE}/blog/${a.slug}/</link>
      <guid isPermaLink="true">${SITE}/blog/${a.slug}/</guid>
      <pubDate>${new Date(`${a.date}T12:00:00Z`).toUTCString()}</pubDate>
      <description>${esc(a.description)}</description>
    </item>`,
  )
  .join('\n')}
  </channel>
</rss>
`;
fs.writeFileSync(path.join(OUT, 'feed.xml'), rss);

// Sitemap: homepage, profile pages, blog index, topics, and every article.
// lastmod tracks real content changes: article dates (updated/date frontmatter), and for the other
// pages the newest of their frontmatter `updated`/`date` and the git history of their sources.
// Image entries (sitemap image extension): each page's share image, the avatar on /about/, and each
// article's share image. Only PNG, JPEG and WebP files that exist in dist/ are listed (the diagrams
// are inline SVG, which image sitemaps do not take).
const latest = updatedOf(articles) || TODAY;
const OG_PATH = '/assets/og-image.png';
const AVATAR_PATH = '/assets/anirudh-avatar.png';
const sitemapImage = (src) => {
  if (!src) return null;
  const rel = String(src).startsWith(SITE) ? String(src).slice(SITE.length) : String(src);
  if (!rel.startsWith('/') || !/\.(png|jpe?g|webp)$/i.test(rel)) return null;
  return fs.existsSync(path.join(DIST, rel.slice(1))) ? `${SITE}${rel}` : null;
};
const images = (...srcs) => [...new Set(srcs.map(sitemapImage).filter(Boolean))];
const urls = [
  // The homepage is the React app: index.html plus src/.
  { loc: `${SITE}/`, lastmod: gitDay('index.html', 'src'), images: images(OG_PATH) },
  ...(aboutPage ? [{ loc: `${SITE}/about/`, lastmod: aboutPage.modified, images: images(AVATAR_PATH, OG_PATH) }] : []),
  // /projects/ is built from projects.md, the homepage project list and the articles.
  ...(projectsSrc
    ? [{ loc: `${SITE}/projects/`, lastmod: maxDay(projectsSrc.modified, gitDay('src/constants'), updatedOf(articles)), images: images(OG_PATH) }]
    : []),
  ...(resume ? [{ loc: `${SITE}/resume/`, lastmod: resume.modified, images: images(OG_PATH) }] : []),
  // /hackathons/ also shows each write-up's title and links, so it moves with those articles.
  ...(hackathonsSrc
    ? [{ loc: `${SITE}/hackathons/`, lastmod: maxDay(hackathonsSrc.modified, updatedOf(hackathonArticles)), images: images(OG_PATH) }]
    : []),
  ...(research ? [{ loc: `${SITE}/research/`, lastmod: research.modified, images: images(OG_PATH) }] : []),
  // /uses/ links every article whose stack uses a tool, so any article can change it.
  ...(usesSrc ? [{ loc: `${SITE}/uses/`, lastmod: maxDay(usesSrc.modified, latest), images: images(OG_PATH) }] : []),
  { loc: `${SITE}/blog/`, lastmod: maxDay(latest, gitDay('scripts/build-blog.mjs', 'scripts/blog')) },
  ...(TOPICS.length ? [{ loc: `${SITE}/blog/topics/`, lastmod: maxDay(latest, gitDay('scripts/build-blog.mjs', 'scripts/blog')) }] : []),
  ...TOPICS.map((t) => ({ loc: SITE + topicHref(t.slug), lastmod: updatedOf(t.articles) })),
  ...articles.map((a) => ({ loc: `${SITE}/blog/${a.slug}/`, lastmod: a.updated || a.date, images: images(a.cover) })),
];
const sitemapUrl = (u) =>
  [
    '  <url>',
    `    <loc>${esc(u.loc)}</loc>`,
    `    <lastmod>${u.lastmod}</lastmod>`,
    ...(u.images || []).map((img) => `    <image:image>\n      <image:loc>${esc(img)}</image:loc>\n    </image:image>`),
    '  </url>',
  ].join('\n');
fs.writeFileSync(
  path.join(DIST, 'sitemap.xml'),
  `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">
${urls.map(sitemapUrl).join('\n')}
</urlset>
`,
);

// Homepage Person JSON-LD: always generated from scripts/blog/person.mjs, so dist/index.html can
// never drift from /about/ and /resume/. index.html keeps a copy only for the dev server.
const PERSON_BLOCK = /<script\b(?=[^>]*\bid="person-ld")[^>]*>([\s\S]*?)<\/script>/;
const personJson = { '@context': 'https://schema.org', ...person() };
const homeFile = path.join(DIST, 'index.html');
if (fs.existsSync(homeFile)) {
  const home = fs.readFileSync(homeFile, 'utf8');
  if (!PERSON_BLOCK.test(home)) throw new Error('[blog] dist/index.html has no <script id="person-ld"> block to fill');
  fs.writeFileSync(homeFile, home.replace(PERSON_BLOCK, () => ld(personJson).replace('<script type="application/ld+json">', '<script type="application/ld+json" id="person-ld">')));
  const src = PERSON_BLOCK.exec(fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8'));
  let same = false;
  try {
    same = src && JSON.stringify(JSON.parse(src[1])) === JSON.stringify(personJson);
  } catch {
    // an unparsable source copy counts as out of date
  }
  if (!same) warn('index.html Person JSON-LD differs from scripts/blog/person.mjs (dist is correct; refresh the source copy)');
}

// House style: no em or en dashes in page copy. Article bodies are checked by lint-articles.mjs;
// this catches copy that comes from elsewhere (templates, src/constants, page frontmatter).
for (const [route, html] of Object.entries(generated)) {
  const text = html
    .replace(/<script[\s\S]*?<\/script>/g, '')
    .replace(/<style[\s\S]*?<\/style>/g, '')
    .replace(/<[^>]+>/g, ' ');
  const hits = text.match(/[^\s]{0,20}[\u2014\u2013][^\s]{0,20}/g);
  if (hits) warn(`${route}: ${hits.length} em/en dash(es) in page copy, e.g. "${hits[0]}"`);
}

console.log(
  `[blog] ${articles.length} article(s), ${TOPICS.length} topic page(s)${resume ? ', /resume/' : ''}${
    projectsSrc ? `, /projects/ (${projects.length} projects)` : ''
  }${research ? ', /research/' : ''}${hackathonsSrc ? `, /hackathons/ (${hackathonSections.reduce((n, x) => n + x.events.length, 0)} events)` : ''}${
    usesSrc ? `, /uses/ (${usesGroups.reduce((n, g) => n + g.tools.length, 0)} tools)` : ''
  } → dist/, sitemap.xml (${urls.length} urls, ${urls.reduce((n, u) => n + (u.images || []).length, 0)} images), feed.xml, llms.txt, llms-full.txt (${Math.round(
    Buffer.byteLength(llmsFull) / 1024,
  )} KB)`,
);
console.log(`[blog] article inline script CSP hash: '${ARTICLE_SCRIPT_HASH}'`);
