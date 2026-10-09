---
title: "How AniBot Streams Answers About Me From a Netlify Function"
description: "AniBot is the chat assistant on my portfolio. How it streams gpt-4o-mini tokens through a Netlify Function, why I dropped RAG, and how the blog is built."
date: 2026-10-03
slug: anibot-portfolio-chatbot
project: "AniBot (this site)"
tags: [OpenAI, Netlify Functions, Streaming, React Three Fiber, Static Site Generation, SEO]
repo: https://github.com/anirxdh/portfolio
live: https://anirudhvasudevan.com/
accent: "#7c9cff"
summary: "AniBot is a chat widget on my portfolio that streams gpt-4o-mini answers token by token from a single Netlify Function, grounded by a hand-written system prompt instead of a vector database. This article also covers the React Three Fiber hero and the static blog engine that rendered this page."
---

## The resume nobody reads

Recruiters do not read resumes top to bottom. They skim for a company name, a stack, and a reason to send an email. My portfolio in late 2025 had a 3D hacker room and a project carousel, and it still made people hunt for the two sentences they wanted. I wanted visitors to just ask.

AniBot is a streaming chat assistant on my portfolio site that answers questions about my work, projects, hackathons, and how to reach me, built by Anirudh Vasudevan for anirudhvasudevan.com. You click a floating button, type "what did he build at the YC hackathon," and the answer types itself out in Markdown while the model is still generating it. Behind it is one Netlify Function, one long system prompt, and a React hook of about 140 lines. This article covers the widget, the React Three Fiber hero, and the blog engine that rendered this page.

## Why a system prompt beat a vector database

The first version of AniBot was a RAG pipeline. Commit ef483a6 on November 2, 2025 added a Netlify Function, a Pinecone index, and scripts/embedDocuments.js, which parsed my resume PDF with pdf-parse, split it into 1000 character chunks with 200 of overlap, and embedded them with text-embedding-3-small. At request time it embedded the question and pasted the top 5 chunks into the prompt. It worked. It was the wrong tool.

The knowledge base was one PDF. Everything the retriever could return I could type into a prompt in an afternoon, and a prompt can say things a resume never does: which link to send, what tone to take with a founder versus a recruiter. Retrieval added a second vendor, a second key, a network hop per call, and a way for the model to answer confidently from the wrong chunk.

So the same evening, commit aac606d, "chatbot made simple," deleted netlify/functions/utils/pinecone.js and the embedding script and replaced them with createSystemPrompt() in netlify/functions/utils/openai.js, less than three hours after the first commit.

The other decision was streaming. The first version returned the full completion as JSON. The July 2026 refresh (commit 1126ffa) switched to token streaming, because the first version showed three dots until the whole reply was done, and a bubble that does nothing for the length of a 900 token answer reads as broken.

## What a visitor sees

AniBot lives in a floating button at the bottom right of every page. Clicking it opens a 400 by 600 pixel dialog with a welcome message and five suggested questions from src/components/AiChat/SuggestedQuestions.jsx.

Type a question or tap a chip. A user bubble appears with a typing indicator, and when the first text arrives an assistant bubble fills in, rendered as Markdown with links that open in a new tab. After the first reply a "Keep exploring" row offers three follow-ups and a button that scrolls to the contact form.

## Architecture

The site is a React 18 single page app built with Vite 6 and Tailwind 3, hosted on Netlify, with no backend except one Netlify Function. The chat client posts to /api/chat, netlify.toml rewrites that path to /.netlify/functions/chat, and the function talks to OpenAI and streams the answer back as plain text. Everything else, including the blog, is static files produced at build time.

![AniBot architecture: browser, Netlify Function, OpenAI, and the build-time blog generator](/blog/diagrams/anibot-portfolio-chatbot-architecture.svg)

