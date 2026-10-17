// Static blog generator. Runs after `vite build` and emits real HTML pages for every
// article in content/articles/*.md so search engines and LLM crawlers get full content
// without executing the React app. Also rewrites dist/sitemap.xml and writes an RSS feed.
//
// Frontmatter (all required unless noted):
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

const ROOT = process.cwd();
const SRC = path.join(ROOT, 'content', 'articles');
const DIST = path.join(ROOT, 'dist');
const OUT = path.join(DIST, 'blog');
const DIAGRAMS = path.join(ROOT, 'public', 'blog', 'diagrams');
const SITE = 'https://anirudhvasudevan.com';
const AUTHOR = 'Anirudh Vasudevan';
const DEFAULT_OG = `${SITE}/assets/og-image.png`;
const DEFAULT_ACCENT = '#7C9CFF';

const esc = (s = '') =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const slugify = (s) =>
  String(s).toLowerCase().replace(/<[^>]+>/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const fmtDate = (iso) =>
  new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
// YAML `date: 2026-09-27` arrives as a Date (UTC midnight); strings pass through.
const isoDay = (v) => (v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10));

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
  .map((file) => {
    const raw = fs.readFileSync(path.join(SRC, file), 'utf8');
    const { data, content } = matter(raw);
    for (const k of REQUIRED) {
      if (data[k] === undefined || data[k] === null || data[k] === '') {
        throw new Error(`[blog] ${file}: missing frontmatter field "${k}"`);
      }
    }
    if (data.description.length > 170) {
      console.warn(`[blog] ${file}: description is ${data.description.length} chars (aim for <=160)`);
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
  .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));

const PUBLISHED = new Set(articles.map((a) => a.slug));
const slugs = new Set();
for (const a of articles) {
  if (slugs.has(a.slug)) throw new Error(`[blog] duplicate slug "${a.slug}"`);
  slugs.add(a.slug);
}

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
    const draftLink = /^\/blog\/([a-z0-9-]+)\/?(#.*)?$/.exec(href);
    if (draftLink && !PUBLISHED.has(draftLink[1])) {
      console.warn(`[blog] ${article.file}: unlinked draft reference ${href}`);
      return text;
    }
    const external = /^https?:\/\//.test(href) && !href.startsWith(SITE);
    const attrs = external ? ' target="_blank" rel="noopener noreferrer"' : '';
    return `<a href="${esc(href)}"${title ? ` title="${esc(title)}"` : ''}${attrs}>${text}</a>`;
  };

  renderer.image = ({ href, title, text }) => {
    if (href.startsWith('/blog/diagrams/') && href.endsWith('.svg')) {
      const file = path.join(DIAGRAMS, path.basename(href));
      if (!fs.existsSync(file)) {
        console.warn(`[blog] ${article.file}: diagram not found: ${href}`);
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

  renderer.code = ({ text, lang }) => {
    const cls = lang ? ` class="language-${esc(lang)}"` : '';
    return `<pre><code${cls}>${esc(text)}</code></pre>\n`;
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

// ---------- templates ----------
const head = ({ title, description, url, ogImage, ogType = 'website', extra = '' }) => `<!doctype html>
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
          <a href="/#hackathons">Hackathons</a>
          <a href="/#work">Work</a>
          <a href="/blog/"${cur('blog')}>Writing</a>
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
        <a href="/blog/">Writing</a>
        <a href="/assets/anirudh-vasudevan-resume.pdf">Resume</a>
        <a href="https://github.com/anirxdh" target="_blank" rel="noopener noreferrer">GitHub</a>
        <a href="https://www.linkedin.com/in/anirudhvasudev/" target="_blank" rel="noopener noreferrer">LinkedIn</a>
        <a href="/blog/feed.xml">RSS</a>
      </p>
    </footer>`;

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

function articlePage(a, html, toc, related, faqs = []) {
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
  };
  const breadcrumbs = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Home', item: SITE + '/' },
      { '@type': 'ListItem', position: 2, name: 'Writing', item: SITE + '/blog/' },
      { '@type': 'ListItem', position: 3, name: a.title, item: url },
    ],
  };
  const faqLd = faqs.length
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
  const extra = `<script type="application/ld+json">${JSON.stringify(jsonLd)}</script>
    <script type="application/ld+json">${JSON.stringify(breadcrumbs)}</script>${
      faqLd ? `\n    <script type="application/ld+json">${JSON.stringify(faqLd)}</script>` : ''
    }`;

  return `${head({ title: `${a.title} | ${AUTHOR}`, description: a.description, url, ogImage, ogType: 'article', extra })}
  <body class="article-body" style="--accent:${a.accent}">
    <a class="skip" href="#content">Skip to article</a>
    <div class="glow" aria-hidden="true"></div>
    ${siteNav('blog')}
    <main id="content" class="article">
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
                a.live ? `<a class="pill" href="${esc(a.live)}" target="_blank" rel="noopener noreferrer">Live demo ↗</a>` : ''
              }${
                a.repo ? `<a class="pill" href="${esc(a.repo)}" target="_blank" rel="noopener noreferrer">Source on GitHub ↗</a>` : ''
              }</p>`
            : ''
        }
        ${a.summary ? `<div class="tldr"><strong>TL;DR</strong> ${esc(a.summary)}</div>` : ''}
      </header>

      <div class="article__layout">
        ${
          toc.length > 2
            ? `<aside class="toc" aria-label="On this page"><p class="toc__title">On this page</p><ol>${toc
                .map((t) => `<li><a href="#${t.id}">${esc(t.text)}</a></li>`)
                .join('')}</ol></aside>`
            : ''
        }
        <article class="prose">
          ${html}
          <p class="tags">${a.tags.map((t) => `<span>${esc(t)}</span>`).join('')}</p>
          ${authorBox()}
        </article>
      </div>

      ${
        related.length
          ? `<section class="related" aria-labelledby="related-title">
        <h2 id="related-title">More writing</h2>
        <div class="cards">${related.map(articleCard).join('')}</div>
      </section>`
          : ''
      }
    </main>
    ${siteFooter()}
  </body>
</html>
`;
}

function profilePage(page, html, toc, faqs) {
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
  const breadcrumbs = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Home', item: SITE + '/' },
      { '@type': 'ListItem', position: 2, name: 'About', item: url },
    ],
  };
  const faqLd = faqs.length
    ? { '@context': 'https://schema.org', '@type': 'FAQPage', mainEntity: faqs.map((f) => ({ '@type': 'Question', name: f.question, acceptedAnswer: { '@type': 'Answer', text: f.answer } })) }
    : null;
  const extra = [profileLd, breadcrumbs, faqLd].filter(Boolean).map((o) => `<script type="application/ld+json">${JSON.stringify(o)}</script>`).join('\n    ');
  return `${head({ title: `${AUTHOR} | Full-Stack & AI Engineer in San Francisco`, description: page.description, url, ogImage: DEFAULT_OG, ogType: 'profile', extra })}
  <body class="article-body profile-body">
    <a class="skip" href="#content">Skip to content</a>
    <div class="glow" aria-hidden="true"></div>
    ${siteNav('about')}
    <main id="content" class="article">
      <header class="article__head profile__head">
        <img class="profile__avatar" src="/assets/anirudh-avatar.png" alt="Anirudh Vasudevan" width="96" height="96" />
        <div>
          <p class="eyebrow"><span>About</span><span class="dot">·</span><span>San Francisco</span></p>
          <h1>Anirudh Vasudevan</h1>
          <p class="standfirst">Full-stack and AI engineer. Member of Technical Staff at Rivo. 5x hackathon winner, granted patent, EMNLP author.</p>
          <p class="links">
            <a class="pill" href="/assets/anirudh-vasudevan-resume.pdf">Resume</a>
            <a class="pill" href="https://www.linkedin.com/in/anirudhvasudev/" target="_blank" rel="noopener noreferrer">LinkedIn ↗</a>
            <a class="pill" href="https://github.com/anirxdh" target="_blank" rel="noopener noreferrer">GitHub ↗</a>
            <a class="pill" href="/#contact">Contact</a>
          </p>
        </div>
      </header>
      <div class="article__layout">
        ${toc.length > 2 ? `<aside class="toc" aria-label="On this page"><p class="toc__title">On this page</p><ol>${toc.map((t) => `<li><a href="#${t.id}">${esc(t.text)}</a></li>`).join('')}</ol></aside>` : ''}
        <article class="prose">
          ${html}
        </article>
      </div>
    </main>
    ${siteFooter()}
  </body>
</html>
`;
}

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
  return `${head({
    title: `Writing | ${AUTHOR}`,
    description:
      'Deep dives into the AI products, voice agents, and hackathon builds Anirudh Vasudevan shipped: architecture, decisions, and what actually worked.',
    url,
    ogImage: DEFAULT_OG,
    extra: `<script type="application/ld+json">${JSON.stringify(jsonLd)}</script>`,
  })}
  <body class="index-body">
    <a class="skip" href="#content">Skip to content</a>
    <div class="glow" aria-hidden="true"></div>
    ${siteNav('blog')}
    <main id="content" class="index">
      <header class="index__head">
        <p class="eyebrow"><span>Writing</span><span class="dot">·</span><span>${list.length} ${list.length === 1 ? 'article' : 'articles'}</span></p>
        <h1>How I built the things I built.</h1>
        <p class="standfirst">Architecture, trade-offs, and the honest story behind each project: the hackathon wins, the products, and the experiments.</p>
      </header>
      ${
        featured
          ? `<section class="featured" aria-label="Latest article">${articleCard(featured).replace('class="card"', 'class="card card--featured"')}</section>`
          : ''
      }
      ${rest.length ? `<section class="cards" aria-label="All articles">${rest.map(articleCard).join('')}</section>` : ''}
    </main>
    ${siteFooter()}
  </body>
</html>
`;
}

// ---------- write output ----------
fs.mkdirSync(OUT, { recursive: true });
fs.copyFileSync(path.join(ROOT, 'scripts', 'blog', 'blog.css'), path.join(OUT, 'blog.css'));

for (const a of articles) {
  const { html, toc, faqs } = renderMarkdown(a);
  const related = articles
    .filter((b) => b.slug !== a.slug)
    .map((b) => ({ b, score: b.tags.filter((t) => a.tags.includes(t)).length }))
    .sort((x, y) => y.score - x.score)
    .slice(0, 3)
    .map((x) => x.b);
  const dir = path.join(OUT, a.slug);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'index.html'), articlePage(a, html, toc, related, faqs));
}
fs.writeFileSync(path.join(OUT, 'index.html'), indexPage(articles));

// About page (the canonical "who is Anirudh Vasudevan" page).
const ABOUT_SRC = path.join(ROOT, 'content', 'pages', 'about.md');
let aboutPage = null;
if (fs.existsSync(ABOUT_SRC)) {
  const { data, content } = matter(fs.readFileSync(ABOUT_SRC, 'utf8'));
  aboutPage = { ...data, date: isoDay(data.date), content, file: 'pages/about.md', tags: [] };
  const { html, toc, faqs } = renderMarkdown(aboutPage);
  fs.mkdirSync(path.join(DIST, 'about'), { recursive: true });
  fs.writeFileSync(path.join(DIST, 'about', 'index.html'), profilePage(aboutPage, html, toc, faqs));
}

// llms.txt: a plain-text map of the site for LLM crawlers (https://llmstxt.org).
fs.writeFileSync(
  path.join(DIST, 'llms.txt'),
  `# Anirudh Vasudevan

> Anirudh Vasudevan is a full-stack and AI engineer in San Francisco. He is a Member of Technical Staff at Rivo (voice AI agents, React Native apps, analytics and growth), was previously the founding engineer at Nonlinear, holds an MS in Computer Science from the University of Minnesota, is a 5x hackathon winner (Y Combinator AI Hackathon top 10, ElevenLabs hackathon wins), holds a granted patent for a contactless voting system, and co-wrote an EMNLP paper.

## Profile
- [About Anirudh Vasudevan](${SITE}/about/): biography, current work, hackathons, patent, research, education, contact
- [Portfolio home](${SITE}/): projects, experience, hackathons, AniBot chat assistant
- [Resume (PDF)](${SITE}/assets/anirudh-vasudevan-resume.pdf)
- [LinkedIn](https://www.linkedin.com/in/anirudhvasudev/)
- [GitHub](https://github.com/anirxdh)

## Writing (project deep dives)
${articles.map((a) => `- [${a.title}](${SITE}/blog/${a.slug}/): ${a.description}`).join('\n')}
`,
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

// Sitemap: homepage + blog index + every article.
const today = new Date().toISOString().slice(0, 10);
const latest = articles[0]?.date || today;
const urls = [
  { loc: `${SITE}/`, lastmod: latest },
  ...(aboutPage ? [{ loc: `${SITE}/about/`, lastmod: aboutPage.date }] : []),
  { loc: `${SITE}/blog/`, lastmod: latest },
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

console.log(`[blog] ${articles.length} article(s) → dist/blog/, sitemap.xml (${urls.length} urls), feed.xml`);
