// Deterministic checks for content/articles/*.md (frontmatter, length, style rules, diagram refs)
// and content/pages/*.md (frontmatter, style rules). Both get a privacy check for phone numbers.
// Usage: node scripts/lint-articles.mjs   (exit 1 on any error)
import fs from 'node:fs';
import path from 'node:path';
import matter from 'gray-matter';

const ROOT = process.cwd();
const SRC = path.join(ROOT, 'content', 'articles');
const PAGES = path.join(ROOT, 'content', 'pages');
const DIAGRAMS = path.join(ROOT, 'content', 'diagrams');
const BANNED =
  /\b(delve|crucial|robust|comprehensive|nuanced|multifaceted|furthermore|moreover|additionally|pivotal|landscape|tapestry|underscore|foster|showcase|intricate|vibrant|seamless|leverage|harness|journey|testament|game-changer)\b/gi;
// US-style phone numbers: (952) 245 7395, 952-245-7395, 952.245.7395. The site never publishes one.
const PHONE = /(?:\(\d{3}\)\s?|\b\d{3}[\s.-])\d{3}[\s.-]\d{4}\b/;

let errors = 0;
let warnings = 0;
const err = (f, m) => {
  errors += 1;
  console.log(`ERROR ${f}: ${m}`);
};
const warn = (f, m) => {
  warnings += 1;
  console.log(`warn  ${f}: ${m}`);
};

const files = fs.readdirSync(SRC).filter((f) => f.endsWith('.md'));
const slugs = new Set();
for (const file of files) {
  const raw = fs.readFileSync(path.join(SRC, file), 'utf8');
  let parsed;
  try {
    parsed = matter(raw);
  } catch (e) {
    err(file, `frontmatter does not parse: ${e.message}`);
    continue;
  }
  const { data, content } = parsed;
  const slug = data.slug;
  for (const k of ['title', 'description', 'date', 'slug', 'project', 'tags', 'summary']) {
    if (!data[k]) err(file, `missing frontmatter "${k}"`);
  }
  if (slug && file !== `${slug}.md`) warn(file, `filename does not match slug "${slug}"`);
  if (slug) {
    if (slugs.has(slug)) err(file, `duplicate slug ${slug}`);
    slugs.add(slug);
  }
  if (data.title && (data.title.length < 30 || data.title.length > 80)) warn(file, `title length ${data.title.length}`);
  if (data.description && (data.description.length < 100 || data.description.length > 170))
    warn(file, `description length ${data.description.length}`);
  if (data.summary && (data.summary.length < 150 || data.summary.length > 360)) warn(file, `summary length ${data.summary.length}`);
  if (Array.isArray(data.tags) && (data.tags.length < 3 || data.tags.length > 6)) warn(file, `${data.tags.length} tags`);
  if (data.repo && !/^https:\/\/github\.com\/anirxdh\//.test(data.repo)) err(file, `repo is not an anirxdh GitHub URL: ${data.repo}`);
  if (data.live && !/^https?:\/\//.test(data.live)) err(file, `live is not a URL: ${data.live}`);

  // body checks (ignore code blocks for dash/banned-word checks)
  const prose = content.replace(/```[\s\S]*?```/g, '');
  const dashes = (prose.match(/[—–]/g) || []).length;
  if (dashes) err(file, `${dashes} em/en dash(es) in prose`);
  const fmDashes = (JSON.stringify(data).match(/[—–]/g) || []).length;
  if (fmDashes) err(file, `${fmDashes} em/en dash(es) in frontmatter`);
  const banned = [...prose.matchAll(BANNED)].map((m) => m[0].toLowerCase());
  if (banned.length) warn(file, `banned words: ${[...new Set(banned)].join(', ')}`);
  const words = prose.split(/\s+/).filter(Boolean).length;
  if (words < 1400) err(file, `only ${words} words (min 1600 target)`);
  else if (words < 1600 || words > 2600) warn(file, `${words} words`);

  // structure
  const h2s = [...content.matchAll(/^## (.+)$/gm)].map((m) => m[1].trim());
  if (!h2s.some((h) => /^faq$/i.test(h))) err(file, 'missing "## FAQ" section');
  if (!h2s.some((h) => /takeaway/i.test(h))) warn(file, 'no "Key takeaways" heading');
  const faqQs = (content.match(/^### .+\?\s*$/gm) || []).length;
  if (faqQs < 3) warn(file, `only ${faqQs} FAQ questions (### ...?)`);
  if (!/\| *Layer *\| *Choice *\| *Why *\|/i.test(content)) warn(file, 'no | Layer | Choice | Why | table');
  const codeBlocks = (content.match(/```/g) || []).length / 2;
  if (codeBlocks < 2) warn(file, `${codeBlocks} code blocks`);

  // diagrams
  for (const kind of ['architecture', 'flow']) {
    const ref = `](/blog/diagrams/${slug}-${kind}.svg)`;
    const n = content.split(ref).length - 1;
    if (n !== 1) err(file, `${kind} diagram referenced ${n} times (expected 1)`);
    if (!fs.existsSync(path.join(DIAGRAMS, `${slug}-${kind}.mmd`))) err(file, `missing content/diagrams/${slug}-${kind}.mmd`);
  }
  const otherImgs = [...content.matchAll(/!\[[^\]]*\]\(([^)]+)\)/g)].map((m) => m[1]).filter((s) => !s.startsWith('/blog/diagrams/'));
  if (otherImgs.length) warn(file, `non-diagram images: ${otherImgs.join(', ')}`);

  // secrets / PII smell test
  if (/sk-[A-Za-z0-9]{20,}|xi-api-key|AKIA[0-9A-Z]{16}|pk_live_|sk_live_/.test(raw)) err(file, 'possible secret in article');
  if (PHONE.test(prose)) err(file, `looks like a phone number: "${prose.match(PHONE)[0]}"`);
}

// ---------- content/pages/*.md (about, resume, projects) ----------
const pages = fs.existsSync(PAGES) ? fs.readdirSync(PAGES).filter((f) => f.endsWith('.md')).sort() : [];
for (const name of pages) {
  const file = `pages/${name}`;
  const raw = fs.readFileSync(path.join(PAGES, name), 'utf8');
  let parsed;
  try {
    parsed = matter(raw);
  } catch (e) {
    err(file, `frontmatter does not parse: ${e.message}`);
    continue;
  }
  const { data, content } = parsed;
  for (const k of ['title', 'description', 'date', 'slug']) {
    if (!data[k]) err(file, `missing frontmatter "${k}"`);
  }
  if (data.description && (data.description.length < 100 || data.description.length > 170))
    warn(file, `description length ${data.description.length}`);
  // Frontmatter carries real copy here (resume entries, project blurbs), so check it like prose.
  const text = `${JSON.stringify(data)}\n${content.replace(/```[\s\S]*?```/g, '')}`;
  const dashes = (text.match(/[—–]/g) || []).length;
  if (dashes) err(file, `${dashes} em/en dash(es)`);
  const banned = [...text.matchAll(BANNED)].map((m) => m[0].toLowerCase());
  if (banned.length) warn(file, `banned words: ${[...new Set(banned)].join(', ')}`);
  if (PHONE.test(raw)) err(file, `looks like a phone number: "${raw.match(PHONE)[0]}"`);
  if (/sk-[A-Za-z0-9]{20,}|xi-api-key|AKIA[0-9A-Z]{16}|pk_live_|sk_live_/.test(raw)) err(file, 'possible secret in page');
}

console.log(`\n${files.length} articles, ${pages.length} pages, ${errors} errors, ${warnings} warnings`);
process.exit(errors ? 1 : 0);
