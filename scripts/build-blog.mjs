// Static page generator. Runs after `vite build` and emits real HTML pages so search engines and
// LLM crawlers get full content without executing the React app:
//   /blog/<slug>/          every published article in content/articles/*.md
//   /blog/                 the article index
//   /blog/topics/[<tag>/]  one page per tag shared by 2+ articles, plus a topics index
//   /about/                content/pages/about.md
//   /resume/               content/pages/resume.md (web version of the resume PDF)
//   /projects/             src/constants/index.js + articles + content/pages/projects.md
// It also rewrites dist/sitemap.xml and writes the RSS feed, llms.txt and /blog/index.json.
//
// Article frontmatter (all required unless noted):
//   title, description (<=160 chars), date (YYYY-MM-DD), slug, project, tags[]
//   optional: updated, repo, live, award, accent (hex), cover (/path), summary (1-2 sentence TL;DR)
//
// Diagrams: reference an SVG in public/blog/diagrams/ as a markdown image
// (`![caption](/blog/diagrams/name.svg)`) and it is inlined as a <figure>.

import fs from 'node:fs';
import path from 'node:path';
import matter from 'gray-matter';
import { marked } from 'marked';
import { PERSON_ID, person } from './blog/person.mjs';
import { articleTags, buildTopics, tagSlug } from './blog/topics.mjs';
import { seriesFor } from './blog/series.mjs';
import { loadProjects } from './blog/projects.mjs';
import { ARTICLE_SCRIPT, ARTICLE_SCRIPT_HASH } from './blog/enhance.mjs';

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

const warned = new Set();
const warn = (msg) => {
  if (warned.has(msg)) return;
  warned.add(msg);
  console.warn(`[blog] ${msg}`);
};

// ---------- load articles ----------
if (!fs.existsSync(SRC)) {
  console.log('[blog] no content/articles directory, skipping');
  process.exit(0);
}
if (!fs.existsSync(DIST)) {
  console.error('[blog] dist/ not found — run `vite build` first');
  process.exit(1);
}

const REQUIRED = ['title', 'description', 'date', 'slug', 'project', 'tags'];
const articles = fs
  .readdirSync(SRC)
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

