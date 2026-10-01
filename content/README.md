# Blog content pipeline

Long-form project articles for https://anirudhvasudevan.com/blog/. Every article is a real static page
(see `scripts/build-blog.mjs`, which runs after `vite build`).

## Layout
- `content/articles/<slug>.md` — one article per project. Frontmatter: `title`, `description` (120-160 chars),
  `date`, `slug`, `project`, `tags` (3-6), `summary` (TL;DR), optional `award`, `repo`, `live`, `accent`, `cover`,
  and `draft: true` while unverified (drafts are skipped by the generator).
- `content/diagrams/<slug>-architecture.mmd` and `<slug>-flow.mmd` — mermaid sources, rendered locally to
  `public/blog/diagrams/*.svg` (hand-drawn look) and committed. The article embeds them as
  `![caption](/blog/diagrams/<slug>-architecture.svg)`.
- `public/blog/og/<slug>.png` — 1200x630 share image per article, generated locally.

## Commands
- `npm run diagrams` — render changed `.mmd` files (uses mermaid-cli with the local Chromium; lists failures).
- `python3 scripts/gen-og.py` — share images (FORCE=1 to regenerate all).
- `node scripts/lint-articles.mjs` — dashes, banned words, frontmatter, diagram refs, word counts, FAQ/table/takeaways.
- `npm run build` — Vite build + blog pages, sitemap (all articles), RSS, `/blog/index.json` for the homepage section.

## How the articles were produced
`scripts/blog/write-articles.workflow.js` is the multi-agent workflow that wrote them: one writer per project reads a
shallow clone of the repo and writes in the first person (plain English, no em dashes, real code excerpts, two diagrams,
a "why this approach" section, a stack table, key takeaways, and an FAQ that becomes FAQPage structured data); an
independent fact-checker verifies every claim against the code; the writer revises until it passes.

## Publishing checklist
1. Verify each article (fact-check pass or manual read), then remove `draft: true`.
2. `npm run diagrams && python3 scripts/gen-og.py && node scripts/lint-articles.mjs && npm run build`
3. Preview `dist/` (launch config `portfolio-preview`), spot-check desktop and phone.
4. Push to `main`; Netlify deploys. Check `/blog/`, `/sitemap.xml`, and one article's structured data.
