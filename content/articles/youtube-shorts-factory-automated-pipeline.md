---
draft: true
title: "Building a YouTube Shorts Factory That Posts Every Day"
description: "An unattended pipeline that turns a topic into a published YouTube Short: LLM scripts, Fal.ai images, ElevenLabs voice, Whisper captions, and FFmpeg."
date: 2026-10-03
slug: youtube-shorts-factory-automated-pipeline
project: "YouTube Shorts Factory"
tags: [LLM Pipelines, FFmpeg, ElevenLabs, Whisper, GitHub Actions, SQLite]
accent: "#ff4d4d"
summary: "YouTube Shorts Factory is a TypeScript pipeline that discovers a fresh fact, writes a script, generates images and voice, burns karaoke captions, and uploads a 9:16 Short, on a daily GitHub Actions cron with a review dashboard. This is the story of what it took to make it run unattended for months."
---

## The daily chore I wanted to delete

The planning doc is dated March 7, 2026, and states the goal in one line: every day, a polished anime-style educational Short is ready for approval, with no manual content creation, scripting, or video editing. Making one by hand means finding a fresh fact, writing a script, generating images, recording a voice, cutting, captioning, and uploading. I did not want to do any of that.

YouTube Shorts Factory is an automated video production pipeline that takes a channel topic and produces a finished, captioned, narrated 9:16 YouTube Short every day, then publishes it after a one-click review, built by Anirudh Vasudevan as a personal side product. It is TypeScript on Node 20, runs on GitHub Actions cron, keeps state in per-channel SQLite databases that round-trip through Cloudflare R2, and shows each video on an Express dashboard.

The source is private, so I describe the code instead of linking it. Everything below comes from the repo as of August 2026.

## Why a pipeline and not a prompt

The obvious approach was one big prompt: "write a script and describe the scenes," paste into a video tool, done. I did not go that way, for two reasons. A model has no memory of what it already told me, so a channel run on single prompts would repeat itself. The comment at the top of `discoverNovelFact` records the answer: send the full one-liner history to the LLM, which means that history has to live in a database. And a single prompt gives you nothing to retry when a step fails halfway: if the voice API times out after the images are paid for, you have no video.

The second option was a hosted AI video product. When I audited the alternatives in April 2026 (`REPORT.md` compares AutoShorts.ai, Pictory, InVideo, and Fliki), the reasons I stayed with my own pipeline were: no monthly fee, control of each step, images made for the fact instead of stock footage, and zero manual work per video.

So each step is a small module with typed input and output, and each result lands in a database row before the next step runs. The other constraint was budget. The planning doc says v1 had to cost zero dollars, so the first version ran on Groq's free tier, Microsoft Edge TTS, and a Google Colab T4 exposed over ngrok. Every provider sits behind an interface (`LLMProvider`, `ImageProvider`, `VideoProvider`, `TTSProvider` in `src/providers/*.interface.ts`), so moving to OpenAI, Fal.ai, and ElevenLabs was an environment variable change.

## What the factory does each morning

A GitHub Actions cron fires once a day per channel. When the run finishes (`REPORT.md` estimates about 15 minutes) I get an email with the production ID and the fact it chose. I open the dashboard, watch the video, and click approve or reject; a rejection asks for a reason, stored for prompt tuning. Later a second workflow picks one approved video at random, writes its title, description, and tags with an LLM, and uploads it to YouTube as a public Short.

Under the hood, `src/produce.ts` runs three phases (Content Brain, video production, background music) and pushes the results to R2.

## Architecture

YouTube Shorts Factory has three runtime homes. GitHub Actions runs production and publishing on cron. Railway runs the Express dashboard in a `node:20-slim` container. Cloudflare R2 is the only durable storage, because the other two lose their disks.

![YouTube Shorts Factory architecture: GitHub Actions jobs, the produce.ts pipeline, external AI APIs, R2 storage, and the Railway dashboard](/blog/diagrams/youtube-shorts-factory-automated-pipeline-architecture.svg)

The produce workflow runs the type checker and tests, restores the channel's `content-brain.db` from R2, and runs `src/produce.ts`, which calls OpenAI, the local embedding model, Fal.ai, ElevenLabs, Whisper, and FFmpeg, then uploads to R2. The dashboard restores every channel database from R2 at boot. The publish workflow pulls those databases and uploads one approved video through the YouTube Data API.

The main choices and the reason for each:

| Layer | Choice | Why |
|---|---|---|
| Fact discovery | gpt-4o-mini in CI, JSON mode, Zod `FactSchema` | Cheap; Zod errors feed back for 2 retries |
| Dedup | all-MiniLM-L6-v2 via `@huggingface/transformers`, cosine similarity | Free, local, 23 MB model fits a CI runner |
| Script | gpt-5.4 by default, 4 to 6 segments, 80 to 160 words | The script decides the whole video |
| Images | Fal.ai FLUX dev at 576x1024, schnell as an option | Portrait aspect; `FLUX_MODEL` swaps to the cheaper schnell |
| Motion | Fal.ai Hailuo-02 Fast for `ANIMATE_MAX_CLIPS` clips, FFmpeg `zoompan` for the rest | AI motion costs per clip; Ken Burns is free |
| Voice | ElevenLabs `/with-timestamps`, `eleven_multilingual_v2` | Character alignment gives karaoke timing for free |
| Captions | ASS karaoke tags, then `whisper-1` word timestamps re-burn | TTS timing is per segment; Whisper measures the final audio |
| State | better-sqlite3 in WAL mode, one DB per channel, synced to R2 | No server; a WAL checkpoint before upload keeps it consistent |
| Scheduling | Actions cron plus a time window enforced in code | GitHub fires crons late; the code decides whether to post |

