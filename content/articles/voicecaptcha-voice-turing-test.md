---
draft: true
title: "Bots Can Click Checkboxes. Can They Speak? Building VoiceCaptcha"
description: "How VoiceCaptcha makes a user speak a one-time phrase, transcribes it with Groq Whisper on a Cloudflare Worker, and scores it with a small fuzzy matcher."
date: 2026-09-30
slug: voicecaptcha-voice-turing-test
project: "VoiceCaptcha"
tags: [Cloudflare Workers, Durable Objects, Groq Whisper, ElevenLabs, Voice AI, React]
live: https://voicecaptcha.vercel.app/
accent: "#26c6da"
summary: "VoiceCaptcha is a voice CAPTCHA built for ElevenHacks Hack #2. A Cloudflare Worker issues a one-time phrase from a Durable Object, Groq Whisper transcribes the recording, a fuzzy matcher scores it, and ElevenLabs reads the same phrase back after a pass."
---

## A Playwright script that checks the box

Before I wrote any voice code, I wrote a test that cheats. The file is e2e/recaptcha-automation.spec.ts. It opens /demo on localhost, finds the reCAPTCHA anchor iframe, clicks the checkbox, and waits for the Record button to become enabled. It passes. The file header is clear that it runs against Google's public test site key and proves nothing about production risk scoring. But the point stood. A checkbox is a click, and clicks are cheap to script.

VoiceCaptcha is a voice-based CAPTCHA that asks a user to speak a random one-time phrase, transcribes the audio on a Cloudflare Worker with Groq Whisper, and scores the transcript against the phrase, built by Anirudh Vasudevan for ElevenHacks Hack #2, the Cloudflare x ElevenLabs hackathon, in April 2026. After a pass, the user can hear ElevenLabs read the same phrase back in a synthetic voice. Same words, different origin. That contrast was the pitch.

The source is private, so I will describe it rather than link it. The Worker is about 350 lines of TypeScript across four files, and the React side is about 1,300 lines. The live site at voicecaptcha.vercel.app has a landing page at /, the demo at /demo, and the iframe widget at /embed.

## Why a Durable Object, and why Groq

The hackathon brief asked for both Cloudflare and ElevenLabs. The obvious shape was a Worker that proxies ElevenLabs. I wanted the Cloudflare side to carry real logic, not just hold a key.

The first decision was where challenge state lives. A CAPTCHA phrase has to be issued, remembered, matched once, and thrown away. Worker memory cannot remember anything, because each request can land on a different isolate. KV is eventually consistent, which is the wrong property for "this challenge was already used." A Durable Object gives me one place with transactional storage, so I picked that and named it ChallengeCoordinator. ARCHITECTURE.md, my build plan from the hack, still calls it optional. It stopped being optional once I saw that single use was the only security property I could honestly deliver in a weekend.

The second decision was transcription. Cloudflare has Workers AI Whisper. I went with Groq's hosted whisper-large-v3 because it was the fastest Whisper endpoint I had used, and the demo loop is tap Check, wait, see result. Every extra second makes a CAPTCHA feel broken. Groq is not a sponsor platform, and ELEVENHACKS.md records it as extra. I accepted that trade.

The third decision was what ElevenLabs is for. ElevenLabs does not sell an "is this voice AI" detector, and I did not want to pretend otherwise. So ElevenLabs is text to speech, used after the pass, as the payoff. The Worker response carries a note field saying humanLikeness is a demo score and a real deployment would need a deepfake-audio API. I would rather ship the caveat inside the JSON.

## What a user sees

VoiceCaptcha opens at /demo as a split screen: a normal reCAPTCHA v2 checkbox on the left, and on the right a phrase such as "the river bends where the old oak stands" above four blurred orbs that look like a Siri visualizer. Record stays disabled until the box is checked.

You tap Record and the browser asks for the microphone. The orbs move with your voice. As you read, each word turns from pending to done, driven by Chrome's Web Speech API. You tap Check. The audio goes to the Worker, and a moment later one of three lines appears: human pass, wrong sentence, or bot suspected, along with the transcript and the scores.

