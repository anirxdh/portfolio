#!/usr/bin/env node
// SEO and GEO audit of the built site. Run it after `npm run build`; it reads dist/ and changes nothing.
// No dependencies: node built-ins, plus the Person entity from scripts/blog/person.mjs, which is the
// source of truth every page's structured data must agree with.
//
// Usage:
//   node scripts/validate-seo.mjs              audit dist/ and print a report (exit 1 on any error)
//   node scripts/validate-seo.mjs --quiet      print errors only
//   node scripts/validate-seo.mjs --strict     treat warnings as errors too
//   node scripts/validate-seo.mjs --dist=out   audit another build folder
//
// Checks:
//   every HTML page   one <title> (30-65 chars), meta description (70-165 chars), one absolute
//                     self-referencing canonical, og:title/og:description/og:image/og:url, twitter:card,
//                     <html lang>, one <h1>, unique ids, alt on every <img>, no em or en dashes in the
//                     title or description, every internal link and asset exists in dist/
//   JSON-LD           every block parses; per type: BlogPosting/Article, ProfilePage, Person, FAQPage
//                     (questions visible on the page), BreadcrumbList, ItemList, CollectionPage,
//                     WebSite, ScholarlyArticle, Event; every on-site URL exists; every node with the
//                     site's Person @id agrees with person.mjs
//   sitemap.xml       well-formed, every <loc> exists and is canonical, every indexable page listed,
//                     <lastmod> is YYYY-MM-DD
//   robots.txt        Sitemap line, no search or AI crawler blocked from a sitemap URL
//   llms.txt          llmstxt.org shape, every link exists, every indexable page listed
//   feeds, manifest   RSS/Atom feeds parse and link to real pages; manifest icons exist
//   site-wide         duplicate titles, descriptions and canonicals; pages nothing links to

import fs from 'node:fs';
import path from 'node:path';
import { SITE, PERSON_ID, person } from './blog/person.mjs';

// ---------- options ----------
const args = process.argv.slice(2);
const has = (flag) => args.includes(`--${flag}`);
const optValue = (flag) => args.find((a) => a.startsWith(`--${flag}=`))?.slice(flag.length + 3);
if (has('help')) {
  console.log('Usage: node scripts/validate-seo.mjs [--quiet] [--strict] [--dist=<dir>]');
  process.exit(0);
}
const ROOT = process.cwd();
const DIST = path.resolve(ROOT, optValue('dist') || 'dist');
const QUIET = has('quiet');
const STRICT = has('strict');

const SITE_URL = new URL(SITE);
const HOST = SITE_URL.host;
const SITE_HOSTS = new Set([HOST, `www.${HOST}`]);
const CANON_PERSON = person();
const TODAY = new Date().toISOString().slice(0, 10);
const DASH = /[\u2013\u2014]/;
const TITLE_RANGE = [30, 65];
const DESCRIPTION_RANGE = [70, 165];
const HEADLINE_MAX = 110;

if (!fs.existsSync(DIST) || !fs.statSync(DIST).isDirectory()) {
  console.error(`[seo] ${DIST} not found. Run \`npm run build\` first.`);
  process.exit(1);
}

// ---------- report ----------
const groups = new Map(); // where -> { file, rank, items: [{ level, msg }], seen }
function report(where, level, msg) {
  let g = groups.get(where);
  if (!g) {
    g = { items: [], seen: new Set() };
    groups.set(where, g);
  }
  const key = `${level}|${msg}`;
  if (g.seen.has(key)) return;
  g.seen.add(key);
  g.items.push({ level, msg });
}
const error = (where, msg) => report(where, 'error', msg);
const warn = (where, msg) => report(where, 'warn', msg);

// ---------- small helpers ----------
const isFile = (f) => {
  try {
    return fs.statSync(f).isFile();
  } catch {
    return false;
  }
};
const toPosix = (p) => p.split(path.sep).join('/');
const clean = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
const short = (s, n = 90) => {
  const t = clean(s);
  return t.length > n ? `${t.slice(0, n - 3)}...` : t;
};
const chars = (s) => [...String(s)].length;
const safeDecode = (s) => {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
};
const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const arr = (v) => (v === undefined || v === null ? [] : Array.isArray(v) ? v : [v]);
const typesOf = (node) => arr(node?.['@type']).map(String);
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
// Text comparison that ignores case, spacing and curly quotes.
const norm = (s) =>
  String(s ?? '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
const squash = (s) => norm(s).replace(/\s+/g, '');

const ISO = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/;
function isIsoDate(s) {
  const m = ISO.exec(String(s));
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const dt = new Date(Date.UTC(y, mo - 1, d));
  const dayOk = dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
  const timeOk = m[4] === undefined || (Number(m[4]) < 24 && Number(m[5]) < 60 && (m[6] === undefined || Number(m[6]) < 60));
  return dayOk && timeOk;
}

function lineIndex(src) {
  const starts = [0];
  for (let i = src.indexOf('\n'); i !== -1; i = src.indexOf('\n', i + 1)) starts.push(i + 1);
  return (idx) => {
    let lo = 0;
    let hi = starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (starts[mid] <= idx) lo = mid;
      else hi = mid - 1;
    }
    return lo + 1;
  };
}

// Width and height of a PNG, GIF, JPEG or WebP file (null for anything else).
function imageSize(file) {
  let fd;
  try {
    fd = fs.openSync(file, 'r');
    const buf = Buffer.alloc(256 * 1024);
    const b = buf.subarray(0, fs.readSync(fd, buf, 0, buf.length, 0));
    if (b.length >= 24 && b.readUInt32BE(0) === 0x89504e47 && b.toString('ascii', 12, 16) === 'IHDR') {
      return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
    }
    if (b.length >= 10 && b.toString('ascii', 0, 3) === 'GIF') return { width: b.readUInt16LE(6), height: b.readUInt16LE(8) };
    if (b.length >= 30 && b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP') {
      const chunk = b.toString('ascii', 12, 16);
      if (chunk === 'VP8X') return { width: 1 + b.readUIntLE(24, 3), height: 1 + b.readUIntLE(27, 3) };
      if (chunk === 'VP8 ') return { width: b.readUInt16LE(26) & 0x3fff, height: b.readUInt16LE(28) & 0x3fff };
      if (chunk === 'VP8L') {
        const bits = b.readUInt32LE(21);
        return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
      }
    }
    if (b[0] === 0xff && b[1] === 0xd8) {
      let o = 2;
      while (o + 9 < b.length) {
        if (b[o] !== 0xff) {
          o += 1;
          continue;
        }
        const marker = b[o + 1];
        if (marker === 0xff) {
          o += 1;
          continue;
        }
        if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) {
          o += 2;
          continue;
        }
        if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
          return { height: b.readUInt16BE(o + 5), width: b.readUInt16BE(o + 7) };
        }
        o += 2 + b.readUInt16BE(o + 2);
      }
    }
    return null;
  } catch {
    return null;
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

// ---------- HTML parsing ----------
// A small tolerant tokenizer, enough for generated pages: elements with attributes, ancestry (head,
// svg), raw-text elements, the visible body text, and the text inside each <h1> and <a>.
const NAMED_ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00a0', mdash: '\u2014', ndash: '\u2013',
  hellip: '\u2026', lsquo: '\u2018', rsquo: '\u2019', ldquo: '\u201c', rdquo: '\u201d', middot: '\u00b7',
  copy: '\u00a9', reg: '\u00ae', trade: '\u2122', rarr: '\u2192', larr: '\u2190', nearr: '\u2197',
  times: '\u00d7', bull: '\u2022', deg: '\u00b0', laquo: '\u00ab', raquo: '\u00bb',
};
const decode = (s) =>
  String(s).replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z][a-z0-9]*);/gi, (m, e) => {
    if (e[0] === '#') {
      const cp = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      try {
        return String.fromCodePoint(cp);
      } catch {
        return m;
      }
    }
    return NAMED_ENTITIES[e] ?? NAMED_ENTITIES[e.toLowerCase()] ?? m;
  });