## How it works

### Finding a fact nobody on the channel has heard

`discoverNovelFact` in `src/services/fact-discovery.ts` loads every one-liner stored for the topic and puts the list in the system prompt under a "do not repeat, rephrase, or pick an adjacent angle" header. It asks the LLM for a candidate at temperature 0.85 in JSON mode and validates it with `FactSchema`; a Zod error goes back to the model, up to three attempts.

The prompt alone was not enough, because models rephrase. So each candidate is embedded with all-MiniLM-L6-v2 (384 dimensions, stored as a BLOB on the `facts` row) and compared by cosine similarity against every stored fact for that topic. My first version embedded the one-liner, and every pair landed in a 0.65 to 0.75 band because the one-liners shared a template. Embedding the fact body instead separated real duplicates from distinct facts.

The threshold also steps. The default is 0.75 with up to 8 retries, strict until the last two:

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

A rejected candidate and the stored fact it collided with are both pushed into `previousFacts`, so the next prompt names the exact pair to avoid. The relaxed final attempts mean no day ends without a video.

### One tracked stage at a time

`produceVideo` in `src/pipeline/video-producer.ts` is the heart of Phase 2. `ProductionRepository.initializeStages` inserts one row per scene for `image_gen`, `animation`, `upscale`, and `tts`, plus global rows for `subtitle_gen` and `composite`, each tracking `status`, `attempts`, `output_path`, and `last_error`. Every paid call runs inside `runWithRetry` (3 attempts) behind an `isStageComplete` check, so a re-run that died at the compositor does not pay for images again.

![One daily production run flowing through YouTube Shorts Factory, from the cron trigger to the video landing in R2](/blog/diagrams/youtube-shorts-factory-automated-pipeline-flow.svg)

Inside a run, TTS and images start together with `Promise.all`. The first `ANIMATE_MAX_CLIPS` segments (2 in CI) go to Hailuo-02 Fast; the rest, and any clip whose animation fails after retries, get a `zoompan` move from `createKenBurnsClip`. `adjustClipDuration` retimes each clip to its narration with `setpts`, trimming rather than speeding past 1.5x. The compositor concatenates, scales to 1080x1920, encodes libx264 at CRF 18, and `mixBackgroundMusic` layers an ElevenLabs Music track under the voice.

### Captions from two clocks

ElevenLabs' `/with-timestamps` endpoint returns audio plus a character-level alignment. `ElevenLabsTTSProvider.extractWordBoundaries` folds characters into words, and `src/services/subtitle-gen.ts` groups them in fours, writing an ASS file where each word carries a `{\k}` tag with its duration in centiseconds:

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

Those times are assembled, not measured. `video-producer.ts` builds `cumulativeOffsets` from the per-segment TTS durations, and `subtitle-gen.ts` adds each word's offset to its segment start. That clock is a sum of segment lengths, while the finished MP4 has been through concat, retiming, and a trim. So when `OPENAI_API_KEY` is set, the compositor skips the burn (`skipSubtitleBurn` in `compositor.ts`) and `src/services/whisper-sync.ts` measures the final audio instead: it extracts the audio track, sends it to `whisper-1` with `timestamp_granularities: ['word']`, rebuilds the ASS from Whisper's times, and burns it in a second encode. If Whisper fails, `syncSubtitlesFallback` burns the TTS-timed file.

### SQLite on machines with no disk

Neither Actions runners nor Railway containers keep files between runs, and I did not want a database server for a hobby project. So each channel's `content-brain.db` lives in R2 and `src/services/r2-db-sync.ts` moves it. Upload has one catch:

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

In WAL mode recent writes sit in a `-wal` sidecar. Uploading only the `.db` would drop the newest facts and leave holes in the next day's dedup. The checkpoint flushes everything into the main file first.

Download is harder because two writers exist: CI produces videos and the dashboard approves them. So `downloadDbFromR2` does not overwrite. It opens the R2 copy read-only, runs `integrity_check`, and merges row by row, inserting missing facts with their embedding and propagating `youtube_video_id` so nothing posts twice.

### A cron that posts exactly once

The first publishing scheduler used fixed cron slots with a probability per slot, and it silently stopped posting for about two weeks. A comment in the workflow file records why: GitHub fires scheduled workflows up to three hours late, which pushed the later slots past my 8 pm cutoff. The rewrite fires five hourly crons from 22:00 UTC, and the script decides:

```ts
// src/scripts/publish-approved.ts
const PUBLISH_WINDOW_START = 15; // 3pm PT, inclusive
const PUBLISH_WINDOW_END = 20;   // 8pm PT, exclusive

if (!force && (hour < PUBLISH_WINDOW_START || hour >= PUBLISH_WINDOW_END)) {
  return;
}
// ... best-effort downloadDbFromR2 for every channel ...
if (!force && publishedInLastHours(20)) {
  return;
}
```

`pacificHour` uses `Intl.DateTimeFormat` with the Los Angeles zone so daylight saving does not move the window. Since 20 hours is longer than the 5 hour window, the first cron that lands inside posts and every later one that day exits. The script picks one approved, unpublished video at random, asks gpt-4o-mini for metadata, and uploads through `googleapis`. An expired OAuth token sends me a reauth email and exits zero so the workflow stays green.

## The hard parts

The dedup band problem was hard to see because nothing errored. As the comment in `fact-discovery.ts` says, the threshold was useless while every pairwise score sat in the same 0.65 to 0.75 band.

The dropped-embedding merge bug made even less noise. Pull request #9 records it: the merge in `downloadDbFromR2` inserted an empty buffer for every fact's embedding, and each dashboard sync wrote that database back to R2, overwriting the good vectors. `cosineSimilarity` returned NaN for empty vectors, NaN never crosses a threshold, so dedup passed everything and repeated facts shipped. The fix carries `f.embedding` through the merge query, and `cosineSimilarity` in `src/services/embedder.ts` now returns 0 for empty or mismatched vectors. The code that crosses a machine boundary has the fewest tests: `tests/r2-db-sync.test.ts` only covers the case where R2 is not configured, and the merge path is untested.

Prompt hardening was reactive. The image style prefix in `src/providers/fal-image.provider.ts` carries a negative list (extra fingers, organs in the wrong place, otherworldly creatures), added across five pull requests between May and July 2026, at least one lifted straight from the rejection log. The quality checker wired into `src/produce.ts` should catch these, but it is stubbed to always pass.

Other shortcuts: `produce.ts` hardcodes per-channel voice and music volume maps, the Whisper pass means every Short is encoded twice, and the dashboard is one Express file and one HTML page.

## What shipped

YouTube Shorts Factory was built in March 2026 and ran as a daily production system through at least August 2026, when the last pull request merged. Five channels ran at its widest, four on the README schedule plus a fifth in another language, each with its own topic guidance, SQLite database, and YouTube OAuth token, plus a voice map that gives two of them their own ElevenLabs voice; the fifth routes its script through an LLM verification loop before synthesis. The production workflow is now trimmed to two channels. The repo has 25 vitest files, and the last merged pull request reported 365 passing tests, run before every production. The April 2026 audit in `REPORT.md` put the running cost at $23 to $43 a month in budget mode. I am not sharing audience or revenue numbers.

## What I would do differently

I would move the SQLite-through-R2 scheme to a small hosted database like Turso or Postgres; until then, the merge in `downloadDbFromR2` needs real tests with two databases that disagree. I would make the quality checker real, probably a vision model that scores each image against its scene description before paying for animation. And I would add a health page with the last successful produce and publish per channel, so an outage is caught on day one.

## Key takeaways

- Embed the content-rich field, not the summary field, when deduplicating LLM output. Templated summaries flatten every cosine score into one band.
- Give every paid step a database row with status, attempts, and last error before you call the API. Resumability is cheap on day one and expensive to retrofit.
- Time captions against the final audio, not against a sum of per-segment synthesizer clocks.
- A SQLite file in WAL mode is not the whole database. Checkpoint before you copy it anywhere.
- Do not let a cron schedule be the only thing enforcing a timing rule. Fire more often than needed and put the window and the once-per-day guard in code.
- Free fallbacks (a Ken Burns zoom, TTS-timed captions) should be real code paths that run on failure.

## FAQ

### How does YouTube Shorts Factory avoid repeating facts?

YouTube Shorts Factory embeds every fact body with a local all-MiniLM-L6-v2 model and stores the vector in SQLite. Each new LLM candidate is compared by cosine similarity against every stored fact for that channel. The threshold starts at 0.75, relaxes only on the final two of up to nine attempts, and each rejected candidate goes back into the prompt.

### How does YouTube Shorts Factory keep captions in sync with the voice?

YouTube Shorts Factory writes a first ASS karaoke file from ElevenLabs' character-level alignment, composes the video without burning it, then sends the final audio to OpenAI whisper-1 for word timestamps and burns a rebuilt ASS file from those. If Whisper fails, it burns the TTS-timed captions instead.

### How does YouTube Shorts Factory publish exactly one video a day?

YouTube Shorts Factory schedules five hourly GitHub Actions cron jobs because GitHub can fire a job hours late. The publish script exits unless the Pacific hour is between 3 pm and 8 pm, and exits if any channel published in the last 20 hours. The first run that passes both checks uploads one approved video at random.

## Links

The YouTube Shorts Factory source is private, there is no public demo, and the channels are not linked here.
