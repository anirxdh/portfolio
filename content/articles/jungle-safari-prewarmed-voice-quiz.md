---
title: "How Jungle Safari Hides Every AI Round Trip From a Toddler"
description: "Jungle Safari is a toddler animal-sound quiz where every ElevenLabs clip and GPT-4o-mini mascot line is generated ahead of time and cached so nothing loads."
date: 2026-10-03
slug: jungle-safari-prewarmed-voice-quiz
project: "Jungle Safari"
tags: [ElevenLabs, Voice AI, Next.js, Upstash Redis, Caching, React Three Fiber]
repo: https://github.com/anirxdh/JungleSafari
live: https://thejunglesafari.netlify.app
accent: "#7cb342"
summary: "Jungle Safari is an animal-sound quiz for ages 1 to 3, built for the #ElevenHacks hackathon. Every ElevenLabs sound and every spoken mascot line is generated ahead of time and cached in static files, Upstash Redis and the browser, so a toddler never sees a spinner."
---

## A two-year-old does not wait for a spinner

The obvious game loop is the one every AI demo uses. The kid taps an animal, the server asks gpt-4o-mini for a cute line, sends it to ElevenLabs for a voice, and ships the audio back. Two to five seconds, by my rough estimate. For a toddler that is forever; they wander off or start mashing the screen. So the real engineering problem was hiding the AI at every layer where a delay could creep in: the CDN, the serverless function, the cache, and the browser.

Jungle Safari is a web quiz for ages 1 to 3 that plays an AI-generated animal sound, asks the kid to tap the right animal, and has a safari owl mascot answer with a spoken line tailored to the exact wrong animal they picked, built by Anirudh Vasudevan for the #ElevenHacks hackathon run by turbopuffer and ElevenLabs. The planning doc in the repo is dated April 12, 2026 and the last commit landed April 16, so this was about four days of work, including two pivots.

## Why pre-generate instead of stream

The obvious approach is streaming text-to-speech and playing the first chunk. I rejected it for two reasons.

First, streaming only hides the TTS part. The LLM call still has to finish first, and on Netlify every API route is a serverless function that can cold start. Streaming would shave the TTS wait and leave the LLM wait and the cold start, which is still too long here.

Second, the content space is small and known. There are 55 animals in data/animals.json across 7 categories, and the wrong options for a round always come from the same category as the correct animal (buildAnimalOptions in lib/animals.ts). So the set of possible (correct animal, wrong guess) mascot lines is finite. By my count it is 414 wrong pairs plus 55 correct lines, 469 entries. The README says about 350; either way it is small enough to generate once and keep forever.

That made the decision easy: generate everything up front, store it somewhere global, and make the live game a pure cache reader. The storage choice came from Netlify: functions get a /tmp that does not survive between instances and the deploy bundle is read only, so the mascot audio lives in Redis as base64 strings, one cache shared by every user and instance.

## What the kid sees

The landing page plays a short hero video once and freezes on a painted "Let's Go!" frame. HeroVideoOnce.tsx ignores taps for the first second so a toddler cannot skip the intro by accident. A tap after that scrolls to basecamp, where a parent types a nickname and picks Today's Expedition (the shared daily challenge) or Free Roam (random animals).

A game is three rounds. Each round plays an animal sound and shows four animal names. The kid taps one, the reveal is instant, and then the owl speaks. If the kid picked a tiger when the answer was a lion, the line is about lions versus tigers, not a generic "try again." Next stays locked until the voice finishes. After round three the results page shows stickers, 3D badges, the streak, and for daily games a global rank for the day and a top-3 preview.

## Architecture

Jungle Safari is a Next.js 16 App Router app. Pages under src/app render in the browser; routes under src/app/api become Netlify functions. Nothing in memory can be relied on between requests, so all runtime state lives in Upstash Redis, and OpenAI and ElevenLabs are only called on a cache miss.

![Jungle Safari architecture: browser, Netlify functions, Upstash Redis and the AI vendors only on cache miss](/blog/diagrams/jungle-safari-prewarmed-voice-quiz-architecture.svg)

Reading left to right: the home page asks a tiny preview route for today's three animals and preloads their mp3s before the kid has clicked anything. The play page calls POST /api/game/start, gets back three rounds including the correct answers, preloads all three clips, and fires POST /api/feedback/prewarm once per round. Each prewarm call reads the round from Redis and runs getOrGenerateFeedback for all four option outcomes in parallel, which on a warm cache is four Redis reads. The results page posts the score to the leaderboard. The dotted edges are the miss path.

The animal sounds take a different route. scripts/pre-generate-animal-audio.ts generated them once and the 55 mp3s (about 4.3 MB) are committed to public/animals, so Netlify serves them from its CDN with no function involved.

Here is each layer and why I picked it:

| Layer | Choice | Why |
|---|---|---|
| Framework | Next.js 16 App Router, React 19, TypeScript | One repo for pages and API routes; Netlify turns routes into functions |
| Animal sounds | ElevenLabs Sound Effects, 5 second clips, committed mp3s | Finite set of 55, generated once, served from CDN |
| Mascot text | gpt-4o-mini, temperature 0.7, max 120 tokens | Cheap and fast for a one-time warm-up of a few hundred lines |
| Mascot voice | ElevenLabs TTS, voice Bella, eleven_multilingual_v2, mp3_44100_128 | Warm, friendly adult voice, per the code comment |
| Feedback cache | Upstash Redis, JSON value with a base64 data URL | Global across users and instances; no filesystem |
| Game state | Redis key per game, 1 hour TTL | Survives cold starts; expires on its own |
| Leaderboard | Redis sorted set per UTC day, 48 hour TTL | zadd plus zrevrank gives rank in two calls; self-cleaning |
| Daily picks | FNV-1a hash of the date seeding mulberry32 | Every instance derives the same animals with no scheduler |
| Kid progress | localStorage via lib/kid-storage.ts | No accounts, no auth, SSR-safe defaults |

## How it works

### The feedback cache is the whole product

lib/feedback.ts is the mascot's brain. The cache key is the pair that defines the outcome: the correct animal id plus either the guessed animal id or the literal "correct". The value is a small JSON object with the spoken text and a data:audio/mpeg;base64 string holding the mp3 bytes.

```ts
// lib/feedback.ts
  const cached = await redis.get<FeedbackPayload>(key);
  if (
    cached &&
    typeof cached.audioDataUrl === "string" &&
    cached.audioDataUrl.startsWith("data:audio/") &&
    typeof cached.text === "string"
  ) {
    return cached;
  }
```

The shape check matters. A stale or malformed entry would otherwise reach the browser and fail silently. Instead it falls through to regeneration and overwrites itself.

On a miss, generateExplanation builds a prompt from the correct animal, the guessed animal and the animal's funFact field, asks gpt-4o-mini for a line under 30 words with no emoji, and generateSpeech in lib/elevenlabs.ts turns it into an mp3 Buffer. That becomes a data URL and the object is written back with no TTL. Each entry is roughly 30 to 60 KB (per the lib/feedback.ts comment), well under the 1 MB per-value limit on the Upstash free tier. scripts/pre-generate-feedback.ts walks every animal and every same-category decoy pair through the same function, so it is safe to re-run. The README's cost table puts the full warm-up, sounds and voices together, at about 9 dollars one time.

### The reveal is a local check, and the server finds out later

This is the trade a security reviewer would like least. POST /api/game/start returns the correct name, emoji, description and fun fact for every round, and the client checks the answer itself.

```ts
// src/app/play/page.tsx
    const correct = option === round.correctName;
    setRevealCorrect(correct);
    const score = correct ? 1000 : 0;
    setTotalScore((prev) => prev + score);
    // Fire server update in BACKGROUND (for leaderboard/state tracking)
    fetch("/api/game/guess", {
      method: "POST",
      body: JSON.stringify({ gameId, roundIndex: currentRound, guess: option }),
    }).catch(() => {});
```

That excerpt is trimmed. The order is the point: update the screen, then tell the server. POST /api/game/guess still does its own comparison and writes the round to Redis, but nothing in the UI waits on it. The comment in the start route puts it plainly: the target audience is toddlers, not hackers. The leaderboard submit route accepts the client's score (validated as 0 to 5000) rather than re-reading game state, because the guess writes are fire-and-forget and the results page could race ahead of them. I would not ship this for a game with prizes. For a cartoon sticker, I think it is right.

### Preloading at three different moments

![One round of Jungle Safari from game start to the owl speaking](/blog/diagrams/jungle-safari-prewarmed-voice-quiz-flow.svg)

The kid's tap is the last step in a chain of warm-ups that started before the game did.

On the home page, a useEffect in src/app/page.tsx fetches /api/daily/preview, which runs the same seeded pick as the real game but creates no game and touches no Redis. For each returned audioUrl it creates a new Audio() with preload set to auto, so the clips download while the parent is still typing a nickname. On game start, prefetchAllAudio does the same for all three rounds, and prewarmAllFeedback posts to /api/feedback/prewarm once per round in parallel. That route warms all four outcomes, so whichever button the kid taps, the line is already in Redis. On the tap, MascotFeedback.tsx mounts and posts to /api/feedback, which by then should be a hit.

### Locking Next to the audio, and the strict-mode bug

The owl's voice is the point of the reveal, so Next stays disabled until the audio ends. MascotFeedback.tsx builds an Audio element from the data URL, plays it, and flips canAdvance on the ended event. A 6 second safety timer unlocks the button if the backend is down.

The bug I lost time on was React strict mode. My first version used the usual cancelled flag in the fetch effect. Strict mode runs effects twice in development, the first cleanup set cancelled to true, and the real response was thrown away, so only the fallback text rendered. The fix was a ref that makes the fetch run once per mount (excerpt trimmed of the headers line).