// A link to /blog/<slug>/ whose article is still a draft would 404.
const isDraftLink = (href) => {
  const m = /^\/blog\/([a-z0-9-]+)\/?(#.*)?$/.exec(href || '');
  return Boolean(m && !BLOG_RESERVED.has(m[1]) && !PUBLISHED.has(m[1]));
};

const loadPage = (name) => {
  const file = path.join(PAGES, `${name}.md`);
  if (!fs.existsSync(file)) return null;
  const { data, content } = matter(fs.readFileSync(file, 'utf8'));
  return { ...data, date: isoDay(data.date), content, file: `pages/${name}.md`, tags: [] };
};

// ---------- markdown rendering ----------
function makeRenderer(article, toc) {
  const renderer = new marked.Renderer();

  renderer.heading = ({ tokens, depth }) => {
    const text = renderer.parser.parseInline(tokens);
    const id = slugify(text);
    if (depth === 2) toc.push({ id, text: text.replace(/<[^>]+>/g, '') });
    return `<h${depth} id="${id}"><a class="anchor" href="#${id}" aria-hidden="true" tabindex="-1">#</a>${text}</h${depth}>\n`;
  };

  renderer.link = ({ href, title, tokens }) => {
    const text = renderer.parser.parseInline(tokens);
    // Never link to an article that is still a draft (it would 404); keep the words, drop the link.
    if (isDraftLink(href)) {
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
      const svg = fs
        .readFileSync(file, 'utf8')
        .replace(/<\?xml[^>]*\?>/, '')
        .replace(/<svg /, '<svg role="img" ');
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
const inlineMd = (md, file) => marked.parseInline(String(md ?? ''), { renderer: makeRenderer({ file }, []) });

// Pull "## FAQ" → "### question" / answer paragraphs out of the markdown so they can be
// emitted as FAQPage structured data (search engines and LLM crawlers read it directly).
const plain = (md) =>
  md
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/[*_]{1,2}([^*_]+)[*_]{1,2}/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();

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
      current = { question: plain(t.text), answer: '' };
      faqs.push(current);
    } else if (current && (t.type === 'paragraph' || t.type === 'list')) {
      const text = t.type === 'list' ? t.items.map((i) => plain(i.text)).join(' ') : plain(t.text);
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
          <a href="/blog/"${cur('blog')}>Writing</a>
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
          <p class="author__bio">Full-stack and AI engineer in San Francisco. Member of Technical Staff at Rivo, building production voice AI agents. 5x hackathon winner, granted patent, EMNLP author.</p>
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
    author: { '@id': PERSON_ID, '@type': 'Person', name: AUTHOR, url: SITE + '/about/' },
    publisher: { '@id': PERSON_ID, '@type': 'Person', name: AUTHOR, url: SITE + '/' },
    mainEntityOfPage: url,
    image: ogImage,
    keywords: a.tags.join(', '),
    wordCount: a.words,
    ...(a.repo ? { codeRepository: a.repo } : {}),
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
    dateModified: page.date,
    mainEntity: person({ mainEntityOfPage: url }),
  };
  const breadcrumbs = breadcrumbLd([
    { name: 'Home', href: '/' },
    { name: 'About', href: '/about/' },
  ]);
  const extra = [profileLd, breadcrumbs, faqLd(faqs)].filter(Boolean).map(ld).join('\n    ');
  return shell({
    headOpts: { title: `${AUTHOR} | Full-Stack & AI Engineer in San Francisco`, description: page.description, url, ogType: 'profile', extra },
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
    author: { '@id': PERSON_ID, '@type': 'Person', name: AUTHOR, url: SITE + '/about/' },
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

// ---------- resume ----------
function resumePage(r, pdfBytes) {
  const url = `${SITE}/resume/`;
  const pdf = r.pdf || RESUME_PDF;
  const inline = (md) => inlineMd(md, r.file);
  const link = (href, label) =>
    isDraftLink(href) ? '' : `<a href="${esc(href)}"${extAttrs(href)}>${esc(label)}${isExternal(href) ? ' ↗' : ''}</a>`;
  const entry = ({ title, href, where, role, note, when, bullets = [], links = [] }) => {
    const linkRow = links.map((l) => link(l.url, l.label)).filter(Boolean);
    return `
          <article class="rentry">
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
    dateModified: r.date,
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
        <p class="eyebrow"><span>Resume</span>${r.pronouns ? `<span class="dot">·</span><span>${esc(r.pronouns)}</span>` : ''}<span class="dot">·</span><span>Updated ${fmtMonth(r.date)}</span></p>
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
  const intro = page.content.trim() ? inlineMd(page.content.trim(), page.file) : '';
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

// llms.txt: a plain-text map of the site for LLM crawlers (https://llmstxt.org).
fs.writeFileSync(
  path.join(DIST, 'llms.txt'),
  `# Anirudh Vasudevan

> Anirudh Vasudevan is a full-stack and AI engineer in San Francisco. He is a Member of Technical Staff at Rivo (voice AI agents, React Native apps, analytics and growth), was previously the founding engineer at Nonlinear, holds an MS in Computer Science from the University of Minnesota, is a 5x hackathon winner (Y Combinator AI Hackathon top 10, ElevenLabs hackathon wins), holds a granted patent for a contactless voting system, and co-wrote an EMNLP paper.

## Profile
- [About Anirudh Vasudevan](${SITE}/about/): biography, current work, hackathons, patent, research, education, contact
- [Resume](${SITE}/resume/): education, skills, experience, projects, patent, and publications as a web page
- [Resume (PDF)](${SITE}${RESUME_PDF})
- [Projects](${SITE}/projects/): every project with its award, tech stack, and links to the live site, source, and write-up
- [Portfolio home](${SITE}/): projects, experience, hackathons, AniBot chat assistant
- [LinkedIn](https://www.linkedin.com/in/anirudhvasudev/)
- [GitHub](https://github.com/anirxdh)
${
  projects.length
    ? `
## Projects
${projects.map((p) => `- [${p.name}](${SITE}/projects/#${p.key}): ${p.award ? `${p.award}. ` : ''}${p.blurb}`).join('\n')}
`
    : ''
}
## Writing (project deep dives)
${articles.map((a) => `- [${a.title}](${SITE}/blog/${a.slug}/): ${a.description}`).join('\n')}
${
  TOPICS.length
    ? `
## Writing by topic
${TOPICS.map((t) => `- [${t.name}](${SITE}${topicHref(t.slug)}): ${plural(t.articles.length, 'article')}`).join('\n')}
`
    : ''
}`,
);

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
const today = new Date().toISOString().slice(0, 10);
const latest = updatedOf(articles) || today;
const maxDay = (...days) => days.filter(Boolean).sort().at(-1);
const urls = [
  { loc: `${SITE}/`, lastmod: latest },
  ...(aboutPage ? [{ loc: `${SITE}/about/`, lastmod: aboutPage.date }] : []),
  ...(projectsSrc ? [{ loc: `${SITE}/projects/`, lastmod: maxDay(projectsSrc.date, latest) }] : []),
  ...(resume ? [{ loc: `${SITE}/resume/`, lastmod: resume.date }] : []),
  { loc: `${SITE}/blog/`, lastmod: latest },
  ...(TOPICS.length ? [{ loc: `${SITE}/blog/topics/`, lastmod: latest }] : []),
  ...TOPICS.map((t) => ({ loc: SITE + topicHref(t.slug), lastmod: updatedOf(t.articles) })),
  ...articles.map((a) => ({ loc: `${SITE}/blog/${a.slug}/`, lastmod: a.updated || a.date })),
];
fs.writeFileSync(
  path.join(DIST, 'sitemap.xml'),
  `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((u) => `  <url>\n    <loc>${u.loc}</loc>\n    <lastmod>${u.lastmod}</lastmod>\n  </url>`).join('\n')}
</urlset>
`,
);

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
  } → dist/, sitemap.xml (${urls.length} urls), feed.xml, llms.txt`,
);
console.log(`[blog] article inline script CSP hash: '${ARTICLE_SCRIPT_HASH}'`);
