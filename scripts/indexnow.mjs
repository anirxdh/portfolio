// Tell Bing / Yandex / Seznam (and ChatGPT search, which uses Bing) that pages changed.
// Run AFTER a deploy is live:  node scripts/indexnow.mjs            (all sitemap URLs)
//                              node scripts/indexnow.mjs /about/    (specific paths)
// Google does not support IndexNow; use Search Console for Google.
const SITE = 'https://anirudhvasudevan.com';
const KEY = 'b052ce8c9a5ba7e6d77b67afd279520e'; // public by design; must match public/<KEY>.txt

const paths = process.argv.slice(2);
let urls;
if (paths.length) {
  urls = paths.map((p) => new URL(p, SITE).href);
} else {
  const xml = await (await fetch(`${SITE}/sitemap.xml`)).text();
  urls = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
}
const res = await fetch('https://api.indexnow.org/indexnow', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json; charset=utf-8' },
  body: JSON.stringify({ host: 'anirudhvasudevan.com', key: KEY, keyLocation: `${SITE}/${KEY}.txt`, urlList: urls }),
});
console.log(`IndexNow: submitted ${urls.length} URL(s), HTTP ${res.status}`);
if (res.status >= 300) console.log(await res.text());
