---
draft: true
title: "How AniBot Streams Answers About Me From a Netlify Function"
description: "AniBot is the chat assistant on my portfolio. How it streams gpt-4o-mini tokens through a Netlify Function, why I dropped RAG, and how the blog is built."
date: 2026-09-30
slug: anibot-portfolio-chatbot
project: "AniBot (this site)"
tags: [OpenAI, Netlify Functions, Streaming, React Three Fiber, Static Site Generation, SEO]
repo: https://github.com/anirxdh/portfolio
live: https://anirudhvasudevan.com/
accent: "#7c9cff"
summary: "AniBot is a chat widget on my portfolio that streams gpt-4o-mini answers token by token from a single Netlify Function, grounded by a hand-written system prompt instead of a vector database. This article also covers the React Three Fiber hero and the static blog engine that rendered this page."
---

## The resume nobody reads

Recruiters do not read resumes top to bottom. They skim for a company name, a stack, and a reason to send an email. My portfolio in late 2025 had a 3D hacker room and a project carousel, and it still made people hunt for the two sentences they wanted. I wanted a way for a visitor to just ask.

AniBot is a streaming chat assistant on my portfolio site that answers questions about my work, projects, hackathons, and how to reach me, built by Anirudh Vasudevan for anirudhvasudevan.com. You click a floating button, type "what did he build at the YC hackathon," and the answer types itself out in Markdown while the model is still generating it. Behind it is one Netlify Function, one long system prompt, and a React hook of about 120 lines. This article covers that widget, the React Three Fiber hero, and the static blog engine that rendered this page.

## Why a system prompt beat a vector database

The first version of AniBot was a RAG pipeline. Commit ef483a6 on November 2, 2025 added a Netlify Function, a Pinecone index, and a scripts/embedDocuments.js that parsed my resume PDF with pdf-parse, split it into 1000 character chunks with 200 characters of overlap, and embedded them with text-embedding-3-small. At request time the function embedded the question, pulled the top 5 chunks, and pasted them into the prompt. It worked. It was the wrong tool.

The knowledge base was one PDF. Everything the retriever could return was something I could type into a prompt in an afternoon, and a prompt can say things a resume never does: which link to send, what tone to take with a founder versus a recruiter. Retrieval added a second vendor, a second key, a network hop per call, and a failure mode where the model answered confidently from the wrong chunk.

So the same evening, commit aac606d, "chatbot made simple," deleted netlify/functions/utils/pinecone.js and the embedding script and replaced them with a createSystemPrompt() function in netlify/functions/utils/openai.js. The two commits are less than three hours apart in the git log.

The other decision was streaming. The first version waited for the full completion and returned JSON. The July 2026 refresh (commit 1126ffa) switched to token streaming, because a 900 token answer from gpt-4o-mini takes a few seconds, and a bubble with three dots for that long reads as broken. Streaming fixed the feel without touching the model or the prompt.

## What a visitor sees

AniBot lives in a floating button at the bottom right of every page. Clicking it opens a 400 by 600 pixel dialog with a welcome message and five suggested questions from src/components/AiChat/SuggestedQuestions.jsx, from my work at Rivo to how to get in touch.

Type a question or tap a chip. The user bubble appears with a typing indicator under it. When the first text arrives, the indicator disappears and an assistant bubble fills in, rendered as Markdown with bold names, bullet lists, and links that open in a new tab. After the first reply a "Keep exploring" row offers three follow-ups and a button that scrolls to the contact form. The widget loads through React.lazy in App.jsx, so it stays out of the first paint.

## Architecture

The site is a React 18 single page app built with Vite 6 and Tailwind 3, hosted on Netlify. There is no backend except one Netlify Function. The chat client posts to /api/chat, netlify.toml rewrites that path to /.netlify/functions/chat, and the function talks to OpenAI and streams the answer back as plain text. Everything else, including the blog, is static files produced at build time.