```tsx
// src/components/MascotFeedback.tsx
  useEffect(() => {
    if (fetchedRef.current) return;
    fetchedRef.current = true;
    (async () => {
      try {
        const res = await fetch("/api/feedback", {
          method: "POST",
          body: JSON.stringify({ animalId, guessId, correct }),
        });
```

### A daily challenge with no scheduler

Everyone who plays Today's Expedition on the same UTC day should get the same three animals, with no cron job or stored seed. lib/animals.ts hashes the date string with FNV-1a and feeds the result into a mulberry32 generator.

```ts
// lib/animals.ts
export function seedFromString(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h;
}
```

pickAnimalsForSeed does a seeded Fisher-Yates shuffle, then walks the result preferring categories it has not used yet. Any Netlify instance runs the same code on the same string and gets the same three animals. Free Roam is the same function seeded with Math.random(). The leaderboard uses the same date string. Its sorted set member is the nickname joined to the game id, so re-submitting the same game overwrites its own entry, and zrevrank returns the rank in one call.

## The hard parts

The repo started as SoundGuessr, a GeoGuessr-style game where you hear an AI soundscape and guess the place and decade. .planning/PROJECT.md still describes that game. I had 203 scenes in data/scenes.json, most of them generated with gpt-4o-mini and zod structured outputs, and cosine-distance scoring in lib/scoring.ts. It worked, but a soundscape is hard to guess and hard to demo. I renamed it Audio Visa, then threw out the game design for a toddler quiz, then renamed again to Jungle Safari. The Redis and localStorage keys still start with audiovisa, and the old scene files and scoring module are still in the repo as dead code.

turbopuffer is the honest gap. The README pitches vector search as central to the audio pipeline. In the code, scripts/seed-animals.ts does embed all 55 animals with text-embedding-3-small and upsert them into an audiovisa-animals namespace. But no route under src imports lib/turbopuffer.ts or lib/search.ts. The index exists; the game never reads it.

Smaller hacks: the rate limiters in /api/feedback and /api/animal/audio are in-memory Maps, so on Netlify they are per function instance and reset on every cold start. The game was five rounds before it was three, and a few comments and the leaderboard's 5000 cap still describe the old version.

## Results

Jungle Safari shipped and is live at thejunglesafari.netlify.app. It was submitted to the #ElevenHacks hackathon. The repo records no placement or award, so I claim none.

What shipped: 55 ElevenLabs animal sounds, a pre-warmed mascot voice cache in Upstash, a shared daily challenge with a global top-10 board, Free Roam, localStorage streaks and stickers, and a 3D owl built from react-three-fiber primitives with no model files.

## What I would do differently

Wire turbopuffer in or take it out of the README. The natural use was there: embed a theme like "things that buzz" and pull a themed expedition out of the index.

Move the rate limit into Redis. Upstash ships a ratelimit package and the connection is already there.

Keep the instant reveal but reconcile with the server. The guess route already returns the correct answer; the client could render its local guess and quietly correct itself if the server disagreed, so the leaderboard could trust server state again.

## Key takeaways

- When the content space is finite, pre-generate it. Count the pairs before you build a streaming pipeline.
- Base64 audio in Redis is a fair storage choice on serverless hosts: one global cache, no filesystem, no object storage to configure.
- Warm every outcome, not just the likely one. Four buttons means four prewarmed cache entries, so the user's choice is never on the critical path.
- A hash of the date is a scheduler. FNV-1a plus a seeded PRNG gives every stateless instance the same daily pick with no cron and no stored seed.
- Sorted-set members with a deterministic suffix turn resubmits into upserts. Nickname plus game id means retries overwrite instead of duplicate.

## FAQ

### How does Jungle Safari keep the mascot's voice from loading?

Jungle Safari generates every possible mascot line ahead of time. The set of outcomes is bounded because wrong options always come from the same animal category, so a warm-up script walks every (correct animal, wrong guess) pair, asks gpt-4o-mini for a short line, converts it with ElevenLabs TTS, and stores the text plus a base64 mp3 in Upstash Redis with no expiry. By the time the kid taps, the feedback request is a Redis read.

### Why does Jungle Safari store audio in Redis instead of files?

Jungle Safari runs on Netlify, where API routes are serverless functions with a read-only deploy bundle and a per-instance /tmp that does not persist, so a file cache would neither persist nor be shared. Storing each clip as a data:audio/mpeg;base64 string inside a JSON value in Upstash gives one cache that every function and every player shares, at roughly 30 to 60 KB per entry.

### Does Jungle Safari use turbopuffer at runtime?

No. Jungle Safari's seed script embeds all 55 animals with OpenAI text-embedding-3-small and upserts them into a turbopuffer namespace, but no API route in the live game queries that index. The README describes vector search as part of the audio pipeline; in the shipped code it is seeded and never read. Daily picks come from an FNV-1a hash of the date, not from vector search.

## Links

- Live demo: [thejunglesafari.netlify.app](https://thejunglesafari.netlify.app)
- Source: [github.com/anirxdh/JungleSafari](https://github.com/anirxdh/JungleSafari)
