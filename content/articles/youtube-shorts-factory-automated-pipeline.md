---
draft: true
title: "Building a YouTube Shorts Factory That Posts Every Day"
description: "An unattended pipeline that turns a topic into a published YouTube Short: LLM scripts, Fal.ai images, ElevenLabs voice, Whisper captions, and FFmpeg."
date: 2026-09-30
slug: youtube-shorts-factory-automated-pipeline
project: "YouTube Shorts Factory"
tags: [LLM Pipelines, FFmpeg, ElevenLabs, Whisper, GitHub Actions, SQLite]
accent: "#ff4d4d"
summary: "YouTube Shorts Factory is a TypeScript pipeline that discovers a fresh fact, writes a script, generates images and voice, burns karaoke captions, and uploads a 9:16 Short, on a daily GitHub Actions cron with a review dashboard. This is the story of what it took to make it run unattended for months."
---

## The daily chore I wanted to delete

In March 2026 I wanted to run a few faceless educational YouTube Shorts channels, the kind that explain one surprising fact in forty seconds. I made the first few by hand. Each took a couple of hours: find a fact nobody had covered, write a script, generate images, record a voice, cut, caption, upload. After a week I knew I would never keep that up for four channels, so I stopped making videos and started building the machine.

YouTube Shorts Factory is an automated video production pipeline that takes a channel topic and produces a finished, captioned, narrated 9:16 YouTube Short every day, then publishes it after a one-click review, built by Anirudh Vasudevan as a personal side product. It is TypeScript on Node 20, runs on GitHub Actions cron jobs, keeps state in per-channel SQLite databases that round-trip through Cloudflare R2, and shows its output on an Express dashboard where I approve or reject each video.

The source is private, so I will describe the code rather than link it. Everything below comes from the repo as it stood at the last merged pull request in August 2026.

## Why a pipeline and not a prompt

The obvious approach was one big prompt: "write a script and describe the scenes," paste into a video tool, done. I tried that first and hit two problems. The model repeated itself within a week, because it has no memory of what it already told me. And a single prompt gives you nothing to retry when a step fails halfway: if the voice API times out after the images are paid for, you have no video.

The second option was a hosted AI video product, but none would let me run a Hindi channel with a different narrator next to an English one from the same config.

So I built a pipeline where each step is a small module with a typed input and output, and each result is written to a database row before the next step runs. The constraint that shaped everything was budget. The planning doc says v1 had to cost zero dollars, so the first version ran on Groq's free tier, Microsoft Edge TTS, and a Google Colab T4 exposed over ngrok as a FastAPI server. Every provider sits behind an interface (`LLMProvider`, `ImageProvider`, `VideoProvider`, `TTSProvider` in `src/providers/*.interface.ts`) so swapping free for paid is an environment variable. The same `VideoProducer` now runs on OpenAI, Fal.ai, and ElevenLabs.

## What the factory does each morning

A GitHub Actions cron fires once a day per channel. Half an hour later I get an email with a production ID and the fact it chose. During the day I open the dashboard, watch the video, and click approve or reject; a rejection asks for a reason, stored for prompt tuning. In the late afternoon a second workflow picks one approved video at random across channels, generates a title, description, and tags with an LLM, and uploads it to YouTube as a public Short.

Under the hood, `src/produce.ts` runs three phases: Content Brain, video production, and background music, then pushes the MP4, thumbnail, and database to R2.

## Architecture

YouTube Shorts Factory has three runtime homes. GitHub Actions runs production and publishing on cron. Railway runs the Express dashboard in a `node:20-slim` container. Cloudflare R2 is the only durable storage, because the other two have disks that disappear between runs.

![YouTube Shorts Factory architecture: GitHub Actions produce and publish jobs, the pipeline modules, external AI APIs, R2 storage, and the Railway dashboard](/blog/diagrams/youtube-shorts-factory-automated-pipeline-architecture.svg)

