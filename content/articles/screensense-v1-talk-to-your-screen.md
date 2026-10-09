---
title: "Building ScreenSense v1, a Hold-to-Talk Chrome Extension, in 36 Hours"
description: "How I built a voice-first Chrome extension that screenshots your tab, transcribes your spoken question, and streams a vision-model answer next to your cursor."
date: 2026-10-03
slug: screensense-v1-talk-to-your-screen
project: "ScreenSense (v1)"
tags: [Chrome Extension, Voice AI, Groq, Whisper, Llama 4, Hackathon]
repo: https://github.com/anirxdh/Treeline
accent: "#2fb583"
summary: "ScreenSense v1 is a Manifest V3 Chrome extension I built solo at TreeLine Hacks 2026. Hold backtick, ask a question out loud, release, and a streamed Llama 4 Scout answer appears in a Shadow DOM overlay at your cursor, with a short spoken summary."
---

## The screenshot loop I wanted to kill

The workflow that bugged me was small and constant. See something confusing on a page, take a screenshot, open a new tab, drag the image into ChatGPT or Claude, type the question, wait, switch back. TreeLine Hacks 2026 was 36 hours with no preset theme, so I picked this.

ScreenSense is a voice-first Chrome extension that lets you hold a key, speak a question about whatever is on your screen, and get a streamed AI answer rendered in an overlay next to your cursor, built by Anirudh Vasudevan for TreeLine Hacks 2026. This is Part 1 of three and covers the original extension in the public `anirxdh/Treeline` repo.

I built v1 alone, with Claude Code as a pair. The git log shows 17 commits, from 13:12 Pacific on March 7 to 06:38 the next morning, about sixteen and a half hours of commit history inside the 36-hour window.

## Why a Chrome extension with no backend

The obvious approach was a web app: a page you paste screenshots into, with a server holding the API keys. It does not fix the problem, and the planning doc rules it out before any code: the core value line is an answer "without leaving the page", and the Key Decisions table commits to a Chrome Extension MV3 because it has good APIs for screenshots. Staying on the page forces the answer into the browser itself: a content script and an overlay drawn on top of arbitrary sites.

The second decision was no backend at all. `.planning/PROJECT.md`, which is the first commit, lists "No backend server" as a key decision with the rationale "simplest architecture, fastest to build solo." The user pastes their own free Groq key (and an optional ElevenLabs key) into a React settings page, and the keys sit in `chrome.storage.local`. Nothing to deploy, nothing for me to pay for.

The third decision was the model stack, and it changed mid-build. The planning doc names Gemini for vision and ElevenLabs for speech-to-text, because the prize I was aiming for was "Best Project Built with ElevenLabs." The first API modules targeted `gemini-2.0-flash` and ElevenLabs `scribe_v1`. What shipped is Groq for both transcription and vision, with ElevenLabs kept only for text-to-speech. The reason recorded in the code is the free tier: the header comment in `groq-stt.ts` calls Groq Whisper a "drop-in replacement for ElevenLabs STT," and one free key covers both the Whisper endpoint and the OpenAI-compatible chat endpoint. The swap landed at 17:40 on March 7 in a commit titled "Extenstion with agent" (typo preserved).

## What ScreenSense does, step by step

On first install a three-step React welcome wizard calls `getUserMedia({ audio: true })` once, stops the tracks, and records that the mic was granted. After that, on any page:

1. You hold the backtick key. After 200 ms a 16-bar waveform appears below your cursor and follows it while you talk.
2. You release. A dark card appears at the cursor labeled "Transcribing...".
3. Your transcript shows in quotes, then "Thinking...", then the answer streams in as markdown.
4. A short spoken summary plays through ElevenLabs or the browser's speech synthesis.
5. A follow-up box appears. Type a follow-up, hold backtick again to ask by voice, click Clear, or press Escape.

Settings let you rebind the key, change the hold delay, and pick a display mode and an explanation level from Kid to Executive.

## Architecture

ScreenSense v1 runs in three Chrome execution contexts that talk over `chrome.runtime` messages: a content script injected into every frame of every page, a Manifest V3 service worker that runs the pipeline, and an offscreen document that owns the microphone. There is no server; the three external calls (Groq Whisper, Groq chat completions, ElevenLabs TTS) are plain `fetch` calls from the extension.

