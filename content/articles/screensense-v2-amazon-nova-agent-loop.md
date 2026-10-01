---
draft: true
title: "How ScreenSense Runs a Browser Agent Loop on Amazon Nova"
description: "ScreenSense v2 turns a spoken command into a Chrome extension agent loop: screenshot, DOM snapshot, one Nova Lite action, re-observe, repeat until done."
date: 2026-09-27
slug: screensense-v2-amazon-nova-agent-loop
project: "ScreenSense (v2)"
tags: [Amazon Nova, Chrome Extension, Browser Agents, FastAPI, Voice AI, AWS Bedrock]
live: https://screen-sense-nova-anirxdh.netlify.app/
accent: "#2fb583"
summary: "ScreenSense v2 is a Chrome MV3 extension plus a FastAPI backend that lets you hold a key, speak a task, and watch Amazon Nova Lite click, type and navigate a live page one action at a time. This is the story of the observe-act-observe loop and everything that broke around it."
---

## The moment the answer was not enough

Two days after the first ScreenSense hackathon build, I was on an Amazon product page asking the extension a question. It answered correctly. Then I said "add it to the cart" and nothing happened, because [version one](/blog/screensense-v1-talk-to-your-screen/) could only look. It could describe a screen but not touch it. The Amazon Nova AI Hackathon 2026 was the excuse to fix that.

ScreenSense v2 is a voice-driven browser agent, packaged as a Chrome Manifest V3 extension with a Python FastAPI backend, that takes a spoken command and executes it on the live page through an observe-act-observe loop on Amazon Nova Lite, built by Anirudh Vasudevan for the Amazon Nova AI Hackathon 2026. You hold the backtick key, say "go to Wikipedia and search for artificial intelligence," release, and a small bubble near your cursor narrates each step while the page changes under it.

The whole thing was committed over two days, March 15 and 16, 2026. The repo is private, so I will describe the code rather than link it.

## Why one action at a time

The obvious approach was to ask the model for a full plan: send the screenshot and the command, get back five steps, run them all. I tried that first and it fell apart on the second step every time. The page after step one is never the page the model planned against. A search submit reloads the document, an "Add to Cart" click opens a side panel, and the selectors for step three no longer exist.

The second option was a pure vision agent: no DOM, just screenshots and pixel coordinates. Nova Lite is a small multimodal model, and I did not trust it to land a click on a 30 pixel button from a downscaled JPEG. A coordinate also gives you no name for the thing you clicked, so the bubble could not say what it was doing.

So ScreenSense v2 does something narrower. The content script scrapes the DOM into a JSON snapshot with a real CSS selector for every interactive element. The backend sends that snapshot plus a compressed screenshot to Nova and demands exactly one action back. The extension executes it, waits for the DOM to settle, re-screenshots, re-scrapes, and asks again. With a small sponsor model, the safest move is to shrink the decision to one step and hand it exact strings to copy.

## What the user sees

ScreenSense v2 works like this from the user's side.

1. Hold the backtick key on any page. After a 200 ms hold delay, a frosted-glass bubble appears at your cursor with a live waveform.
2. Speak, then release. The bubble shows "Transcribing," then "Understanding," then your transcript.
3. Nova returns an answer (for "what is the price?") or an action. For actions the bubble goes to "Executing," a green outline flashes on the target element, and a short phrase like "Searching USB-C cable" is spoken aloud.
4. Each action is followed by "Re-evaluating (3/25)" and the next step, logged inside the bubble.
5. When Nova says done, the bubble lists every step and says "All done." Escape, or holding the key again, cancels the loop.

## Architecture

ScreenSense v2 runs as three processes that only talk through messages. The content script lives inside the page and owns the DOM. The service worker owns the loop. The FastAPI backend owns the AWS credentials and every model call. Nothing in the page ever holds a key.

![ScreenSense v2 architecture: content script, service worker, FastAPI backend, and AWS services](/blog/diagrams/screensense-v2-amazon-nova-agent-loop-architecture.svg)

