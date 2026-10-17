// Ready-to-paste copies of every published article for dev.to, Hashnode and Medium, each pointing
// back to the original on anirudhvasudevan.com with a canonical URL, so the site keeps the search
// credit and the copies add links and name mentions.
//
// Usage: node syndication/export.mjs        (from the repo root; no dependencies beyond gray-matter)
// Writes:
//   syndication/devto/<slug>.md          front matter for DEV's markdown editor + body
//   syndication/hashnode/<slug>.md       front matter for Hashnode + body
//   syndication/medium/import-list.md    URLs for Medium's "Import a story" tool, in posting order
//   syndication/SCHEDULE.md              one article a week, with a checkbox per platform
// Copies of articles that are no longer published are deleted. Output is deterministic, so a rerun
// with no content changes leaves git clean.
//
// Body changes, compared with content/articles/<slug>.md:
//   - site-relative links become absolute https://anirudhvasudevan.com URLs; links to articles that
//     are still drafts keep their words and lose the link (same rule as the site build)
//   - diagrams point at an image on the site, with the caption under it. When the dark-background
//     images from render-diagrams.mjs are deployed (public/blog/diagrams/raster/), those are used;
//     otherwise the site's SVG (readable on a dark theme, faint on a white one)
//   - the TL;DR, award and live/source links from the top of the site page are added at the top
//   - a footer says where the article was first published and who wrote it
// Code blocks and inline code are never touched.
import fs from 'node:fs';
import path from 'node:path';
import matter from 'gray-matter';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const SRC = path.join(ROOT, 'content', 'articles');
const OUT = path.join(ROOT, 'syndication');
const SITE = 'https://anirudhvasudevan.com';
const HOSTED_RASTER = path.join(ROOT, 'public', 'blog', 'diagrams', 'raster');
const LOCAL_RASTER = path.join(OUT, 'diagrams');
const OG_DIR = path.join(ROOT, 'public', 'blog', 'og');

// Posting order: hackathon results and the patent first (they carry the facts people search for),
// then the products, then everything else newest first. Slugs not listed here follow in date order.
const PRIORITY = [
  'lark-multi-agent-mcp',
  'living-photos-gaussian-splats',
  'facetime-from-mars',
  'screensense-voice-browser-agent',
  'apartment-4b-horror-game',
  'civs-contactless-voting-patent',
  'moss-voice-cpa-yc-hackathon',
  'rua-product-story',
  'rua-caregiver-app-offline-first',
  'anirudhs-world-deterministic-village',
  'anibot-portfolio-chatbot',
  'youtube-shorts-factory-automated-pipeline',
];

// Same sentence as the author box on the site (scripts/build-blog.mjs) and content/pages/about.md.
const BYLINE =
  "I'm Anirudh Vasudevan, a full-stack and AI engineer in San Francisco and a Member of Technical Staff at Rivo, where I build production voice AI agents. I have won five hackathons, hold a granted patent, and co-wrote a paper accepted to EMNLP.";

const isoDay = (v) => (v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10));
const yamlStr = (s) => JSON.stringify(String(s)); // a JSON string is a valid YAML double-quoted scalar
const uniq = (list) => [...new Set(list.filter(Boolean))];
const warnings = [];

// ---------- load ----------
const all = fs
  .readdirSync(SRC)
  .filter((f) => f.endsWith('.md'))
  .sort()
  .map((file) => {
    const { data, content } = matter(fs.readFileSync(path.join(SRC, file), 'utf8'));
    return { ...data, file, content, date: isoDay(data.date), tags: Array.isArray(data.tags) ? data.tags : String(data.tags).split(',').map((t) => t.trim()) };
  });
const articles = all.filter((a) => !a.draft);
const PUBLISHED = new Set(articles.map((a) => String(a.slug).toLowerCase()));
const rank = (a) => {
  const i = PRIORITY.indexOf(a.slug);
  return i === -1 ? PRIORITY.length : i;
};
articles.sort((a, b) => rank(a) - rank(b) || (a.date < b.date ? 1 : a.date > b.date ? -1 : a.slug.localeCompare(b.slug)));