![ScreenSense v1 architecture: content script, service worker, offscreen document, and external APIs](/blog/diagrams/screensense-v1-talk-to-your-screen-architecture.svg)

Reading left to right: the content script (`src/content/`) detects the key hold and draws both the waveform and the answer overlay. The service worker (`src/background/service-worker.ts`) receives `shortcut-hold`, starts the offscreen recorder, and on `shortcut-release` runs `runPipeline`. The offscreen document (`src/offscreen/offscreen.ts`) is the only place that records, and it streams amplitude data back up the chain.

The real choices in the code and why each is there:

| Layer | Choice | Why |
|---|---|---|
| Input | Capture-phase `keydown` and `keyup` on `document` with a 200 ms hold timer | Fire before page handlers; the timer stops a quick tap from starting a recording |
| Mic | MV3 offscreen document created with `reasons: ['USER_MEDIA']` | Permission is granted once on the extension origin and survives navigation |
| Transcription | Groq `whisper-large-v3-turbo` via multipart `FormData` | Free tier, same key as the chat endpoint |
| Vision and chat | Groq `meta-llama/llama-4-scout-17b-16e-instruct`, `stream: true` | Accepts a PNG data URL plus text, streams SSE deltas |
| Streaming transport | Hand-rolled SSE reader over `fetch` `ReadableStream` | No SDK dependency, and each delta must be forwarded to the tab |
| Overlay | Host div with `attachShadow({ mode: 'closed' })`, inline CSS, `z-index: 2147483647` | Host page styles cannot leak in, and the card sits above everything |
| Memory | `Map<tabId, ConversationTurn[]>` in the service worker, capped at 20 turns | Cheap per-tab context that dies with the tab |
| Speech | ElevenLabs `eleven_flash_v2_5` with `SpeechSynthesisUtterance` fallback | Natural voice when a key exists, still works without one |

## How it works

### Hold-to-talk without breaking the page

`src/content/shortcut-handler.ts` registers its listener with `document.addEventListener('keydown', onKeyDown, true)`, so it runs in the capture phase, ahead of any page handler, and it swallows the key.

```ts
// src/content/shortcut-handler.ts
function onKeyDown(event: KeyboardEvent): void {
  if (event.key !== shortcutKey) return;
  // Prevent key repeat from re-triggering
  if (keyHeld) return;
  keyHeld = true;
  // Prevent the character from being typed
  event.preventDefault();
  event.stopImmediatePropagation();
  // Start the hold delay timer
```

This code never lets the backtick through: `preventDefault` and `stopImmediatePropagation` run on every matching keydown, before the timer starts, so you cannot type a backtick on any page while ScreenSense is installed. That is why Settings lets you rebind the key. The 200 ms timer only decides whether a recording starts. A quick tap clears it in `onKeyUp` and nothing happens; a hold flips `holdActive` and sends `shortcut-hold` with the cursor position, and release then sends `shortcut-release`. A `window` blur counts as a release too.

Two details cost real time. Google Docs puts its editor in an iframe, so the manifest sets `all_frames: true` and only the top frame (`window === window.top`) draws UI. And the overlay's follow-up input stops propagation of its own key events, so typing there never starts a recording.

### The mic lives in an offscreen document

My first recorder ran in the page. `getUserMedia` from a content script asks for permission per site origin, so every new site meant a new prompt, and a Manifest V3 service worker has no DOM and cannot record at all.

The fix is `chrome.offscreen.createDocument`. `ensureOffscreen()` in the service worker creates `offscreen.html` with `reasons: ['USER_MEDIA']` if `chrome.runtime.getContexts` finds none. That page runs on the extension's own origin, so the permission collected once by the welcome wizard applies everywhere. It wraps the stream in a `MediaRecorder` (`audio/webm;codecs=opus`, 100 ms timeslices) and feeds it in parallel through a Web Audio `AnalyserNode` with `fftSize = 256` to produce the waveform.

