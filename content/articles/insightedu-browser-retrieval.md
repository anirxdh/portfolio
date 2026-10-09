---
draft: true
title: "InsightEDU: Retrieval in the Browser, Generation in the Cloud"
description: "How my University of Minnesota capstone turned six school-district equity datasets into Plotly dashboards and a chatbot that retrieves in the browser."
date: 2026-10-03
slug: insightedu-browser-retrieval
project: "InsightEDU"
tags: [RAG, TF-IDF, React, Plotly, OpenAI, Data Privacy]
repo: https://github.com/anirxdh/InsightEDU
accent: "#9ccc65"
summary: "InsightEDU is my MS Computer Science capstone at the University of Minnesota: seven Plotly dashboards over aggregated school-district data plus a chatbot whose retrieval layer is a hand-written TF-IDF engine running in the browser. Only the final prompt leaves the page."
---

## Six spreadsheets and one question nobody could answer fast

The data arrived as aggregated tables: graduation outcomes, GPA bands, demographics, free and reduced-price meal eligibility, chronic absenteeism, and staff composition for a public school district, school years 2017 through 2024. Every row was already rolled up to a group level and every small count masked. That deal made the project possible: the data was safe to put in a web page, which is rare for student records.

InsightEDU is a React 19 and Vite 6 single-page application that turns those six datasets into interactive Plotly dashboards and a chatbot that answers plain-English questions about the district's numbers, built by me, Anirudh Vasudevan, as my MS Computer Science capstone at the University of Minnesota, advised by Erich Kummerfeld. The written report is dated February 2026 and the most recent commit is dated April 2026.

The question that shaped the design: when a collaborator asks "what is the graduation rate for English learners," how many systems does that travel through? My answer: one browser tab and one API call.

## Why I put retrieval in the browser instead of a vector database

The obvious approach was the standard RAG stack: embed the data, store vectors in Pinecone, query from the app. `CHATBOT_SETUP.md` in the repo describes exactly that, a LangChain and Pinecone chatbot in a `src/utils/ragSystem.js` that no longer exists under `src/`. `scripts/ingestPinecone.mjs` and `scripts/chatRag.mjs` still embed the documents with `text-embedding-3-small` into a 1536-dimension cosine index named `edu-rag` and run a readline chat over it with LangChain.

The browser app does not use it, for three reasons. First, the corpus is tiny: the document builders produce 142 documents averaging about 133 characters, about 67 KB of JSON. A vector database for 142 sentences is a server, an API key, an index to keep in sync, and a network hop on every question, to replace a few hundred lines of in-memory JavaScript. Second, the questions are structured: a dataset, a breakdown, and a label ("FRP by school," "staff by highest degree"), and those exact words appear in the documents, so keyword matching gets close to embeddings. Third, privacy. The whole argument for the design was that nothing leaves the browser except the few sentences in each prompt, and shipping the corpus to a third-party vector store cut against that.

So the browser builds the documents, caches them in `localStorage`, scores them with a from-scratch TF-IDF, and sends only the top hits plus the question to `gpt-4o-mini`. Pinecone remains an offline script.

## What a user actually does

InsightEDU opens on a Clerk sign-in page: `src/App.jsx` renders `<SignedIn>` for the app and `<SignedOut>` for `SignInPage.jsx`, so nothing renders until you authenticate.

1. The landing route shows a CSS 3D ring of six cards (`LandingSlider.jsx`), one per dataset, each linking to its route.
2. Each of the six chart pages (for example `src/pages/GraduationView.jsx`) has tabs from a `CATEGORY_META` array: overall, year, gender, race, and the equity groups. Picking a tab calls `makeChart(category, data)`, which returns Plotly traces: a donut for the overall tab on five of the six pages (the staff page uses single bars for tenure), a line or a stacked bar for the year tab, and grouped, stacked, or single bars for the rest depending on the page. A short summary from `ANALYSIS_SUMMARIES` sits under each chart. The seventh route, `/chronic`, is a 19-line wrapper (`ChronicAbsenteeismView.jsx`) around a separate multi-chart `ChronicAbsenteeismDashboard` component.
3. A floating button opens the chatbot (`src/components/Chatbot.jsx`), with suggestion chips like "Compare GPA by gender," a streamed answer with a blinking cursor, and a Clear button that wipes memory.
4. Further down the landing page, a React Three Fiber scene (`ChemistryLab3D.jsx`) loads a GLTF chemistry lab model and idles with a slow sine rotation.

## Architecture

InsightEDU has no server of its own. Six JSON files under `src/data/` are imported at build time and bundled with the app. Clerk handles identity and the OpenAI Chat Completions API handles generation. Everything in between runs inside the browser tab.

![InsightEDU architecture: six bundled JSON datasets feed Plotly dashboards and a browser-side RAG pipeline that calls OpenAI](/blog/diagrams/insightedu-browser-retrieval-architecture.svg)

