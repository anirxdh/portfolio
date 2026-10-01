---
draft: true
title: "InsightEDU: Retrieval in the Browser, Generation in the Cloud"
description: "How my University of Minnesota capstone turned six school-district equity datasets into Plotly dashboards and a chatbot that retrieves in the browser."
date: 2026-09-30
slug: insightedu-browser-retrieval
project: "InsightEDU"
tags: [RAG, TF-IDF, React, Plotly, OpenAI, Data Privacy]
repo: https://github.com/anirxdh/InsightEDU
accent: "#9ccc65"
summary: "InsightEDU is my MS Computer Science capstone at the University of Minnesota: seven Plotly dashboards over aggregated school-district data plus a chatbot whose retrieval layer is a hand-written TF-IDF engine running in the browser. Only the final prompt leaves the page."
---

## Six spreadsheets and one question nobody could answer fast

The data arrived as aggregated tables: graduation outcomes, GPA bands, demographics, free and reduced-price meal eligibility, chronic absenteeism, and staff composition for a public school district, covering school years from 2017 through 2024. Every row was already rolled up to a group level and every small count was already masked. That was the deal that made the project possible, and it meant the data was safe to put in a web page, which you cannot usually say about student records.

InsightEDU is a React 19 and Vite 6 single-page application that turns those six datasets into interactive Plotly dashboards and a chatbot that answers plain-English questions about the district's numbers, built by Anirudh Vasudevan as his MS Computer Science capstone at the University of Minnesota, advised by Erich Kummerfeld. The written report is dated February 2026 and the last commit landed in April 2026, so the work ran from the summer of 2025 into the spring of 2026.

The question that shaped the design: if a collaborator asks "what is the graduation rate for English learners," how many systems does that question travel through before an answer comes back? My answer ended up being one browser tab and one API call.

## Why I put retrieval in the browser instead of a vector database

The obvious approach, and the one I started with, was the standard RAG stack: embed the data with an OpenAI embedding model, store vectors in Pinecone, and query Pinecone from the app. I built that path. It still lives in `scripts/ingestPinecone.mjs` and `scripts/chatRag.mjs`, which embed the documents with `text-embedding-3-small`, create a 1536-dimension cosine index named `edu-rag` if it is missing, and run a readline chat over it with LangChain's `ChatOpenAI`. A stale `CHATBOT_SETUP.md` in the repo still describes that design as if it shipped.

It did not ship, for three reasons. First, the corpus is tiny. When I run the document builders, they produce 142 documents averaging about 133 characters each, roughly 67 KB of JSON. A vector database for 142 sentences is a server, an API key, an index to keep in sync, and a network hop on every question, all to replace something a few hundred lines of JavaScript can do in memory. Second, the questions are structured. People ask about a dataset, a breakdown, and a label ("FRP by school," "staff by highest degree"), and those exact words appear in the documents, so keyword matching with metadata boosts gets close to what embeddings would give. Third, the privacy story. The pitch to my advisor was that nothing leaves the browser except the handful of sentences that go into each prompt. Shipping the corpus to a third-party vector store cut against that.

So the browser builds the documents, caches them in `localStorage`, scores them with a from-scratch TF-IDF, and sends only the top hits plus the question to `gpt-4o-mini`. Pinecone stayed as an offline experiment.

## What a user actually does

InsightEDU opens on a Clerk sign-in page. `src/main.jsx` wraps everything in `ClerkProvider`, and `src/App.jsx` renders `<SignedIn>` for the app and `<SignedOut>` for `SignInPage.jsx`, so nothing renders until you are authenticated.

1. The landing route shows a CSS 3D ring of six cards (`LandingSlider.jsx`), one per dataset. Clicking a card navigates to that dataset's route.
2. Each dashboard page (for example `src/pages/GraduationView.jsx`) has tabs from a `CATEGORY_META` array: overall, year, gender, race, chronically absent, FRP eligible, English learner, special education. Picking a tab calls `makeChart(category, data)`, which returns Plotly traces: a donut for overall, a line for year, grouped bars for the rest.
3. Under every chart is a short written summary from an `ANALYSIS_SUMMARIES` array.
4. A floating button opens the chatbot (`src/components/Chatbot.jsx`). It shows suggestion chips like "Compare GPA by gender," streams the answer with a blinking cursor, and has a Clear button that wipes memory.
5. Further down the landing page, a React Three Fiber scene (`ChemistryLab3D.jsx`) loads a GLTF model, fits it once inside drei's `Bounds`, and idles with a slow sine rotation.

