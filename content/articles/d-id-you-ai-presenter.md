---
draft: true
title: "Putting a Talking AI Presenter Inside Any Video With ffmpeg and D-ID"
description: "How D-ID You turns an uploaded video into a narrated MP4 with a circular AI presenter, using ElevenLabs, DeepSeek V3, D-ID Talks and one long ffmpeg filter."
date: 2026-10-03
slug: d-id-you-ai-presenter
project: "D-ID You"
tags: [D-ID, ElevenLabs, ffmpeg, Next.js, Video AI, Hackathon]
repo: https://github.com/anirxdh/D-ID-You
live: https://d-id-you.vercel.app
accent: "#c77dff"
summary: "D-ID You takes a screen recording or YouTube link and returns an MP4 with a circular AI presenter narrating it in the corner. This is the story of a hackathon pivot, a five-service media pipeline, and the ffmpeg filter that holds it together."
---

## Less than a day left and a fresh repo

On the night of June 3, 2026, I had a working hackathon entry I did not want to submit, and a deadline the next afternoon. The ElevenHacks Hack #11 D-ID track asked for an AI agent where the visual experience is essential. My first attempt, a private project called ElseWhere, was a live D-ID avatar you could talk to inside a Mars colony scene. A live stream gives you nothing to download or share. I shelved it and started a new repo a little after midnight.

D-ID You is a Next.js web app that turns any uploaded video into a narrated presentation by compositing a circular talking AI presenter into the MP4, built by Anirudh Vasudevan for ElevenHacks Hack #11, D-ID track. You upload a screen recording or paste a YouTube link. About ninety seconds later (the README's number for a 30 MB file) you download a video where a presenter in the corner explains what you are watching, in the voice, style and language you picked.

## Why a rendered file instead of a live avatar

The obvious approach was a live avatar: open a WebRTC session, push text, watch it speak. ElseWhere did that through the D-ID client SDK, and this repo's own first design did it too, against D-ID's `/talks/streams` endpoints. Those routes are still under `app/api/avatar/` as dead code. A stream leaves you with no file.

The second option was D-ID Clips V3 Pro, which renders a presenter for the whole video. The README records what I saw: 15 to 30 minutes for a three minute video.

The third option, the one I shipped, was the D-ID Talks API. Talks takes a still image and a script, voices it through an ElevenLabs voice, and returns a short talking-head MP4. The README says the render takes about 12 seconds (its timing table lists 15 for submit plus render, and the comments in `api/did.ts` still say one to two minutes), as long as the clip is short. So the README caps the script at 45 seconds, and `api/subtitle.ts` has the helper: `MAX_PRESENTER_SECONDS` is 45 and `targetWordCount` turns that into about 105 words at 140 words per minute. That cap shaped everything downstream, including a bug I describe below: it exists, but nothing calls it.

For the language model I kept DeepInfra, already wired in, and pointed it at `deepseek-ai/DeepSeek-V3` through its OpenAI-compatible endpoint, which has the JSON mode the summary step needs.

## What a user actually does

D-ID You opens on a four-step wizard. Step one is the upload: an mp4, mov or webm up to 500 MB, or a YouTube URL. Step two is the presenter, picked from D-ID's list with hover previews. Step three is voice and style: 16 ElevenLabs voices filtered by the presenter's gender, a narration style, one of six languages, an audio mode, a music mood and a caption size. Step four is a review summary, the presenter position picker, and Start Processing.

The pipeline then transcribes, writes the script (editable) and creates the presenter. Once the D-ID clip is ready, compositing starts with a progress bar fed by ffmpeg. You end with one MP4, a share link, and a button that cuts a 30 to 60 second highlight DeepSeek picks from the transcript.

## Architecture

D-ID You is one Next.js 15 app with an unusual split: the UI runs on the Pages Router (`pages/app.tsx` mounts `components/avatarlens-shell.tsx`) while every API route lives in the App Router. The browser drives the pipeline, and each job lives on disk under `.avatarlens/videos/<uuid>/`.

