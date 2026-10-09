---
title: "Bots Can Click Checkboxes. Can They Speak? Building VoiceCaptcha"
description: "How VoiceCaptcha makes a user speak a one-time phrase, transcribes it with Groq Whisper on a Cloudflare Worker, and scores it with a small fuzzy matcher."
date: 2026-10-03
slug: voicecaptcha-voice-turing-test
project: "VoiceCaptcha"
tags: [Cloudflare Workers, Durable Objects, Groq Whisper, ElevenLabs, Voice AI, React]
live: https://voicecaptcha.vercel.app/
accent: "#26c6da"
summary: "VoiceCaptcha is a voice CAPTCHA built for ElevenHacks Hack #2. A Cloudflare Worker issues a one-time phrase from a Durable Object, Groq Whisper transcribes the recording, a fuzzy matcher scores it, and ElevenLabs reads the same phrase back after a pass."
---

## A Playwright script that checks the box

The repo ships a test that cheats, e2e/recaptcha-automation.spec.ts. It opens /demo on localhost, finds the reCAPTCHA anchor iframe, clicks the checkbox, and waits for the Record button to become enabled. Its header says it runs against Google's public test site key and proves nothing about production risk scoring. Still, a checkbox is a click, and clicks are cheap to script.

VoiceCaptcha is a voice-based CAPTCHA that asks a user to speak a random one-time phrase, transcribes the audio on a Cloudflare Worker with Groq Whisper, and scores the transcript against the phrase, built by Anirudh Vasudevan for ElevenHacks Hack #2, the Cloudflare x ElevenLabs hackathon, in April 2026. After a pass, the user can hear ElevenLabs read the same phrase back in a synthetic voice. Same words, different origin: that was the pitch.

The source is private, so I describe it here rather than link it.

## Why a Durable Object, and why Groq

The hackathon brief asked for both Cloudflare and ElevenLabs. The obvious shape was a Worker that proxies ElevenLabs. My own goal, not recorded in the repo, was for the Cloudflare side to carry real logic, not just hold a key.

The first decision was where challenge state lives. A CAPTCHA phrase has to be issued, remembered, matched once, and thrown away. Worker memory cannot do that, because each request can land on a different isolate. KV is eventually consistent, the wrong property for "this challenge was already used." A Durable Object gives me one place with transactional storage, so I picked that and named it ChallengeCoordinator. ARCHITECTURE.md, the build plan in the repo, lists Durable Object or KV storage as an optional v2 item. The shipped code uses the Durable Object and deletes the challenge after scoring, which is the main security property it enforces, along with a five-minute expiry.

The second decision was transcription. ARCHITECTURE.md lists two options, Groq Whisper or Workers AI Whisper on Cloudflare. I went with Groq's hosted whisper-large-v3. The README's reason is speed: it calls Groq the fastest Whisper inference available, and the demo loop is tap Check, wait, see result. Every extra second makes a CAPTCHA feel broken. Groq is not part of the brief; ELEVENHACKS.md records it as extra and not required.

The third decision was what ElevenLabs is for. ElevenLabs does not sell an "is this voice AI" detector, and I did not want to pretend otherwise. So ElevenLabs is text to speech, used after the pass, as the payoff. The Worker response carries a note field saying humanLikeness is a demo score and a real deployment would need a deepfake-audio API.

## What a user sees

The demo at /demo is a split screen: a reCAPTCHA v2 checkbox on the left, and on the right four overlapping gradient orbs above a phrase such as "the river bends where the old oak stands". Record stays disabled until the box is checked.

You tap Record and the browser asks for the microphone. The orbs move with your voice, and each word turns from pending to done as you read it, driven by Chrome's Web Speech API. You tap Check. The audio goes to the Worker, and one of three lines comes back: human pass, wrong sentence, or bot suspected.

If you passed, a Play ElevenLabs voice button appears and eleven_multilingual_v2 reads the same phrase. The /embed route is the same panel without the reCAPTCHA gate, plus a postMessage bridge for iframe use.

## Architecture

VoiceCaptcha is two deployments that know nothing about each other except a URL. The static React 18 and Vite 5 frontend lives on Vercel with one SPA rewrite. The API is a Cloudflare Worker in workers/voice-captcha-api with the two provider keys as Worker secrets.

![VoiceCaptcha architecture: browser audio consumers, Cloudflare Worker with Durable Object, Groq and ElevenLabs](/blog/diagrams/voicecaptcha-voice-turing-test-architecture.svg)