On the left is the browser, where App.jsx lazy-loads the widget and useAiChat.js owns the message list and the fetch. In the middle is Netlify: the CDN serving dist/, chat.js as a Functions v2 handler, and openai.js holding the system prompt beside it. On the right is OpenAI. The bottom row is build time, where npm run build runs vite build and then node scripts/build-blog.mjs to turn content/articles/*.md into HTML under dist/blog/.

Here is what each layer uses and why.

| Layer | Choice | Why |
|---|---|---|
| Hosting | Netlify static site plus Functions v2 | One deploy for site and API, nothing to keep warm |
| Chat API | chat.js with Request and Response objects | Web standard streams work with no adapter |
| Model | gpt-4o-mini, temperature 0.6, max_tokens 900 | Cheap and fast for short factual answers |
| Knowledge | Hardcoded system prompt in utils/openai.js | One PDF of facts does not need retrieval |
| Transport | text/plain ReadableStream, X-Accel-Buffering: no | Simpler than SSE and it asks proxies not to buffer |
| Client render | fetch body reader plus setState throttled to 40 ms | Smooth typing without a fake timer |
| 3D hero | React Three Fiber, drei, maath easing | Declarative scene with damped pointer parallax |
| Blog | gray-matter and marked in build-blog.mjs | Static HTML crawlers read without running React |

## How it works

### The function validates, then streams

chat.js is a default export that takes a Request and returns a Response, the Netlify Functions v2 shape. It answers the OPTIONS preflight, rejects anything but POST, and requires the message to be a string of at most 4000 characters. The history the client sends is not trusted either.

```js
// netlify/functions/chat.js
const safeHistory = (Array.isArray(conversationHistory) ? conversationHistory : [])
  .filter(
    (m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string',
  )
  .slice(-MAX_HISTORY_ITEMS)
  .map((m) => ({ role: m.role, content: m.content.slice(0, MAX_HISTORY_CHARS) }));
```

Only user and assistant turns survive, so nobody can slip a second system message in from the browser, and the list is capped at 10 turns of 4000 characters each, which bounds the token cost of one request. CORS is a regex, ORIGIN_PATTERN, that allows the apex domain, www, the old netlify.app subdomain, and deploy previews.

streamChatCompletion() in utils/openai.js calls openai.chat.completions.create with gpt-4o-mini, temperature 0.6, max_tokens 900, and stream: true, with the system prompt prepended. chat.js wraps the result in a ReadableStream whose start() method loops over the OpenAI iterator with for await, encodes each delta.content to UTF-8 bytes, and enqueues it; a finally block closes the controller. The Response carries Content-Type text/plain, Cache-Control no-cache, and X-Accel-Buffering: no, which asks proxies such as nginx not to hold the bytes until the end (it is a hint, not a guarantee). There is no SSE framing and no JSON per event, just the answer arriving in pieces.

### The client throttles its own re-renders

![One chat message end to end, from the widget through chat.js to OpenAI and back](/blog/diagrams/anibot-portfolio-chatbot-flow.svg)

useAiChat.js sends {message, conversationHistory}, the last 10 messages minus the welcome message, then reads the body with a reader instead of waiting for it to finish.

```js
// src/hooks/useAiChat.js
const reader = response.body.getReader();
const decoder = new TextDecoder();
let acc = '';
let created = false;
let lastFlush = 0;

const flush = () => {
  const text = acc;
  setMessages((prev) => prev.map((m) => (m.id === assistantId ? { ...m, content: text } : m)));
};
```

The loop calls reader.read() until done, decoding with stream: true so a multi-byte character split across chunks survives. The assistant message does not exist until the first non-empty chunk lands; then the hook hides the typing dots and creates it. After that, setMessages only runs when performance.now() is more than 40 ms past the last flush, with one final flush when the stream ends and a fallback line if it was empty.

The 40 ms matters because ChatMessage.jsx runs react-markdown with remark-gfm over the whole message on every render, and the stream delivers a few characters per chunk. The gap caps re-renders at 25 per second no matter how fast chunks land. I picked the number by eye; nothing in the repo measures it, and it is one constant to tune if it ever feels off.

### The system prompt is the whole knowledge base

utils/openai.js is 178 lines and most of it is the prompt string, split into labelled blocks including about, contact, education, skills, current role, previous experience, hackathons, key projects, patents, availability, and a closing block of response rules. The rules say replies render as Markdown, stay at 2 to 4 sentences or a few bullets, link projects, admit when something is not covered, and never invent facts, employers, dates, or metrics. The last rule says I am employed at Rivo and the bot must never imply I am urgently seeking work.

The trade is simple. Every resume change means editing a JavaScript string and redeploying, and the full prompt rides along on every request. In exchange, the knowledge base is fixed and reviewable in a diff.

### The hero scene and the main thread

The hero in src/sections/Hero.jsx is a React Three Fiber Canvas with a camera at z=30 and a HackerRoom model loaded with drei's useGLTF. The room model, the gltfjsx components, and the section layout come from the JavaScript Mastery three.js portfolio course. What I changed is the content, the Projects monitor, which paints real screenshots onto its screen mesh and crossfades them with GSAP, and the scroll and counter hooks around the canvases. The camera easing in HeroCamera.jsx, which dollies from z=30 to 20 with maath's damp3 and tilts the room toward the pointer with dampE, is the course's file as shipped; I kept it because it does the right thing. The monitor is mine, and this is the part of src/components/DemoComputer.jsx that swaps screenshots.

```jsx
// src/components/DemoComputer.jsx
const tl = gsap.timeline();
tl.to(mat, {
  opacity: 0,
  duration: 0.3,
  ease: 'power1.in',
  onComplete: () => setDisplayIdx(target),
}).to(mat, { opacity: 1, duration: 0.4, ease: 'power1.out' });
return () => tl.kill();
```

When the active screenshot index changes, a GSAP timeline fades the screen material out over 0.3 seconds, swaps the texture in onComplete, and fades back in over 0.4 seconds. A stateRef tracks which index is actually on screen, so a quick run of clicks cannot race the async setState, and switching projects snaps to the first image with no fade. The textures come from drei's useTexture with flipY off and the sRGB color space set, which is what keeps the screenshots upright and not washed out. Because three canvases share the main thread, useScrollReveal.js and Counter.jsx both carry a setTimeout fallback in case IntersectionObserver or requestAnimationFrame callbacks stall.

### The blog engine behind this page

scripts/build-blog.mjs runs right after vite build. It reads every content/articles/*.md with gray-matter, throws on missing frontmatter, skips draft: true, computes a reading time at 230 words per minute, and sorts by date. A custom marked renderer gives every heading an anchor id and collects the h2s into a table of contents, opens external links in a new tab, and inlines any image that points at /blog/diagrams/*.svg as a figure.

```js
// scripts/build-blog.mjs
const svg = fs
  .readFileSync(file, 'utf8')
  .replace(/<\?xml[^>]*\?>/, '')
  .replace(/<svg /, '<svg role="img" ');
return `<figure class="diagram"><div class="diagram__canvas">${svg}</div>${
  text ? `<figcaption>${esc(text)}</figcaption>` : ''
}</figure>`;
```

The SVG goes straight into the HTML, so diagram labels are indexable text and need no extra request. The generator also finds the "## FAQ" heading, pairs each question with its answer, and emits a FAQPage JSON-LD block alongside BlogPosting and BreadcrumbList. It writes dist/blog/<slug>/index.html per article, a listing page, an RSS feed, sitemap.xml, and an index.json that src/sections/Writing.jsx fetches for the homepage cards.

Browser-dependent steps stay off the build server. render-diagrams.sh runs @mermaid-js/mermaid-cli@11 with the hand-drawn theme in scripts/blog/mermaid.json against a local Chromium, and lint-articles.mjs checks frontmatter, bans em dashes and filler words, and greps for anything that looks like an API key. Netlify only runs Node.

## The hard parts

Streaming through a function has a blind spot. If OpenAI errors mid-stream, chat.js logs it and closes the stream, but the 200 status already went out, so the client renders whatever arrived and nobody can tell a truncated answer from a complete one.

There is no rate limiting. The origin regex only stops browsers, since curl can send any Origin header, and the length caps bound the cost per request, not the number of requests. The only backstop is whatever spending cap is set on the OpenAI account, which lives outside the repo.

The system prompt is server-side, but the repository is public, so the prompt is public too, and it holds contact details that belong in environment variables. There are leftovers too: the old resume PDF under scripts/documents, Pinecone placeholders in .env.example, and five legacy project videos nothing references. And the puppeteer config (scripts/blog/puppeteer.json) points at an absolute path to one Chromium binary, so diagrams only build on one laptop.

## Results

AniBot has been in the repo since November 2025 and streaming since the July 4, 2026 commit. The portfolio moved to anirudhvasudevan.com on September 26, 2026 (commits 547fcc8 and c46e814), with 301 redirects from www and the old netlify.app subdomain. The static blog engine landed as commit d34549d and renders every article under /blog/, including this one.

I have no usage numbers, because the chat function stores nothing and the site has no analytics on chat events. There is no award attached to this project; it is my own site.

## What I would do differently

Move the personal fields out of the prompt string into environment variables. Put an AbortController with a timeout on the OpenAI call and end a successful stream with a short sentinel so the client can tell complete from cut off. Add a token bucket keyed on IP in front of the function. Wire lint-articles.mjs into npm run build so a bad article fails the deploy.

The next real step is content. The blog articles are now much larger than the resume and AniBot knows nothing about them, so this is where retrieval might finally earn its place: not for one PDF, but for a growing set of long documents the prompt cannot hold.

## Key takeaways

- A plain text/plain stream over fetch is enough for one-way tokens. SSE adds framing you only need when you multiplex several event types.
- Throttle UI flushes with performance.now() instead of flushing per chunk. One constant caps re-renders no matter how fast the stream arrives, and it is easy to measure and tune later.
- Treat client-supplied conversation history as untrusted input: whitelist roles, cap the count, cap the length per turn.
- A curated system prompt beats retrieval when the corpus is one document you control. Add retrieval when the corpus outgrows the context window or changes without you.
- Pre-render anything a crawler should read, and keep browser-dependent build steps off the CI box by committing their outputs.

## FAQ

### How does AniBot stream responses from a Netlify Function?

AniBot's Netlify Function (netlify/functions/chat.js) calls the OpenAI chat completions API with stream: true and wraps the async iterator in a ReadableStream that enqueues each delta.content as UTF-8 bytes. The browser reads the text/plain Response with response.body.getReader() and a TextDecoder and appends text to the assistant bubble as it arrives.

### Why does AniBot use a system prompt instead of RAG?

AniBot started as a Pinecone RAG pipeline over one resume PDF and was rewritten the same day around a single hand-written system prompt. The corpus fit in the prompt, a prompt can carry tone and formatting rules a resume cannot, and dropping retrieval removed a vendor, a key, and a network hop per request.

### What model does AniBot use?

AniBot uses OpenAI's gpt-4o-mini through the official Node SDK, with temperature 0.6 and max_tokens 900. The model is cheap and fast, which matters because every request carries the full system prompt plus up to 10 turns of history.

### How is the blog on anirudhvasudevan.com generated?

The blog on anirudhvasudevan.com is generated by scripts/build-blog.mjs, which runs after vite build and parses each Markdown article with gray-matter and marked. It inlines SVG diagrams, turns the FAQ section into FAQPage structured data, and writes static HTML per article plus an index page, an RSS feed, a sitemap, and a JSON index for the homepage.

### Is the 3D hero scene on the portfolio original?

No, the hacker room, computer, and avatar models and the gltfjsx-generated React components come from the JavaScript Mastery three.js portfolio course. What is original is the AniBot chat system, the scroll reveal and counter behaviour, the screenshot carousel on the 3D monitor, the SEO setup, and the static blog engine.

## Links

- Live site: [anirudhvasudevan.com](https://anirudhvasudevan.com/)
- Source: [github.com/anirxdh/portfolio](https://github.com/anirxdh/portfolio)