![D-ID You architecture: browser wizard, Next.js API routes, local disk, and four external APIs](/blog/diagrams/d-id-you-ai-presenter-architecture.svg)

Reading left to right: the wizard uploads to `/api/videos`, which writes the file and a `manifest.json`. The shell then POSTs to `transcribe`, `knowledge` and `avatar` in order: Scribe v2 for the transcript, DeepSeek V3 for the summary and script, ElevenLabs TTS for character timings, and a D-ID Talk submission. The browser polls `/api/videos/<id>/presenter` every five seconds until the clip is ready.

The final step is `composite`. It downloads the D-ID clip, optionally generates a music bed with ElevenLabs Sound Generation, and spawns `ffmpeg-static` with one `filter_complex` for mask, overlay, captions and audio mix in one pass. Progress goes from ffmpeg's stderr into an in-memory map and out to the browser over Server-Sent Events.

Each layer and why:

| Layer | Choice | Why |
|---|---|---|
| UI framework | Pages Router UI, App Router API | RSC crashed with lucide-react |
| Transcription | ElevenLabs Scribe v2, word timestamps | Lines split on pauses and sentences |
| Script and summary | DeepSeek V3 via DeepInfra | JSON mode, already wired in |
| Subtitle timing | ElevenLabs `/with-timestamps` TTS | Real speech timing; 140 wpm fallback |
| Presenter render | D-ID Talks API | 12 seconds, not 15 to 30 minutes |
| Compositing | `ffmpeg-static` child process | One filter graph, one pass |
| Live progress | `-progress pipe:2` into a Map, served as SSE | Real encoder percentages |
| Storage | Local disk under `AVATARLENS_DATA_DIR` | Simplest option; weak on serverless |
| Networking | `lib/fetch-safe.ts` over `node:https` | Native fetch gave ECONNRESET on uploads |

## How it works

### Turning Scribe word timestamps into transcript lines

Scribe v2 returns a flat array of words with `start`, `end` and `type`. In `api/openai.ts`, `transcribeWithScribe` posts the whole video through `form-data` over a raw `https.request` and hands the words to `groupWordsIntoLines`. A line ends on a pause over 1.5 seconds, on sentence punctuation, or at 15 words. Each line keeps its first start and last end, so DeepSeek can pick a timestamped highlight for the `highlight` route.

### The script cap that never got wired in

The `avatar` route runs `getVideoDuration` on the original file (it spawns `ffmpeg -i` and parses the `Duration:` line), then calls `generatePresenterScript` with the transcript, summary, duration, style and language.

Here is the part I got wrong. The route imports `targetWordCount` from `api/subtitle.ts` and never calls it. Inside `generatePresenterScript` in `api/openai.ts`, the word budget is `Math.max(80, Math.round(durationMins * 140))`, from the full video length. A three minute video is asked for about 420 words, not 105. The cap lives in a helper, not in the request, while the ffmpeg flags downstream (`-t` and `eof_action=pass`) still assume a short clip. On a long upload that means a slow render and a presenter talking over most of the video.

Before submitting the Talk, the route calls `generateSrtFromElevenLabs`, which hits ElevenLabs `/v1/text-to-speech/{voiceId}/with-timestamps` and gets back three parallel arrays: characters, start times and end times. A loop in `api/subtitle.ts` rebuilds words from the characters, each word taking its first character's start and its last character's end, then chunks them seven at a time into SRT blocks. If the call fails, `generateSrt` estimates timing at 140 words per minute. The SRT only feeds burned-in captions.

### Submitting the Talk and polling it

`createTalk` in `api/did.ts` posts to D-ID `/talks` with the presenter image as `source_url` and an ElevenLabs voice provider. The returned ID gets a `talk_` prefix that routes the polling:

```ts
// api/did.ts
  const payload = await didJson("/talks", {
    method: "POST",
    body: JSON.stringify({
      source_url: sourceUrl,
      script: { type: "text", input: script, provider },
      config: { result_format: "mp4", fluent: true, pad_audio: 0 },
    }),
  }) as { id?: string };
  if (!payload?.id) throw new Error("D-ID did not return a talk id");
  return `talk_${payload.id}`;  // prefix so presenter route knows which API to poll
```

