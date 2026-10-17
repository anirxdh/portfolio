// Multi-part article series. Each article in a series gets a box linking the other parts.
// List every planned part here; parts that are still drafts are skipped automatically, and the
// box only appears once at least two parts are published.

export const SERIES = [
  {
    id: 'screensense',
    name: 'The ScreenSense series',
    blurb: 'How ScreenSense went from a hold-to-talk Chrome extension to a voice browser agent.',
    parts: [
      { slug: 'screensense-v1-talk-to-your-screen', label: 'v1' },
      { slug: 'screensense-v2-amazon-nova-agent-loop', label: 'v2' },
      { slug: 'screensense-voice-browser-agent', label: 'v3' },
    ],
  },
];

// { series, parts: [{ label, article }] } for an article, or null. `bySlug` maps slug -> published article.
export function seriesFor(slug, bySlug) {
  for (const s of SERIES) {
    if (!s.parts.some((p) => p.slug === slug)) continue;
    const parts = s.parts.filter((p) => bySlug.has(p.slug)).map((p) => ({ label: p.label, article: bySlug.get(p.slug) }));
    return parts.length >= 2 ? { series: s, parts } : null;
  }
  return null;
}