## Architecture

InsightEDU has no server of its own. Six JSON files under `src/data/` are imported at build time and bundled with the app. Two external services do the rest: Clerk handles identity, and the OpenAI Chat Completions API handles generation. Everything in between, including the document store and the search engine, runs inside the browser tab.

![InsightEDU architecture: six bundled JSON datasets feed Plotly dashboards and a browser-side RAG pipeline that calls OpenAI](/blog/diagrams/insightedu-browser-retrieval-architecture.svg)

Reading the diagram left to right: the JSON datasets feed two consumers. The dashboard pages read them directly for charts. The chatbot path reads them through `ragStore.js`, which compiles rows into sentence documents, stamps them with a version, and stores them in `localStorage`. `ragChat.js` owns a `RagChat` singleton that routes each question, calls `tfidfSearch`, builds the prompt, and streams the OpenAI response back to `Chatbot.jsx`. The Node scripts in the lower box reach Pinecone, but the web app never imports them.

The main choices in the code and the reason behind each:

| Layer | Choice | Why |
|---|---|---|
| App shell | React 19 + Vite 6 + React Router 7 | Fast dev loop, one route per dataset, no server to host |
| Auth | Clerk `<SignedIn>` / `<SignedOut>` gates, `routing="hash"` on `<SignIn>` | Hosted Google OAuth with an allowlist; hash routing avoids fights with BrowserRouter |
| Data | Six static JSON files imported at build time | Pre-aggregated and masked, so bundling is safe and removes a backend |
| Charts | Plotly.js via react-plotly.js, shared `THEME` in `src/utils/theme.js` | Donut, line, grouped and stacked bars from one trace builder per page |
| Document store | `buildRagDocuments()` to `localStorage` with a `CURRENT_VERSION` stamp | Build once per version change, read instantly on later visits |
| Retrieval | Hand-written TF-IDF with four metadata boosts | 142 short structured docs do not need embeddings or a vector DB |
| Routing | Regex `isProjectQuery`, `isCrossDatasetQuery`, `detectDataset` | Skip retrieval for meta questions; summarize for broad ones |
| Generation | `gpt-4o-mini`, temperature 0.4, `max_tokens` 600, `stream: true` | Cheap, fast, conservative enough to stick to the records |

## How it works

### Turning JSON rows into sentences a model can quote

The first job of `src/utils/ragStore.js` is to turn nested JSON into flat sentences. Each dataset has its own builders (`makeGraduationDocs`, `makeGpaDocs`, `makeDemographicsDocs`, `makeFrpDocs`, six `makeStaff*Doc` functions, `makeAttendanceDocs`). Every document has the same shape: an `id` like `graduation:gender:female`, a `text` field, a duplicate `pageContent` field left over from the LangChain design, and `metadata` with `dataset`, `breakdown`, `label`, and the raw numbers.

The key decision was to enrich labels at build time, not at answer time. The raw data uses numeric race codes and school IDs. `enrichLabel(label, breakdown)` maps those through `RACE_CODES` and `SCHOOL_CODES` so the sentence already says "Black (race code 4)" rather than "4". Masked counts become "masked" or "n=too small," and decimal percentages go through `safePercent`. If the model quotes a document verbatim, the quote is already readable.

Persistence is three small functions. `saveRagDocuments` writes the array under `rag_documents` and the constant `CURRENT_VERSION` (currently `"v4"`) under `rag_version`; `isStale()` compares the two; the `RagChat` constructor rebuilds only if the cache is empty or stale. Bumping the version string invalidates every user's cache on their next visit.

### A TF-IDF engine in about eighty lines

