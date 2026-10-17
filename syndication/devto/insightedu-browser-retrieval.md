---
title: "InsightEDU: Retrieval in the Browser, Generation in the Cloud"
published: false
description: "How my University of Minnesota capstone turned six school-district equity datasets into Plotly dashboards and a chatbot that retrieves in the browser."
tags: ai, rag, react, openai
canonical_url: https://anirudhvasudevan.com/blog/insightedu-browser-retrieval/
cover_image: https://anirudhvasudevan.com/blog/og/insightedu-browser-retrieval.png
---

> **TL;DR** InsightEDU is my MS Computer Science capstone at the University of Minnesota: seven Plotly dashboards over aggregated school-district data plus a chatbot whose retrieval layer is a hand-written TF-IDF engine running in the browser. Only the final prompt leaves the page.

[Source on GitHub](https://github.com/anirxdh/InsightEDU)

## Six aggregated datasets and one chatbot question

InsightEDU is a React 19 and Vite 6 single-page app that Anirudh Vasudevan built as his University of Minnesota MS Computer Science capstone, advised by Erich Kummerfeld, turning six school-district datasets into Plotly dashboards and a plain-English chatbot. The written report is dated February 2026 and the most recent commit is dated April 2026.

The data arrived as aggregated tables for a public school district, school years 2017 through 2024: graduation, GPA bands, demographics, free and reduced-price meal eligibility, chronic absenteeism, and staff. Every row was rolled up to a group level and every small count masked, so the data was safe to put in a web page.

In the finished app, a question like "what is the graduation rate for English learners" touches three things: the browser tab, one OpenAI call, and Clerk for sign-in.

## Why I put retrieval in the browser instead of a vector database

The obvious approach was the standard RAG stack: embed the data, store vectors in Pinecone, query from the app. `CHATBOT_SETUP.md` describes exactly that design. `scripts/ingestPinecone.mjs` and `scripts/chatRag.mjs` still embed the documents with `text-embedding-3-small` into a 1536-dimension index named `edu-rag` and run a terminal chat over it with LangChain.

The browser app does not use that path, for two reasons. First, the corpus is tiny: 142 documents averaging about 133 characters. A vector database for 142 sentences is a hosted service, an API key, an index to keep in sync, and a network hop per question. Second, the questions are structured ("FRP by school," "staff by highest degree"), and those exact words appear in the documents. The report's literature review makes the same point, citing Robertson and Zaragoza: exact keyword matching is often more reliable in structured domains. Nothing in the repo compares the two; there is no retrieval eval for either path.

The report calls the Pinecone path complementary and lists expanding it as future work. Keeping retrieval local also meant only the prompt (system prompt, recent history, the question, and the retrieved sentences) leaves the page.

## What a user actually does

The app opens on a Clerk sign-in page; `src/App.jsx` renders nothing else until you authenticate.

1. The landing route shows a 3D ring of six dataset cards (`LandingSlider.jsx`).
2. Each chart page has tabs (overall, year, gender, race, equity groups) that call `makeChart(category, data)` for Plotly traces. A seventh route, `/chronic`, covers absenteeism.
3. A floating button opens `src/components/Chatbot.jsx`, with suggestion chips and a streamed answer.

## Architecture

InsightEDU has no server of its own. Six JSON files under `src/data/` are bundled at build time, Clerk handles identity, and OpenAI handles generation. Everything in between runs in the browser tab.

![InsightEDU architecture: six bundled JSON datasets feed Plotly dashboards and a browser-side RAG pipeline that calls OpenAI](https://anirudhvasudevan.com/blog/diagrams/insightedu-browser-retrieval-architecture.svg)

*InsightEDU architecture: six bundled JSON datasets feed Plotly dashboards and a browser-side RAG pipeline that calls OpenAI*

The datasets feed two consumers: the dashboards read them directly, and the builders in `ragStore.js` compile them into 142 sentence documents cached in `localStorage`. A `RagChat` singleton in `ragChat.js` routes each question, calls `tfidfSearch`, builds the prompt, reads the OpenAI stream, and passes text to `Chatbot.jsx` through `onChunk`. The Node scripts in their own "Node scripts only" box, joined by dotted lines, embed the same documents into Pinecone; the web app never imports them.

The main choices and the reason for each:

| Layer | Choice | Why |
|---|---|---|
| App shell | React 19 + Vite 6 + React Router 7 | One route per dataset, no server to host |
| Auth | Clerk `<SignedIn>` / `<SignedOut>` gates, `routing="hash"` on `<SignIn>` | Membership lives in the Clerk dashboard, not in code |
| Data | Six static JSON files imported at build time | Pre-aggregated and masked, so bundling is safe |
| Charts | Plotly.js via react-plotly.js, shared `THEME` in `src/utils/theme.js` | One trace builder per page |
| Document store | `buildRagDocuments()` to `localStorage` with a `CURRENT_VERSION` stamp | Build once, read instantly on later visits |
| Retrieval | Hand-written TF-IDF with four multiplicative boosts | 142 short docs do not need a vector DB |
| Routing | Regex `isProjectQuery`, `isCrossDatasetQuery`, `detectDataset` | Skip retrieval for meta questions; summarize for broad ones |
| Generation | `gpt-4o-mini`, temperature 0.4, `max_tokens` 600, `stream: true` | Cheap, fast, conservative enough to stick to the records |

## How it works

### Turning JSON rows into sentences a model can quote

The first job of `src/utils/ragStore.js` is to turn nested JSON into flat sentences. Each dataset has its own builder (`makeGraduationDocs`, `makeGpaDocs`, `makeFrpDocs`, and so on). Every document has an `id` like `graduation:gender:female`, a `text` field that starts with a heading such as "Graduation by gender:", a `pageContent` copy for LangChain, and `metadata` with `dataset`, `breakdown`, raw numbers, and usually a `label`.

The key decision was to enrich labels at build time. `enrichLabel(label, breakdown)` maps race codes and school IDs through `RACE_CODES` and `SCHOOL_CODES` so the sentence already says "Black (race code 4)" rather than "4". The model can quote a document verbatim.

`saveRagDocuments` stores the array with a `CURRENT_VERSION` stamp (currently `"v4"`), and the `RagChat` constructor rebuilds only if the cache is empty or stale.

### A TF-IDF engine in under a hundred lines

The search engine lives at the bottom of the same file. `tokenize` lowercases, strips most punctuation (periods and percent signs survive), and drops one-letter tokens and stop words like "tell" and "please." `buildIdf` counts document frequency once and caches it.

```js
// src/utils/ragStore.js
function tfidfScore(tokens, idf, queryTerms) {
  const tf = {};
  for (const t of tokens) tf[t] = (tf[t] || 0) + 1;
  const maxTf = Math.max(...Object.values(tf), 1);
  let score = 0;
  for (const qt of queryTerms) {
    if (tf[qt]) {
      const normalizedTf = 0.5 + 0.5 * (tf[qt] / maxTf);
      score += normalizedTf * (idf[qt] || 1);
  // ... closing braces, then return score;
```

That is augmented term frequency (so short documents are not punished) times a smoothed IDF of `log((N + 1) / (df + 1)) + 1`. `tfidfSearch` concatenates `text`, `dataset`, `breakdown`, and `label` before tokenizing, so metadata feeds the base score.

Then come three metadata boosts and an exact-phrase boost:

```js
// src/utils/ragStore.js
    // Metadata boosts
    if (d.metadata?.dataset && q.includes(d.metadata.dataset)) score *= 1.5;
    if (d.metadata?.breakdown && q.includes(d.metadata.breakdown)) score *= 1.3;
    if (d.metadata?.label && q.includes(String(d.metadata.label).toLowerCase())) score *= 1.4;

    // Exact phrase boost
    const hay = (d.text || d.pageContent || "").toLowerCase();
    if (q.length > 4 && hay.includes(q)) score *= 2;
```

The boosts multiply. For "Graduation by gender," the two gender documents get the dataset and breakdown boosts, and because the query copies their "Graduation by gender:" heading, the exact-phrase boost doubles them again. They rank above the nineteen other graduation documents. Zero scores are filtered out. A query made only of stop words returns the first k documents unranked.

### Routing before retrieving

`src/utils/ragChat.js` classifies each question before searching. `isProjectQuery` catches "who built this" and gets no records, since the system prompt describes the project. `isCrossDatasetQuery` catches "which years are covered" and gets a short summary built from metadata. Everything else goes to `retrieve`.

![One chatbot question flowing through routing, TF-IDF retrieval, prompt assembly, and streamed generation](https://anirudhvasudevan.com/blog/diagrams/insightedu-browser-retrieval-flow.svg)

*One chatbot question flowing through routing, TF-IDF retrieval, prompt assembly, and streamed generation*

`retrieve` asks `tfidfSearch` for `k * 2` documents (with `k = 12`), then moves documents from the detected dataset to the front. The session carry-over is a few lines:

```js
// src/utils/ragChat.js
    // If user is asking about a previous topic, inject session-relevant docs
    if (!detected && this.session.dataset) {
      const sessionDocs = tfidfSearch(`${this.session.dataset} ${query}`, k);
      const ids = new Set(results.map(d => d.id));
      for (const d of sessionDocs) {
        if (!ids.has(d.id)) results.push(d);
      }
    }

    return results.slice(0, k);
```

If the user asked about graduation last turn and now asks "what about by gender?", `detectDataset` finds nothing, so the code re-runs the search with the previous dataset prepended. Those session documents are appended after the first results, then `slice(0, k)` cuts the list to 12, so they survive only when the follow-up's own search returns fewer than 12 hits. `buildContext` then dedupes and tags each record as `[dataset > breakdown > label]`.

### Streaming tokens from a raw fetch

The app has no OpenAI SDK in the browser. `callOpenAI` is a plain `fetch` with `stream: true`, read as a `ReadableStream`:

```js
// src/utils/ragChat.js
      const chunk = decoder.decode(value, { stream: true });
      const lines = chunk.split('\n').filter(l => l.startsWith('data: '));

      for (const line of lines) {
        const data = line.slice(6).trim();
        if (data === '[DONE]') break;
        try {
          const parsed = JSON.parse(data);
          const token = parsed.choices?.[0]?.delta?.content;
          if (token) {
            full += token;
            if (onChunk) onChunk(full);
```

The callback receives the accumulated text, so `Chatbot.jsx` creates an empty bot message first and replaces its `text` on every chunk. A `streaming: true` flag shows the blinking cursor until the promise resolves.

## The hard parts

The system prompt in `ragChat.js` carries most of the behavior fixes. It forbids words like "RAG," "retrieval," and "context," tells the model to say "our database," and states that all six datasets have data, so the model does not declare a dataset empty when retrieval misses.

The session carry-over mostly fails. A follow-up whose own search returns 12 or more hits loses every carried-over document. After a graduation question, "what about by race" returns 24 hits, and the 12 kept are FRP, staff, and attendance race documents, with no graduation data. "What about by school" keeps 12 demographics documents. The gender example works only because the bare "gender" search returns 11 documents with the graduation gender rows already on top, so the session pass adds just `graduation:overall`.

The fallback has a bug. With no key, or if the API call throws, `generateResponse` returns `localFallback`, the top retrieved document. But `handleSend` in `Chatbot.jsx` adds an empty bot message, awaits `generateResponse`, ignores its return value, and only flips `streaming` to false. `localFallback` never calls `onChunk`, so the user sees an empty bubble.

The exact-phrase boost is narrower than it looks. It fires only when the whole lowercased question is a substring of a document, so heading-shaped queries like "Graduation by gender" hit it and full sentences like "What is the overall graduation rate?" never do. Of the six entries in `SUGGESTIONS`, only "Staff racial composition" matches a document verbatim.

`isCrossDatasetQuery` is too eager. Any question with "year," "time," "range," or "period" and no dataset keyword gets the year summary instead of retrieval.

The biggest trade-off is the OpenAI key. Vite inlines it into the client bundle at build time. Clerk limits who can load the page, but any signed-in user can pull the key out of the JavaScript. The repo holds no keys, but the pattern is the weakness.

## Results

InsightEDU was completed as a working single-page app with seven dashboard routes, Clerk-gated access, and the browser-side chatbot, plus a capstone report dated February 2026. There is no public deployment, no award, and no user study, and the report lists example question types, not measured accuracy.

## What I would do differently

First, fix the fallback. In `handleSend`, keep the value `generateResponse` returns and write it into the bot message when no chunks arrived. Then test the chat with the key unset.

Second, fix the follow-ups: put session documents first, or interleave them with the new results, before the slice to 12.

Third, a proxy: a serverless function that holds the OpenAI key and streams the response back, with no change to retrieval.

Fourth, a retrieval evaluation. The boost multipliers are bare constants with nothing measuring them. A fixture of questions paired with the document ids that should rank first would make every tweak measurable, and could test whether the Pinecone path wins on paraphrases like "kids who miss a lot of school."

Fifth, wording. The system prompt and parts of the report call the platform "HIPAA-compliant." FERPA is the law for student records, and no compliance label fits a client-side key. The honest framing is "aggregated, small-count-masked data behind a sign-in gate."

Last, cleanup: `README.md` is still the Vite template and `CHATBOT_SETUP.md` describes a dead design.

## Key takeaways

- For a few hundred short, structured facts, start with TF-IDF and add embeddings only when an eval shows keywords missing paraphrases.
- Enrich codes to names when you build documents, not when you build the prompt. "Hispanic (race code 1)" is quotable; "code 1" needs a lookup table in every prompt.
- Route before you retrieve. Meta, broad, and targeted questions want different context, and a few regexes in front of search keep prompts small.
- If you carry a topic forward into a follow-up, merge those documents ahead of the truncation, not after it. Anything appended after a full result list gets cut.
- Wire the fallback all the way to the UI and test with the key unset. A fallback that returns a value nobody renders is the same as no fallback.

## FAQ

### How does InsightEDU retrieve data without a vector database?

InsightEDU compiles its six JSON datasets into 142 sentence documents in the browser, caches them in `localStorage`, and ranks them with a hand-written TF-IDF scorer plus four multiplicative boosts (dataset 1.5x, breakdown 1.3x, label 1.4x, exact phrase 2x). The top 12 go into the prompt.

### What model does the InsightEDU chatbot use?

InsightEDU calls OpenAI's `gpt-4o-mini` with temperature 0.4, a 600-token cap, and streaming, parsed in the browser. If no key is configured or the call fails, the `RagChat` layer returns the best retrieved document, but the chat panel does not display it.

### How does InsightEDU protect student privacy?

InsightEDU only bundles data that was aggregated and small-count masked upstream, behind a Clerk sign-in gate. Retrieval runs in the browser, so only the assembled prompt reaches OpenAI, never the full corpus. The OpenAI key itself ships in the client bundle, which is the weak point.

### Why does the InsightEDU repo include Pinecone scripts if the app does not use them?

The Pinecone scripts embed the same documents for a terminal chat. The capstone report calls that path complementary future work. The browser app uses TF-IDF because the corpus is tiny and the questions are keyword-shaped.

## Links

- Source: [github.com/anirxdh/InsightEDU](https://github.com/anirxdh/InsightEDU)

---

*Originally published on [anirudhvasudevan.com](https://anirudhvasudevan.com/blog/insightedu-browser-retrieval/).*

*I'm Anirudh Vasudevan, a full-stack and AI engineer in San Francisco and a Member of Technical Staff at Rivo, where I build production voice AI agents. I have won five hackathons, hold a granted patent, and co-wrote a paper accepted to EMNLP. More about me at [anirudhvasudevan.com/about](https://anirudhvasudevan.com/about/), and every project write-up is at [anirudhvasudevan.com/blog](https://anirudhvasudevan.com/blog/).*