// ---------- tags ----------
// Site tags are free text ("React Three Fiber", "Voice AI"). Each platform has its own rules.
const key = (t) => String(t).trim().toLowerCase();
const AI_TAGS = new Set([
  'voice ai', 'elevenlabs', 'openai', 'groq', 'rag', 'livekit', 'agents', 'mcp', 'whisper', 'groq whisper',
  'aws bedrock', 'llm pipelines', 'llama 4', 'amazon nova', 'browser agents', 'multi-agent', 'multi-app agents',
  'computer vision', 'd-id', 'video ai', 'fal', 'moss', 'langchain', 'pinecone', 'speech engine', 'firecrawl',
]);
const GAME_TAGS = new Set(['game dev', 'game design', 'game ai']);
const isAi = (a) => a.tags.some((t) => AI_TAGS.has(key(t)));
const isGame = (a) => a.tags.some((t) => GAME_TAGS.has(key(t)));
const broadTag = (a) => (isAi(a) ? 'ai' : isGame(a) ? 'gamedev' : a.tags.some((t) => key(t) === 'react native') ? 'mobile' : 'webdev');

// DEV: at most 4 tags, lowercase letters and digits only.
const DEVTO = {
  'voice ai': 'voiceai', 'react three fiber': 'threejs', 'three.js': 'threejs', 'next.js': 'nextjs',
  'game dev': 'gamedev', 'game design': 'gamedev', 'game ai': 'gamedev', 'web audio': 'webaudio',
  'web audio api': 'webaudio', 'webaudio': 'webaudio', 'html audio': 'webaudio', 'react native': 'reactnative',
  'aws bedrock': 'aws', 'amazon nova': 'aws', 'groq whisper': 'whisper', 'llm pipelines': 'llm',
  'multi-agent': 'agents', 'browser agents': 'agents', 'multi-app agents': 'agents', 'cloudflare workers': 'cloudflare',
  'github actions': 'githubactions', 'chrome extension': 'chromeextension', 'netlify functions': 'netlify',
};
// Tags with a large following on DEV go before niche ones, keeping the article's own order otherwise.
const DEVTO_POPULAR = new Set([
  'voiceai', 'elevenlabs', 'mcp', 'rag', 'llm', 'agents', 'openai', 'langchain', 'python', 'typescript', 'javascript',
  'react', 'nextjs', 'reactnative', 'threejs', 'gamedev', 'aws', 'computervision', 'firebase', 'cloudflare',
  'githubactions', 'ffmpeg', 'hackathon', 'webaudio',
]);
const devtoTag = (t) => DEVTO[key(t)] || key(t).replace(/[^a-z0-9]/g, '');
const prioritized = (tags, popular) => [...tags.filter((t) => popular.has(t)), ...tags.filter((t) => !popular.has(t))];
const devtoTags = (a) => {
  const mapped = uniq(a.tags.map(devtoTag));
  return uniq([broadTag(a), ...prioritized(mapped, DEVTO_POPULAR)]).slice(0, 4);
};

// Hashnode: up to 5 tag slugs (lowercase, hyphenated). These are Hashnode's slugs for the common ones.
const HASHNODE = {
  'react': 'reactjs', 'react three fiber': 'threejs', 'three.js': 'threejs', 'next.js': 'nextjs',
  'game dev': 'game-development', 'game design': 'game-development', 'game ai': 'game-development',
  'react native': 'react-native', 'aws bedrock': 'aws', 'amazon nova': 'aws', 'llm pipelines': 'llm',
  'web audio api': 'web-audio', 'webaudio': 'web-audio', 'html audio': 'web-audio', 'groq whisper': 'whisper',
  'multi-agent': 'ai-agents', 'agents': 'ai-agents', 'browser agents': 'ai-agents', 'multi-app agents': 'ai-agents',
};
const HASHNODE_BROAD = { ai: 'ai', gamedev: 'game-development', mobile: 'mobile-development', webdev: 'web-development' };
const HASHNODE_POPULAR = new Set([
  'voice-ai', 'elevenlabs', 'mcp', 'rag', 'llm', 'ai-agents', 'openai', 'langchain', 'python', 'typescript', 'javascript',
  'reactjs', 'nextjs', 'react-native', 'threejs', 'game-development', 'aws', 'computer-vision', 'firebase', 'ffmpeg', 'hackathon',
]);
const hashnodeTag = (t) => HASHNODE[key(t)] || key(t).replace(/\+/g, ' plus ').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const hashnodeTags = (a) => {
  const mapped = uniq(a.tags.map(hashnodeTag));
  return uniq([HASHNODE_BROAD[broadTag(a)], ...prioritized(mapped, HASHNODE_POPULAR)]).slice(0, 5);
};