Left to right: the shortcut handler fires a hold event, which the service worker turns into a recording request to the offscreen document. On release, the service worker captures a screenshot with `chrome.tabs.captureVisibleTab`, asks the content script for a DOM snapshot, and sends audio to the backend. The backend transcribes with AWS Transcribe Streaming (Groq Whisper as fallback), then sends command, screenshot, and DOM to Nova Lite through the Bedrock converse API. The one action that comes back crosses the same bridges in reverse, ending in `action-executor.ts`. A separate SSE channel (`GET /events`) pushes backend stage changes to the bubble.

The concrete choices in the code, and why:

| Layer | Choice | Why |
|---|---|---|
| Reasoning model | Amazon Nova Lite, `us.amazon.nova-lite-v1:0`, Bedrock `converse`, maxTokens 2048 | Sponsor model with vision; cheap enough for 25 calls per task |
| Perception | Screenshot plus DOM snapshot with CSS selectors | Exact selectors remove guessing for a small model |
| Loop control | One action per iteration, max 25 | Fresh observation every step; hard cap stops runaways |
| DOM settling | MutationObserver quiet window, then poll for real content | AJAX pages return empty snapshots if scraped too early |
| Speech to text | AWS Transcribe Streaming, Groq `whisper-large-v3-turbo` fallback | Stay on AWS; keep a fallback for demo day |
| Audio capture | MV3 offscreen document, MediaRecorder plus AnalyserNode | Mic permission persists across page loads |
| Backend | FastAPI, boto3 wrapped in `asyncio.to_thread` | boto3 is synchronous; threads keep SSE alive |
| Voice out | ElevenLabs `eleven_flash_v2_5` proxied via service worker, Web Speech fallback | Page CSP blocks direct calls from a content script |

## How the loop actually works

### The loop in the service worker

`runAgentLoop` in `src/background/service-worker.ts` is the heart of ScreenSense v2. It receives the first batch of actions from `POST /task` but ignores everything past index zero. It executes `currentActions[0]`, records the result in `actionHistory`, waits for the page, re-captures, and calls `POST /task/continue`. Whatever Nova returns replaces `currentActions`. The loop exits on `done`, on cancellation, on a closed tab, or at `MAX_AGENT_ITERATIONS = 25`.

![One voice command flowing through ScreenSense v2 from key release to task done](/blog/diagrams/screensense-v2-amazon-nova-agent-loop-flow.svg)

The trick that made the loop self-correcting was feeding failures back as text. When the content script reports that a selector matched nothing, the service worker does not retry. It writes the failure into history and lets the next `/task/continue` call see it.

```ts
// src/background/service-worker.ts
actionHistory.push({
  description: step.description,
  result: `FAILED: ${result.error}. Try a different selector or approach.`,
});
```

The continue prompt in `backend/services/nova_reasoning.py` tells Nova that a `FAILED:` line means try a different selector, and that after three identical attempts it should skip that item and move on. That turned a dead loop into a model that picks the second-best button.

### Waiting for the page to settle

The biggest source of bad decisions was scraping too early. After a click the DOM keeps mutating for a few hundred milliseconds, and after a search submit it can be empty for seconds while results load. The content script answers a `wait-for-dom-stable` message with a MutationObserver that resets a timer on every mutation and resolves once the page has been quiet for `settleMs`.

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

A hard timeout (1500 to 2000 ms) stops an animated page from blocking forever. But quiet is not the same as loaded. So after settling, `waitForDomContent` in the service worker polls `scrape-dom` every 500 ms for up to 5 seconds (8 after a navigate) and only accepts a snapshot with at least one button, one input, or more than five links. That one condition fixed the "page is blank, give up" failure on Amazon search results.

### Surviving navigation

