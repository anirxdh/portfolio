// Data for /uses/: the tool groups in content/pages/uses.md, each tool linked to the published
// articles that used it. An article counts when one of its tags is the tool (or an alias), or when
// its "| Layer | Choice | Why |" stack table names the tool. That table lists what the project
// actually runs on, so a passing mention elsewhere in the text never links a tool. A tool with
// `hosts` also links every article whose live link is served from one of those domains.

import { marked } from 'marked';
import { tagSlug } from './topics.mjs';

const escapeRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// Word-ish boundaries: "React" matches "React 19" and "react-pdf" but not "components-react".
const wordRe = (alias) => new RegExp(`(?<![\\w@/.-])${escapeRe(alias)}(?![\\w])`, 'i');

// Text of an article's stack table(s): every markdown table whose first header cell is "Layer".
export function stackText(article) {
  const out = [];
  const walk = (tokens = []) => {
    for (const t of tokens) {
      if (t.type === 'table' && /^layer$/i.test(String(t.header?.[0]?.text || '').trim())) {
        out.push(t.rows.map((r) => r.map((c) => c.text).join(' | ')).join('\n'));
      } else if (t.tokens) walk(t.tokens);
    }
  };
  walk(marked.lexer(article.content || ''));
  return out.join('\n');
}

// Host of an article's live link ("living-photos-rust.vercel.app"), for tools matched by `hosts`.
const liveHost = (a) => {
  try {
    return new URL(a.live).hostname.toLowerCase();
  } catch {
    return '';
  }
};

// Project name for a link label: "ScreenSense (v3)" -> "ScreenSense", unless two links would read the same.
const baseProject = (a) => String(a.project).replace(/\s*\([^)]*\)\s*$/, '').trim();
export function labelArticles(list) {
  const counts = new Map();
  for (const a of list) counts.set(baseProject(a), (counts.get(baseProject(a)) || 0) + 1);
  return list.map((a) => ({ article: a, label: counts.get(baseProject(a)) > 1 ? String(a.project) : baseProject(a) }));
}

export function loadUses({ page, articles, bySlug, warn }) {
  const file = page.file;
  const stacks = new Map(articles.map((a) => [a.slug, stackText(a)]));
  const tagSets = new Map(articles.map((a) => [a.slug, new Set((a.tags || []).map(tagSlug))]));
  const seen = new Set();
  return (page.groups || []).map((g, gi) => {
    if (!g.name || !g.id) throw new Error(`[blog] ${file}: group ${gi + 1} needs a "name" and an "id"`);
    const tools = (g.tools || []).map((t, ti) => {
      if (!t.name) throw new Error(`[blog] ${file}: ${g.id} tool ${ti + 1} has no "name"`);
      if (seen.has(t.name.toLowerCase())) warn(`${file}: "${t.name}" is listed twice`);
      seen.add(t.name.toLowerCase());
      const aliases = [t.name, ...(t.match || [])];
      const slugs = new Set(aliases.map(tagSlug));
      const res = aliases.map(wordRe);
      const skip = new Set(t.skip || []);
      const explicit = (t.articles || []).filter((slug) => {
        if (bySlug.has(slug)) return true;
        warn(`${file}: "${t.name}" lists "${slug}", which is not published; left out`);
        return false;
      });
      const hosts = t.hosts || [];
      const matched = articles
        .filter(
          (a) =>
            [...tagSets.get(a.slug)].some((s) => slugs.has(s)) ||
            res.some((re) => re.test(stacks.get(a.slug))) ||
            hosts.some((h) => liveHost(a) === h || liveHost(a).endsWith(`.${h}`)),
        )
        .map((a) => a.slug);
      // Newest first (the order of `articles`), explicit ones included.
      const keep = new Set([...explicit, ...matched].filter((s) => !skip.has(s)));
      const list = articles.filter((a) => keep.has(a.slug));
      return { name: t.name, note: t.note, at: t.at || [], articles: labelArticles(list) };
    });
    return { id: g.id, name: g.name, tools };
  });
}
