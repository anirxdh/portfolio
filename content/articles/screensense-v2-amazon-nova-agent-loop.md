---
draft: true
title: "How ScreenSense Runs a Browser Agent Loop on Amazon Nova"
description: "ScreenSense v2 turns a spoken command into a Chrome extension agent loop: screenshot, DOM snapshot, one Nova Lite action, re-observe, repeat until done."
date: 2026-10-03
slug: screensense-v2-amazon-nova-agent-loop
project: "ScreenSense (v2)"
tags: [Amazon Nova, Chrome Extension, Browser Agents, FastAPI, Voice AI, AWS Bedrock]
live: https://screen-sense-nova-anirxdh.netlify.app/
accent: "#2fb583"
summary: "ScreenSense v2 is a Chrome MV3 extension plus a FastAPI backend that lets you hold a key, speak a task, and watch Amazon Nova Lite click, type and navigate a live page one action at a time. This is the story of the observe-act-observe loop and everything that broke around it."
---

## The moment the answer was not enough

[Version one](/blog/screensense-v1-talk-to-your-screen/) of ScreenSense could describe a screen but not touch it. Ask it "what is the price?" on a product page and it answered. Say "add it to the cart" and nothing happened, because there was no code path that could click anything. The Amazon Nova AI Hackathon 2026, which started two days after that first build, was the excuse to fix that.

ScreenSense v2 is a voice-driven browser agent, packaged as a Chrome Manifest V3 extension with a Python FastAPI backend, that takes a spoken command and executes it on the live page through an observe-act-observe loop on Amazon Nova Lite, built by Anirudh Vasudevan for the Amazon Nova AI Hackathon 2026. You hold the backtick key, say "go to Wikipedia and search for artificial intelligence," release, and a bubble near your cursor narrates each step as the page changes.

The last commit landed on March 16, 2026. The repo is private, so I describe the code rather than link it.

## Why one action at a time

The obvious approach was to ask the model for a full plan: send the screenshot and command, get five steps back, run them all. The code still carries the shape of that idea. `POST /task` returns a list of steps, and the response type is a batch, not a single action. But a plan written against one page falls apart as soon as the page changes, and the page after step one is never the page the model planned against. A search submit reloads the document, an "Add to Cart" click opens a side panel, and the selectors for step three no longer exist.

The second option was a pure vision agent: no DOM, just screenshots and pixel coordinates. Nova Lite is a small multimodal model, and I did not trust it to land a click on a small button from a downscaled JPEG. A coordinate also gives no name for the thing clicked, so the bubble could not say what it was doing.

So ScreenSense v2 does something narrower. The content script scrapes the DOM into a JSON snapshot with a real CSS selector for every interactive element. The backend sends that snapshot plus a compressed screenshot to Nova and demands exactly one action back. The extension executes it, waits for the DOM to settle, re-captures, and asks again.

## What the user sees

ScreenSense v2 works like this from the user's side.

1. Hold the backtick key on any page. After 200 ms a frosted-glass bubble appears at your cursor with a live waveform.
2. Speak, then release. The bubble shows "Transcribing," then "Understanding," then your transcript.
3. Nova returns an answer (for "what is the price?") or an action. For an action, a green outline flashes on the target, a phrase like "Searching USB-C cable" is spoken, and the bubble logs "Re-evaluating... (3/25)" before the next step.
4. When Nova says done, the bubble lists every step and says "All done." Escape, or holding the key again, cancels the loop.

## Architecture

ScreenSense v2 runs as three processes that only talk through messages. The content script lives in the page and owns the DOM. The service worker owns the loop. The FastAPI backend owns the AWS credentials and every model call. AWS credentials never leave the backend; the only key the extension touches is an optional ElevenLabs key read from chrome.storage, which `src/content/tts.ts` hands to the service worker in the `elevenlabs-tts` message.

![ScreenSense v2 architecture: content script, service worker, FastAPI backend, and AWS services](/blog/diagrams/screensense-v2-amazon-nova-agent-loop-architecture.svg)