If you passed, a Play ElevenLabs voice button appears and eleven_multilingual_v2 reads the same phrase. The /embed route is the same panel without the reCAPTCHA gate, plus a postMessage bridge so another site can drop it into an iframe.

## Architecture

VoiceCaptcha is two deployments that know nothing about each other except a URL. The static React 18 and Vite 5 frontend lives on Vercel with one SPA rewrite. The API is a Cloudflare Worker in workers/voice-captcha-api with its own wrangler.toml and the two provider keys as Worker secrets. Vite proxies /api to wrangler in dev; in production the frontend reads VITE_API_BASE_URL at build time.

![VoiceCaptcha architecture: browser audio consumers, Cloudflare Worker with Durable Object, Groq and ElevenLabs](/blog/diagrams/voicecaptcha-voice-turing-test-architecture.svg)

Reading left to right: the browser has three consumers of one microphone MediaStream. MediaRecorder captures the blob that will be verified, webkitSpeechRecognition feeds the word highlighter, and a Web Audio AnalyserNode drives the orbs. Only the blob leaves the browser. The Worker in src/index.ts owns four routes: GET /api/challenge, POST /api/verify-voice, POST /api/tts-demo, and GET /api/health. It reaches the ChallengeCoordinator Durable Object through an internal fetch against fake URLs like https://do/create.

Here is each layer and the reason behind it.

| Layer | Choice | Why |
|---|---|---|
| Frontend hosting | Vercel static build with SPA rewrite | Three routes from one bundle; main.tsx switches on pathname |
| API | Cloudflare Worker, four routes | Sponsor platform; holds the Groq and ElevenLabs secrets |
| Challenge state | Singleton Durable Object, SQLite-backed | Transactional single-use storage; free plan requires new_sqlite_classes |
| Transcription | Groq whisper-large-v3 over multipart | Fastest Whisper I had used; keeps the Check wait short |
| Scoring | Hand-written ordered fuzzy match plus bag of words | Small, readable, tunable thresholds; no model in the loop |
| Synthetic voice | ElevenLabs eleven_multilingual_v2 | The human versus AI contrast after a pass |
| Live word highlight | Web Speech API in Chrome | Instant feedback while speaking; UX only, never trusted |
| Bot pre-gate | reCAPTCHA v2 via react-google-recaptcha | Familiar first step; checked only on the client |

## How it works

### One-time challenges in a singleton Durable Object

VoiceCaptcha routes every challenge through one Durable Object instance. The Worker gets a stub with idFromName("global"), so every request in every region hits the same object. The create handler is seven lines.

```ts
// workers/voice-captcha-api/src/challenge-do.ts
if (url.pathname === "/create" && request.method === "POST") {
  await this.pruneExpired();
  const phrase = PHRASES[Math.floor(Math.random() * PHRASES.length)];
  const challengeId = crypto.randomUUID();
  await this.ctx.storage.put(challengeId, { phrase, created: Date.now() });
  return Response.json({ challengeId, phrase });
}
```

The phrase bank in phrases.ts has five sentences. pruneExpired runs on every create and get and deletes anything older than five minutes. After scoring a verify request, the Worker posts to the object's delete route whether the attempt passed or not. One id, one attempt.

The config detail worth knowing is in wrangler.toml. Most examples use new_classes, and on a free Cloudflare account that deploy fails.

```toml
# workers/voice-captcha-api/wrangler.toml
# Free plan: Durable Objects must be SQLite-backed (error 10097 if you use new_classes).
[[migrations]]
tag = "v1"
new_sqlite_classes = ["ChallengeCoordinator"]
```

### The verify request, end to end

VoiceCaptcha's security story is one POST. Here is its path.

![One verify request flowing from the browser through the Worker, the Durable Object and Groq](/blog/diagrams/voicecaptcha-voice-turing-test-flow.svg)

In VoiceCaptchaPanel.tsx, stopVcAndVerify flips a ref so the speech recognizer stops restarting, then awaits the MediaRecorder stop event before touching the chunks. That await matters: the last ondataavailable fires just before stop, so reading the chunks early can drop the tail of the recording. It then posts a FormData with challengeId and the blob.