Reading left to right: three things listen to the microphone at once. MediaRecorder captures the blob that will be verified, and a Web Audio AnalyserNode in useMicVisualizer.ts takes the same getUserMedia stream and drives the orbs from a requestAnimationFrame loop with no React state. webkitSpeechRecognition opens its own capture and feeds the word highlighter. Only the blob goes to the Worker. The Worker in src/index.ts owns four routes: GET /api/challenge, POST /api/verify-voice, POST /api/tts-demo, and GET /api/health. It reaches the ChallengeCoordinator Durable Object through internal fetches to fake URLs like https://do/create.

Each layer, and why it is there:

| Layer | Choice | Why |
|---|---|---|
| Frontend hosting | Vercel static build with SPA rewrite | Three routes from one bundle; main.tsx switches on pathname |
| API | Cloudflare Worker, four routes | Sponsor platform; holds the Groq and ElevenLabs secrets |
| Challenge state | Singleton Durable Object, SQLite-backed | Transactional single-use storage; free plan needs new_sqlite_classes |
| Transcription | Groq whisper-large-v3 over multipart | Picked for speed, per the README; short Check wait |
| Scoring | Hand-written ordered fuzzy match plus bag of words | Small, readable, tunable; no model in the loop |
| Synthetic voice | ElevenLabs eleven_multilingual_v2 | The human versus AI contrast after a pass |
| Live word highlight | Web Speech API in Chrome | Instant feedback; UX only, never trusted |
| Bot pre-gate | reCAPTCHA v2 via react-google-recaptcha | Familiar first step; checked only on the client |

## How it works

### One-time challenges in a singleton Durable Object

Every challenge goes through one Durable Object instance. The Worker gets a stub with idFromName("global"), so every request in every region hits the same object. The create handler is short.

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

The phrase bank in phrases.ts has five sentences. pruneExpired runs on every create and get and deletes anything older than five minutes. After every attempt that reaches scoring, the Worker posts to the delete route, pass or fail. A transcription error returns 502 before the delete, so the challenge survives a Groq failure. One id, one scored attempt in the normal flow; the get and delete are separate calls around the Groq request, so two simultaneous posts with the same id would both be scored.

One config detail lives in wrangler.toml, and the comment above the migration block explains it: on a free Cloudflare account, a new_classes migration fails with error 10097.

```toml
# workers/voice-captcha-api/wrangler.toml
# Free plan: Durable Objects must be SQLite-backed (error 10097 if you use new_classes).
[[migrations]]
tag = "v1"
new_sqlite_classes = ["ChallengeCoordinator"]
```

### The verify request, end to end

The whole security story is one POST.

![One verify request flowing from the browser through the Worker, the Durable Object and Groq](/blog/diagrams/voicecaptcha-voice-turing-test-flow.svg)

In VoiceCaptchaPanel.tsx, stopVcAndVerify flips a ref so the speech recognizer stops restarting, then awaits the MediaRecorder stop event before touching the chunks. That await matters: the last ondataavailable fires just before stop, so reading early can drop the tail of the recording. It then posts a FormData with challengeId and the blob.

On the Worker, the handler validates the form and asks the Durable Object for the entry. Unknown or expired ids come back as a 400. transcribeGroq posts the bytes to Groq's audio transcriptions endpoint with model whisper-large-v3. The scores are computed, the challenge is deleted, and the JSON goes back with ok, reason, transcript, matchScore, bagScore, humanLikeness, and ttsPhraseOnPass on a pass.

### A fuzzy matcher small enough to read in a minute

There is no model in the pass/fail decision. VoiceCaptcha uses a few dozen lines of string code in index.ts. normalize lowercases and strips punctuation. Then two scorers run.

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

The thresholds are hard-coded. A pass needs ordered at or above 0.98 and a transcript of at least eight characters. If ordered is at least 0.35 or bag is at least 0.45, the reason is wrong_sentence. Anything lower, or an empty transcript, is bot_suspected. humanLikeness is a weighted mix of the two scores plus a small length bonus, capped at 1. It is a demo number.

### Two speech recognizers with two different jobs

Speech recognition runs twice on every attempt, on purpose. Groq Whisper on the Worker is the one that counts. Chrome's webkitSpeechRecognition exists only to light up words as you say them, and its text never reaches the server. The panel does not assume one recognition session lasts the whole recording: if onend fires while recordingVcRef is still true, the handler starts it again.

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