Left to right: the produce workflow runs the type checker and tests, restores the channel's `content-brain.db` from cache or R2, and runs `src/produce.ts`, which calls OpenAI, a local embedding model, Fal.ai, ElevenLabs, Whisper, and FFmpeg before uploading to R2. The dashboard restores every channel database from R2 at boot. The publish workflow pulls those databases and uploads one approved video through the YouTube Data API.

The main choices in the code and the reason for each:

| Layer | Choice | Why |
|---|---|---|
| Fact discovery | gpt-4o-mini, JSON mode, Zod `FactSchema` | Cheap; Zod errors feed back for 2 retries |
| Dedup | all-MiniLM-L6-v2 via `@huggingface/transformers`, cosine similarity | Free, local, 23 MB model fits a CI runner |
| Script | gpt-5.4 by default, 4 to 6 segments, 80 to 160 words | The script decides the whole video |
| Images | Fal.ai FLUX at 576x1024 | Portrait aspect; schnell is near $0.002 per image |
| Motion | Fal.ai Hailuo-02 Fast for `ANIMATE_MAX_CLIPS` clips, FFmpeg `zoompan` for the rest | AI motion costs per clip; Ken Burns is free |
| Voice | ElevenLabs `/with-timestamps`, `eleven_multilingual_v2` | Character alignment gives karaoke timing for free |
| Captions | ASS karaoke tags, then `whisper-1` word timestamps re-burn | TTS timing drifts after concat; Whisper measures the real audio |
| State | better-sqlite3 in WAL mode, one DB per channel, synced to R2 | No server; a WAL checkpoint before upload keeps it consistent |
| Scheduling | Actions cron plus a time window enforced in code | GitHub fires crons late; the code decides whether to post |

## How it works

### Finding a fact nobody on the channel has heard

`discoverNovelFact` in `src/services/fact-discovery.ts` loads every one-liner stored for the topic and puts the list in the system prompt under a "do not repeat, rephrase, or pick an adjacent angle" header. It asks gpt-4o-mini for a candidate at temperature 0.85 in JSON mode and validates it with `FactSchema`; on failure the Zod error text goes back to the model, up to three attempts.

The prompt alone was not enough, because models rephrase. So each candidate is embedded with all-MiniLM-L6-v2 (384 dimensions, stored as a BLOB on the `facts` row) and compared by cosine similarity against every stored fact for that topic. My first version embedded the one-liner, and every pair landed in a 0.65 to 0.75 band because the one-liners shared a template. Embedding the fact body instead spread real duplicates away from distinct facts.

The threshold also steps. The default is 0.75 with up to 8 retries, held strict for every attempt except the last two:

```ts
// src/services/fact-discovery.ts
const remaining = maxRetries - attempt;
const threshold =
  remaining >= 2 ? baseThreshold :
  remaining === 1 ? baseThreshold + 0.08 :
  baseThreshold + 0.15;

const candidate = await discoverFact(provider, config, previousFacts);
const dedupResult = await checkDuplicate(embedText(candidate), topicId, factRepo, threshold, embedFn);
```

A rejected candidate and the stored fact it collided with are both pushed into `previousFacts`, so the next prompt names the exact pair to avoid. The relaxed final attempts are a safety valve so a day never ends with no video.

### One tracked stage at a time

`produceVideo` in `src/pipeline/video-producer.ts` is the heart of Phase 2. `ProductionRepository.initializeStages` inserts one row per scene for `image_gen`, `animation`, `upscale`, and `tts`, plus global rows for `subtitle_gen` and `composite`, each tracking `status`, `attempts`, `output_path`, and `last_error`. Every paid call runs inside `runWithRetry` (3 attempts, 1 s, 4 s, 16 s backoff), and `isStageComplete` is checked first, so a re-run that died at the compositor does not pay for the images again.

![One daily production run flowing through YouTube Shorts Factory, from the cron trigger to the video landing in R2](/blog/diagrams/youtube-shorts-factory-automated-pipeline-flow.svg)