The search engine lives at the bottom of the same file. `tokenize` lowercases, strips everything except letters, digits, periods and percent signs, and drops a stop-word list that includes chat filler like "tell," "show," and "please." `buildIdf` walks every document once, counts document frequency per token, and caches the result until the document count changes.

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
```

That is augmented term frequency (so a short document is not punished for being short) times a smoothed IDF of `log((N + 1) / (df + 1)) + 1`. The text being scored is not just the sentence: `tfidfSearch` concatenates `text`, `dataset`, `breakdown`, and `label` before tokenizing, so metadata contributes to the base score.

Then come the boosts, which made the real difference:

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

The boosts multiply, so a document matching dataset, breakdown, and label gets about 2.7 times its base score. "Graduation by gender" ranks the two gender documents above the dozens of other graduation documents that share the word "graduation." Zero scores are filtered out, so a question with no overlapping terms returns nothing rather than noise.

### Routing before retrieving

`src/utils/ragChat.js` decides what kind of question it has before touching the search engine. `isProjectQuery` catches "who built this" and "what pages are there"; those get no records, because the system prompt already has an "ABOUT THE PROJECT" section. `isCrossDatasetQuery` catches "what data do you have" and "which years are covered"; rather than stuffing thirty documents into the prompt, those go to `buildYearSummary()` or `buildOverviewSummary()`, which compile six lines from document metadata. Everything else goes to `retrieve`.

![One chatbot question flowing through routing, TF-IDF retrieval, prompt assembly, and streamed generation](/blog/diagrams/insightedu-browser-retrieval-flow.svg)

`retrieve` asks `tfidfSearch` for twice as many documents as it needs (`k * 2`, with `k = 12`), then reorders so documents from the detected dataset come first. The session piece is the part I am most pleased with for how little code it took:

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

If the user asked about graduation last turn and now asks "what about by gender?", `detectDataset` finds nothing in the new question, so the code re-runs the search with the previous dataset name prepended and appends any new hits. Together with a rolling history of up to 12 message pairs, follow-ups resolve correctly most of the time without real coreference logic. `buildContext` then dedupes by text and tags each record as `[dataset > breakdown > label]` so the model can see where a number came from.

### Streaming tokens from a raw fetch

I did not use the OpenAI SDK in the browser. `callOpenAI` is a plain `fetch` to the chat completions endpoint with `stream: true`, and the body is read as a `ReadableStream`:

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

The callback receives the whole accumulated text, not the delta, which keeps `Chatbot.jsx` simple: it creates an empty bot message with a `crypto.randomUUID()` id before the call, then on every chunk replaces that one message's `text`. A `streaming: true` flag renders the blinking cursor until the promise resolves.

The degradation ladder is deliberate. If no key is configured, `generateResponse` skips the network and returns `localFallback`, the top retrieved document with race codes enriched. If the API call throws, the same fallback runs. The chat never shows a blank bubble.

## The hard parts

The system prompt is where most of the debugging time went. Early versions would say "the context does not include" or "based on the retrieved data," which sounds wrong to a district administrator. The prompt now forbids the words "RAG," "retrieval," "context," "vector," and "embedding" and tells the model to say "our database." It states that all six datasets have data, because an early version would claim a dataset was empty whenever retrieval returned nothing for it. And it explains that decimals are percentages, because `0.876` was being read as "0.876 percent."

The exact-phrase boost is a hack. It fires only when the whole lowercased question is a substring of a document, which almost never happens for a real sentence but happens reliably for suggestion chips like "Staff racial composition," which I wrote to match document text. It makes the demo chips feel precise and does nothing for free-form questions.

`isCrossDatasetQuery` is too eager. Any question containing "year," "time," "range," or "period" with no dataset keyword gets the year summary instead of retrieval, so "how has absenteeism changed over time" works only because "absent" matches `detectDataset` first.

The dashboard pages are copy-heavy. Each `*View.jsx` is 280 to 440 lines of mostly repeated Plotly configuration. A shared chart factory would have halved the code.

The biggest trade-off is the OpenAI key. The app reads it from a Vite environment variable at build time, which means it is inlined into the client bundle. The Clerk allowlist limits who can load the page, but any allowed user can pull the key out of the JavaScript. For a capstone demo behind an allowlist I accepted that. For anything public, the completion call has to move behind a proxy. No `.env` is committed and the repo contains no keys, but the pattern itself is the weakness.

## Results

InsightEDU shipped as a working single-page app with seven dashboard routes, Clerk-gated access, the browser-side RAG chatbot, and the 3D landing page, submitted with a written capstone report dated February 2026. There is no public deployment, no award, and no user study; the report's chatbot performance section is a table of example question types, not measured accuracy. The repository is public.

## What I would do differently

First, a proxy. A single serverless function holding the OpenAI key, forwarding the messages array and streaming the response back, removes the client-side key without changing anything else in `ragChat.js`.

Second, a retrieval evaluation. I tuned the boost multipliers by hand on a few dozen questions. A fixture of questions paired with the document ids that should rank first, run as a test, would have made every tweak measurable. The repo has no tests.

Third, wording. The system prompt and the report both say "HIPAA-compliant." Student education records fall under FERPA, not HIPAA, and a client-side key is not what a compliance claim looks like. The honest framing is "aggregated, small-count-masked data behind an allowlist."

Fourth, cleanup. `README.md` is still the Vite template, `CHATBOT_SETUP.md` describes a design that no longer exists, and `package.json` still lists LangChain and Pinecone though the browser app imports neither.

If I kept building, the Pinecone path is the obvious next experiment: run both retrievers on the same question set and see whether embeddings win on paraphrases like "kids who miss a lot of school."

## Key takeaways

- For a few hundred short, structured facts, TF-IDF with metadata boosts is competitive with embeddings and costs nothing at query time. Reach for a vector database when the corpus or vocabulary outgrows keywords, not by default.
- Enrich codes to names when you build documents, not when you build the prompt. "Hispanic (race code 1)" is quotable; "code 1" needs a lookup table in every prompt.
- Route before you retrieve. Meta, broad, and targeted questions want different context, and a few regexes in front of the search engine cut prompt size and wrong answers more than any retrieval tweak did.
- Carry the previous topic forward by re-querying with it prepended. It is a cheap approximation of coreference that handles "what about by gender?" without an extra model call.
- Version-stamp any client-side cache. One constant you bump when the builder changes invalidates every user's `localStorage`.
- Build the fallback first. Returning the best retrieved document when the model is unavailable means the feature degrades instead of disappearing, and local development works without a key.

## FAQ

### How does InsightEDU retrieve data without a vector database?

InsightEDU compiles its six JSON datasets into 142 short sentence documents in the browser, caches them in `localStorage`, and ranks them with a hand-written TF-IDF scorer in `src/utils/ragStore.js`. Four multiplicative boosts (dataset 1.5x, breakdown 1.3x, label 1.4x, exact phrase 2x) push documents whose metadata matches the question to the top, and the top 12 go into the prompt.

### What model does the InsightEDU chatbot use?

InsightEDU calls OpenAI's `gpt-4o-mini` through the Chat Completions API with temperature 0.4, a 600-token cap, and streaming enabled. The browser parses the Server-Sent Events stream itself with a `ReadableStream` reader and updates React state on every token. If no key is configured or the call fails, the chatbot returns the best retrieved document instead.

### How does InsightEDU protect student privacy?

InsightEDU only bundles data that was aggregated to the group level and small-count masked before it reached the project, so no individual student record exists in the app. Access is gated by Clerk sign-in with Google OAuth and an email allowlist. Retrieval runs in the browser, so the only data that leaves the page is the handful of retrieved sentences inside each chat prompt.

### Why does the InsightEDU repo include Pinecone scripts if the app does not use them?

InsightEDU started with a LangChain and Pinecone design. `scripts/ingestPinecone.mjs` and `scripts/chatRag.mjs` embed the same documents with `text-embedding-3-small`, upsert them into a serverless Pinecone index, and run a terminal chat over it. That path was replaced by the browser-side TF-IDF engine because the corpus is tiny and the questions are keyword-shaped. The scripts remain as a future semantic-search option.

## Links

- Source: [github.com/anirxdh/InsightEDU](https://github.com/anirxdh/InsightEDU)
