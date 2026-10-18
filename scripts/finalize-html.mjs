// Last build step: small cross-page fixes on every HTML file in dist/.
// - rel="me" on links to his own profiles (scripts/blog/person.mjs SAME_AS), so search engines
//   and other sites can tie the profiles and this site to one person.
import fs from 'node:fs';
import path from 'node:path';
import { SAME_AS } from './blog/person.mjs';

const DIST = path.join(process.cwd(), 'dist');
const norm = (u) => String(u).trim().toLowerCase().replace(/^https?:\/\/(www\.)?/, '').replace(/[?#].*$/, '').replace(/\/+$/, '');
const MINE = new Set(SAME_AS.map(norm));

const addRelMe = (html) =>
  html.replace(/<a\b[^>]*>/gi, (tag) => {
    const href = /\shref="([^"]+)"/i.exec(tag)?.[1];
    if (!href || !/^https?:\/\//i.test(href) || !MINE.has(norm(href))) return tag;
    const rel = /\srel="([^"]*)"/i.exec(tag);
    if (!rel) return tag.replace(/<a\b/i, '<a rel="me"');
    const tokens = rel[1].split(/\s+/).filter(Boolean);
    if (tokens.includes('me')) return tag;
    return tag.replace(rel[0], ` rel="${['me', ...tokens].join(' ')}"`);
  });

let files = 0;
let links = 0;
const walk = (dir) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (e.name.endsWith('.html')) {
      const src = fs.readFileSync(p, 'utf8');
      const out = addRelMe(src);
      if (out !== src) {
        links += (out.match(/rel="me[ "]/g) || []).length - (src.match(/rel="me[ "]/g) || []).length;
        fs.writeFileSync(p, out);
        files += 1;
      }
    }
  }
};
if (fs.existsSync(DIST)) walk(DIST);
console.log(`[finalize] rel="me" added to ${links} profile link(s) in ${files} page(s)`);