```ts
// src/offscreen/offscreen.ts
amplitudeInterval = setInterval(() => {
  if (stopped || !analyser) return;
  const data = new Uint8Array(analyser.frequencyBinCount);
  analyser.getByteFrequencyData(data);
  // Send as regular array (Uint8Array doesn't serialize well in chrome messages)
  chrome.runtime.sendMessage({ action: 'offscreen-amplitude', data: Array.from(data) }).catch(() => {});
}, 50);
```

Every 50 ms that array goes to the service worker, which forwards it to the recording tab as `amplitude-data`. `src/content/listening-indicator.ts` samples 16 evenly spaced bins and maps 0 to 255 onto bar heights of 2 to 24 px. The `Array.from` is there for the reason the comment gives: a `Uint8Array` does not serialize well over `chrome.runtime.sendMessage`, so the bins travel as a plain array.

### Streaming Groq tokens into a closed Shadow DOM

![One ScreenSense v1 voice query, from key release to spoken summary](/blog/diagrams/screensense-v1-talk-to-your-screen-flow.svg)

`runPipeline` in `service-worker.ts` first calls `chrome.tabs.captureVisibleTab({ format: 'png' })`. It posts the audio to Groq's transcription endpoint as multipart form data (`src/background/api/groq-stt.ts`) and sends the transcript to the tab as a `pipeline-stage` message.

The vision call in `src/background/api/groq-vision.ts` builds a messages array: a system prompt from a `LEVEL_INSTRUCTIONS` table keyed by explanation level, the tab's prior turns as plain text, and the current turn as an `image_url` data URL plus the transcript, with `stream: true`, `temperature: 0.7` and `max_tokens: 1024`. Old screenshots are never resent. The project has no SDK dependency (`package.json` lists only `react` and `react-dom`), so SSE parsing is by hand.

```ts
// src/background/api/groq-vision.ts
const lines = buffer.split('\n');
buffer = lines.pop() || '';
for (const line of lines) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith(':')) continue;
  if (trimmed === 'data: [DONE]') continue;
  if (trimmed.startsWith('data: ')) {
    const jsonStr = trimmed.slice(6);
    try {
```

The reader splits decoded bytes on newlines and keeps the last partial line for the next read. Each parsed `choices[0].delta.content` goes to the tab as a `stream-chunk` message. After the loop, any trailing `data:` line still in the buffer is parsed too, so a final chunk that arrives without a trailing newline is not lost. `Overlay.appendChunk` in `src/content/overlay.ts` receives those chunks.

```ts
// src/content/overlay.ts
appendChunk(text: string): void {
  if (!this.responseEl) return;
  // Lock position once content starts streaming
  if (!this.accumulatedText && this.tracking) {
    this.stopTracking();
  }
  this.accumulatedText += text;
  // In audio-only mode, don't render the text
  if (this.displayMode === 'audio-only') return;
```

While the overlay says "Thinking..." it follows the mouse. On the first chunk it locks in place, and `positionOverlay` flips the 420 px card left of the cursor or above it when it would run off the viewport. Each chunk re-renders the text through `renderMarkdown`.

The card lives inside `attachShadow({ mode: 'closed' })` with inline CSS. Because the response is set through `innerHTML`, `src/content/markdown.ts` escapes `&`, `<`, and `>` before it converts inline code, bold, italic, and `- ` bullets into tags. Escape first, then add markup.

### Answer, then summarize, then speak

Reading a four-sentence answer aloud is annoying; the README calls what I wanted a "~3 second spoken summary." After `stream-complete`, `runPipeline` fires a second, non-streaming call to the same model asking for one or two sentences under 20 words, at `temperature: 0.5` and `max_tokens: 60`. It is deliberately not awaited, so the follow-up input is usable the moment the text finishes.

`speak()` in `tts.ts` strips markdown, POSTs to ElevenLabs with `model_id: eleven_flash_v2_5` and plays the returned blob, or, on any failure or missing key, builds a `SpeechSynthesisUtterance`.

## The hard parts

The pivot left a mess. `src/background/api/gemini.ts`, `src/background/api/elevenlabs-stt.ts`, and `src/content/audio-recorder.ts` are still in the tree, unused. Worse, the live vision function is still named `streamGeminiResponse` even though it has called Groq since 17:40 on day one. It is defined in `groq-vision.ts` and imported in `service-worker.ts`, and I never renamed it.