// Medium: up to 5 free-text tags.
const mediumTags = (a) => uniq([isAi(a) ? 'Artificial Intelligence' : isGame(a) ? 'Game Development' : 'Web Development', ...a.tags]).slice(0, 5);

// ---------- diagrams ----------
const RASTER_EXT = ['jpg', 'png'];
const findRaster = (dir, name) => {
  for (const ext of RASTER_EXT) {
    const f = path.join(dir, `${name}.${ext}`);
    if (fs.existsSync(f)) return { file: f, ext };
  }
  return null;
};
const diagram = (name) => {
  const hosted = findRaster(HOSTED_RASTER, name);
  if (hosted) return { url: `${SITE}/blog/diagrams/raster/${name}.${hosted.ext}`, local: path.relative(ROOT, hosted.file), hosted: true };
  const local = findRaster(LOCAL_RASTER, name);
  return { url: `${SITE}/blog/diagrams/${name}.svg`, local: local ? path.relative(ROOT, local.file) : null };
};

// ---------- body ----------
// The page an article lives on, used to resolve relative links exactly as a browser would.
const SITE_HOSTS = new Set([new URL(SITE).host, `www.${new URL(SITE).host}`]);
const absolute = (href, base) => {
  if (!href || href.startsWith('#') || /^(mailto|tel):/i.test(href)) return { href };
  let u;
  try {
    u = new URL(href, base);
  } catch {
    return { href };
  }
  if (!SITE_HOSTS.has(u.host)) return { href: u.href };
  u.host = new URL(SITE).host;
  const m = /^\/blog\/([^/.]+)\/?$/i.exec(u.pathname);
  const draft = Boolean(m && m[1].toLowerCase() !== 'topics' && !PUBLISHED.has(decodeURIComponent(m[1]).toLowerCase()));
  return { href: u.href, draft };
};

// Split markdown into fenced code blocks (kept verbatim) and prose.
function segments(md) {
  const out = [];
  const lines = md.split('\n');
  let buf = [];
  let fence = null;
  const flush = (code) => {
    if (buf.length) out.push({ code, text: buf.join('\n') });
    buf = [];
  };
  for (const line of lines) {
    const m = /^\s{0,3}(`{3,}|~{3,})/.exec(line);
    if (!fence && m) {
      flush(false);
      fence = m[1];
      buf.push(line);
    } else if (fence && m && m[1][0] === fence[0] && m[1].length >= fence.length && line.trim() === m[1]) {
      buf.push(line);
      flush(true);
      fence = null;
    } else {
      buf.push(line);
    }
  }
  flush(Boolean(fence));
  return out;
}

const LINK = /(!?)\[((?:[^[\]]|\[[^\]]*\])*)\]\(\s*<?([^)\s>]+)>?(\s+"[^"]*")?\s*\)/g;

function rewriteProse(text, a, figures) {
  const base = `${SITE}/blog/${a.slug}/`;
  // Protect inline code spans first.
  const spans = [];
  let t = text.replace(/(`+)([\s\S]*?[^`])\1(?!`)/g, (m) => {
    spans.push(m);
    return `\u0000${spans.length - 1}\u0000`;
  });
  // A diagram on its own line becomes image + visible caption (the site shows it as a figcaption).
  t = t.replace(/^!\[([^\]]*)\]\(\s*(\/blog\/diagrams\/([^)/\s]+)\.svg)\s*\)[ \t]*$/gm, (m, alt, href, name) => {
    const d = diagram(name);
    figures.push({ name, alt, ...d });
    return alt ? `![${alt}](${d.url})\n\n*${alt}*` : `![](${d.url})`;
  });
  t = t.replace(LINK, (m, bang, label, href, title = '') => {
    if (bang && /^\/blog\/diagrams\/.+\.svg$/.test(href)) {
      const name = path.basename(href, '.svg');
      const d = diagram(name);
      figures.push({ name, alt: label, ...d });
      return `![${label}](${d.url}${title})`;
    }
    const r = absolute(href, base);
    if (r.draft) {
      warnings.push(`${a.file}: unlinked draft reference ${href}`);
      return label;
    }
    return `${bang}[${label}](${r.href}${title})`;
  });
  return t.replace(/\u0000(\d+)\u0000/g, (m, i) => spans[Number(i)]);
}