Left to right: a hold starts the offscreen recorder. On release, `runPipeline` captures a screenshot with `chrome.tabs.captureVisibleTab`, ships the audio to the backend and gets the transcript back, requests a DOM snapshot, then calls `POST /task`. The backend sends command, screenshot and DOM to Nova Lite through the Bedrock converse API. The one action that comes back crosses the same bridges in reverse and ends in `action-executor.ts`. A separate SSE channel (`GET /events`) pushes backend stage changes to the service worker, which relays them to the bubble.

The concrete choices, and why:

| Layer | Choice | Why |
|---|---|---|
| Reasoning model | Amazon Nova Lite, `us.amazon.nova-lite-v1:0`, Bedrock `converse`, maxTokens 2048 | Sponsor model with vision; cheap enough for 25 calls per task |
| Perception | Screenshot plus DOM snapshot with CSS selectors | Exact selectors remove guessing for a small model |
| Loop control | One action per iteration, max 25 | Fresh observation every step; hard cap stops runaways |
| DOM settling | MutationObserver quiet window, then poll for real content | AJAX pages return empty snapshots if scraped too early |
| Speech to text | AWS Transcribe Streaming, Groq `whisper-large-v3-turbo` fallback | Stay on AWS; keep a fallback for demo day |
| Audio capture | MV3 offscreen document, MediaRecorder plus AnalyserNode | A service worker cannot call `getUserMedia`; `offscreen.ts` can |
| Backend | FastAPI, boto3 wrapped in `asyncio.to_thread` | boto3 is synchronous; threads keep SSE alive |
| Voice out | ElevenLabs `eleven_flash_v2_5` proxied via service worker, Web Speech fallback | Page CSP blocks direct calls from a content script |

## How the loop actually works

### The loop in the service worker

`runAgentLoop` in `src/background/service-worker.ts` is the heart of ScreenSense v2. It receives a batch of actions from `POST /task` but ignores everything past index zero. It executes `currentActions[0]`, records the result in `actionHistory`, waits for the page, re-captures, and calls `POST /task/continue`. Whatever Nova returns replaces `currentActions`. The loop exits on `done`, cancellation, a closed tab, or `MAX_AGENT_ITERATIONS = 25`.

![One voice command flowing through ScreenSense v2 from key release to task done](/blog/diagrams/screensense-v2-amazon-nova-agent-loop-flow.svg)

The trick that made the loop self-correcting was feeding failures back as text. When a selector matches nothing, the service worker does not retry. It writes the failure into history and lets the next `/task/continue` call see it.

```ts
// src/background/service-worker.ts
actionHistory.push({
  description: step.description,
  result: `FAILED: ${result.error}. Try a different selector or approach.`,
});
```

The continue prompt in `backend/services/nova_reasoning.py` tells Nova that a `FAILED:` line means try a different selector, and that after three identical attempts it should skip that item. That turned a dead loop into a model that picks the second-best button.

### Waiting for the page to settle

The biggest source of bad decisions was scraping too early. After a click the DOM keeps mutating for a few hundred milliseconds, and after a search submit it can be empty for seconds. The content script answers a `wait-for-dom-stable` message with a MutationObserver that resets a timer on every mutation and resolves once the page has been quiet for `settleMs`.

```ts
// src/content/content-script.ts
const observer = new MutationObserver(() => {
  clearTimeout(timer);
  timer = setTimeout(() => {
    settled = true;
    observer.disconnect();
    resolve({ stable: true });
  }, settleMs);
});
```

A hard timeout (1500 to 2000 ms) stops an animated page from blocking forever. Quiet is not loaded, though. After settling, `waitForDomContent` in the service worker polls `scrape-dom` every 500 ms for up to 5 seconds (8 after a navigate) and only accepts a snapshot with at least one button, one input, or more than five links. The comment on that function says it handles AJAX-heavy pages, and that is the failure it exists for: a results page that is quiet because it has not loaded anything yet.

### Surviving navigation

