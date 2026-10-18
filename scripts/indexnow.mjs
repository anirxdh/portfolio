// Tell Bing / Yandex / Seznam (and ChatGPT search, which uses Bing) that pages changed.
// Run AFTER a deploy is live:  node scripts/indexnow.mjs            (all sitemap URLs)
//                              node scripts/indexnow.mjs /about/    (specific paths or full URLs)
// Google does not support IndexNow; use Search Console for Google.
// Exits non-zero when the sitemap cannot be read, nothing is left to submit, or IndexNow rejects it.
const SITE = 'https://anirudhvasudevan.com';
const HOST = new URL(SITE).host;
const KEY = 'b052ce8c9a5ba7e6d77b67afd279520e'; // public by design; must match public/<KEY>.txt

const fail = (msg) => {
  console.error(`IndexNow: ${msg}`);
  process.exit(1);
};

async function sitemapUrls() {
  let res;
  try {
    res = await fetch(`${SITE}/sitemap.xml`);
  } catch (e) {
    fail(`could not fetch ${SITE}/sitemap.xml: ${e.message}`);
  }
  if (!res.ok) fail(`${SITE}/sitemap.xml returned HTTP ${res.status}`);
  const xml = await res.text();
  return [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)].map((m) => m[1].replace(/&amp;/g, '&'));
}

const args = process.argv.slice(2);
const candidates = args.length ? args : await sitemapUrls();

// IndexNow rejects the whole batch (HTTP 422) if any URL is on another host, so keep only ours.
const urls = [];
for (const raw of candidates) {
  let u;
  try {
    u = new URL(raw, SITE);
  } catch {
    console.warn(`IndexNow: skipping invalid URL "${raw}"`);
    continue;
  }
  if (u.host !== HOST || !/^https?:$/.test(u.protocol)) {
    console.warn(`IndexNow: skipping ${u.href} (not on ${HOST})`);
    continue;
  }
  if (!urls.includes(u.href)) urls.push(u.href);
}
if (!urls.length) fail('no URLs to submit');

let res;
try {
  res = await fetch('https://api.indexnow.org/indexnow', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ host: HOST, key: KEY, keyLocation: `${SITE}/${KEY}.txt`, urlList: urls }),
  });
} catch (e) {
  fail(`request failed: ${e.message}`);
}
console.log(`IndexNow: submitted ${urls.length} URL(s), HTTP ${res.status}`);
if (!res.ok) {
  const body = await res.text().catch(() => '');
  if (body) console.error(body);
  if (res.status === 429) console.error('IndexNow: throttled; submit only the paths that changed, e.g. node scripts/indexnow.mjs /about/');
  process.exitCode = 1;
}