A `navigate` action, or any click that reloads the document, kills the content script mid-conversation. `chrome.tabs.sendMessage` throws, and the service worker cannot tell whether the action succeeded. ScreenSense v2 treats that exception as a signal: it sleeps 2 seconds, pings `scrape-dom` until a fresh content script answers, and records "Page navigated (action triggered navigation)" in history. For explicit navigates it waits 3 seconds and then tries up to ten pings a second apart before declaring the page dead. The continue prompt tells Nova that after a "Page navigated" line it should read the URL and DOM again.

### Fitting a page into a small model

A full Amazon results page is far bigger than Nova Lite's comfortable context. Two functions in `nova_reasoning.py` keep every call inside budget. `_compress_screenshot` uses Pillow to downscale the PNG to at most 1024 pixels wide as JPEG at quality 70. `_truncate_dom` serializes the snapshot and, above 30,000 characters, cuts `text_content` to 2,000 characters, trims tables, lists, images and headings to three entries, and caps buttons, links, inputs and products at 15 items.

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

The scraper does its share too. `buildSelector` in `src/content/dom-scraper.ts` walks an attribute ladder: `id`, `data-testid`, product attributes like `data-asin`, `aria-label`, `title`, an `href` substring for links, `name`, and finally tag plus classes with `nth-of-type`, all through `CSS.escape`. Elements also get a semantic role such as `add-to-cart` or `search-submit` from `classifyElement`, so the model can pick by meaning instead of reading a hundred button labels.

### Executing without trusting the model

Every action Nova returns is a string produced by a model that just read an untrusted web page. `executeAction` in `src/content/action-executor.ts` treats it that way.

