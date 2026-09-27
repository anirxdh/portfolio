---
draft: true
title: "Building ScreenSense v1, a Hold-to-Talk Chrome Extension, in 36 Hours"
description: "How I built a voice-first Chrome extension that screenshots your tab, transcribes your spoken question, and streams a vision-model answer next to your cursor."
date: 2026-09-27
slug: screensense-v1-talk-to-your-screen
project: "ScreenSense (v1)"
tags: [Chrome Extension, Voice AI, Groq, Whisper, Llama 4, Hackathon]
repo: https://github.com/anirxdh/Treeline
accent: "#2fb583"
summary: "ScreenSense v1 is a Manifest V3 Chrome extension I built solo at TreeLine Hacks 2026. Hold backtick, ask a question out loud, release, and a streamed Llama 4 Scout answer appears in a Shadow DOM overlay at your cursor, with a short spoken summary."
---

## The screenshot loop I wanted to kill

The workflow that bugged me was small and constant. See something confusing on a page, take a screenshot, open a new tab, drag the image into ChatGPT or Claude, type the question, wait, switch back. TreeLine Hacks 2026 was 36 hours with no preset theme, so I picked this.

ScreenSense is a voice-first Chrome extension that lets you hold a key, speak a question about whatever is on your screen, and get a streamed AI answer rendered in an overlay next to your cursor, built by Anirudh Vasudevan for TreeLine Hacks 2026. This is Part 1 of three and covers the original extension in the public `anirxdh/Treeline` repo (originally named ScreenSense). [Part 2](/blog/screensense-v2-amazon-nova-agent-loop/) covers the rebuild as an agent loop on Amazon Nova. [Part 3](/blog/screensense-voice-browser-agent/) covers the autonomous voice browser agent.

I built v1 alone, with Claude Code as a pair. The git log shows 17 commits, from 13:12 Pacific on March 7 to 06:38 the next morning: about sixteen and a half hours of commit history inside the 36-hour window.

## Why a Chrome extension with no backend

The obvious approach was a web app: a page you paste screenshots into, with a server holding the API keys. I rejected it in the first hour because it does not fix the problem. You should never leave the page you are looking at, and that forces the answer into the browser itself: a content script and an overlay drawn on top of arbitrary sites.

The second decision was no backend at all. `.planning/PROJECT.md`, written before the first commit, lists "No backend server" as a key decision with the rationale "simplest architecture, fastest to build solo." Every API call goes straight from the extension. The user pastes their own free Groq key (and an optional ElevenLabs key) into a React settings page, and the keys sit in `chrome.storage.local`. Zero deploy work, zero cost to me.

The third decision was the model stack, and it changed mid-build. The planning doc says Gemini 2.0 Flash for vision and ElevenLabs Scribe for speech-to-text, because the prize I was aiming for was "Best Project Built with ElevenLabs." What shipped is Groq for both transcription (`whisper-large-v3-turbo`) and vision (`meta-llama/llama-4-scout-17b-16e-instruct`), with ElevenLabs kept only for text-to-speech. Latency and a single free key drove the switch: Groq's Whisper endpoint and its OpenAI-compatible streaming chat endpoint take the same bearer token, and streamed tokens arrive fast enough that the overlay feels live. The swap landed at 17:40 on March 7 in a commit titled "Extenstion with agent" (typo preserved), adding 1,686 lines and removing 379.

## What ScreenSense does, step by step

ScreenSense installs as an unpacked extension from the `dist/` folder Webpack produces. On first install the service worker opens `welcome.html`, a three-step React wizard whose key step calls `navigator.mediaDevices.getUserMedia({ audio: true })` once, stops the tracks, and writes `screensense-mic-granted: true` to storage. After that, on any page:

1. You hold the backtick key. After 200 ms a 16-bar waveform appears below your cursor and follows it while you talk.
2. You release. The waveform fades and a dark card appears at the cursor labeled "Transcribing...".
3. Your transcript shows in quotes, then "Thinking...", then the answer streams in word by word as markdown.
4. A second model call produces an under-20-word summary that ElevenLabs (or the browser's speech synthesis) reads aloud.
5. A follow-up box and a context bar appear. Type a follow-up, hold backtick again to ask by voice, click Clear, or press Escape.

Settings let you rebind the key, change the hold delay, pick a display mode (text plus audio, audio only, text only), and pick an explanation level from Kid to Executive.

## Architecture

ScreenSense v1 runs in three Chrome execution contexts that talk over `chrome.runtime` messages: a content script injected into every frame of every page, a Manifest V3 service worker that runs the pipeline, and an offscreen document that owns the microphone. There is no server; the three external calls (Groq Whisper, Groq chat completions, ElevenLabs TTS) are plain `fetch` calls from the extension.

![ScreenSense v1 architecture: content script, service worker, offscreen document, and external APIs](/blog/diagrams/screensense-v1-talk-to-your-screen-architecture.svg)

Reading left to right: the content script (`src/content/`) detects the key hold and draws both the waveform and the answer overlay. The service worker (`src/background/service-worker.ts`) receives `shortcut-hold`, spins up the offscreen document, and on `shortcut-release` waits for the audio blob, then runs `runPipeline`. The offscreen document (`src/offscreen/offscreen.ts`) is the only place `getUserMedia` is called in normal use, and it streams amplitude data back up the chain. The one outbound call from the page is text-to-speech in `src/content/tts.ts`.

The real choices in the code and why each is there:

| Layer | Choice | Why |
|---|---|---|
| Input | Capture-phase `keydown` and `keyup` on `document` with a 200 ms hold timer | Fire before page handlers, and let a quick tap still type a backtick |
| Mic | MV3 offscreen document created with `reasons: ['USER_MEDIA']` | Permission is granted once on the extension origin and survives navigation |
| Transcription | Groq `whisper-large-v3-turbo` via multipart `FormData` | Fast, free tier, same key as the chat endpoint |
| Vision and chat | Groq `meta-llama/llama-4-scout-17b-16e-instruct`, `stream: true` | Accepts a PNG data URL plus text, streams SSE deltas |
| Streaming transport | Hand-rolled SSE reader over `fetch` `ReadableStream` | No SDK in a service worker, and each delta must be forwarded to the tab |
| Overlay | Host div with `attachShadow({ mode: 'closed' })`, inline CSS, `z-index: 2147483647` | Host page styles cannot leak in, and the card sits above everything |
| Memory | `Map<tabId, ConversationTurn[]>` in the service worker, capped at 20 turns | Cheap per-tab context that dies with the tab |
| Speech | ElevenLabs `eleven_flash_v2_5` with `SpeechSynthesisUtterance` fallback | Natural voice when a key exists, still works without one |
| Settings UI | React 18 plus Tailwind, state in `chrome.storage.local` | Content script listens to `chrome.storage.onChanged`, no reload needed |

## How it works

### Hold-to-talk without breaking the page

The keyboard handler in `src/content/shortcut-handler.ts` has two jobs that pull in opposite directions: catch the backtick before the page does, and still let you type a backtick when you just tap it. The answer is a capture-phase listener plus a timer.

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

The listener is registered with `document.addEventListener('keydown', onKeyDown, true)`, so it runs before any page handler. The timer callback flips `holdActive` and sends `shortcut-hold` with the cursor position. If the key comes up before `holdDelayMs` (200 ms by default), `onKeyUp` just clears the timer; after, it sends `shortcut-release`. A `window` blur counts as a release too, because switching windows mid-hold otherwise left the mic on.

Two details cost real time. Google Docs puts its editor in an iframe, so the manifest sets `all_frames: true` and only the top frame (`window === window.top`) draws UI. And the overlay's follow-up input stops propagation of its own key events, so typing a backtick there does not start a recording.

### The mic lives in an offscreen document

My first recorder, `src/content/audio-recorder.ts`, ran in the page and is still in the repo, unused. `getUserMedia` from a content script asks for permission per site origin, so every new site meant a new prompt, and a Manifest V3 service worker has no DOM and cannot record at all.

The fix is `chrome.offscreen.createDocument`. The service worker's `ensureOffscreen()` checks `chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] })` and, if nothing is there, creates `offscreen.html` with `reasons: ['USER_MEDIA']`. That page runs on the extension's own origin, so the permission collected once by the welcome wizard applies everywhere. It wraps the stream in a `MediaRecorder` (`audio/webm;codecs=opus`, 100 ms timeslices) and feeds it in parallel through a Web Audio `AnalyserNode` with `fftSize = 256` to produce the waveform.

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

Every 50 ms that array goes to the service worker, which forwards it to the recording tab as `amplitude-data`. `src/content/listening-indicator.ts` samples 16 evenly spaced bins and maps 0 to 255 onto bar heights of 2 to 24 px. The `Array.from` matters: a `Uint8Array` does not survive `chrome.runtime.sendMessage`, and the first waveform stayed flat until I found that.

### Streaming Groq tokens into a closed Shadow DOM

![One ScreenSense v1 voice query, from key release to spoken summary](/blog/diagrams/screensense-v1-talk-to-your-screen-flow.svg)

`runPipeline` in `service-worker.ts` first calls `chrome.tabs.captureVisibleTab({ format: 'png' })`. It posts the audio to Groq's `/openai/v1/audio/transcriptions` endpoint as multipart form data (`src/background/api/groq-stt.ts`) and sends the transcript to the tab as a `pipeline-stage` message.

The vision call in `src/background/api/groq-vision.ts` builds a messages array: a system prompt from a `LEVEL_INSTRUCTIONS` table keyed by explanation level, the tab's prior turns as plain text, and the current turn as an `image_url` data URL plus the transcript, with `stream: true`, `temperature: 0.7` and `max_tokens: 1024`. Those prior turns come from a `Map<tabId, ConversationTurn[]>` in the service worker, capped at 20 turns (`MAX_CONVERSATION_TURNS`) and deleted on `chrome.tabs.onRemoved`; old screenshots are never resent. There is no SDK in a service worker, so SSE parsing is by hand.

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

The reader splits decoded bytes on newlines and keeps the last partial line for the next read. Each parsed `choices[0].delta.content` goes to the tab as a `stream-chunk` message. After the loop, any trailing `data:` line still in the buffer is parsed too, which fixed a bug where the last word of an answer was dropped. `Overlay.appendChunk` in `src/content/overlay.ts` receives those chunks.

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

While the overlay says "Thinking..." it follows the mouse, so it is never in your way. On the first chunk it locks in place. `positionOverlay` flips the 420 px card left of the cursor or above it when it would run off the viewport. Below the excerpt, the text is re-rendered through `renderMarkdown`, and the card auto-scrolls only if the user is within 40 px of the bottom.

The card lives inside `attachShadow({ mode: 'closed' })` with inline CSS. Because the response is set through `innerHTML`, `src/content/markdown.ts` escapes `&`, `<`, and `>` before it converts inline code, bold, italic, and `- ` bullets into tags. Escape first, then add markup.

### Answer, then summarize, then speak

Reading a four-sentence answer aloud is annoying; the README calls what I wanted a "~3 second spoken summary." After `stream-complete`, `runPipeline` fires a second, non-streaming call to the same model asking for one or two sentences under 20 words, at `temperature: 0.5` and `max_tokens: 60`. It is deliberately not awaited, so the follow-up input is usable the moment the text finishes.

`speak()` in `tts.ts` strips markdown, then POSTs to ElevenLabs with `model_id: eleven_flash_v2_5` and plays the returned blob, or, on any failure or missing key, builds a `SpeechSynthesisUtterance`. Audio-only mode swaps the text for a CSS wave and polls `isSpeaking()` every 500 ms to auto-dismiss.

## The hard parts

The pivot left a mess. `src/background/api/gemini.ts`, `src/background/api/elevenlabs-stt.ts`, and `src/content/audio-recorder.ts` are still in the tree, unused. Worse, the live vision function is still named `streamGeminiResponse` even though it has called Groq since 17:40 on day one. Renaming across three files at 2 a.m. felt riskier than leaving it.

The service worker holds state in module-level variables: `currentState`, `pendingTabId`, `recordingTabId`, and the conversations map. Manifest V3 kills idle workers, and all of it evaporates when that happens. In a demo the worker stays alive because messages keep arriving; a user who leaves a tab open for an hour silently loses their history.

There is one rate-limit path: a 429 from Whisper produces "Rate limit hit," while a 429 from the chat endpoint falls into the generic "Something went wrong" branch. There is no retry anywhere. The spoken summary is a second full model call per question, which doubles Groq requests; on the free tier (30 per minute and 14,400 per day, per the README) that is fine for one person and bad at scale.

The overlay is about 900 lines of hand-built DOM in one class, with no tests. And the screenshot is the whole visible tab as base64 PNG, sent on every turn including typed follow-ups.

## Results

ScreenSense v1 shipped as a working extension, a README with a walkthrough video, and a standalone landing page in `landing/index.html`, all inside the TreeLine Hacks 2026 window. No award is recorded in this repo. The README carries only a "Built at TreeLine Hacks 2026" badge.

Five days later I re-entered the same build at Global Engineering Hack 2026. That repo is private, so I am not linking it. Its `src/` and `manifest.json` are byte-for-byte identical to the Treeline repo; the only change is the README badge, in a commit dated March 12. That re-entry pushed me to rebuild ScreenSense as an agent.

## What I would do differently

I would move the pipeline out of ad hoc message handling into a small state machine, and persist per-tab history to `chrome.storage.session` so a worker restart does not lose it. I would delete the three dead modules and rename `streamGeminiResponse`. I would downscale the screenshot and skip it on text follow-ups. I would fold the spoken summary into the main call by asking the model for a marked final line instead of paying for a second request.

The bigger change is the one I made next. Answering questions about the screen is useful, but the follow-ups people typed during the demo were requests to do things, not to explain things. That is the story of [Part 2](/blog/screensense-v2-amazon-nova-agent-loop/) and [Part 3](/blog/screensense-voice-browser-agent/).

## Key takeaways

- In Manifest V3, record audio in an offscreen document created with `reasons: ['USER_MEDIA']`. The permission attaches to the extension origin and survives navigation.
- Typed arrays do not survive `chrome.runtime.sendMessage`. Convert with `Array.from` before sending and rebuild on the other side.
- A capture-phase listener plus a hold timer lets one key do two jobs: tap to type, hold to trigger. Treat window blur as a release.
- When you set model output through `innerHTML`, escape `&`, `<`, and `>` before adding any markup of your own. The order is the sanitizer.
- Streaming SSE by hand over `fetch` is about 30 lines: split on newline, keep the tail, and flush the tail when the stream ends.
- If a follow-up UI must feel instant, fire secondary model calls (summaries, TTS) without awaiting them and deliver the result as a separate message later.

## FAQ

### How does ScreenSense record the microphone in a Manifest V3 extension?

ScreenSense creates an offscreen document with `chrome.offscreen.createDocument({ url: 'offscreen.html', reasons: ['USER_MEDIA'] })` and calls `getUserMedia` from there. The document runs on the extension's own origin, so the one-time permission from the welcome wizard covers every site.

### What models does ScreenSense v1 use?

ScreenSense v1 uses Groq for both speech-to-text and vision: `whisper-large-v3-turbo` for transcription and `meta-llama/llama-4-scout-17b-16e-instruct` for the streamed answer and the spoken summary. Text-to-speech uses ElevenLabs `eleven_flash_v2_5` when the user has a key and the browser's Web Speech API otherwise. There is no backend.

### How does ScreenSense keep the overlay from clashing with the host page?

ScreenSense draws the answer card inside a closed Shadow DOM on a fixed-position host div with `z-index: 2147483647`. All CSS is an inline string inside the shadow root, so page styles cannot reach it and its styles cannot leak out. Model output is escaped before the markdown renderer adds tags.

### Does ScreenSense send my screen anywhere?

ScreenSense sends a PNG screenshot of the visible tab and your transcribed question directly to Groq's API with the key you pasted in Settings, and optionally the summary text to ElevenLabs. Nothing passes through a server I run. Keys live in `chrome.storage.local`, and per-tab history lives in the service worker's memory until the tab closes.

### Did ScreenSense v1 win anything at TreeLine Hacks?

No result is recorded in the repo for the TreeLine Hacks 2026 build. ScreenSense v1 was re-entered unchanged at Global Engineering Hack 2026, then rebuilt as an autonomous browser agent, covered in Parts 2 and 3.

## Links

- Source: [github.com/anirxdh/Treeline](https://github.com/anirxdh/Treeline)
- Walkthrough video: [YouTube](https://www.youtube.com/watch?v=eUtELbN1SbI)
- Part 2: [ScreenSense v2, an agent loop on Amazon Nova](/blog/screensense-v2-amazon-nova-agent-loop/)
- Part 3: [ScreenSense voice browser agent](/blog/screensense-voice-browser-agent/)