const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);
const BLOCK = new Set([
  'address', 'article', 'aside', 'blockquote', 'br', 'dd', 'details', 'div', 'dl', 'dt', 'figcaption', 'figure',
  'footer', 'form', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'header', 'hr', 'li', 'main', 'nav', 'ol', 'p', 'pre',
  'section', 'summary', 'table', 'tbody', 'td', 'tfoot', 'th', 'thead', 'tr', 'ul',
]);
const ATTR = /([^\s"'>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
const END_TAG = /<\/([a-zA-Z][^\s/>]*)[^>]*>/y;

function parseHtml(src) {
  const lineOf = lineIndex(src);
  const els = [];
  const stack = [];
  const body = [];
  const n = src.length;
  const text = (raw) => {
    if (!raw) return;
    const t = decode(raw);
    for (const e of stack) if (e.capture) e.capture.push(t);
    if (!stack.at(-1)?.hidden) body.push(t);
  };
  let i = 0;
  while (i < n) {
    const lt = src.indexOf('<', i);
    if (lt === -1) {
      text(src.slice(i));
      break;
    }
    if (lt > i) text(src.slice(i, lt));
    i = lt;
    if (src.startsWith('<!--', i)) {
      const e = src.indexOf('-->', i + 4);
      i = e === -1 ? n : e + 3;
      continue;
    }
    if (src.startsWith('<![CDATA[', i)) {
      const e = src.indexOf(']]>', i);
      text(src.slice(i + 9, e === -1 ? n : e));
      i = e === -1 ? n : e + 3;
      continue;
    }
    if (src[i + 1] === '!' || src[i + 1] === '?') {
      const e = src.indexOf('>', i);
      i = e === -1 ? n : e + 1;
      continue;
    }
    if (src[i + 1] === '/') {
      END_TAG.lastIndex = i;
      const m = END_TAG.exec(src);
      if (!m) {
        text('<');
        i += 1;
        continue;
      }
      const tag = m[1].toLowerCase();
      for (let k = stack.length - 1; k >= 0; k -= 1) {
        if (stack[k].tag === tag) {
          stack.length = k;
          break;
        }
      }
      if (BLOCK.has(tag)) text(' ');
      i = m.index + m[0].length;
      continue;
    }
    if (!/[a-zA-Z]/.test(src[i + 1] || '')) {
      text('<');
      i += 1;
      continue;
    }
    let j = i + 1;
    while (j < n && !/[\s/>]/.test(src[j])) j += 1;
    const tag = src.slice(i + 1, j).toLowerCase();
    let k = j;
    let quote = null;
    for (; k < n; k += 1) {
      const c = src[k];
      if (quote) {
        if (c === quote) quote = null;
      } else if (c === '"' || c === "'") quote = c;
      else if (c === '>') break;
    }
    const attrs = new Map();
    const dups = [];
    for (const m of src.slice(j, k).matchAll(ATTR)) {
      const name = m[1].toLowerCase();
      if (attrs.has(name)) dups.push(name);
      else attrs.set(name, decode(m[2] ?? m[3] ?? m[4] ?? ''));
    }
    const parent = stack.at(-1) || null;
    const el = {
      tag,
      attrs,
      dups,
      line: lineOf(i),
      parent,
      inSvg: tag === 'svg' || Boolean(parent?.inSvg),
      inHead: Boolean(parent && (parent.tag === 'head' || parent.inHead)),
      hidden: tag === 'head' || tag === 'template' || Boolean(parent?.hidden),
    };
    els.push(el);
    const selfClose = src[k - 1] === '/';
    i = k + 1;
    if (tag === 'title' && parent?.tag === 'svg') parent.hasTitle = true;
    if (tag === 'img' && clean(attrs.get('alt'))) for (const e of stack) if (e.capture) e.capture.push(` ${attrs.get('alt')} `);
    if (BLOCK.has(tag)) text(' ');
    if ((VOID.has(tag) && !el.inSvg) || (selfClose && el.inSvg)) continue;
    if (tag === 'script' || tag === 'style' || tag === 'textarea' || (tag === 'title' && !el.inSvg)) {
      const close = new RegExp(`</${tag}\\s*>`, 'gi');
      close.lastIndex = i;
      const m = close.exec(src);
      const raw = src.slice(i, m ? m.index : n);
      el.text = tag === 'script' || tag === 'style' ? raw : decode(raw);
      if (tag === 'textarea') text(raw);
      i = m ? m.index + m[0].length : n;
      continue;
    }
    if (tag === 'h1' || tag === 'a') el.capture = [];
    stack.push(el);
  }
  return { els, bodyText: clean(body.join('')) };
}

// ---------- XML parsing (sitemap, feeds) ----------
// Strict enough to catch what breaks a sitemap: one root, matched tags, quoted attributes, and no
// bare "&". Returns { name, attrs, children, text, line }.
function parseXml(src) {
  const lineOf = lineIndex(src);
  const n = src.length;
  const fail = (msg, at) => {
    throw new Error(`${msg} (line ${lineOf(at)})`);
  };
  const ENTITY = /&(?:amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);/y;
  const checkAmps = (s, at) => {
    for (let p = s.indexOf('&'); p !== -1; p = s.indexOf('&', p + 1)) {
      ENTITY.lastIndex = p;
      if (!ENTITY.test(s)) fail('unescaped "&" (write &amp;)', at + p);
    }
  };
  const xmlDecode = (s) =>
    s.replace(/&(amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);/g, (m, e) =>
      e[0] === '#' ? String.fromCodePoint(e[1] === 'x' ? parseInt(e.slice(2), 16) : Number(e.slice(1))) : { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }[e],
    );
  const NAME = /[A-Za-z_:][\w.:-]*/y;
  const ATTRIBUTE = /\s+([A-Za-z_:][\w.:-]*)\s*=\s*(?:"([^"<]*)"|'([^'<]*)')/y;
  const start = src.charCodeAt(0) === 0xfeff ? 1 : 0;
  const stack = [];
  let root = null;
  let i = start;
  while (i < n) {
    const lt = src.indexOf('<', i);
    const end = lt === -1 ? n : lt;
    if (end > i) {
      const t = src.slice(i, end);
      if (!stack.length) {
        if (t.trim()) fail('text outside the root element', i);
      } else {
        checkAmps(t, i);
        stack.at(-1).text += xmlDecode(t);
      }
    }
    if (lt === -1) break;
    i = lt;
    if (src.startsWith('<?', i)) {
      const e = src.indexOf('?>', i);
      if (e === -1) fail('unterminated processing instruction', i);
      if (/^<\?xml[\s?]/i.test(src.slice(i, i + 6)) && i !== start) fail('the XML declaration must come first', i);
      i = e + 2;
      continue;
    }
    if (src.startsWith('<!--', i)) {
      const e = src.indexOf('-->', i + 4);
      if (e === -1) fail('unterminated comment', i);
      i = e + 3;
      continue;
    }
    if (src.startsWith('<![CDATA[', i)) {
      const e = src.indexOf(']]>', i);
      if (e === -1) fail('unterminated CDATA section', i);
      if (!stack.length) fail('CDATA outside the root element', i);
      stack.at(-1).text += src.slice(i + 9, e);
      i = e + 3;
      continue;
    }
    if (src.startsWith('<!', i)) {
      const e = src.indexOf('>', i);
      if (e === -1) fail('unterminated declaration', i);
      i = e + 1;
      continue;
    }
    if (src[i + 1] === '/') {
      NAME.lastIndex = i + 2;
      const m = NAME.exec(src);
      const close = m ? src.indexOf('>', NAME.lastIndex) : -1;
      if (!m || close === -1 || src.slice(NAME.lastIndex, close).trim()) fail('malformed end tag', i);
      const top = stack.pop();
      if (!top) fail(`</${m[0]}> closes nothing`, i);
      if (top.name !== m[0]) fail(`</${m[0]}> does not match <${top.name}> from line ${top.line}`, i);
      i = close + 1;
      continue;
    }
    NAME.lastIndex = i + 1;
    const m = NAME.exec(src);
    if (!m) fail('malformed tag', i);
    const el = { name: m[0], attrs: {}, children: [], text: '', line: lineOf(i) };
    let k = NAME.lastIndex;
    for (;;) {
      ATTRIBUTE.lastIndex = k;
      const a = ATTRIBUTE.exec(src);
      if (!a) break;
      if (Object.hasOwn(el.attrs, a[1])) fail(`duplicate attribute "${a[1]}" on <${el.name}>`, i);
      const value = a[2] ?? a[3];
      checkAmps(value, k);
      el.attrs[a[1]] = xmlDecode(value);
      k = ATTRIBUTE.lastIndex;
    }
    while (/\s/.test(src[k] || '')) k += 1;
    let selfClose = false;
    if (src.startsWith('/>', k)) {
      selfClose = true;
      k += 2;
    } else if (src[k] === '>') k += 1;
    else fail(`malformed attribute or tag <${el.name}>`, k);
    if (stack.length) stack.at(-1).children.push(el);
    else if (root) fail('more than one root element', i);
    else root = el;
    if (!selfClose) stack.push(el);
    i = k;
  }
  if (stack.length) fail(`<${stack.at(-1).name}> from line ${stack.at(-1).line} is never closed`, n - 1);
  if (!root) fail('no root element', 0);
  return root;
}
const xmlChildren = (el, name) => el.children.filter((c) => c.name === name);

// ---------- dist index ----------
function listHtml(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...listHtml(p));
    else if (e.isFile() && e.name.endsWith('.html')) out.push(p);
  }
  return out.sort();
}
const routeOf = (rel) =>
  rel === 'index.html' ? '/' : rel.endsWith('/index.html') ? `/${rel.slice(0, -'index.html'.length)}` : `/${rel}`;

// Netlify redirects and rewrites (netlify.toml and dist/_redirects): a link to one of these paths
// is served even though no file exists for it.
function loadRedirects() {
  const froms = [];
  const toml = path.join(ROOT, 'netlify.toml');
  if (isFile(toml)) for (const m of fs.readFileSync(toml, 'utf8').matchAll(/^\s*from\s*=\s*"([^"]+)"/gm)) froms.push(m[1]);
  const file = path.join(DIST, '_redirects');
  if (isFile(file)) {
    for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
      const from = line.replace(/#.*/, '').trim().split(/\s+/)[0];
      if (from) froms.push(from);
    }
  }
  return froms
    .filter((f) => f.startsWith('/'))
    .map((from) => ({ from, re: new RegExp(`^${escRe(from).replace(/\\\*/g, '.*').replace(/:[A-Za-z_]\w*/g, '[^/]+')}$`) }));
}
const REDIRECTS = loadRedirects();