The `presenter` route reads `presenterClipId` from the manifest and checks its prefix. `talk_` means poll `/talks/{id}`; anything else means `/clips/{id}`. A `segments:` prefix covers an experimental four-clip mode the wizard never turns on (`segmentMode: false` is hard-coded).

### The ffmpeg filter graph

![One composite request from the browser through ffmpeg and back](/blog/diagrams/d-id-you-ai-presenter-flow.svg)

`compositePresenter` in `api/composite.ts` downloads the D-ID MP4 to a temp directory, reads the SRT if captions are on, and calls `runFfmpeg`. The video half of the graph:

```ts
// api/composite.ts
    const filterParts = [
      "[0:v]scale=1280:720[main]",
      `[1:v]scale=${scale}[sq]`,
      `[sq]format=rgba,geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='255*lt(pow(X-${r},2)+pow(Y-${r},2),pow(${r},2))'[pip]`,
      `[main][pip]overlay=${x}:${y}:eof_action=pass:format=auto${overlayLabel}`,
      ...(captionFilter ? [`${overlayLabel}${captionFilter}[v]`] : []),
      audioFilter,
    ];
    const filterComplex = filterParts.join(";");
```

The circle is the `geq` line. A browser preview can use CSS, but a file needs real alpha. The presenter stream is scaled to a square (240 px by default) and converted to RGBA, and `geq` sets each pixel's alpha to 255 inside the circle of radius `r` and 0 outside. `format=auto` on the overlay respects that alpha, and `eof_action=pass` keeps the main video going after the presenter ends.

The audio half took longer:

```ts
// api/composite.ts
function buildAudioFilter(audioMode: AudioMode, hasPresenter = true): string {
  if (audioMode === "original_only") return "[0:a]aresample=44100[a]";
  if (audioMode === "blend" && hasPresenter)
    // Resample both to 44100 + reset D-ID PTS offset before mixing
    return "[0:a]aresample=44100[a0];[1:a]aresample=44100,asetpts=PTS-STARTPTS[a1];[a0][a1]amix=inputs=2:duration=shortest:weights=0.3 0.7[a]";
  // presenter_only: reset PTS to 0 + resample + pad with silence so -t works without audio gap
  return "[1:a]aresample=44100,asetpts=PTS-STARTPTS,apad[a]";
}
```

D-ID's Talks MP4s do not start their audio at timestamp zero. The README records what my first composites sounded like: gap, audio, gap, about every half second. `asetpts=PTS-STARTPTS` resets the presenter audio to zero, `aresample=44100` matches the rates before `amix`, and `apad` extends the presenter track with silence. Instead of `-shortest`, the args pass `-t <original duration>` so the output is always full length.

Captions use `drawtext`, and I hit every ffmpeg escaping problem: apostrophes, colons, percent signs. The fix in `buildCaptionFilterWithFiles` is to keep text out of the filter. Each caption line goes to its own `cap_<i>_<ts>.txt` file, mapped to ASCII and referenced by a relative `textfile=` name, with ffmpeg's `cwd` set to the temp directory so no path needs escaping.

### Streaming progress out of a child process

ffmpeg runs with `-progress pipe:2`, which prints `out_time=` lines on stderr. `runFfmpeg` parses `Duration:` once, turns each `out_time=` into a percentage, and stores it in `progressStore`, a module-level `Map` keyed by video ID, capped at 98 until `progress=end`. The `composite-progress` route wraps that map in a `ReadableStream` that emits a `data:` event every 1.5 seconds.

## The hard parts

The Next.js split was a workaround I kept. The README records a webpack module factory crash traced to `lucide-react` under React Server Components, so the UI lives on the Pages Router and the API routes in the App Router. `next.config.mjs` also disables client `splitChunks` and `runtimeChunk` with no comment; my guess is the same fight. It works, but it is not a design.

