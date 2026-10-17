// Topic pages: /blog/topics/<slug>/ for every tag that MIN_ARTICLES or more published articles share.
// Tags are free text in article frontmatter, so a few spellings of the same thing are folded together
// here (display only; the article files are not touched).

export const MIN_ARTICLES = 2;

const ALIASES = new Map([
  ['web audio', 'Web Audio'],
  ['web audio api', 'Web Audio'],
  ['webaudio', 'Web Audio'],
  ['react.js', 'React'],
  ['reactjs', 'React'],
  ['nextjs', 'Next.js'],
  ['threejs', 'Three.js'],
  ['ffmpeg', 'ffmpeg'],
]);

export const canonicalTag = (tag) => {
  const t = String(tag).trim();
  return ALIASES.get(t.toLowerCase()) || t;
};

export const tagSlug = (tag) =>
  canonicalTag(tag)
    .toLowerCase()
    .replace(/\+/g, ' plus ')
    .replace(/#/g, ' sharp ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

// Canonical, de-duplicated tags of one article: [{ name, slug }].
export const articleTags = (article) => {
  const seen = new Set();
  const out = [];
  for (const raw of article.tags || []) {
    const slug = tagSlug(raw);
    if (!slug || seen.has(slug)) continue;
    seen.add(slug);
    out.push({ name: canonicalTag(raw), slug });
  }
  return out;
};

// [{ slug, name, articles[] }], most-used first. Articles keep the order they were passed in.
export function buildTopics(articles, min = MIN_ARTICLES) {
  const bySlug = new Map();
  for (const a of articles) {
    for (const { name, slug } of articleTags(a)) {
      if (!bySlug.has(slug)) bySlug.set(slug, { slug, name, articles: [] });
      bySlug.get(slug).articles.push(a);
    }
  }
  return [...bySlug.values()]
    .filter((t) => t.articles.length >= min)
    .sort((x, y) => y.articles.length - x.articles.length || x.name.localeCompare(y.name));
}