In the diagram, the datasets feed two consumers: the dashboard pages read them directly, and `ragStore.js` compiles them into sentence documents cached in `localStorage`. `ragChat.js` owns a `RagChat` singleton that routes each question, calls `tfidfSearch`, builds the prompt, and streams the OpenAI response back to `Chatbot.jsx`. The Node scripts in the lower box reach Pinecone; the web app never imports them.

The main choices and the reason for each:

| Layer | Choice | Why |
|---|---|---|
| App shell | React 19 + Vite 6 + React Router 7 | One route per dataset, no server to host |
| Auth | Clerk `<SignedIn>` / `<SignedOut>` gates, `routing="hash"` on `<SignIn>` | Membership lives in the Clerk dashboard, not in code; hash routing keeps Clerk's steps out of app routes |
| Data | Six static JSON files imported at build time | Pre-aggregated and masked, so bundling is safe |
| Charts | Plotly.js via react-plotly.js, shared `THEME` in `src/utils/theme.js` | One trace builder per page |
| Document store | `buildRagDocuments()` to `localStorage` with a `CURRENT_VERSION` stamp | Build once, read instantly on later visits |
| Retrieval | Hand-written TF-IDF with four metadata boosts | 142 short docs do not need a vector DB |
| Routing | Regex `isProjectQuery`, `isCrossDatasetQuery`, `detectDataset` | Skip retrieval for meta questions; summarize for broad ones |
| Generation | `gpt-4o-mini`, temperature 0.4, `max_tokens` 600, `stream: true` | Cheap, fast, conservative enough to stick to the records |

## How it works

### Turning JSON rows into sentences a model can quote