```ts
// src/content/action-executor.ts
const ALLOWED_ACTIONS = new Set(['click', 'type', 'navigate', 'extract', 'scroll']);
const DANGEROUS_SELECTOR_PATTERNS = [
  /javascript:/i,
  /<script/i,
  /on\w+=\s*['"]/i, // onclick=', onerror="
  /`/,
];
```

Anything outside the allowlist is rejected. Selectors are checked against those patterns, then test-run through `document.querySelector` in a try block so a syntax error becomes a clean failure the model can read. Navigation accepts only `http` and `https`. A rate limiter enforces a 300 ms gap. Typing uses the native `HTMLInputElement` value setter and dispatches `input` and `change` events so React controlled inputs notice. If the target looks like a search box, the executor presses a synthetic Enter and calls `form.requestSubmit()`, so "search for X" is one action instead of two.

## The hard parts

The MV3 audio plumbing broke more often than the model did. A service worker cannot call `getUserMedia`, so recording lives in an offscreen document. `chrome.offscreen.createDocument` resolves before that document's script has registered its listener, so the first `start-recording` message sometimes vanished. The fix is an `offscreen-ready` handshake with a 500 ms fallback. A second race: on a quick tap, `stop-recording` could arrive before `start-recording` had been sent. The service worker now stores a `recordingStartedPromise` and chains the stop onto it.

The transcription path is honest hackathon work. The WebSocket endpoint `/transcribe/stream` has a docstring about streaming audio during recording. In the code that ships, the client opens the socket after the key is released and sends the whole blob in one message. Faster than multipart, but not streaming.

Other shortcuts I would not ship: the backend URL is hardcoded to `localhost:8000`, and CORS is `allow_origins=["*"]` with credentials on. The per-tab conversation history (20 turns) is stored but never sent to Nova, so follow-ups have no memory beyond the current page. The explanation-level setting from version one survives in the settings page, but the prompts ignore it. `groq-vision.ts` is still imported and unused. The README says "Nova 2 Lite" while the code calls `us.amazon.nova-lite-v1:0`; the code is the truth.

One more thing to be clear about: while the demo video was recorded, the reasoning call was temporarily switched to a different model, then reverted. The submitted code runs Nova Lite.

## Results

ScreenSense v2 shipped as a working extension loaded unpacked from `dist/`, a FastAPI backend on localhost, a landing page on Netlify, and a YouTube demo. The README lists the categories it targeted: Agentic AI, Multimodal Understanding, UI Automation, and Voice AI. No award or placement is recorded in the repo, so I claim none.

The number I am proud of is the test count: 367 automated tests in the same two days, 213 in Jest (with a hand-built `chrome.*` mock for the service worker) and 154 in pytest with Bedrock, Transcribe and Groq mocked. Those counts come from the test files in the repo. The 894-line `test_nova_reasoning.py` is where I caught most of the JSON-extraction edge cases.

## What I would do differently

[ScreenSense v3](/blog/screensense-voice-browser-agent/) already changed several of these decisions. If I rebuilt v2 today:

- Stream audio during the hold, not after release. The endpoint supports it; the client never used it.
- Send the DOM diff between iterations instead of the whole snapshot.
- Put the loop state machine in a testable module rather than one 550-line function inside the service worker.
- Replace the fixed sleeps around navigation with `chrome.webNavigation.onCompleted`.
- Give Nova the conversation history it was promised, or delete the store.

## Key takeaways

- A small multimodal model does far better when the decision is one step and the identifiers are exact strings it can copy. Give it selectors, not coordinates.
- Feed action failures back as text in the next prompt. "FAILED: element not found, try a different selector" beats any client-side retry logic.
- "DOM is quiet" and "DOM has content" are different conditions. Wait for both, with a hard timeout on each.
- In MV3, treat a thrown `chrome.tabs.sendMessage` as a navigation signal and rebuild your context, not as a fatal error.
- Model output that names DOM elements is untrusted input. Allowlist the verbs, sanitize the selectors, restrict URL schemes, and rate-limit before touching the page.
- Budget every model call up front: downscale images, truncate structured context in a fixed order, and summarize history older than the last few steps.

## FAQ

### How does ScreenSense v2 decide what to click on a web page?

ScreenSense v2 never asks the model for coordinates. The content script scrapes the page into a JSON snapshot in which every button, link, input and form carries a CSS selector built from a priority ladder (`id`, `data-testid`, `aria-label`, `href`, `name`, then tag and class). Amazon Nova Lite receives that snapshot with a compressed screenshot and must return one action whose selector is copied from the snapshot.

### Why does ScreenSense v2 execute only one action per model call?

Because the page changes after every action, and a plan written against the old page fails on the new one. ScreenSense v2 executes the first action Nova returns, waits for the DOM to settle, re-captures a screenshot and DOM snapshot, and calls `POST /task/continue` with the new state and a compressed history. The loop ends when Nova responds with `done` or after 25 iterations.

### How does ScreenSense v2 handle page navigation in a Chrome extension?

When a navigate action or a full-page click destroys the content script, `chrome.tabs.sendMessage` throws in the service worker. ScreenSense v2 catches that, pings the tab until a fresh content script answers, records "Page navigated" in the action history, and polls until the snapshot contains real buttons, inputs or links before asking Nova what to do next.

### Which Amazon Nova model does ScreenSense v2 use?

ScreenSense v2 calls Amazon Nova Lite, model id `us.amazon.nova-lite-v1:0`, through the AWS Bedrock `converse` API with a 2048 token output limit. Screenshots are downscaled to 1024 pixels wide and sent as JPEG, and the DOM snapshot is truncated to about 30,000 characters. Speech to text uses AWS Transcribe Streaming with Groq Whisper as a fallback.

### Is the ScreenSense v2 source code public?

No. The ScreenSense v2 repository is private. The landing page and demo video are public, and this article describes the architecture, prompts and loop logic in detail.

## Links

- Live landing page: [screen-sense-nova-anirxdh.netlify.app](https://screen-sense-nova-anirxdh.netlify.app/)
- Part 1: [ScreenSense v1, talk to your screen](/blog/screensense-v1-talk-to-your-screen/)
- Part 3: [ScreenSense voice browser agent](/blog/screensense-voice-browser-agent/)
- Source: private repository, not linked.