The service worker holds state in module-level variables: `currentState`, `pendingTabId`, `recordingTabId`, and the conversations map. Manifest V3 kills idle workers, and all of it evaporates when that happens. In a demo the worker stays alive because messages keep arriving; a user who leaves a tab open for an hour silently loses their history.

Only the Whisper call has a rate-limit branch ("Rate limit hit"); a 429 from the chat endpoint falls into the generic "Something went wrong" path, and nothing retries. The spoken summary is a second full model call per question, which doubles Groq requests; on the free tier (30 per minute and 14,400 per day, per the README) that is fine for one person and bad at scale.

The overlay is about 900 lines of hand-built DOM in one class, with no tests. And the screenshot is the whole visible tab as base64 PNG, sent on every turn including typed follow-ups.

## Results

ScreenSense v1 shipped as a working extension, a README with a walkthrough video, and a standalone landing page in `landing/index.html`, all inside the TreeLine Hacks 2026 window. No award is recorded in this repo; the README carries only a "Built at TreeLine Hacks 2026" badge. The following week I re-entered the same build at Global Engineering Hack 2026, in a private repo I am not linking. Its `src/` and `manifest.json` are identical to the Treeline repo. The README badge, clone URLs, and "Built At" text were rebranded, the walkthrough video section was dropped, and the landing page was recolored.

## What I would do differently

I would move the pipeline out of ad hoc message handling into a small state machine, and persist per-tab history to `chrome.storage.session` so a worker restart does not lose it. I would delete the three dead modules and rename `streamGeminiResponse`. I would downscale the screenshot and skip it on text follow-ups. I would fold the spoken summary into the main call by asking the model for a marked final line instead of paying for a second request.

The bigger change is the one I made next. Answering questions about the screen is useful, but I wanted the extension to act on the page, not only explain it. That is the story of [Part 2](/blog/screensense-v2-amazon-nova-agent-loop/) and [Part 3](/blog/screensense-voice-browser-agent/).

## Key takeaways

- In Manifest V3, record audio in an offscreen document created with `reasons: ['USER_MEDIA']`. The permission attaches to the extension origin and survives navigation.
- Typed arrays do not survive `chrome.runtime.sendMessage`. Convert with `Array.from` before sending and rebuild on the other side.
- A capture-phase listener plus a hold timer turns one key into a trigger: a quick tap is ignored, a hold fires. The key is swallowed either way, so let users rebind it, and treat window blur as a release.
- When you set model output through `innerHTML`, escape `&`, `<`, and `>` before adding any markup of your own. The order is the sanitizer.
- Streaming SSE by hand over `fetch` is about 50 lines: split on newline, keep the tail, and flush the tail when the stream ends.
- If a follow-up UI must feel instant, fire secondary model calls (summaries, TTS) without awaiting them and deliver the result as a separate message later.

## FAQ

### How does ScreenSense record the microphone in a Manifest V3 extension?

ScreenSense creates an offscreen document with `reasons: ['USER_MEDIA']` and calls `getUserMedia` from there. The document runs on the extension's own origin, so the one-time permission from the welcome wizard covers every site.

### What models does ScreenSense v1 use?

ScreenSense v1 uses Groq Whisper for transcription and Groq's Llama 4 Scout for both the streamed answer and the spoken summary. Text-to-speech uses ElevenLabs when the user has a key and the browser's Web Speech API otherwise. There is no backend.

### Does ScreenSense send my screen anywhere?

ScreenSense sends a PNG screenshot of the visible tab and your transcribed question directly to Groq with the key you pasted in Settings, and optionally the summary text to ElevenLabs. Nothing passes through a server I run, and keys live in `chrome.storage.local`.

## Links

- Source: [github.com/anirxdh/Treeline](https://github.com/anirxdh/Treeline)
- Walkthrough video: [YouTube](https://www.youtube.com/watch?v=eUtELbN1SbI)
- Part 2: [ScreenSense v2, an agent loop on Amazon Nova](/blog/screensense-v2-amazon-nova-agent-loop/)
- Part 3: [ScreenSense voice browser agent](/blog/screensense-voice-browser-agent/)
