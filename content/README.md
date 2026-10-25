# Blog content pipeline

Long-form project articles for https://anirudhvasudevan.com/blog/. Every article is a real static page
(see `scripts/build-blog.mjs`, which runs after `vite build`).

## Layout
- `content/articles/<slug>.md` — one article per project. Frontmatter: `title`, `description` (120-160 chars),
  `date`, `slug`, `project`, `tags` (3-6), `summary` (TL;DR), optional `award`, `repo`, `live`, `accent`, `cover`,
  and `draft: true` while unverified (drafts are skipped by the generator).
- `kind: guide` marks a pillar article that pulls lessons from several project write-ups (for example
  `lessons-building-voice-ai-agents`). Guides get a Guide badge, their own row on `/blog/` and a section in
  `llms.txt`, and come first on topic pages; `/projects/` and `/uses/` leave them out because they are not projects.
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

## SEO and GEO check
`scripts/validate-seo.mjs` audits the built site. Run it after `npm run build` (step 2 above). It reads `dist/`,
changes nothing, and needs no packages.

```bash
node scripts/validate-seo.mjs            # full report; exit code 1 if there is any error
node scripts/validate-seo.mjs --quiet    # errors only
node scripts/validate-seo.mjs --strict   # warnings fail the run too
```

What it checks:
- Every page: one title (30 to 65 chars), a meta description (70 to 165 chars), one canonical that is this page's
  own https URL, og:title, og:description, og:image, og:url, twitter:card, `<html lang>`, one `<h1>`, unique ids,
  alt text on every image, no em or en dashes in titles and descriptions, and no internal link or asset that is
  missing from `dist/`.
- JSON-LD: every block parses, each type has what Google asks for (BlogPosting, ProfilePage, Person, FAQPage,
  BreadcrumbList, ItemList, CollectionPage, WebSite, and ScholarlyArticle or Event if one appears), FAQ questions
  appear on the page, every on-site URL exists, and every node with the Person @id matches
  `scripts/blog/person.mjs`.
- `sitemap.xml` (every URL exists and is canonical, every page is listed, lastmod is YYYY-MM-DD), `robots.txt`
  (no search engine or AI crawler is blocked), `llms.txt` (every link works, every page is listed), the RSS feed,
  and the web manifest.

Errors break search results or structured data, so fix them before pushing. Warnings are worth fixing but do not
fail the run.