The pivot left a mess. The code was called AvatarLens before the rename, and `components/avatarlens-shell.tsx`, the `AVATARLENS_` env vars and the type names still show it. The `docs/` folder describes that earlier RAG chat design; `api/rag.ts`, `components/chat-panel.tsx` and the stream routes are dead code.

TLS verification is the shortcut I most want to fix. `lib/fetch-safe.ts` and `instrumentation.ts` disable certificate checks only when `AVATARLENS_INSECURE_TLS=1` is set. But the two raw `https.request` calls, `transcribeWithScribe` in `api/openai.ts` and `uploadPresenterImage` in `api/did.ts`, hard-code `rejectUnauthorized: false` with no comment. Nothing in the repo says why. They should be gated on that flag, a one-line fix each.

The progress store and the disk storage are process-local, fine on a long-running Node server. On Vercel, where the hosted demo runs, each route can land on a different function instance, so the SSE endpoint may never see the map the composite route writes, and `.avatarlens` is not durable. The README also notes YouTube import fails there because `yt-dlp` is not on the serverless image.

The stage progress bars before compositing are fake: each stage has an `estSec` and a `setInterval` ticks toward a ceiling while the request runs. Only the compositing bar is real.

## What shipped

D-ID You was built for ElevenHacks Hack #11 on the D-ID track and pushed on June 4, 2026. No placement or award is recorded. The app is live at d-id-you.vercel.app, the source is public (MIT), and the README shows a before and after: a German YouTube video converted to English with an AI presenter over it. The README's timing table for a 30 MB upload puts the run at about 90 seconds: roughly 22 for Scribe, 20 for the script, 15 for D-ID and 30 for ffmpeg.

## What I would do differently

Wire `targetWordCount` into `generatePresenterScript`, so the script budget is the 45 seconds the README promises.

Move job state and the progress map somewhere shared. A Redis entry per video ID would let the SSE and composite routes run on different instances, and object storage would replace `.avatarlens`.

Run the stages on the server. The wizard drives the chain today, so a closed tab abandons the job halfway; a queue worker could run it while the browser subscribes. Then delete the dead code and try a PNG mask for the circle, since `geq` runs an expression per pixel per frame.

## Key takeaways

- When a media API has a fast mode with a length limit, cap your content to fit it, and check the cap is in the request, not only in a helper.
- ffmpeg's `geq` filter can punch alpha into a stream with one expression: test `pow(X-r,2)+pow(Y-r,2) < pow(r,2)` per pixel, write 255 or 0 to alpha, then overlay with `format=auto`.
- If a downloaded clip's audio stutters when mixed, check its PTS offset before blaming the codec. `asetpts=PTS-STARTPTS` is the fix the README records for D-ID's half-second gaps.
- Use `-t <duration>` rather than `-shortest` when one input is meant to be shorter, and `apad` the short audio so the mix does not end early.
- Never put user text inside an ffmpeg `drawtext` string. Write each line to a file, pass `textfile=`, and set ffmpeg's `cwd` to that directory.

## FAQ

### How does D-ID You add a presenter to a video?

D-ID You transcribes the video with ElevenLabs Scribe v2, asks DeepSeek V3 for a narration script, voices it through an ElevenLabs voice inside the D-ID Talks API, and uses ffmpeg to composite the talking-head clip as a circular overlay on the original. The output is one full-length MP4 with the presenter in the corner.

### Why is the D-ID You presenter script meant to be short?

D-ID You uses the D-ID Talks API, which is fast only for short clips, so the README caps the script at 45 seconds, about 105 words. In the shipped code that cap is a helper that is imported but never called, so the script is sized to the full video instead.

### How does D-ID You make the presenter circular in the MP4?

D-ID You scales the presenter clip to a square, converts it to RGBA, and runs ffmpeg's `geq` filter with an alpha expression that returns 255 inside a circle of radius `r` and 0 outside. The masked stream goes onto the main video with `overlay` and `format=auto`, so the corners show the video underneath.

## Links

- Live demo: [d-id-you.vercel.app](https://d-id-you.vercel.app)
- Source: [github.com/anirxdh/D-ID-You](https://github.com/anirxdh/D-ID-You)