Inside a run: TTS and images start together with `Promise.all`. The first `ANIMATE_MAX_CLIPS` segments (2 in CI) go to Hailuo-02 Fast for a 6 or 10 second clip; the rest go through `createKenBurnsClip`, which upscales the still to 2160x3840 and picks one of five randomized `zoompan` moves. If AI animation fails after retries, that clip falls back to Ken Burns instead of failing the video. `adjustClipDuration` retimes each clip to its narration with `setpts` but refuses to speed up past 1.5x, trimming instead. The compositor concatenates, scales to 1080x1920, encodes libx264 at CRF 18, trims to the audio length, and `mixBackgroundMusic` layers an ElevenLabs Music track under the voice with `amix`.

### Captions from two clocks

ElevenLabs' `/with-timestamps` endpoint returns audio plus a character-level alignment. `ElevenLabsTTSProvider.extractWordBoundaries` folds characters into words, and `src/services/subtitle-gen.ts` groups those into chunks of four, writing an ASS file where each word carries a `{\k}` tag with its duration in centiseconds:

```ts
// src/services/subtitle-gen.ts
const text = chunk
  .map((wb) => {
    const cs = Math.round(wb.duration / 10);
    return `{\\k${cs}}${wb.text}`;
  })
  .join(' ');

lines.push(`Dialogue: 0,${start},${end},Subtitle,,0,0,0,,${text}`);
```

That worked on one segment and drifted on a full video: concat, AAC encoding, and trimming each shift timing a little, and by the last line the caption is visibly late. The fix in `src/services/whisper-sync.ts` is to stop trusting the TTS clock: extract the audio from the composed MP4, send it to `whisper-1` with `timestamp_granularities: ['word']`, rebuild the ASS from Whisper's times, and burn it in a second FFmpeg pass. If Whisper fails, `syncSubtitlesFallback` burns the TTS-timed file instead.

### SQLite on machines with no disk

Neither Actions runners nor Railway containers keep files between runs, and I did not want a database server for a hobby project. So each channel's `content-brain.db` lives in R2 and `src/services/r2-db-sync.ts` moves it around. Upload has one catch:

```ts
// src/services/r2-db-sync.ts
if (options?.db) {
  try {
    options.db.pragma('wal_checkpoint(TRUNCATE)');
    console.log(`  [r2-db-sync] WAL checkpoint completed for ${channel}`);
  } catch (err: any) {
    console.warn(`  [r2-db-sync] WAL checkpoint warning for ${channel}:`, err.message);
  }
}
```

In WAL mode recent writes sit in a `-wal` sidecar. Uploading only the `.db` silently dropped the last few facts, and the next day's dedup had holes. The checkpoint flushes everything into the main file first.

Download is harder because two writers exist: CI produces videos and the dashboard approves them. `downloadDbFromR2` does not overwrite. It opens the R2 copy read-only, runs `integrity_check`, and merges productions row by row. Missing facts are inserted with their embedding carried through (an early version dropped the BLOB and broke dedup). Existing facts get their `youtube_video_id` propagated from R2, which is what prevents double-posting.

### A cron that posts exactly once

The first publishing scheduler used fixed cron slots with a probability per slot, and it silently stopped posting for about two weeks. The reason, recorded in a comment in `src/scripts/publish-approved.ts`: GitHub fires scheduled workflows up to a few hours late, which pushed the later slots past my 8 pm cutoff. The rewrite fires five hourly crons from 22:00 UTC, and the script decides:

```ts
// src/scripts/publish-approved.ts
const PUBLISH_WINDOW_START = 15; // 3pm PT, inclusive
const PUBLISH_WINDOW_END = 20;   // 8pm PT, exclusive

if (!force && (hour < PUBLISH_WINDOW_START || hour >= PUBLISH_WINDOW_END)) {
  return;
}
if (!force && publishedInLastHours(20)) {
  return;
}
```

`pacificHour` uses `Intl.DateTimeFormat` with the Los Angeles zone so daylight saving does not move the window. Since 20 hours is longer than the 5 hour window, the first cron that lands inside posts and every later one that day exits. The script pools every approved, unpublished video present in R2, picks one at random, asks gpt-4o-mini for metadata, and uploads through `googleapis`. An expired OAuth token sends me a reauth email and exits zero so the workflow stays green.