![AniBot architecture: browser, Netlify Function, OpenAI, and the build-time blog generator](/blog/diagrams/anibot-portfolio-chatbot-architecture.svg)

On the left is the browser, where App.jsx lazy-loads the widget and useAiChat.js owns the message list and the fetch. In the middle is Netlify: the CDN serving dist/, the redirect rules, and chat.js running as a Functions v2 handler bundled by esbuild. On the right is OpenAI. The bottom row is build time: npm run build runs vite build and then node scripts/build-blog.mjs, which turns content/articles/*.md into HTML under dist/blog/.

Here is what each layer uses and why.

| Layer | Choice | Why |
|---|---|---|
| Hosting | Netlify static site plus Functions v2 | One deploy for site and API, nothing to keep warm |
| Chat API | chat.js with Request and Response objects | Web standard streams work with no adapter |
| Model | gpt-4o-mini, temperature 0.6, max_tokens 900 | Cheap, fast, good enough for short factual answers |
| Knowledge | Hardcoded system prompt in utils/openai.js | One PDF of facts does not need retrieval |
| Transport | text/plain ReadableStream, X-Accel-Buffering: no | Simpler than SSE and proxies do not buffer it |
| Client render | fetch body reader plus setState throttled to 40 ms | Smooth typing without a fake timer |
| 3D hero | React Three Fiber, drei, maath easing | Declarative scene with damped pointer parallax |
| Blog | gray-matter and marked in build-blog.mjs | Static HTML that crawlers read without running React |

## How it works

### The function validates, then streams

chat.js is a default export that takes a Request and returns a Response, the Netlify Functions v2 shape. It answers the OPTIONS preflight, rejects anything but POST, parses JSON, and requires the message to be a string of at most 4000 characters. The conversation history the client sends is not trusted either.

```js
// netlify/functions/chat.js
const safeHistory = (Array.isArray(conversationHistory) ? conversationHistory : [])
  .filter(
    (m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string',
  )
  .slice(-MAX_HISTORY_ITEMS)
  .map((m) => ({ role: m.role, content: m.content.slice(0, MAX_HISTORY_CHARS) }));
```

Only user and assistant turns survive, so nobody can slip a second system message in from the browser, and the list is capped at 10 turns of 4000 characters each, which bounds the token cost of any one request. CORS is a regex, ORIGIN_PATTERN, that allows the apex domain, www, the old netlify.app subdomain, and deploy previews.

streamChatCompletion() in utils/openai.js calls openai.chat.completions.create with gpt-4o-mini, temperature 0.6, max_tokens 900, and stream: true, with the system prompt prepended. chat.js wraps the result in a ReadableStream whose start() method is this loop.

```js
// netlify/functions/chat.js
for await (const chunk of openaiStream) {
  const content = chunk.choices?.[0]?.delta?.content || '';
  if (content) controller.enqueue(encoder.encode(content));
}
```

Each delta is encoded to UTF-8 bytes and enqueued, and a finally block closes the controller. The Response carries Content-Type text/plain, Cache-Control no-cache, and X-Accel-Buffering: no, so no proxy holds the bytes until the end. There is no SSE framing and no JSON per event. The body is the answer arriving in pieces.

### The client throttles its own re-renders

![One chat message end to end, from the widget through chat.js to OpenAI and back](/blog/diagrams/anibot-portfolio-chatbot-flow.svg)

useAiChat.js sends {message, conversationHistory}, where the history is the last 10 messages with the welcome message filtered out, then reads the body with a reader instead of waiting for it to finish.

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

The loop calls reader.read() until done, decoding with stream: true so a multi-byte character split across chunks is not corrupted. The assistant message does not exist until the first non-empty chunk lands; then the hook hides the typing dots and appends a message with whatever text has arrived. After that, setMessages only runs when performance.now() is more than 40 ms past the last flush. When the stream ends there is one final flush, and an empty stream gets a fallback line.

The 40 ms matters because ChatMessage.jsx runs react-markdown with remark-gfm over the whole message on every render, and a 900 token answer can arrive as several hundred chunks. About 25 updates per second keeps the typing smooth and keeps the parser from running hundreds of times per answer.

### The system prompt is the whole knowledge base

utils/openai.js is 178 lines and most of it is the prompt string, split into labelled blocks: contact, education, skills, current role, previous experience, hackathons, key projects, patents, and a closing block of response rules. The rules say replies render as Markdown, keep it to 2 to 4 sentences or a few bullets, link projects, admit when something is not covered, and never invent facts, employers, dates, or metrics. The last rule states that I am employed at Rivo and the bot must never imply I am urgently seeking work.

The trade is simple. Every resume change means editing a JavaScript string and redeploying, and the full prompt is sent with every request. In exchange, the knowledge is deterministic and reviewable in a diff.

### The hero scene and the main thread

The hero in src/sections/Hero.jsx is a React Three Fiber Canvas with a PerspectiveCamera at z=30 and a HackerRoom model loaded from /models/hacker-room.glb with drei's useGLTF. The room model, the gltfjsx-generated components (HackerRoom.jsx, DemoComputer.jsx, Developer.jsx), and the section layout come from the JavaScript Mastery three.js portfolio course. What I changed is the content, the camera behaviour, and the Projects monitor, which now paints real project screenshots onto its screen mesh and crossfades between them with GSAP.

```jsx
// src/components/HeroCamera.jsx
useFrame((state, delta) => {
  easing.damp3(state.camera.position, [0, 0, 20], 0.25, delta);

  if (!isMobile) {
    easing.dampE(group.current.rotation, [-state.pointer.y / 3, state.pointer.x / 5, 0], 0.25, delta);
  }
});
```

Every frame, damp3 from maath eases the camera from z=30 toward 20, the slow dolly-in on load, and dampE eases the room's rotation toward a target derived from the pointer, so the mouse tilts the room with a lag. On mobile there is no pointer, so that branch is skipped.

Three canvases on one page compete for the main thread. useScrollReveal.js reveals elements through an IntersectionObserver but also sets a 4 second timeout that reveals everything, and Counter.jsx runs the impact band numbers on wall-clock time with a setTimeout that writes the final value in case requestAnimationFrame is throttled.

### The blog engine behind this page

scripts/build-blog.mjs runs right after vite build. It reads every content/articles/*.md with gray-matter, throws if required frontmatter is missing, skips anything marked draft: true, computes a reading time at 230 words per minute, and sorts by date. A custom marked renderer gives h2 headings anchor ids for a table of contents, opens external links in a new tab, and inlines any image that points at /blog/diagrams/*.svg as a figure.

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

The SVG markup goes straight into the HTML, so diagram labels are indexable text and the page makes no extra request to draw them. The generator also lexes the Markdown, finds the "## FAQ" heading, pairs each question with its answer, and emits a FAQPage JSON-LD block alongside BlogPosting and BreadcrumbList. It writes dist/blog/<slug>/index.html per article, a listing page, an RSS feed, a rewritten sitemap.xml, and an index.json that src/sections/Writing.jsx fetches to show the latest three cards on the homepage.

Browser-dependent steps stay off the build server. render-diagrams.sh runs @mermaid-js/mermaid-cli@11 with the dark hand-drawn theme in scripts/blog/mermaid.json against a local Chromium, and lint-articles.mjs checks frontmatter, bans em dashes and filler words, and greps for anything that looks like an API key. Netlify only ever runs Node.

## The hard parts

Streaming through a function has a blind spot. If OpenAI errors mid-stream, chat.js logs it and closes the stream, but the 200 status already went out. The client renders whatever arrived, and nobody can tell a truncated answer from a complete one.

There is no rate limiting. The origin regex only protects browsers, since curl can send any Origin header, and the length caps bound the cost per request but not the number of requests. The real protection today is the spending limit on the OpenAI account.

The system prompt is server-side, but the repository is public, so the prompt is public too, and it holds contact details that belong in environment variables. There are leftovers as well: the old resume PDF under scripts/documents, Pinecone placeholders in .env.example, and five legacy project videos that nothing references. And the mermaid config points at an absolute path to one Chromium binary, so diagrams only build on one laptop.

## Results

AniBot has been live since November 2025 and streaming since the July 4, 2026 commit. The portfolio moved to anirudhvasudevan.com on September 26, 2026 (commits 547fcc8 and c46e814), with 301 redirects from www and the old netlify.app subdomain and WebSite and Person structured data. The static blog engine landed as commit d34549d, and every article under /blog/, including this one, is rendered by it.

I have no usage numbers. The chat function stores nothing and the site has no analytics on chat events. There is no award attached to this project. It is my own site.

## What I would do differently

Move the personal fields out of the prompt string into environment variables. Put an AbortController with a timeout on the OpenAI call and send a short sentinel at the end of a successful stream so the client can tell complete from cut off. Add a token bucket keyed on IP in front of the function. Wire lint-articles.mjs into npm run build so a bad article fails the deploy.

The next real step is content. The blog articles are now much larger than the resume, and AniBot knows nothing about them. Stuffing summaries into the prompt will not scale, so this is where retrieval might finally earn its place: not for one PDF, but for a growing set of long documents the prompt cannot hold.

## Key takeaways

- A plain text/plain stream over fetch is enough for a one-way token stream. SSE adds framing you only need when you multiplex several event types.
- Throttle UI flushes with performance.now() instead of flushing per chunk. 40 ms is below what a reader notices.
- Treat client-supplied conversation history as untrusted input: whitelist roles, cap the count, cap the length per turn.
- A curated system prompt beats retrieval when the corpus is one document you control. Add retrieval when the corpus outgrows the context window or changes without you.
- Give animation and reveal hooks a wall-clock fallback whenever WebGL canvases share the page, because rAF and IntersectionObserver callbacks can stall.
- Pre-render anything a crawler should read, and keep browser-dependent build steps off the CI box by committing their outputs.

## FAQ

### How does AniBot stream responses from a Netlify Function?

AniBot's Netlify Function (netlify/functions/chat.js) calls the OpenAI chat completions API with stream: true, then wraps the async iterator in a ReadableStream that enqueues each delta.content as UTF-8 bytes. The Response is sent as text/plain with X-Accel-Buffering: no, and the browser reads it with response.body.getReader() and a TextDecoder, appending text to the assistant bubble as it arrives.

### Why does AniBot use a system prompt instead of RAG?

AniBot started as a Pinecone RAG pipeline over one resume PDF and was rewritten the same day to use a single hand-written system prompt. The corpus fit in the prompt, a prompt can carry tone and formatting rules a resume cannot, and dropping retrieval removed a vendor, a key, and a network hop per request.

### What model does AniBot use?

AniBot uses OpenAI's gpt-4o-mini through the official Node SDK, with temperature 0.6 and max_tokens 900. The model is cheap and fast, which matters because every request carries the full system prompt plus up to 10 turns of history.

### How is the blog on anirudhvasudevan.com generated?

The blog is generated by scripts/build-blog.mjs, which runs after vite build. It parses Markdown with gray-matter and marked, inlines SVG diagrams, extracts the FAQ section into FAQPage structured data, and writes static HTML for each article plus an index page, an RSS feed, a sitemap, and a JSON index the React homepage reads.

### Is the 3D hero scene on the portfolio original?

No. The hacker room model, the computer and avatar models, and the gltfjsx-generated React components come from the JavaScript Mastery three.js portfolio course. What is original is the AniBot chat system, the camera and scroll behaviour, the screenshot carousel on the 3D monitor, the SEO setup, and the static blog engine.

## Links

- Live site: [anirudhvasudevan.com](https://anirudhvasudevan.com/)
- Source: [github.com/anirxdh/portfolio](https://github.com/anirxdh/portfolio)