// URL path -> file in dist/, following Netlify's rules: /x/ is x/index.html, /x is the file x, then
// x.html, then x/index.html (which Netlify reaches through a redirect to /x/).
function resolvePath(pathname) {
  let p = safeDecode(pathname);
  if (!p.startsWith('/')) p = `/${p}`;
  if (p.includes('\0')) return null;
  const abs = path.join(DIST, p);
  if (abs !== DIST && !abs.startsWith(DIST + path.sep)) return null;
  if (p.endsWith('/')) {
    const f = path.join(abs, 'index.html');
    return isFile(f) ? { file: f } : null;
  }
  if (isFile(abs)) return { file: abs };
  if (isFile(`${abs}.html`)) return { file: `${abs}.html` };
  if (isFile(path.join(abs, 'index.html'))) return { file: path.join(abs, 'index.html'), slashRedirect: true };
  return null;
}

// href -> { kind: internal | external | other | empty | invalid, url }
function classify(href, base) {
  const raw = String(href ?? '').trim();
  if (!raw) return { kind: 'empty' };
  if (/^(mailto|tel|sms|javascript|data|blob):/i.test(raw)) return { kind: 'other', scheme: raw.split(':')[0].toLowerCase() };
  let url;
  try {
    url = new URL(raw, base);
  } catch {
    return { kind: 'invalid' };
  }
  if (!/^https?:$/.test(url.protocol)) return { kind: 'other', scheme: url.protocol.slice(0, -1) };
  return { kind: SITE_HOSTS.has(url.host) ? 'internal' : 'external', url };
}

const PAGES = [];
const PAGE_BY_FILE = new Map();
const SKIPPED_FRAGMENTS = new Set();

// Checks that an on-site URL exists in dist/ (and its #fragment, when asked). Returns the target page.
function checkInternal(where, label, url, { fragments = true } = {}) {
  if (url.protocol !== 'https:') warn(where, `${label} uses http: ${url.href}`);
  if (url.host !== HOST) warn(where, `${label} uses the non-canonical host ${url.host}: ${url.href}`);
  const hit = resolvePath(url.pathname);
  if (!hit) {
    if (!REDIRECTS.some((r) => r.re.test(url.pathname))) error(where, `${label} points to a path that does not exist in dist/: ${url.pathname}`);
    return null;
  }
  if (hit.slashRedirect) warn(where, `${label} ${url.pathname} has no trailing slash, so it costs a redirect to ${url.pathname}/`);
  const page = PAGE_BY_FILE.get(hit.file) || null;
  if (page && fragments && url.hash.length > 1) {
    const id = safeDecode(url.hash.slice(1));
    if (page.clientRendered) SKIPPED_FRAGMENTS.add(page.route);
    else if (!page.ids.has(id)) warn(where, `${label} ${url.pathname}${url.hash}: ${page.route} has no element with id "${id}"`);
  }
  return page;
}

// ---------- load pages ----------
for (const file of listHtml(DIST)) {
  const src = fs.readFileSync(file, 'utf8');
  const rel = toPosix(path.relative(DIST, file));
  const doc = parseHtml(src);
  const ids = new Map();
  const metas = new Map();
  for (const e of doc.els) {
    const id = e.attrs.get('id');
    if (id !== undefined) {
      if (!ids.has(id)) ids.set(id, []);
      ids.get(id).push(e.line);
    }
    if (e.tag === 'meta' && !e.inSvg) {
      for (const key of new Set([e.attrs.get('name'), e.attrs.get('property')].filter(Boolean).map((k) => k.toLowerCase()))) {
        if (!metas.has(key)) metas.set(key, []);
        metas.get(key).push(e);
      }
    }
  }
  const meta = (key) => metas.get(key) || [];
  const robots = meta('robots').map((e) => (e.attrs.get('content') || '').toLowerCase()).join(', ');
  const page = {
    file,
    rel,
    route: routeOf(rel),
    els: doc.els,
    bodyText: doc.bodyText,
    ids,
    meta,
    robots,
    noindex: /\b(noindex|none)\b/.test(robots),
    // The React homepage renders most of its content (and ids like #contact) in the browser.
    clientRendered: ids.has('root') && doc.els.some((e) => e.tag === 'script' && (e.attrs.get('type') || '').toLowerCase() === 'module'),
    inbound: new Set(),
    ld: [],
  };
  PAGES.push(page);
  PAGE_BY_FILE.set(file, page);
}
PAGES.sort((a, b) => (a.route === '/' ? -1 : b.route === '/' ? 1 : a.route.localeCompare(b.route)));

const relTokens = (e) => (e.attrs.get('rel') || '').toLowerCase().split(/\s+/).filter(Boolean);
const lengthCheck = (where, label, value, [min, max]) => {
  const n = chars(value);
  if (n < min || n > max) warn(where, `${label} is ${n} chars (aim for ${min}-${max}): "${value}"`);
};

function checkShareImage(where, label, value, declared = {}) {
  if (!value) return;
  if (!/^https:\/\//.test(value)) {
    error(where, `${label} must be an absolute https URL: ${value}`);
    return;
  }
  const c = classify(value, `${SITE}/`);
  if (c.kind !== 'internal') return;
  checkInternal(where, label, c.url, { fragments: false });
  const hit = resolvePath(c.url.pathname);
  if (!hit) return;
  const bytes = fs.statSync(hit.file).size;
  if (bytes > 5 * 1024 * 1024) warn(where, `${label} is ${(bytes / 1048576).toFixed(1)} MB; LinkedIn and others drop share images over 5 MB`);
  const size = imageSize(hit.file);
  if (!size) return;
  const dw = Number(declared.width);
  const dh = Number(declared.height);
  if ((declared.width && dw !== size.width) || (declared.height && dh !== size.height)) {
    warn(where, `${label} is ${size.width}x${size.height} but the page declares ${declared.width || '?'}x${declared.height || '?'}`);
  }
  if (size.width < 1200 || size.height < 630) warn(where, `${label} is ${size.width}x${size.height}; 1200x630 or larger renders best in link previews`);
}

