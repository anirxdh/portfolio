# anirudhvasudevan.com

The personal site of **Anirudh Vasudevan**, a full-stack and AI engineer in San Francisco and Member of Technical Staff at Rivo.

- Site: https://anirudhvasudevan.com
- About: https://anirudhvasudevan.com/about/
- Writing (deep dives on the projects): https://anirudhvasudevan.com/blog/

## What is in here

- **Portfolio app** (`src/`): React 18 + Vite + Tailwind. The homepage opens on a story told on one Canvas 2D layer (`src/components/story`): the hero's sky is a constellation of his projects and write-ups, and on scroll those stars travel into "My work, as a universe", where the homepage projects orbit as planets. Three.js scenes through React Three Fiber stay further down (a monitor that cycles real project screenshots, an animated developer character).
- **Talk to AniBot** (`src/sections/Hero.jsx`, `src/components/hero`): the hero name dissolves into a particle orb that is AniBot's voice. It is a real conversation on the browser's free speech engines (SpeechRecognition in, speechSynthesis out) against the same `/api/chat` backend in a short spoken style, with the offline notes as the fallback and a text field when there is no microphone.
- **AniBot** (`src/components/AiChat`, `netlify/functions/chat.js`): a chat assistant that answers questions about Anirudh. Replies stream token by token from a Netlify Function, render as Markdown, and can be spoken aloud. A mic button lets you ask out loud using the browser's speech recognition.
- **Static blog engine** (`scripts/build-blog.mjs`): Markdown articles in `content/articles/` become real HTML pages at `/blog/<slug>/` after the Vite build, with BlogPosting, FAQPage, and Breadcrumb structured data, hand-drawn architecture diagrams (Mermaid, rendered to SVG), per-article share images, an RSS feed, `llms.txt`, and a sitemap. `content/pages/about.md` becomes `/about/`. See `content/README.md`.

## SEO and GEO toolkit

- `npm run check:seo` audits the built site (titles, canonicals, structured data, sitemap, links, llms.txt).
- `docs/SEO-PLAYBOOK.md` is the owner checklist: Search Console, Bing, profile updates, bio kit, syndication.
- `syndication/` holds dev.to, Hashnode and Medium copies of every article with canonical links back here (`node syndication/export.mjs` regenerates them).
- `node scripts/indexnow.mjs` pings Bing and ChatGPT search after a deploy; `bash scripts/link-repos.sh` points each project repo at its write-up.

## Run it

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # Vite build + blog pages into dist/
```

Blog tooling: `npm run diagrams` (render changed diagrams), `python3 scripts/gen-og.py` (share images), `node scripts/lint-articles.mjs` (style and structure checks), `node scripts/indexnow.mjs` (ping Bing after a deploy).

The chat function needs `OPENAI_API_KEY` set in Netlify. The contact form uses EmailJS (`VITE_APP_EMAILJS_*`).

## Deploy

Pushes to `main` deploy on Netlify. The custom domain is served over HTTPS only, and the old `anirudhvasudevan.netlify.app` address 301-redirects here.