On the Worker, the handler validates the form and asks the Durable Object for the entry. Unknown or expired ids come back as a 400. transcribeGroq posts the bytes to Groq's audio transcriptions endpoint with model whisper-large-v3, mapping the browser MIME type to a file extension because Groq keys the decoder off the filename. The scores are computed, the challenge is deleted, and the JSON goes back with ok, reason, transcript, matchScore, bagScore, humanLikeness, and on a pass ttsPhraseOnPass.

### A fuzzy matcher small enough to read in a minute

VoiceCaptcha does not use a model to decide pass or fail. It uses about forty lines of string code in index.ts. normalize lowercases and strips punctuation. Then two scorers run.

```ts
// workers/voice-captcha-api/src/index.ts
function wordsRoughlyEqual(a: string, b: string): boolean {
  if (a === b) return true;
  if (a.length < 4 || b.length < 4) return false;
  let d = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) if (a[i] !== b[i]) d++;
  if (Math.abs(a.length - b.length) > 1) return false;
  return d <= 1;
}
```

This is a cheap stand-in for edit distance: identical, or at least four characters each, length within one, and at most one differing position. It forgives "whales" for "whale" but not "the" for "a".

orderedWordScoreFuzzy walks the transcript left to right with a pointer into the expected words, advancing each time wordsRoughlyEqual fires, and returns matched over expected. Extra transcript words are ignored; order is not. bagOfWordsScore is the unordered version.

The thresholds are hard-coded. A pass needs ordered at or above 0.98 and a transcript of at least eight characters. If ordered is at least 0.35 or bag is at least 0.45, the reason is wrong_sentence. Anything lower, or an empty transcript, is bot_suspected. humanLikeness is 0.25 plus half the ordered score plus 0.15 times the bag score plus a small length bonus, capped at 1. It is a number for the demo, and the note field says so.

### Two speech recognizers with two different jobs

VoiceCaptcha runs speech recognition twice on every attempt, on purpose. Groq Whisper on the Worker is the one that counts. Chrome's webkitSpeechRecognition exists only to light up words as you say them, and its text never reaches the server. Chrome ends a session on its own after a pause, so the panel restarts it from onend while the recording is live.

```ts
// src/components/VoiceCaptchaPanel.tsx
rec.onend = () => {
  if (recognitionRef.current === rec && recordingVcRef.current) {
    try {
      rec.start();
    } catch {
      /* ignore */
    }
  }
};
```

The two ref checks keep a stale recognizer from resurrecting itself after Check. computeHighlight then counts how many leading spoken tokens exactly equal the expected tokens, and if the next spoken token is a prefix of the next expected word, that word is marked active. In Safari, where the API is missing, recording still works because MediaRecorder is separate.

The recording format is negotiated too. pickRecorderMime calls MediaRecorder.isTypeSupported over webm with opus, plain webm, mp4, then mpeg. Chrome lands on webm and Safari on mp4, and transcribeGroq maps the same MIME back to an extension.

### Four orbs on one AnalyserNode

The visualizer in useMicVisualizer.ts puts an AnalyserNode with fftSize 512 and smoothingTimeConstant 0.65 on the mic stream and runs a requestAnimationFrame loop. Each tick averages the first 64 frequency bins into a boost value, takes the waveform peak as a pulse value, and writes a transform to each orb directly, with no React state. A generation counter guards the async AudioContext setup so a stream swapped out mid-await does not attach a dead analyser.

## The hard parts

The reCAPTCHA token is never verified on the server. App.tsx gates the Record button on it, but the Worker never calls Google's siteverify endpoint. The checkbox is a UX gate, not a security gate, and the Playwright spec in the repo proves it.

The Worker sends a wildcard Access-Control-Allow-Origin and has no rate limiting. EMBED.md tells integrators the Worker should enforce rate limits. It does not. Each verify call costs a Groq request, so an attacker could run up my bill.