A `navigate` action, or any click that reloads the document, kills the content script mid-conversation and `chrome.tabs.sendMessage` throws. ScreenSense v2 treats that exception as a signal: it sleeps 2 seconds and sends one `scrape-dom` ping. If a fresh content script answers, it records "Page navigated (action triggered navigation)" in history and carries on. If not, it gives up with a lost-connection error. Explicit navigates get more patience: the worker waits 3 seconds, then tries up to ten pings a second apart before declaring the page dead. The continue prompt tells Nova that after a "Page navigated" line it should read the URL and DOM again.

### Fitting a page into a small model

A full Amazon results page is far bigger than Nova Lite's comfortable context. Two functions in `nova_reasoning.py` keep every call in budget. `_compress_screenshot` uses Pillow to downscale the PNG to at most 1024 pixels wide as JPEG at quality 70. `_truncate_dom` serializes the snapshot and, above 30,000 characters, cuts `text_content` to 2,000 characters, trims tables, lists, images and headings to three entries each, and caps buttons, links, inputs and products at 15.

History gets the same treatment. Past five actions, older ones collapse into one summary line and only the last three stay verbatim.

```python
# backend/services/nova_reasoning.py
if len(action_history) > 5:
    older = action_history[:-3]
    recent = action_history[-3:]
    older_summary = f"Previously completed {len(older)} actions: " + ", ".join(
        entry.get('description', 'Unknown')[:40] for entry in older
    )
```

The scraper does its share too. `buildSelector` in `src/content/dom-scraper.ts` walks an attribute ladder: `id`, `data-testid`, `data-asin`, `aria-label`, `title`, an `href` substring for links, `name`, and finally tag plus classes with `nth-of-type`, all through `CSS.escape`. `classifyElement` also tags elements with a role such as `add-to-cart` or `search-submit`, so the model can pick by meaning instead of reading a hundred button labels.

### Executing without trusting the model

Every action Nova returns was produced by a model that just read an untrusted web page. `executeAction` in `src/content/action-executor.ts` treats it that way.

