// Data for /hackathons/: content/pages/hackathons.md (sections of events) joined with the published
// articles, and cross-checked against the homepage list in src/constants/index.js so a result on
// this page can never quietly differ from the one on the homepage.

import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { cleanText } from './projects.mjs';

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const MONTH = /^\d{4}-\d{2}$/;
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const parts = (iso) => iso.split('-').map(Number);
// Results that are not a placement: the project was built and entered, nothing more is claimed.
export const isEntry = (result) => /^entry$/i.test(String(result || '').trim());

// "2026-04" -> "April 2026"; "2026-06-06" + "2026-06-07" -> "June 6 to 7, 2026".
export function eventWhen(date, end) {
  if (MONTH.test(date)) {
    const [y, m] = parts(date);
    return `${MONTHS[m - 1]} ${y}`;
  }
  const [y, m, d] = parts(date);
  if (!end || end === date) return `${MONTHS[m - 1]} ${d}, ${y}`;
  const [y2, m2, d2] = parts(end);
  if (y2 === y && m2 === m) return `${MONTHS[m - 1]} ${d} to ${d2}, ${y}`;
  if (y2 === y) return `${MONTHS[m - 1]} ${d} to ${MONTHS[m2 - 1]} ${d2}, ${y}`;
  return `${MONTHS[m - 1]} ${d}, ${y} to ${MONTHS[m2 - 1]} ${d2}, ${y2}`;
}

const str = (v) => (v instanceof Date ? v.toISOString().slice(0, 10) : v === undefined || v === null ? '' : String(v));

export async function loadHackathons({ root, page, bySlug, warn }) {
  const file = page.file;
  const seen = new Set();
  const sections = (page.sections || []).map((s, si) => {
    if (!s.id || !s.title) throw new Error(`[blog] ${file}: section ${si + 1} needs an "id" and a "title"`);
    const events = (s.events || []).map((e, ei) => {
      const where = `${file}: ${s.id} event ${ei + 1}`;
      for (const k of ['key', 'event', 'date', 'result', 'project', 'built']) {
        if (!e[k]) throw new Error(`[blog] ${where}: missing "${k}"`);
      }
      if (seen.has(e.key)) throw new Error(`[blog] ${where}: duplicate key "${e.key}"`);
      seen.add(e.key);
      const date = str(e.date);
      const end = str(e.end);
      if (!DAY.test(date) && !MONTH.test(date)) throw new Error(`[blog] ${where}: date must be YYYY-MM-DD or YYYY-MM (got ${date})`);
      if (end && (!DAY.test(end) || !DAY.test(date) || end < date)) throw new Error(`[blog] ${where}: "end" must be a YYYY-MM-DD day on or after "date"`);
      const slugs = e.articles || (e.article ? [e.article] : []);
      const articles = slugs
        .map((slug) => {
          const a = bySlug.get(slug);
          if (!a) warn(`${where}: article "${slug}" is not published; its link is left out`);
          return a;
        })
        .filter(Boolean);
      const lead = articles[0];
      return {
        key: e.key,
        event: cleanText(e.event),
        eventUrl: e.eventUrl,
        date,
        end: end || undefined,
        when: eventWhen(date, end),
        place: e.place,
        online: Boolean(e.online),
        result: cleanText(e.result),
        entry: isEntry(e.result),
        project: e.project,
        built: e.built,
        note: e.note,
        articles,
        award: lead?.award,
        live: e.live === false ? undefined : e.live || lead?.live,
        liveLabel: e.liveLabel,
        repo: e.repo === false ? undefined : e.repo || lead?.repo,
        accent: e.accent || lead?.accent,
      };
    });
    return { id: s.id, title: s.title, season: s.season, events };
  });

  // Cross-check with the homepage: every homepage result must be here, with the same wording.
  let constants = {};
  try {
    constants = await import(pathToFileURL(path.join(root, 'src', 'constants', 'index.js')).href);
  } catch (err) {
    warn(`could not import src/constants/index.js to check hackathon results (${err.message})`);
  }
  const all = sections.flatMap((s) => s.events);
  for (const h of constants.hackathons || []) {
    const match = all.find((e) => (h.article && e.articles.some((a) => a.slug === h.article)) || e.project === cleanText(h.project).split(':')[0]);
    if (!match) {
      warn(`hackathons.md has no event for the homepage result "${cleanText(h.result)}, ${cleanText(h.event)}"`);
      continue;
    }
    if (match.result !== cleanText(h.result)) warn(`hackathons.md: ${match.key} result "${match.result}" differs from the homepage ("${cleanText(h.result)}")`);
    if (match.event !== cleanText(h.event)) warn(`hackathons.md: ${match.key} event "${match.event}" differs from the homepage ("${cleanText(h.event)}")`);
  }
  return sections;
}