// ---------- per-page HTML checks ----------
function checkPage(page) {
  const w = page.route;
  const { els } = page;
  const base = SITE + page.route;
  // The 404 page and noindex pages skip the search-result tags (description, canonical, OG, Twitter).
  const indexable = !page.noindex && page.rel !== '404.html';
  page.indexable = indexable;
  if (page.rel === '404.html' && !page.noindex) warn(w, '404 page should carry <meta name="robots" content="noindex">');

  const html = els.find((e) => e.tag === 'html');
  if (!clean(html?.attrs.get('lang'))) error(w, '<html> has no lang attribute');
  if (!els.some((e) => e.tag === 'meta' && e.attrs.has('charset'))) warn(w, 'no <meta charset>');
  if (!page.meta('viewport').length) warn(w, 'no <meta name="viewport">');

  // <title>
  const titles = els.filter((e) => e.tag === 'title' && !e.inSvg);
  if (titles.length !== 1) error(w, `expected exactly one <title>, found ${titles.length}`);
  page.title = clean(titles[0]?.text);
  if (titles.length && !page.title) error(w, '<title> is empty');
  if (page.title) {
    lengthCheck(w, 'title', page.title, TITLE_RANGE);
    if (DASH.test(page.title)) error(w, `title has an em or en dash: "${page.title}"`);
  }

  // meta description
  const descs = page.meta('description');
  page.description = clean(descs[0]?.attrs.get('content'));
  if (!descs.length && indexable) error(w, 'no meta description');
  if (descs.length > 1) error(w, `${descs.length} meta descriptions (keep one)`);
  if (descs.length && !page.description) error(w, 'meta description is empty');
  if (page.description) {
    lengthCheck(w, 'meta description', page.description, DESCRIPTION_RANGE);
    if (DASH.test(page.description)) error(w, `meta description has an em or en dash: "${short(page.description)}"`);
  }

  // <h1>
  const h1s = els.filter((e) => e.tag === 'h1' && !e.inSvg);
  if (h1s.length !== 1) {
    error(w, `expected exactly one <h1>, found ${h1s.length}${h1s.length ? ` (lines ${h1s.map((e) => e.line).join(', ')})` : ''}`);
  }
  page.h1 = clean(h1s[0]?.capture?.join(''));
  if (h1s.length && !page.h1) error(w, '<h1> is empty');

  // canonical, Open Graph, Twitter (indexable pages)
  const canonicals = els.filter((e) => e.tag === 'link' && relTokens(e).includes('canonical'));
  page.canonicalUrl = canonicals[0]?.attrs.get('href');
  if (indexable) {
    if (canonicals.length !== 1) error(w, canonicals.length ? `${canonicals.length} canonical links (keep one)` : 'no <link rel="canonical">');
    const href = page.canonicalUrl;
    if (href !== undefined) {
      if (!/^https:\/\//.test(href)) error(w, `canonical is not an absolute https URL: ${href}`);
      else if (!href.startsWith(`${SITE}/`)) error(w, `canonical is not on ${SITE}: ${href}`);
      else if (href !== base) error(w, `canonical ${href} does not match the page URL ${base}`);
    }
    for (const key of ['og:title', 'og:description', 'og:image', 'og:url']) {
      const tags = page.meta(key);
      if (!tags.length) error(w, `no <meta property="${key}">`);
      else if (tags.length > 1) warn(w, `${tags.length} ${key} tags`);
      else if (!clean(tags[0].attrs.get('content'))) error(w, `${key} is empty`);
    }
    if (!page.meta('og:type').length) warn(w, 'no og:type');
    const ogUrl = page.meta('og:url')[0]?.attrs.get('content');
    if (ogUrl && href && ogUrl !== href) error(w, `og:url ${ogUrl} differs from the canonical ${href}`);
    const card = page.meta('twitter:card');
    if (!card.length) error(w, 'no <meta name="twitter:card">');
    else if (!['summary', 'summary_large_image', 'app', 'player'].includes(card[0].attrs.get('content'))) {
      warn(w, `twitter:card "${card[0].attrs.get('content')}" is not a known card type`);
    }
    if (/\bnofollow\b/.test(page.robots)) warn(w, `robots meta says "${page.robots}", so links on this indexable page pass no signal`);
    if (!/max-image-preview:large/.test(page.robots)) warn(w, 'robots meta lacks max-image-preview:large (large image previews in Google Search and Discover)');
  }
  for (const key of ['og:title', 'og:description', 'twitter:title', 'twitter:description']) {
    const v = page.meta(key)[0]?.attrs.get('content');
    if (v && DASH.test(v)) error(w, `${key} has an em or en dash: "${short(v)}"`);
  }
  checkShareImage(w, 'og:image', page.meta('og:image')[0]?.attrs.get('content'), {
    width: page.meta('og:image:width')[0]?.attrs.get('content'),
    height: page.meta('og:image:height')[0]?.attrs.get('content'),
  });
  const twImage = page.meta('twitter:image')[0]?.attrs.get('content');
  if (twImage && twImage !== page.meta('og:image')[0]?.attrs.get('content')) checkShareImage(w, 'twitter:image', twImage);

  // ids and attributes
  for (const [id, lines] of page.ids) {
    if (!id.trim()) warn(w, `empty id attribute on line ${lines[0]}`);
    else if (lines.length > 1) error(w, `duplicate id "${id}" (lines ${lines.slice(0, 4).join(', ')}${lines.length > 4 ? ', ...' : ''})`);
  }
  const repeated = els.filter((e) => e.dups.length);
  if (repeated.length) {
    const e = repeated[0];
    warn(w, `${plural(repeated.length, 'element')} with a repeated attribute, whose second value browsers ignore (e.g. <${e.tag}> repeats ${e.dups.join(', ')} on line ${e.line})`);
  }

  // images
  for (const e of els) {
    if (e.tag === 'img' && !e.attrs.has('alt')) error(w, `<img src="${e.attrs.get('src') || ''}"> has no alt attribute (line ${e.line})`);
  }
  const unnamed = els.filter(
    (e) => e.tag === 'svg' && (e.attrs.get('role') || '').split(/\s+/)[0] === 'img' && !clean(e.attrs.get('aria-label')) && !e.attrs.get('aria-labelledby') && !e.hasTitle,
  );
  if (unnamed.length) {
    const e = unnamed[0];
    warn(w, `${plural(unnamed.length, '<svg role="img">', '<svg role="img"> elements')} without an accessible name (aria-label, aria-labelledby or <title>), e.g. ${e.attrs.get('id') ? `#${e.attrs.get('id')} ` : ''}on line ${e.line}`);
  }

  // links
  for (const e of els) {
    if (e.inSvg || (e.tag !== 'a' && e.tag !== 'area') || !e.attrs.has('href')) continue;
    const href = e.attrs.get('href');
    const label = `link on line ${e.line}`;
    const c = classify(href, base);
    if (c.kind === 'empty') warn(w, `empty href on line ${e.line}`);
    else if (c.kind === 'invalid') error(w, `${label} has an invalid URL: ${href}`);
    else if (c.kind === 'other' && c.scheme === 'javascript') warn(w, `${label} uses a javascript: URL`);
    else if (c.kind === 'internal') {
      if (href.trim().startsWith('#')) {
        const id = safeDecode(href.trim().slice(1));
        if (id && !page.clientRendered && !page.ids.has(id)) warn(w, `${label} goes to #${id}, but no element has that id`);
      } else {
        const target = checkInternal(w, label, c.url);
        if (target && target !== page) target.inbound.add(page.route);
      }
    }
    if (e.tag === 'a' && e.attrs.get('aria-hidden') !== 'true' && !clean(e.capture?.join('')) && !clean(e.attrs.get('aria-label')) && !clean(e.attrs.get('title'))) {
      warn(w, `${label} (${href}) has no text, so crawlers get no anchor text`);
    }
  }

  // assets: scripts, styles, icons, images, media
  const ASSETS = { img: ['src', 'srcset'], source: ['src', 'srcset'], script: ['src'], video: ['src', 'poster'], audio: ['src'], track: ['src'], iframe: ['src'], embed: ['src'], object: ['data'] };
  for (const e of els) {
    const refs = [];
    if (e.tag === 'link' && !e.inSvg) {
      const rel = relTokens(e);
      if (!rel.some((r) => ['canonical', 'preconnect', 'dns-prefetch'].includes(r)) && e.attrs.has('href')) refs.push(['href', e.attrs.get('href')]);
    } else if (e.inSvg && ['image', 'use', 'feimage'].includes(e.tag)) {
      const v = e.attrs.get('href') ?? e.attrs.get('xlink:href');
      if (v && !v.startsWith('#')) refs.push(['href', v]);
    } else {
      for (const a of ASSETS[e.tag] || []) {
        if (!e.attrs.has(a)) continue;
        if (a === 'srcset') for (const part of e.attrs.get(a).split(',')) refs.push([a, part.trim().split(/\s+/)[0]]);
        else refs.push([a, e.attrs.get(a)]);
      }
    }
    for (const [a, v] of refs) {
      const c = classify(v, base);
      if (c.kind === 'internal') checkInternal(w, `<${e.tag} ${a}> on line ${e.line}`, c.url, { fragments: false });
      else if (c.kind === 'empty' || c.kind === 'invalid') error(w, `<${e.tag} ${a}> on line ${e.line} is empty or not a valid URL`);
    }
  }

  // references to ids on the same page (SVG url(#id) and href="#id", aria-*by, label for)
  const missingRefs = new Map();
  for (const e of els) {
    for (const [name, v] of e.attrs) {
      const want = [];
      if (e.inSvg) {
        for (const m of v.matchAll(/url\(\s*['"]?#([^)'"\s]+)['"]?\s*\)/g)) want.push(m[1]);
        if ((name === 'href' || name === 'xlink:href') && v.startsWith('#') && v.length > 1) want.push(v.slice(1));
      }
      if (['aria-labelledby', 'aria-describedby', 'aria-controls', 'aria-owns'].includes(name)) want.push(...v.split(/\s+/).filter(Boolean));
      if (name === 'for' && e.tag === 'label') want.push(v);
      for (const id of want) if (!page.ids.has(id) && !missingRefs.has(id)) missingRefs.set(id, e.line);
    }
  }
  if (missingRefs.size) {
    const [id, line] = [...missingRefs][0];
    const what = missingRefs.size === 1 ? '1 reference to an id' : `${missingRefs.size} references to ids`;
    warn(w, `${what} missing from the page (e.g. #${id} on line ${line})`);
  }

  // JSON-LD blocks
  for (const e of els) {
    if (e.tag !== 'script' || (e.attrs.get('type') || '').trim().toLowerCase() !== 'application/ld+json') continue;
    try {
      page.ld.push({ data: JSON.parse(e.text), line: e.line });
    } catch (err) {
      error(w, `JSON-LD on line ${e.line} does not parse: ${err.message}`);
    }
  }
  if (page.indexable && !page.ld.length) warn(w, 'no JSON-LD structured data');
}

// ---------- JSON-LD ----------
const ARTICLE_TYPES = ['Article', 'BlogPosting', 'NewsArticle', 'TechArticle', 'Report'];
const PAGE_TYPES = ['WebPage', 'AboutPage', 'ProfilePage', 'CollectionPage', 'Blog', 'ItemList', 'FAQPage'];
const ORG_TYPES = ['Organization', 'Corporation', 'EducationalOrganization', 'CollegeOrUniversity', 'NGO'];
const NAME_EXEMPT = new Set([
  'ListItem', 'Answer', 'Question', 'ImageObject', 'VideoObject', 'BreadcrumbList', 'ItemList', 'FAQPage', 'PropertyValue',
  'Rating', 'AggregateRating', 'Offer', 'PostalAddress', 'GeoCoordinates', 'EntryPoint', 'SearchAction', 'ReadAction',
  'InteractionCounter', 'MonetaryAmount', 'QuantitativeValue', 'ContactPoint', 'OpeningHoursSpecification', 'WebPageElement',
]);
const URL_KEYS = new Set([
  'url', 'item', 'image', 'logo', 'sameAs', 'mainEntityOfPage', 'codeRepository', 'contentUrl', 'thumbnailUrl',
  'embedUrl', 'downloadUrl', 'discussionUrl', 'installUrl', '@id',
]);
const TEXT_KEYS = new Set(['name', 'headline', 'alternativeHeadline', 'description', 'text', 'abstract']);
const STATS = { blocks: 0, topTypes: new Map(), nodes: 0 };
const ID_DEFS = new Map(); // @id -> [{ route, types, node }]
const ID_REFS = []; // { route, id, trail }

// Every object in a JSON-LD document, with its type, a readable trail and whether it is top level.
function collectNodes(data) {
  const out = [];
  const visit = (v, trail, top, parent) => {
    if (Array.isArray(v)) {
      v.forEach((x, i) => visit(x, `${trail}[${i}]`, top, parent));
      return;
    }
    if (!v || typeof v !== 'object') return;
    const types = typesOf(v);
    const label = top ? types.join('/') || 'node' : trail;
    const nd = { node: v, types, top, trail: label, parent };
    out.push(nd);
    for (const [k, x] of Object.entries(v)) {
      if (k === '@context') continue;
      if (k === '@graph') visit(x, '', true, null);
      else visit(x, `${label}.${k}`, false, nd);
    }
  };
  visit(data, '', true, null);
  return out;
}
const urlsOf = (v) =>
  arr(v).flatMap((x) => (typeof x === 'string' ? [x] : x && typeof x === 'object' ? arr(x.url ?? x['@id'] ?? x.contentUrl).filter((u) => typeof u === 'string') : []));
const idOrUrl = (v) => (typeof v === 'string' ? v : v && typeof v === 'object' ? v['@id'] ?? v.url : undefined);

function checkDate(where, label, value, required) {
  if (value === undefined || value === null || value === '') {
    if (required === 'error') error(where, `${label} is missing`);
    else if (required === 'warn') warn(where, `${label} is missing`);
    return null;
  }
  if (typeof value !== 'string' || !isIsoDate(value)) {
    error(where, `${label} is not an ISO 8601 date: ${JSON.stringify(value)}`);
    return null;
  }
  if (value.slice(0, 10) > TODAY) warn(where, `${label} ${value} is in the future`);
  return value;
}
function checkDateOrder(where, label, from, to) {
  if (from && to && Date.parse(to) < Date.parse(from)) error(where, `${label}: ${to} is before ${from}`);
}

function checkLdUrl(page, key, value) {
  const w = page.route;
  if (key === '@id' && (value.startsWith('_:') || !/^[a-z][a-z0-9+.-]*:/i.test(value))) {
    if (!value.startsWith('_:')) warn(w, `JSON-LD @id "${value}" is not an absolute URL`);
    return;
  }
  if (!/^https?:\/\//i.test(value)) {
    if (key !== '@id') error(w, `JSON-LD ${key} must be an absolute URL: ${value}`);
    return;
  }
  const c = classify(value, `${SITE}/`);
  if (c.kind === 'invalid') error(w, `JSON-LD ${key} is not a valid URL: ${value}`);
  // An @id fragment (/#person) names an entity, not an anchor, so only its path has to exist.
  else if (c.kind === 'internal') checkInternal(w, `JSON-LD ${key}`, c.url, { fragments: key !== '@id' });
}

function checkLdImage(page, label, value) {
  const c = classify(value, `${SITE}/`);
  if (c.kind !== 'internal') return;
  const hit = resolvePath(c.url.pathname);
  const size = hit && imageSize(hit.file);
  if (!size) return;
  if (size.width * size.height < 50000) error(page.route, `${label} ${value} is ${size.width}x${size.height}; Google needs at least 50,000 pixels`);
  else if (size.width < 1200) warn(page.route, `${label} ${value} is ${size.width} px wide; Google recommends 1200 px for large previews`);
}

function checkAuthors(page, label, value, { required }) {
  const w = page.route;
  const list = arr(value);
  if (!list.length) {
    if (required) error(w, `${label} is missing`);
    return;
  }
  for (const a of list) {
    if (typeof a === 'string') {
      warn(w, `${label} is the plain string "${a}"; use a Person with a name and url`);
      continue;
    }
    if (!a || typeof a !== 'object') {
      error(w, `${label} is not an object`);
      continue;
    }
    if (!clean(a.name) && !a['@id']) error(w, `${label} has neither a name nor an @id`);
    if (!a.url && !a['@id']) warn(w, `${label} has no url (Google recommends author.url)`);
    if (norm(a.name) === norm(CANON_PERSON.name) && a['@id'] !== PERSON_ID) warn(w, `${label} names ${a.name} but is not linked to ${PERSON_ID}`);
  }
}

function checkPositions(page, label, items) {
  items.forEach((it, i) => {
    const pos = it?.position;
    if (Number(pos) !== i + 1) error(page.route, `${label} item ${i + 1} has position ${JSON.stringify(pos)}; positions must run 1 to ${items.length} in order`);
    else if (typeof pos !== 'number') warn(page.route, `${label} item ${i + 1} position is a string; use a number`);
  });
}

function checkNode(page, nd) {
  const w = page.route;
  const { node, types, top } = nd;
  const L = `JSON-LD ${nd.trail}`;
  const is = (...ts) => types.some((t) => ts.includes(t));
  STATS.nodes += 1;
  if (top) for (const t of types.length ? types : ['(untyped)']) STATS.topTypes.set(t, (STATS.topTypes.get(t) || 0) + 1);

  // @id registry for the site-wide checks
  const id = node['@id'];
  if (typeof id === 'string') {
    const keys = Object.keys(node).filter((k) => k !== '@id' && k !== '@context');
    if (keys.length) {
      if (!ID_DEFS.has(id)) ID_DEFS.set(id, []);
      ID_DEFS.get(id).push({ route: w, types, node });
    } else ID_REFS.push({ route: w, id, trail: nd.trail });
  }
  if (!types.length) return;

  // Article family
  if (is(...ARTICLE_TYPES)) {
    if (top) {
      const headline = node.headline;
      if (typeof headline !== 'string' || !clean(headline)) error(w, `${L} has no headline`);
      else {
        if (chars(headline) > HEADLINE_MAX) error(w, `${L} headline is ${chars(headline)} chars (Google's limit is ${HEADLINE_MAX})`);
        if (page.h1 && norm(headline) !== norm(page.h1)) warn(w, `${L} headline "${short(headline, 60)}" differs from the <h1> "${short(page.h1, 60)}"`);
      }
      const images = urlsOf(node.image);
      if (!images.length) error(w, `${L} has no image`);
      for (const u of images) checkLdImage(page, `${L}.image`, u);
      const pub = checkDate(w, `${L}.datePublished`, node.datePublished, 'error');
      const mod = checkDate(w, `${L}.dateModified`, node.dateModified, 'warn');
      checkDateOrder(w, `${L}.dateModified`, pub, mod);
      checkAuthors(page, `${L}.author`, node.author, { required: true });
      const pubs = arr(node.publisher);
      if (!pubs.length) error(w, `${L} has no publisher`);
      for (const p of pubs) if (!p || typeof p !== 'object' || (!clean(p.name) && !p['@id'])) error(w, `${L}.publisher needs a name or an @id`);
      if (node.mainEntityOfPage !== undefined) {
        const m = idOrUrl(node.mainEntityOfPage);
        if (page.canonicalUrl && m !== page.canonicalUrl) error(w, `${L}.mainEntityOfPage ${m} is not this page's canonical ${page.canonicalUrl}`);
      }
      if (!clean(node.description)) warn(w, `${L} has no description`);
      page.ldModified = [page.ldModified, mod || pub].filter(Boolean).sort().at(-1);
    } else {
      // A reference to an article from a list (Blog.blogPost, CreativeWork.subjectOf).
      const h = node.headline ?? node.name;
      if (!clean(h)) error(w, `${L} has no headline or name`);
      else if (chars(h) > HEADLINE_MAX) warn(w, `${L} headline is ${chars(h)} chars (Google's limit is ${HEADLINE_MAX})`);
      if (!node.url && !node['@id']) warn(w, `${L} has no url`);
      if (node.datePublished !== undefined) checkDate(w, `${L}.datePublished`, node.datePublished);
    }
  }

  if (is('ScholarlyArticle')) {
    if (!clean(node.headline ?? node.name)) error(w, `${L} has no name or headline`);
    checkAuthors(page, `${L}.author`, node.author, { required: true });
    checkDate(w, `${L}.datePublished`, node.datePublished, 'warn');
  }

  if (is('Event')) {
    if (!clean(node.name)) error(w, `${L} has no name`);
    const start = checkDate(w, `${L}.startDate`, node.startDate, 'error');
    const end = checkDate(w, `${L}.endDate`, node.endDate);
    checkDateOrder(w, `${L}.endDate`, start, end);
    if (!node.location) warn(w, `${L} has no location (Google requires it for event results)`);
  }

  if (is('ProfilePage')) {
    const me = arr(node.mainEntity)[0];
    if (!me) error(w, `${L} has no mainEntity`);
    else {
      const t = typesOf(me);
      const def = me['@id'] && !t.length ? ID_DEFS.get(me['@id'])?.[0]?.node : null;
      if (!t.length && !def) warn(w, `${L}.mainEntity is a bare reference; inline the Person so the profile is self-contained`);
      else if (!(t.length ? t : typesOf(def)).some((x) => x === 'Person' || ORG_TYPES.includes(x))) error(w, `${L}.mainEntity must be a Person or Organization`);
      if (!clean((def || me).name)) error(w, `${L}.mainEntity has no name`);
    }
    if (!node.dateModified && !node.dateCreated) warn(w, `${L} has no dateModified or dateCreated`);
    const created = checkDate(w, `${L}.dateCreated`, node.dateCreated);
    const mod = checkDate(w, `${L}.dateModified`, node.dateModified);
    checkDateOrder(w, `${L}.dateModified`, created, mod);
    page.ldModified = [page.ldModified, mod].filter(Boolean).sort().at(-1);
  }

  if (top && is(...PAGE_TYPES) && node.url !== undefined && page.canonicalUrl && node.url !== page.canonicalUrl) {
    error(w, `${L}.url ${node.url} is not this page's canonical ${page.canonicalUrl}`);
  }

  if (is('Person')) {
    // An article's author and publisher are already checked for a name (or @id) above.
    const credited = /\.(author|publisher)(\[\d+\])?$/.test(nd.trail) && typesOf(nd.parent?.node).some((t) => ARTICLE_TYPES.includes(t) || t === 'ScholarlyArticle');
    if (!clean(node.name) && !credited) error(w, `${L} has no name`);
    if (!node.url && !node['@id']) warn(w, `${L} has no url`);
    const same = arr(node.sameAs);
    for (const s of same) {
      let ok = typeof s === 'string' && /^https:\/\//.test(s);
      if (ok) {
        try {
          ok = Boolean(new URL(s).hostname.includes('.'));
        } catch {
          ok = false;
        }
      }
      if (!ok) error(w, `${L}.sameAs entry is not an absolute https URL: ${JSON.stringify(s)}`);
    }
    const dupes = same.filter((s, i) => same.indexOf(s) !== i);
    if (dupes.length) warn(w, `${L}.sameAs lists ${dupes[0]} more than once`);
    const extraKeys = Object.keys(node).filter((k) => !['@type', '@id', '@context', 'name', 'url'].includes(k));
    if (extraKeys.length >= 3 && !same.length) warn(w, `${L} is a full Person without sameAs links to its other profiles`);
  }

  if (is(...ORG_TYPES) && !clean(node.name)) error(w, `${L} has no name`);

  if (is('WebSite')) {
    if (!clean(node.name)) error(w, `${L} has no name`);
    if (!node.url) error(w, `${L} has no url`);
    else if (node.url !== `${SITE}/`) warn(w, `${L}.url is ${node.url}; Google reads the site name from the homepage URL ${SITE}/`);
  }

  if (is('FAQPage')) {
    page.faqCount = (page.faqCount || 0) + 1;
    if (page.faqCount === 2) warn(w, 'more than one FAQPage on the page (Google reads only one)');
    const qs = arr(node.mainEntity);
    if (!qs.length) error(w, `${L} has no questions in mainEntity`);
    const body = norm(page.bodyText);
    const bodySq = squash(page.bodyText);
    const visible = (s) => body.includes(norm(s)) || bodySq.includes(squash(s));
    const seen = new Set();
    qs.forEach((q, i) => {
      const QL = `${L} question ${i + 1}`;
      if (!typesOf(q).includes('Question')) error(w, `${QL} is not a Question`);
      const name = q?.name;
      if (typeof name !== 'string' || !clean(name)) error(w, `${QL} has no name`);
      else {
        if (!visible(name)) error(w, `${QL} "${short(name, 70)}" is not in the visible page text`);
        if (seen.has(norm(name))) warn(w, `${QL} repeats "${short(name, 70)}"`);
        seen.add(norm(name));
      }
      const ans = arr(q?.acceptedAnswer)[0];
      const text = ans && typeof ans === 'object' ? ans.text : undefined;
      if (typeof text !== 'string' || !clean(text)) error(w, `${QL} "${short(name, 50)}" has no acceptedAnswer.text`);
      else if (!visible(text)) warn(w, `${QL} answer is not in the visible page text: "${short(text, 70)}"`);
    });
  }

  if (is('BreadcrumbList')) {
    const items = arr(node.itemListElement);
    if (!items.length) error(w, `${L} has no itemListElement`);
    checkPositions(page, L, items);
    items.forEach((it, i) => {
      if (!clean(it?.name ?? it?.item?.name)) error(w, `${L} item ${i + 1} has no name`);
      const u = idOrUrl(it?.item);
      if (!u) {
        if (i < items.length - 1) error(w, `${L} item ${i + 1} has no item URL (only the last crumb may omit it)`);
      } else if (!/^https?:\/\//.test(u)) error(w, `${L} item ${i + 1} URL is not absolute: ${u}`);
      else if (i === items.length - 1 && page.canonicalUrl && u !== page.canonicalUrl) warn(w, `${L} ends at ${u}, not at this page (${page.canonicalUrl})`);
    });
  } else if (is('ItemList')) {
    const items = arr(node.itemListElement);
    if (!items.length) error(w, `${L} has no itemListElement`);
    const listItems = items.filter((it) => typesOf(it).includes('ListItem'));
    if (listItems.length) {
      checkPositions(page, L, items);
      items.forEach((it, i) => {
        if (it && typeof it === 'object' && !it.url && !it.item) error(w, `${L} item ${i + 1} has neither url nor item`);
      });
    }
    if (node.numberOfItems !== undefined && Number(node.numberOfItems) !== items.length) {
      error(w, `${L}.numberOfItems is ${node.numberOfItems} but the list has ${items.length}`);
    }
  }

  if (is('CollectionPage')) {
    if (!clean(node.name)) error(w, `${L} has no name`);
    if (top && !node.url) warn(w, `${L} has no url`);
    if (!clean(node.description)) warn(w, `${L} has no description`);
  }

  const handled = is(...ARTICLE_TYPES, 'ScholarlyArticle', 'Event', 'Person', 'WebSite', 'CollectionPage', ...ORG_TYPES);
  if (!handled && !types.every((t) => NAME_EXEMPT.has(t)) && !is('ProfilePage', 'WebPage', 'AboutPage') && !clean(node.name ?? node.headline)) {
    warn(w, `${L} has no name`);
  }
}

function checkJsonLd(page) {
  const w = page.route;
  const dashed = [];
  for (const { data, line } of page.ld) {
    STATS.blocks += 1;
    for (const r of Array.isArray(data) ? data : [data]) {
      const ctx = arr(r?.['@context']).filter((c) => typeof c === 'string');
      if (!r || typeof r !== 'object') error(w, `JSON-LD on line ${line} is not an object`);
      else if (!ctx.length) error(w, `JSON-LD on line ${line} has no @context`);
      else if (!ctx.some((c) => /^https:\/\/schema\.org\/?$/.test(c))) {
        if (ctx.some((c) => /^http:\/\/schema\.org\/?$/.test(c))) warn(w, `JSON-LD on line ${line} uses http://schema.org; use https://schema.org`);
        else warn(w, `JSON-LD on line ${line} has an unexpected @context ${JSON.stringify(r['@context'])}`);
      }
    }
    for (const nd of collectNodes(data)) checkNode(page, nd);
    const walk = (v) => {
      if (Array.isArray(v)) return v.forEach(walk);
      if (!v || typeof v !== 'object') return;
      for (const [k, x] of Object.entries(v)) {
        if (k === '@context') continue;
        if (URL_KEYS.has(k)) for (const s of arr(x)) if (typeof s === 'string') checkLdUrl(page, k, s);
        if (TEXT_KEYS.has(k) && typeof x === 'string' && DASH.test(x)) dashed.push(`${k}: "${short(x, 60)}"`);
        if (x && typeof x === 'object') walk(x);
      }
    };
    walk(data);
  }
  if (dashed.length) warn(w, `${plural(dashed.length, 'JSON-LD text value')} with an em or en dash, e.g. ${dashed[0]}`);
}

// ---------- run the page checks ----------
for (const page of PAGES) checkPage(page);
for (const page of PAGES) checkJsonLd(page);

// ---------- site-wide: entity consistency ----------
const SITE_W = 'site-wide';
{
  // Every node carrying the Person @id must describe the same person as scripts/blog/person.mjs.
  const personNodes = ID_DEFS.get(PERSON_ID) || [];
  const scalar = (v) => typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean';
  for (const { route, types, node } of personNodes) {
    if (types.length && !types.includes('Person')) error(route, `JSON-LD node ${PERSON_ID} is typed ${types.join('/')}, not Person`);
    if (node.name !== undefined && node.name !== CANON_PERSON.name) error(route, `JSON-LD ${PERSON_ID} has name "${node.name}"; person.mjs says "${CANON_PERSON.name}"`);
    if (node.url !== undefined && node.url !== CANON_PERSON.url) error(route, `JSON-LD ${PERSON_ID} has url ${node.url}; person.mjs says ${CANON_PERSON.url}`);
    for (const [k, v] of Object.entries(node)) {
      if (['@type', '@id', '@context', 'name', 'url'].includes(k) || !(k in CANON_PERSON)) continue;
      const want = CANON_PERSON[k];
      if (scalar(v) && scalar(want) && v !== want) warn(route, `JSON-LD ${PERSON_ID} ${k} differs from person.mjs: "${short(v, 60)}"`);
      else if (Array.isArray(v) && Array.isArray(want) && k === 'sameAs') {
        const a = new Set(v);
        const b = new Set(want);
        if (a.size !== b.size || [...a].some((x) => !b.has(x))) warn(route, `JSON-LD ${PERSON_ID} sameAs differs from person.mjs`);
      }
    }
  }
  const full = personNodes.filter(({ node }) => arr(node.sameAs).length);
  if (!full.some(({ route }) => route === '/')) warn('/', `the homepage has no full Person node for ${PERSON_ID} (with sameAs); the @id URL should define the entity`);
  if (!full.length) error(SITE_W, `no page defines the full Person ${PERSON_ID} with sameAs links`);

  // A Person with his name but another @id reads as a second person to search engines and LLMs.
  for (const page of PAGES) {
    for (const { data } of page.ld) {
      for (const nd of collectNodes(data)) {
        if (nd.types.includes('Person') && norm(nd.node.name) === norm(CANON_PERSON.name) && nd.node['@id'] !== PERSON_ID) {
          warn(page.route, `JSON-LD ${nd.trail} is a Person named ${nd.node.name} without @id ${PERSON_ID}`);
        }
      }
    }
  }

  // References to on-site @ids nothing defines, and @ids defined with conflicting types.
  for (const { route, id, trail } of ID_REFS) {
    if (!ID_DEFS.has(id) && id.startsWith(`${SITE}/`)) warn(route, `JSON-LD ${trail} refers to ${id}, which no page defines`);
  }
  for (const [id, defs] of ID_DEFS) {
    const typed = defs.filter((d) => d.types.length);
    const kinds = new Set(typed.map((d) => [...d.types].sort().join('/')));
    if (kinds.size > 1) warn(SITE_W, `@id ${id} is typed differently across pages: ${[...kinds].join(', ')}`);
  }
}

// ---------- site-wide: duplicates and orphans ----------
{
  const indexable = PAGES.filter((p) => p.indexable);
  const dupes = (key, label, level) => {
    const by = new Map();
    for (const p of indexable) {
      const v = p[key];
      if (!v) continue;
      if (!by.has(v)) by.set(v, []);
      by.get(v).push(p.route);
    }
    for (const [v, routes] of by) if (routes.length > 1) report(SITE_W, level, `${routes.length} pages share the ${label} "${short(v, 70)}": ${routes.join(', ')}`);
  };
  dupes('title', 'title', 'warn');
  dupes('description', 'meta description', 'warn');
  dupes('canonicalUrl', 'canonical', 'error');
  const orphans = indexable.filter((p) => p.route !== '/' && !p.inbound.size);
  for (const p of orphans) warn(p.route, 'no other page links here, so crawlers only find it through the sitemap');
}

// ---------- sitemap.xml ----------
const SITEMAP_W = 'sitemap.xml';
const SITEMAP_LOCS = [];
{
  const file = path.join(DIST, 'sitemap.xml');
  let root = null;
  if (!isFile(file)) error(SITEMAP_W, 'dist/sitemap.xml is missing');
  else {
    try {
      root = parseXml(fs.readFileSync(file, 'utf8'));
    } catch (e) {
      error(SITEMAP_W, `not well-formed XML: ${e.message}`);
    }
  }
  if (root && root.name !== 'urlset') error(SITEMAP_W, `root element is <${root.name}>, expected <urlset>`);
  else if (root) {
    if (root.attrs.xmlns !== 'http://www.sitemaps.org/schemas/sitemap/0.9') error(SITEMAP_W, '<urlset> lacks xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"');
    if (root.children.length > 50000) error(SITEMAP_W, `${root.children.length} URLs; a sitemap holds at most 50,000`);
    const listed = new Set();
    const seen = new Set();
    root.children.forEach((u, i) => {
      if (u.name !== 'url') {
        error(SITEMAP_W, `unexpected <${u.name}> inside <urlset> (line ${u.line})`);
        return;
      }
      const locs = xmlChildren(u, 'loc');
      if (locs.length !== 1) {
        error(SITEMAP_W, `<url> #${i + 1} (line ${u.line}) has ${locs.length} <loc> elements`);
        return;
      }
      const loc = locs[0].text.trim();
      if (seen.has(loc)) error(SITEMAP_W, `${loc} is listed twice`);
      seen.add(loc);
      SITEMAP_LOCS.push(loc);
      let url = null;
      if (!loc.startsWith(`${SITE}/`)) error(SITEMAP_W, `${loc} is not an absolute ${SITE} URL`);
      else {
        try {
          url = new URL(loc);
        } catch {
          error(SITEMAP_W, `${loc} is not a valid URL`);
        }
      }
      let page = null;
      if (url) {
        if (url.search || url.hash) warn(SITEMAP_W, `${loc} has a query or fragment`);
        const hit = resolvePath(url.pathname);
        if (!hit) error(SITEMAP_W, `${loc} does not exist in dist/`);
        else {
          if (hit.slashRedirect) error(SITEMAP_W, `${loc} has no trailing slash, so it redirects`);
          page = PAGE_BY_FILE.get(hit.file) || null;
          if (page) {
            listed.add(page);
            if (page.noindex) error(SITEMAP_W, `${loc} is marked noindex`);
            if (page.canonicalUrl && page.canonicalUrl !== loc) error(SITEMAP_W, `${loc} is not canonical (the page says ${page.canonicalUrl})`);
          }
        }
      }
      const lastmods = xmlChildren(u, 'lastmod');
      if (lastmods.length > 1) error(SITEMAP_W, `${loc} has ${lastmods.length} <lastmod> elements`);
      if (!lastmods.length) warn(SITEMAP_W, `${loc} has no <lastmod>`);
      else {
        const lm = lastmods[0].text.trim();
        if (!/^\d{4}-\d{2}-\d{2}$/.test(lm) || !isIsoDate(lm)) error(SITEMAP_W, `<lastmod> "${lm}" for ${loc} is not a YYYY-MM-DD date`);
        else {
          if (lm > TODAY) warn(SITEMAP_W, `<lastmod> ${lm} for ${loc} is in the future`);
          const mod = page?.ldModified?.slice(0, 10);
          if (mod && lm < mod) warn(SITEMAP_W, `<lastmod> ${lm} for ${loc} is older than the page's JSON-LD date ${mod}`);
        }
      }
    });
    for (const p of PAGES) {
      if (p.indexable && !listed.has(p) && (!p.canonicalUrl || p.canonicalUrl === SITE + p.route)) error(SITEMAP_W, `${p.route} is in dist/ but not in the sitemap`);
    }
  }
}

// ---------- robots.txt ----------
const ROBOTS_W = 'robots.txt';
const SEARCH_BOTS = ['*', 'Googlebot', 'Bingbot'];
// Crawlers behind ChatGPT, Claude, Perplexity, Gemini and Apple Intelligence answers. Blocking them
// keeps the site out of the answers those assistants give about him.
const AI_BOTS = ['GPTBot', 'OAI-SearchBot', 'ChatGPT-User', 'ClaudeBot', 'Claude-SearchBot', 'Claude-User', 'PerplexityBot', 'Perplexity-User', 'Google-Extended', 'Applebot-Extended', 'CCBot'];
{
  const file = path.join(DIST, 'robots.txt');
  if (!isFile(file)) warn(ROBOTS_W, 'dist/robots.txt is missing');
  else {
    const groupsList = [];
    const sitemaps = [];
    let cur = null;
    let agentRun = false;
    for (const raw of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
      const m = /^([A-Za-z-]+)\s*:\s*(.*)$/.exec(raw.replace(/#.*/, '').trim());
      if (!m) continue;
      const key = m[1].toLowerCase();
      const val = m[2].trim();
      if (key === 'user-agent') {
        if (!cur || !agentRun) {
          cur = { agents: [], rules: [] };
          groupsList.push(cur);
        }
        cur.agents.push(val.toLowerCase());
        agentRun = true;
      } else if (key === 'sitemap') sitemaps.push(val);
      else if ((key === 'allow' || key === 'disallow') && cur) {
        cur.rules.push({ allow: key === 'allow', path: val });
        agentRun = false;
      }
    }
    if (!sitemaps.length) warn(ROBOTS_W, 'no "Sitemap:" line');
    for (const s of sitemaps) {
      const c = classify(s, `${SITE}/`);
      if (!/^https?:\/\//.test(s)) error(ROBOTS_W, `Sitemap ${s} must be an absolute URL`);
      else if (c.kind === 'internal') checkInternal(ROBOTS_W, 'Sitemap', c.url, { fragments: false });
    }
    const ruleRe = (p) => {
      const end = p.endsWith('$');
      return new RegExp(`^${escRe(end ? p.slice(0, -1) : p).replace(/\\\*/g, '.*')}${end ? '$' : ''}`);
    };
    const allowed = (agent, p) => {
      const ua = agent.toLowerCase();
      let rules = groupsList.filter((g) => g.agents.includes(ua)).flatMap((g) => g.rules);
      if (!rules.length && !groupsList.some((g) => g.agents.includes(ua))) rules = groupsList.filter((g) => g.agents.includes('*')).flatMap((g) => g.rules);
      let best = null;
      for (const r of rules) {
        if (!r.path || !ruleRe(r.path).test(p)) continue;
        if (!best || r.path.length > best.path.length || (r.path.length === best.path.length && r.allow)) best = r;
      }
      return !best || best.allow;
    };
    const paths = SITEMAP_LOCS.filter((l) => l.startsWith(`${SITE}/`)).map((l) => new URL(l).pathname);
    for (const agent of [...SEARCH_BOTS, ...AI_BOTS]) {
      const blocked = paths.filter((p) => !allowed(agent, p));
      if (!blocked.length) continue;
      const msg = `${agent === '*' ? 'all crawlers' : agent} blocked from ${plural(blocked.length, 'sitemap URL')}, e.g. ${blocked[0]}`;
      if (SEARCH_BOTS.includes(agent)) error(ROBOTS_W, msg);
      else warn(ROBOTS_W, `${msg} (keeps those pages out of AI assistant answers)`);
    }
  }
}

// ---------- llms.txt ----------
let LLMS_LINKS = 0;
for (const name of ['llms.txt', 'llms-full.txt']) {
  const file = path.join(DIST, name);
  if (!isFile(file)) {
    if (name === 'llms.txt') error(name, 'dist/llms.txt is missing');
    continue;
  }
  const txt = fs.readFileSync(file, 'utf8');
  const lineOf = lineIndex(txt);
  const lines = txt.split('\n');
  if (!lines.find((l) => l.trim())?.startsWith('# ')) warn(name, 'does not open with an "# Name" heading (llmstxt.org format)');
  if (!lines.some((l) => l.startsWith('> '))) warn(name, 'has no "> summary" blockquote (llmstxt.org format)');
  const dashes = txt.match(/[\u2013\u2014]/g);
  if (dashes) warn(name, `${plural(dashes.length, 'em or en dash', 'em or en dashes')}`);
  const linked = new Set();
  let count = 0;
  for (const m of txt.matchAll(/\[((?:\\.|[^\]\\\n])*)\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g)) {
    count += 1;
    const href = m[2];
    const label = `line ${lineOf(m.index)} link`;
    if (!/^https?:\/\//i.test(href)) warn(name, `${label} is not an absolute URL: ${href}`);
    const c = classify(href, `${SITE}/`);
    if (c.kind === 'internal') {
      const page = checkInternal(name, label, c.url);
      if (page) linked.add(page);
    } else if (c.kind === 'invalid' || c.kind === 'empty') error(name, `${label} is not a valid URL: ${href}`);
  }
  if (name === 'llms.txt') LLMS_LINKS = count;
  if (!count) warn(name, 'has no links');
  if (name === 'llms.txt') {
    const missing = PAGES.filter((p) => p.indexable && !linked.has(p));
    if (missing.length) warn(name, `${plural(missing.length, 'indexable page')} not listed: ${missing.slice(0, 8).map((p) => p.route).join(', ')}${missing.length > 8 ? ', ...' : ''}`);
  }
}

// ---------- feeds and manifest ----------
{
  const feeds = new Set();
  const manifests = new Set();
  for (const page of PAGES) {
    for (const e of page.els) {
      if (e.tag !== 'link' || e.inSvg) continue;
      const rel = relTokens(e);
      const c = classify(e.attrs.get('href'), SITE + page.route);
      if (c.kind !== 'internal') continue;
      const hit = resolvePath(c.url.pathname);
      if (!hit) continue;
      if (rel.includes('alternate') && /(rss|atom)\+xml/.test(e.attrs.get('type') || '')) feeds.add(hit.file);
      if (rel.includes('manifest')) manifests.add(hit.file);
    }
  }
  for (const file of feeds) {
    const W = toPosix(path.relative(DIST, file));
    let root;
    try {
      root = parseXml(fs.readFileSync(file, 'utf8'));
    } catch (e) {
      error(W, `not well-formed XML: ${e.message}`);
      continue;
    }
    const check = (href, label) => {
      const c = classify(href, `${SITE}/`);
      if (!/^https?:\/\//.test(href)) error(W, `${label} is not an absolute URL: ${href}`);
      else if (c.kind === 'internal') checkInternal(W, label, c.url);
    };
    const visit = (el) => {
      if (el.name === 'link' && el.text.trim()) check(el.text.trim(), `<link> on line ${el.line}`);
      if ((el.name === 'link' || el.name === 'atom:link') && el.attrs.href) check(el.attrs.href, `<${el.name} href> on line ${el.line}`);
      if (el.name === 'guid' && el.attrs.isPermaLink !== 'false' && el.text.trim()) check(el.text.trim(), `<guid> on line ${el.line}`);
      if (el.name === 'pubDate' && Number.isNaN(Date.parse(el.text.trim()))) error(W, `<pubDate> on line ${el.line} is not a date: ${el.text.trim()}`);
      if (/^(title|description)$/.test(el.name) && DASH.test(el.text)) warn(W, `<${el.name}> on line ${el.line} has an em or en dash`);
      el.children.forEach(visit);
    };
    visit(root);
  }
  for (const file of manifests) {
    const W = toPosix(path.relative(DIST, file));
    let m;
    try {
      m = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (e) {
      error(W, `does not parse as JSON: ${e.message}`);
      continue;
    }
    if (!clean(m.name)) warn(W, 'has no name');
    for (const icon of arr(m.icons)) {
      const c = classify(icon?.src, `${SITE}/`);
      if (c.kind === 'internal') checkInternal(W, 'icon', c.url, { fragments: false });
      else if (c.kind !== 'external') error(W, `icon src is not a valid URL: ${icon?.src}`);
    }
    if (m.start_url) {
      const c = classify(m.start_url, `${SITE}/`);
      if (c.kind === 'internal') checkInternal(W, 'start_url', c.url, { fragments: false });
    }
  }
}

// ---------- print ----------
const color = process.stdout.isTTY && !process.env.NO_COLOR;
const paint = (code, s) => (color ? `\x1b[${code}m${s}\x1b[0m` : s);
const pageByRoute = new Map(PAGES.map((p) => [p.route, p]));
const FILE_ORDER = ['sitemap.xml', 'robots.txt', 'llms.txt', 'llms-full.txt'];
const rank = (where) => {
  if (where === SITE_W) return [3, ''];
  if (pageByRoute.has(where)) return [0, PAGES.indexOf(pageByRoute.get(where)).toString().padStart(5, '0')];
  const i = FILE_ORDER.indexOf(where);
  return [1, i === -1 ? `z${where}` : String(i)];
};
const sorted = [...groups.entries()].sort(([a], [b]) => {
  const [ra, ka] = rank(a);
  const [rb, kb] = rank(b);
  return ra - rb || ka.localeCompare(kb);
});
const allItems = sorted.flatMap(([, g]) => g.items);
const errors = allItems.filter((it) => it.level === 'error').length;
const warnings = allItems.length - errors;

const relDist = path.relative(ROOT, DIST);
const distLabel = !relDist ? '.' : relDist.startsWith('..') || path.isAbsolute(relDist) ? toPosix(DIST) : toPosix(relDist);
console.log(`SEO/GEO audit of ${distLabel}/  (${TODAY})`);
for (const [where, g] of sorted) {
  const items = g.items.filter((it) => !QUIET || it.level === 'error').sort((a, b) => (a.level === b.level ? 0 : a.level === 'error' ? -1 : 1));
  if (!items.length) continue;
  const page = pageByRoute.get(where);
  console.log(`\n${paint(1, where)}${page ? `  (${page.rel})` : ''}`);
  for (const it of items) console.log(`  ${it.level === 'error' ? paint(31, 'ERROR') : paint(33, 'warn ')}  ${it.msg}`);
}

const indexableCount = PAGES.filter((p) => p.indexable).length;
const otherCount = PAGES.length - indexableCount;
const types = [...STATS.topTypes.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([t, n]) => `${t} ${n}`);
const cleanPages = PAGES.filter((p) => !groups.get(p.route)?.items.length).length;
console.log(`\n${paint(1, 'Summary')}`);
console.log(`  pages      ${PAGES.length} HTML (${indexableCount} indexable, ${otherCount} noindex or 404); ${cleanPages} with no findings`);
console.log(`  JSON-LD    ${STATS.blocks} blocks, ${STATS.nodes} nodes; top level: ${types.join(', ') || 'none'}`);
console.log(`  sitemap    ${SITEMAP_LOCS.length} URLs;  llms.txt ${LLMS_LINKS} links`);
if (SKIPPED_FRAGMENTS.size) console.log(`  note       #fragment links into client-rendered pages were not checked: ${[...SKIPPED_FRAGMENTS].join(', ')}`);
console.log(`  result     ${paint(errors ? 31 : 32, plural(errors, 'error'))}, ${plural(warnings, 'warning')}${STRICT ? ' (--strict: warnings fail the run)' : ''}`);
process.exitCode = errors || (STRICT && warnings) ? 1 : 0;