// DEV runs article bodies through Liquid; {{ or {% inside code would break the post.
const devtoSafe = (seg) => (seg.code && /\{\{|\{%/.test(seg.text) ? `{% raw %}\n${seg.text}\n{% endraw %}` : seg.text);

function body(a, platform) {
  const figures = [];
  const main = segments(a.content.trim())
    .map((s) => (s.code ? (platform === 'devto' ? devtoSafe(s) : s.text) : rewriteProse(s.text, a, figures)))
    .join('\n');
  const canonical = `${SITE}/blog/${a.slug}/`;
  const top = [];
  if (a.summary || a.award) {
    const quote = [];
    if (a.award) quote.push(`> **${a.award}**`);
    if (a.award && a.summary) quote.push('>');
    if (a.summary) quote.push(`> **TL;DR** ${String(a.summary).trim()}`);
    top.push(quote.join('\n'));
  }
  const links = [
    a.live && `[Live demo](${absolute(a.live, canonical).href})`,
    a.repo && `[Source on GitHub](${a.repo})`,
  ].filter(Boolean);
  if (links.length) top.push(links.join(' · '));
  const footer = [
    '---',
    `*Originally published on [anirudhvasudevan.com](${canonical}).*`,
    `*${BYLINE} More about me at [anirudhvasudevan.com/about](${SITE}/about/), and every project write-up is at [anirudhvasudevan.com/blog](${SITE}/blog/).*`,
  ];
  return { text: `${[...top, main, ...footer].join('\n\n')}\n`, figures };
}

// ---------- cover ----------
const coverUrl = (a) => {
  if (a.cover) return /^https?:\/\//.test(a.cover) ? a.cover : `${SITE}${a.cover}`;
  if (fs.existsSync(path.join(OG_DIR, `${a.slug}.png`))) return `${SITE}/blog/og/${a.slug}.png`;
  warnings.push(`${a.file}: no share image at public/blog/og/${a.slug}.png; cover left out`);
  return null;
};

// ---------- write ----------
const write = (rel, text) => {
  const file = path.join(OUT, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
};
const prune = (dir) => {
  const keep = new Set(articles.map((a) => `${a.slug}.md`));
  const full = path.join(OUT, dir);
  if (!fs.existsSync(full)) return;
  for (const f of fs.readdirSync(full)) {
    if (f.endsWith('.md') && !keep.has(f)) {
      fs.rmSync(path.join(full, f));
      console.log(`[syndication] removed ${dir}/${f} (article no longer published)`);
    }
  }
};

const rows = [];
for (const a of articles) {
  const canonical = `${SITE}/blog/${a.slug}/`;
  const cover = coverUrl(a);

  const dev = body(a, 'devto');
  const devFront = [
    '---',
    `title: ${yamlStr(a.title)}`,
    'published: false',
    `description: ${yamlStr(a.description)}`,
    `tags: ${devtoTags(a).join(', ')}`,
    `canonical_url: ${canonical}`,
    ...(cover ? [`cover_image: ${cover}`] : []),
    '---',
  ].join('\n');
  write(path.join('devto', `${a.slug}.md`), `${devFront}\n\n${dev.text}`);

  const hn = body(a, 'hashnode');
  const hnFront = [
    '---',
    `title: ${yamlStr(a.title)}`,
    `subtitle: ${yamlStr(a.description)}`,
    `slug: ${a.slug}`,
    `tags: ${hashnodeTags(a).join(', ')}`,
    ...(cover ? [`cover: ${cover}`] : []),
    `canonical: ${canonical}`,
    'saveAsDraft: true',
    'enableToc: true',
    '---',
  ].join('\n');
  write(path.join('hashnode', `${a.slug}.md`), `${hnFront}\n\n${hn.text}`);

  rows.push({ a, canonical, figures: dev.figures });
}
prune('devto');
prune('hashnode');

// Medium: its import tool reads the live page and adds the canonical link itself.
const medium = [
  '# Medium import list',
  '',
  'Generated by `node syndication/export.mjs`. Do not edit by hand.',
  '',
  'Medium copies a story from its live URL and sets the canonical link back to anirudhvasudevan.com on its own. Import one story a week, in this order. Steps are in `syndication/README.md`.',
  '',
  "Medium's importer leaves the diagrams out, because the site draws them inline as SVG. After each import, check where the diagrams should be and upload the two images listed under that story, typing the caption under each one.",
  '',
  '## All URLs, in order',
  '',
  '```text',
  ...rows.map((r) => r.canonical),
  '```',
  '',
  '## One by one',
  '',
  ...rows.flatMap((r, i) => [
    `### ${i + 1}. ${r.a.title}`,
    '',
    `- Import: ${r.canonical}`,
    `- Tags (Medium allows 5): ${mediumTags(r.a).join(', ')}`,
    ...r.figures.map((f) => `- Diagram: ${f.local ? `\`${f.local}\`` : f.url}, caption: ${f.alt || '(none)'}`),
    '',
  ]),
];
write(path.join('medium', 'import-list.md'), `${medium.join('\n').trimEnd()}\n`);

// Weekly tracker. Ticks ([x]) already in the file are kept across reruns, matched by slug.
const ticks = new Map();
const scheduleFile = path.join(OUT, 'SCHEDULE.md');
if (fs.existsSync(scheduleFile)) {
  for (const line of fs.readFileSync(scheduleFile, 'utf8').split('\n')) {
    const slug = /`devto\/([^`]+)\.md`/.exec(line)?.[1];
    if (slug) ticks.set(slug, [...line.matchAll(/\[( |x)\]/gi)].map((m) => m[1].toLowerCase() === 'x'));
  }
}
const box = (slug, i) => (ticks.get(slug)?.[i] ? '[x]' : '[ ]');
const schedule = [
  '# Syndication schedule',
  '',
  'Generated by `node syndication/export.mjs`. Tick a box by changing `[ ]` to `[x]`; reruns keep your ticks.',
  '',
  'One article a week. Post it to DEV and Hashnode as a draft first, check the preview, then publish. Import it into Medium the same day. Only syndicate an article after Search Console shows it as indexed (URL inspection says "URL is on Google"), so Google already knows the original.',
  '',
  '| Week | Article | DEV | Hashnode | Medium |',
  '|---|---|---|---|---|',
  ...rows.map(
    (r, i) =>
      `| ${i + 1} | [${r.a.title.replace(/\|/g, '\\|')}](${r.canonical}) | ${box(r.a.slug, 0)} \`devto/${r.a.slug}.md\` | ${box(r.a.slug, 1)} \`hashnode/${r.a.slug}.md\` | ${box(r.a.slug, 2)} import |`,
  ),
];
write('SCHEDULE.md', `${schedule.join('\n')}\n`);

// ---------- checks ----------
// House style: no em or en dashes in anything this script adds (article prose is linted separately).
for (const dir of ['devto', 'hashnode']) {
  for (const f of fs.readdirSync(path.join(OUT, dir))) {
    const text = segments(fs.readFileSync(path.join(OUT, dir, f), 'utf8'))
      .filter((s) => !s.code)
      .map((s) => s.text.replace(/`[^`]*`/g, ''))
      .join('\n');
    if (/[\u2013\u2014]/.test(text)) warnings.push(`${dir}/${f}: em or en dash in prose`);
    if (/\]\(\/(?!\/)/.test(text)) warnings.push(`${dir}/${f}: a site-relative link survived`);
  }
}

for (const w of warnings) console.warn(`[syndication] ${w}`);
console.log(
  `[syndication] ${articles.length} article(s) -> syndication/devto, syndication/hashnode, syndication/medium/import-list.md, syndication/SCHEDULE.md`,
);
const figures = rows.flatMap((r) => r.figures);
const svgCount = figures.filter((f) => !f.hosted).length;
if (svgCount) {
  console.log(
    `[syndication] ${svgCount} of ${figures.length} diagram link(s) use the site's SVG (faint on light themes). To fix: deploy the dark-background images (see syndication/README.md), then rerun.`,
  );
} else {
  console.log(`[syndication] all ${figures.length} diagram link(s) use the deployed dark-background images`);
}