The first job of `src/utils/ragStore.js` is to turn nested JSON into flat sentences. Each dataset has its own builder (`makeGraduationDocs`, `makeGpaDocs`, `makeFrpDocs`, and so on). Every document has the same shape: an `id` like `graduation:gender:female`, a `text` field, a `pageContent` copy of the same text (the field name LangChain's `Document` class expects), and `metadata` with `dataset`, `breakdown`, the raw numbers, and a `label` on everything except the overall and staff documents.

The key decision was to enrich labels at build time, not at answer time. `enrichLabel(label, breakdown)` maps numeric race codes and school IDs through `RACE_CODES` and `SCHOOL_CODES` so the sentence already says "Black (race code 4)" rather than "4". Masked counts become "masked" or "n=too small." If the model quotes a document verbatim, the quote is already readable.

`saveRagDocuments` writes the array under `rag_documents` and `CURRENT_VERSION` (currently `"v4"`) under `rag_version`, `isStale()` compares the two, and the `RagChat` constructor rebuilds only if the cache is empty or stale. Bumping the version invalidates every cache.

### A TF-IDF engine in about eighty lines

The search engine lives at the bottom of the same file. `tokenize` lowercases, strips punctuation except periods and percent signs, and drops stop words, including chat filler like "tell" and "please." `buildIdf` counts document frequency once and caches it until the document count changes.

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

That is augmented term frequency (so short documents are not punished) times a smoothed IDF of `log((N + 1) / (df + 1)) + 1`. `tfidfSearch` concatenates `text`, `dataset`, `breakdown`, and `label` before tokenizing, so metadata feeds the base score.

Then the boosts, which made the real difference:

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

The boosts multiply, so a document matching dataset, breakdown, and label gets about 2.7 times its base score. "Graduation by gender" ranks the two gender documents above the nineteen other graduation documents that only share the word "graduation." Zero scores are filtered out, so a question that matches nothing returns nothing rather than noise.

### Routing before retrieving

`src/utils/ragChat.js` decides what kind of question it has before touching the search engine. `isProjectQuery` catches "who built this" and "what pages are there" and gets no records, since the system prompt already describes the project. `isCrossDatasetQuery` catches "what data do you have" and "which years are covered" and goes to `buildYearSummary()` or `buildOverviewSummary()`, six lines compiled from metadata. Everything else goes to `retrieve`.

![One chatbot question flowing through routing, TF-IDF retrieval, prompt assembly, and streamed generation](/blog/diagrams/insightedu-browser-retrieval-flow.svg)

`retrieve` asks `tfidfSearch` for `k * 2` documents (with `k = 12`), then moves documents from the detected dataset to the front. The session piece took very little code:

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

If the user asked about graduation last turn and now asks "what about by gender?", `detectDataset` finds nothing, so the code re-runs the search with the previous dataset name prepended and appends any new hits. With a rolling history of up to 12 message pairs, most follow-ups resolve without real coreference logic. `buildContext` then dedupes by text and tags each record as `[dataset > breakdown > label]`.

### Streaming tokens from a raw fetch

There is no OpenAI SDK in the browser. `callOpenAI` is a plain `fetch` with `stream: true`, read as a `ReadableStream`:

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

The callback receives the accumulated text, not the delta, so `Chatbot.jsx` creates an empty bot message before the call and replaces its `text` on every chunk. A `streaming: true` flag renders the blinking cursor until the promise resolves.

With no key configured, `generateResponse` skips the network and returns `localFallback`, the top retrieved document; if the API call throws, the same fallback runs. The chat never shows a blank bubble.

## The hard parts

The system prompt in `ragChat.js` carries most of the behavior fixes. A model that says "the context does not include" sounds wrong to a district administrator, so the prompt forbids "RAG," "retrieval," "context," "vector," and "embedding" and tells the model to say "our database." It states that all six datasets have data, so the model never declares a dataset empty when retrieval misses.

The exact-phrase boost is a hack. It fires only when the whole lowercased question is a substring of a document. That rarely happens for a typed sentence, but the suggestion chip "Staff racial composition" is a word-for-word substring of the `staff:race` document. The other five entries in `SUGGESTIONS` (only the first four are shown) do not match any document verbatim. It helps that chip and little else.

`isCrossDatasetQuery` is too eager. Any question with "year," "time," "range," or "period" and no dataset keyword gets the year summary instead of retrieval; "how has absenteeism changed over time" works only because "absent" matches `detectDataset` first.

The six chart pages run 283 to 439 lines each, mostly repeated Plotly configuration. A shared chart factory would have halved the code.

The biggest trade-off is the OpenAI key. Vite reads it from an environment variable at build time and inlines it into the client bundle. Clerk sign-in limits who can load the page, but any signed-in user can pull the key out of the JavaScript. I accepted that for a capstone demo; anything public needs the call behind a proxy. The repo holds no keys, but the pattern is the weakness.

## Results

InsightEDU shipped as a working single-page app with seven dashboard routes, Clerk-gated access, the browser-side RAG chatbot, and the 3D landing page, plus a written capstone report dated February 2026. There is no public deployment, no award, and no user study; the report's chatbot section lists example question types, not measured accuracy. The repository is public.

## What I would do differently

First, a proxy. A serverless function holding the OpenAI key and streaming the response back removes the client-side key without touching the retrieval code.

Second, a retrieval evaluation. The boost multipliers are bare constants in `ragStore.js` with nothing measuring them; a fixture of questions paired with the document ids that should rank first would make every tweak measurable.

Third, wording. The system prompt and the report both say "HIPAA-compliant." Student records fall under FERPA, not HIPAA, and a client-side key is not what compliance looks like. The honest framing is "aggregated, small-count-masked data behind a sign-in gate."

Fourth, cleanup. `README.md` is still the Vite template, `CHATBOT_SETUP.md` describes a dead design, and `package.json` still lists LangChain and Pinecone. Next, I would run the Pinecone path and the TF-IDF path on the same questions to see whether embeddings win on paraphrases like "kids who miss a lot of school."

## Key takeaways

- For a few hundred short, structured facts, TF-IDF with metadata boosts is competitive with embeddings and costs nothing at query time. Reach for a vector database when the corpus outgrows keywords, not by default.
- Enrich codes to names when you build documents, not when you build the prompt. "Hispanic (race code 1)" is quotable; "code 1" needs a lookup table in every prompt.
- Route before you retrieve. Meta, broad, and targeted questions want different context, and a few regexes in front of the search engine cut prompt size and wrong answers.
- Carry the previous topic forward by re-querying with it prepended. It is a cheap approximation of coreference that handles "what about by gender?" without an extra model call.
- Build the fallback first. Returning the best retrieved document when the model is unavailable means the feature degrades instead of disappearing, and local development needs no key.

## FAQ

### How does InsightEDU retrieve data without a vector database?

InsightEDU compiles its six JSON datasets into 142 short sentence documents in the browser, caches them in `localStorage`, and ranks them with a hand-written TF-IDF scorer in `src/utils/ragStore.js`. Four multiplicative boosts (dataset 1.5x, breakdown 1.3x, label 1.4x, exact phrase 2x) rank matches, and the top 12 go into the prompt.

### What model does the InsightEDU chatbot use?

InsightEDU calls OpenAI's `gpt-4o-mini` with temperature 0.4, a 600-token cap, and streaming enabled, parsing the Server-Sent Events stream in the browser. If no key is configured or the call fails, the chatbot returns the best retrieved document instead.

### How does InsightEDU protect student privacy?

InsightEDU only bundles data that was aggregated and small-count masked upstream, and access is gated by Clerk sign-in (the capstone report describes a Google OAuth allowlist configured in the Clerk dashboard, not in code). Retrieval runs in the browser, so only the few retrieved sentences inside each chat prompt leave the page.

### Why does the InsightEDU repo include Pinecone scripts if the app does not use them?

`CHATBOT_SETUP.md` describes a LangChain and Pinecone design, and `scripts/ingestPinecone.mjs` and `scripts/chatRag.mjs` embed the same documents and run a terminal chat over a Pinecone index. The browser app uses the TF-IDF engine instead because the corpus is tiny and the questions are keyword-shaped.

## Links

- Source: [github.com/anirxdh/InsightEDU](https://github.com/anirxdh/InsightEDU)