```ts
// src/content/action-executor.ts
const ALLOWED_ACTIONS = new Set(['click', 'type', 'navigate', 'extract', 'scroll']);
// ...
const DANGEROUS_SELECTOR_PATTERNS = [
  /javascript:/i,
  /<script/i,
  /on\w+=\s*['"]/i, // onclick=', onerror="
  /`/,
];
```

Anything outside the allowlist is rejected. Selectors are checked against those patterns, then test-run through `document.querySelector` so a syntax error becomes a clean failure the model can read. Navigation accepts only `http` and `https`. A rate limiter enforces a 300 ms gap. Typing uses the native `HTMLInputElement` value setter and dispatches `input` and `change` events so React controlled inputs notice. If the target looks like a search box, the executor presses a synthetic Enter and calls `form.requestSubmit()`, so "search for X" is one action, not two.

## The hard parts

The MV3 audio plumbing broke more often than the model did. A service worker cannot call `getUserMedia`, so recording lives in an offscreen document. `chrome.offscreen.createDocument` resolves before that document has registered its listener, so the first `start-recording` message sometimes vanished. The fix is an `offscreen-ready` handshake with a 500 ms fallback. A second race: on a quick tap, `stop-recording` could arrive before `start-recording` was sent, so the worker now chains the stop onto a stored `recordingStartedPromise`.

The transcription path is honest hackathon work. The WebSocket endpoint `/transcribe/stream` has a docstring about streaming audio during recording, but the shipped client opens the socket after key release and sends the whole blob in one message. Faster than multipart, not streaming.

Other shortcuts I would not ship: the backend URL is hardcoded to `localhost:8000`, and CORS is `allow_origins=["*"]` with credentials on. The per-tab conversation history (20 turns) is stored but never sent to Nova, so follow-ups have no memory. The explanation-level setting from version one survives in settings, but the prompts ignore it.

The reasoning call in the submitted code runs Nova Lite. `backend/services/nova_reasoning.py` has no model switch or fallback for reasoning; if Bedrock fails, the task fails.

## Results

ScreenSense v2 shipped as a working extension loaded unpacked from `dist/`, a FastAPI backend on localhost, a landing page on Netlify, and a YouTube demo. The README lists the categories it targeted: Agentic AI, Multimodal Understanding, UI Automation, and Voice AI. No award or placement is recorded in the repo, so I claim none.

The number I am proud of: 367 automated tests shipped with the hackathon build, 213 in Jest (with a hand-built `chrome.*` mock for the service worker) and 154 in pytest with Bedrock, Transcribe and Groq mocked. The counts come from the test files in the repo; the 894-line `test_nova_reasoning.py` is where I caught many of the JSON-extraction edge cases.

## What I would do differently

[ScreenSense v3](/blog/screensense-voice-browser-agent/) already changed several of these. If I rebuilt v2 today:

- Stream audio during the hold, not after release. The endpoint supports it; the client never used it.
- Send the DOM diff between iterations instead of the whole snapshot.
- Put the loop state machine in a testable module rather than one roughly 300-line function in the service worker.
- Replace the fixed sleeps around navigation with `chrome.webNavigation.onCompleted`.
- Give Nova the conversation history it was promised, or delete the store.

## Key takeaways

- A small multimodal model does far better when the decision is one step and the identifiers are exact strings it can copy: selectors, not coordinates.
- Feed action failures back as text in the next prompt. "FAILED: element not found, try a different selector" beats client-side retry logic.
- "DOM is quiet" and "DOM has content" are different conditions. Wait for both, with a hard timeout on each.
- In MV3, treat a thrown `chrome.tabs.sendMessage` as a navigation signal and rebuild context, not as a fatal error.
- Model output that names DOM elements is untrusted input. Allowlist verbs, sanitize selectors, restrict URL schemes, and rate-limit before touching the page.
- Budget every model call up front: downscale images, truncate structured context in a fixed order, and summarize older history.

## FAQ

### How does ScreenSense v2 decide what to click on a web page?

ScreenSense v2 never asks the model for coordinates. The content script scrapes the page into a JSON snapshot in which every button, link, input and form carries a CSS selector built from a priority ladder of stable attributes. Amazon Nova Lite gets that snapshot with a compressed screenshot and must return one action whose selector is copied from it.

### Why does ScreenSense v2 execute only one action per model call?

Because the page changes after every action, and a plan written against the old page fails on the new one. ScreenSense v2 runs the first action Nova returns, re-captures the page, and calls `POST /task/continue` with the new state, until Nova responds with `done` or 25 iterations pass.

### How does ScreenSense v2 handle page navigation in a Chrome extension?

When a navigate action or a full-page click destroys the content script, `chrome.tabs.sendMessage` throws in the service worker. ScreenSense v2 catches that, waits 2 seconds, and sends one `scrape-dom` ping; if a fresh content script answers it records "Page navigated" in the history and continues. Explicit navigate actions get a retry loop of up to ten pings a second apart. The worker then polls until the snapshot has real buttons, inputs or links before asking Nova again.

### Which Amazon Nova model does ScreenSense v2 use?

ScreenSense v2 calls Amazon Nova Lite, model id `us.amazon.nova-lite-v1:0`, through the AWS Bedrock `converse` API with a 2048 token output limit. Screenshots are downscaled to 1024 pixels wide as JPEG, and the DOM snapshot is truncated at about 30,000 characters.

### Is the ScreenSense v2 source code public?

No. The ScreenSense v2 repository is private. The landing page and demo video are public; this article describes the architecture and loop logic instead.

## Links

- Live landing page: [screen-sense-nova-anirxdh.netlify.app](https://screen-sense-nova-anirxdh.netlify.app/)
- Part 1: [ScreenSense v1, talk to your screen](/blog/screensense-v1-talk-to-your-screen/)
- Part 3: [ScreenSense voice browser agent](/blog/screensense-voice-browser-agent/)
- Source: private repository, not linked.