## The hard parts

The dedup band problem took longest to see because nothing errored. Videos just started feeling samey. Logging the max similarity on every attempt revealed the cluster, and the fix was conceptual, not technical.

The WAL checkpoint bug and the dropped-embedding merge bug were both silent data loss that showed up a day later on a different machine. I now treat "state crosses a machine boundary" as the place for the most tests, and `tests/r2-db-sync.test.ts` exists because of those two.

Prompt hardening was reactive. The image style prefix in `src/providers/fal-image.provider.ts` carries a negative list (extra fingers, organs in the wrong place, otherworldly creatures), and every item is there because a video got rejected for it. A quality model should catch these, but the quality checker wired into `src/produce.ts` is stubbed to always pass.

Other shortcuts: `produce.ts` hardcodes per-channel voice and music volume maps that belong in the channel `.env` files. The Whisper pass re-encodes the video, so every Short is compressed twice. The dashboard is one 684-line Express file plus a single HTML page.

## What shipped

YouTube Shorts Factory ran as a daily production system from March 2026 through at least August 2026, when the last pull request merged. Four channels ran at its widest, each with its own topic guidance, SQLite database, ElevenLabs voice, and YouTube OAuth token; one Hindi channel routes its script through an LLM verification loop before synthesis. The production workflow is currently trimmed to two channels. The repo has 25 vitest files with 341 test cases, run before every production. An internal audit from April 2026 (`REPORT.md`) put the running cost at roughly $23 to $43 a month in budget mode. I am not sharing audience or revenue numbers.

## What I would do differently

I would move the SQLite-through-R2 scheme to a small hosted database like Turso or Postgres; the merge logic works, but I would not want to explain it to a second contributor. I would make the quality checker real, probably a vision model that scores each image against its scene description before animation is paid for. And I would add a health page showing the last successful produce and publish per channel, because the two-week outage would have been a two-hour outage if anything had been watching.

## Key takeaways

- Embed the content-rich field, not the summary field, when deduplicating LLM output. Templated summaries compress every cosine score into a narrow band.
- Give every paid step a database row with status, attempts, and last error before you call the API. Resumability is cheap on day one and expensive to retrofit.
- When captions drift, measure the final audio instead of trusting the synthesizer's clock.
- A SQLite file in WAL mode is not the whole database. Checkpoint before you copy it anywhere.
- Do not let a cron schedule be the only thing enforcing a timing rule. Fire more often than needed and put the window and the once-per-day guard in code.
- Free fallbacks (a Ken Burns zoom, TTS-timed captions) should be real code paths that run on failure.

## FAQ

### How does YouTube Shorts Factory avoid repeating facts?

YouTube Shorts Factory embeds every fact body with a local all-MiniLM-L6-v2 model and stores the vector in SQLite. Each new candidate from gpt-4o-mini is compared by cosine similarity against every stored fact for that channel. The threshold starts at 0.75 and relaxes only on the final two of up to nine attempts, and each rejected candidate is added to the prompt.

### How does YouTube Shorts Factory keep captions in sync with the voice?

YouTube Shorts Factory writes a first ASS karaoke file from ElevenLabs' character-level alignment, composes the video, then sends the final audio to OpenAI whisper-1 for word-level timestamps and burns a rebuilt ASS file from those. If Whisper fails, it burns the TTS-timed captions instead.

### How does YouTube Shorts Factory publish exactly one video a day?

YouTube Shorts Factory schedules five hourly GitHub Actions cron jobs because GitHub can fire a job hours late. The publish script exits unless the Pacific hour is between 3 pm and 8 pm, then exits if any channel published in the last 20 hours. The first run that passes both checks picks one approved video at random and uploads it.

## Links

The YouTube Shorts Factory source is a private repository and there is no public demo. The channels it runs are not linked here.