Five phrases is not a phrase bank. A bot could record five clips once and replay the right one. The single-use challengeId stops a replay against the same id, but not pre-recording.

The embed trust model is thin. The parent page receives ok true over postMessage and decides what to do. There is no signed token its backend can check, which is what makes reCAPTCHA's siteverify useful.

The TTS path is wasteful. The Worker base64-encodes ElevenLabs' MPEG bytes in 32 KB chunks and wraps them in JSON, and the browser builds a data URI for an Audio element. It works in one fetch, and that is the only thing it has going for it.

## Results

VoiceCaptcha was submitted to ElevenHacks Hack #2, the Cloudflare x ElevenLabs hackathon. ELEVENHACKS.md records the submission window closing on Thursday, April 2, 2026. No award or placement is recorded anywhere in the repo, and I am not going to claim one. The history is three commits, the last on April 1, 2026, the day before the deadline.

What shipped: the frontend on Vercel with the landing page, the /demo split screen and the /embed widget, and the Worker with its Durable Object on Cloudflare. The README links to an example third-party site that integrates the widget. It also says the verify loop completes in under two seconds; that is a README claim with no benchmark behind it.

## What I would do differently

Verify the reCAPTCHA token on the Worker and refuse to issue a challenge without it. Generate phrases instead of picking from five: a few hundred nouns, verbs and adjectives combined at random would make pre-recording impractical. Both are small changes that turn the pitch into something closer to true.

Then return a short-lived signed pass token from the Worker, so an integrator's backend can check it instead of trusting a postMessage event. Lock CORS to known origins and add rate limiting. Try Workers AI Whisper so the whole stack sits on Cloudflare. If synthetic-voice detection ever mattered for real, integrate a detector API and drop the composite humanLikeness number.

## Key takeaways

- Single-use state needs a strongly consistent store. A Durable Object with delete-after-use is a few lines; KV would let a challenge be used twice during propagation.
- On the Cloudflare free plan, Durable Object migrations must use new_sqlite_classes, not new_classes, or the deploy fails with error 10097.
- Use client-side speech recognition for feedback and server-side transcription for the decision, on separate code paths, so a lying client cannot change the result.
- Await the MediaRecorder stop event before reading the chunks; the final ondataavailable fires just before stop.
- When a score is for show, say so inside the response. A note field next to humanLikeness kept the demo honest.
- Negotiate the MediaRecorder MIME type on the client and mirror the mapping on the server, because Whisper endpoints key the decoder off the filename.

## FAQ

### How does VoiceCaptcha make sure a phrase can only be used once?

VoiceCaptcha stores every challenge in a single Cloudflare Durable Object named ChallengeCoordinator, keyed by a random UUID. When the audio comes back, the Worker reads the entry, scores the transcript, and deletes the entry no matter the outcome. Entries older than five minutes are pruned on every access.

### What does VoiceCaptcha use to transcribe the audio?

VoiceCaptcha sends the recorded blob from the Cloudflare Worker to Groq's hosted whisper-large-v3 model through the OpenAI-compatible audio transcriptions endpoint. The browser's live word highlighting uses Chrome's Web Speech API, but that text never reaches the server.

### Does VoiceCaptcha detect AI-generated or deepfake voices?

No. VoiceCaptcha checks that the spoken words match a fresh phrase; it does not analyze whether the voice is synthetic. The humanLikeness score is a composite of the word-match scores, and the response includes a note saying a real deployment would need a deepfake-audio detection API. ElevenLabs only reads the phrase back after a pass.

### How do you embed VoiceCaptcha on another website?

VoiceCaptcha ships an /embed route meant for an iframe. The URL takes an api_base parameter pointing at the Worker and a parent_origin parameter for postMessage. After each verify attempt the widget posts an object with type voicecaptcha, version 1, and the ok, reason, matchScore and humanLikeness fields. The parent page should check event.origin before trusting it.

## Links

- Live demo: https://voicecaptcha.vercel.app/ (landing page), with the interactive demo at /demo and the widget at /embed
- Source: private repository, not linked