The two ref checks keep a stale recognizer from resurrecting itself after Check. computeHighlight counts how many leading spoken tokens exactly equal the expected tokens, and if the next spoken token is a prefix of the next expected word, that word is marked active. In a browser without the API, the panel shows a Chrome / Edge hint, and recording still works because MediaRecorder is separate.

pickRecorderMime negotiates the recording format, trying webm with opus, plain webm, two mp4 variants, then mpeg through MediaRecorder.isTypeSupported, and transcribeGroq maps the chosen MIME to a file extension.

## The hard parts

App.tsx gates the Record button on the reCAPTCHA token, but the Worker never calls Google's siteverify endpoint. The checkbox is a UX gate, not a security gate.

The Worker sends a wildcard Access-Control-Allow-Origin and has no rate limiting, even though EMBED.md tells integrators it should. Each verify call costs a Groq request.

Five phrases is not a phrase bank. A bot could record five clips once and replay the right one; the single-use challengeId stops a replay against the same id, not pre-recording.

The embed trust model is thin: the parent page receives ok true over postMessage, with no signed token its backend can check.

The TTS path is wasteful: the Worker base64-encodes ElevenLabs' MPEG bytes in 32 KB chunks inside JSON, and the browser builds a data URI for an Audio element.

## Results

The hackathon was ElevenHacks Hack #2. ELEVENHACKS.md records the submission window closing on Thursday, April 2 (the year comes from the commit dates) and still lists submitting as an open checklist item. No award or placement is recorded in the repo, and I am not going to claim one. The git history is three commits, the last at 23:29 Pacific time on April 1, the day before the April 2 deadline.

What shipped: the frontend on Vercel with the landing page, /demo and /embed, live at voicecaptcha.vercel.app. The Worker URL is not in the repo; ELEVENHACKS.md, my only source for the backend, records the Worker and Durable Object as deployed to Cloudflare. The README links to an example third-party site that integrates the widget and says the verify loop completes in under two seconds, a claim with no benchmark behind it.

## What I would do differently

Verify the reCAPTCHA token on the Worker and refuse to issue a challenge without it. Generate phrases instead of picking from five: a few hundred nouns, verbs and adjectives combined at random would make pre-recording impractical.

Then return a short-lived signed pass token from the Worker, so an integrator's backend can check it instead of trusting a postMessage event. Lock CORS to known origins and add rate limiting. Try Workers AI Whisper so the whole stack sits on Cloudflare. If synthetic-voice detection ever mattered, integrate a detector API and drop the composite humanLikeness number.

## Key takeaways

- Single-use state needs a strongly consistent store. In a Durable Object, delete-after-use is a few lines, though the consume step should be atomic (read and delete in one call), which mine is not. KV would let a challenge be used twice during propagation.
- On the Cloudflare free plan, Durable Object migrations must use new_sqlite_classes, not new_classes, or the deploy fails with error 10097.
- Use client-side speech recognition for feedback and server-side transcription for the decision, on separate code paths, so a lying client cannot change the result.
- Await the MediaRecorder stop event before reading the chunks; the final ondataavailable fires just before stop.

## FAQ

### How does VoiceCaptcha make sure a phrase can only be used once?

Every VoiceCaptcha challenge lives in a single Cloudflare Durable Object named ChallengeCoordinator, keyed by a random UUID. When the audio comes back, the Worker reads the entry, scores the transcript, and deletes the entry, pass or fail; a transcription error returns 502 before the delete. Entries older than five minutes are pruned on every create and get.

### Does VoiceCaptcha detect AI-generated or deepfake voices?

No. VoiceCaptcha checks that the spoken words match a fresh phrase; it does not analyze whether the voice is synthetic. The humanLikeness score is a composite of the word-match scores, and the response includes a note saying a real deployment would need a deepfake-audio detection API. ElevenLabs only reads the phrase back after a pass.

### How do you embed VoiceCaptcha on another website?

The /embed route of VoiceCaptcha is meant for an iframe. The URL takes an api_base parameter pointing at the Worker and a parent_origin parameter for postMessage. After each verify attempt the widget posts an object with type voicecaptcha, version 1, and the ok, reason, matchScore and humanLikeness fields. The parent page should check event.origin before trusting it.

## Links

- Live demo: https://voicecaptcha.vercel.app/ (demo at /demo, widget at /embed)
- Source: private repository, not linked
