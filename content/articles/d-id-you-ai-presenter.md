---
draft: true
title: "Putting a Talking AI Presenter Inside Any Video With ffmpeg and D-ID"
description: "How D-ID You turns an uploaded video into a narrated MP4 with a circular AI presenter, using ElevenLabs, DeepSeek V3, D-ID Talks and one long ffmpeg filter."
date: 2026-09-30
slug: d-id-you-ai-presenter
project: "D-ID You"
tags: [D-ID, ElevenLabs, ffmpeg, Next.js, Video AI, Hackathon]
repo: https://github.com/anirxdh/D-ID-You
live: https://d-id-you.vercel.app
accent: "#c77dff"
summary: "D-ID You takes a screen recording or YouTube link and returns an MP4 with a circular AI presenter narrating it in the corner. This is the story of a hackathon pivot, a five-service media pipeline, and the ffmpeg filter that holds it together."
---

## Fifteen hours left and a project I did not believe in

On the night of June 3, 2026, I had a half-built hackathon entry and a deadline the next afternoon. The ElevenHacks Hack #11 D-ID track had one prompt: build an AI agent where the visual experience is essential, not optional. My first attempt was a private project called ElseWhere, a live D-ID avatar you could talk to inside a generated Mars colony. It depended on a WebRTC session behaving at the exact moment a judge pressed play, and I did not trust that moment. I shelved it and started a new repo a little after midnight.

D-ID You is a Next.js web app that turns any uploaded video into a narrated presentation by compositing a circular talking AI presenter into the MP4, built by Anirudh Vasudevan for ElevenHacks Hack #11, D-ID track. You upload a screen recording or paste a YouTube link. About ninety seconds later (per the README's timing table on a 30 MB file) you download a video where a presenter in the corner explains what you are watching, in a voice, style and language you picked.

Most demos and lectures are screen recordings with nobody in them. Adding a presenter normally means re-recording or post-production. I wanted a pipeline that did it for you, and I wanted the result to be a file.

## Why a rendered file instead of a live avatar

The obvious approach, and the one ElseWhere used, was D-ID's streaming API: open a WebRTC session, push text, watch the avatar speak live. Those stream routes are still in the repo under `app/api/avatar/` as dead code. I dropped that path because a live stream gives you nothing to download or share.

The second option was D-ID Clips V3 Pro, which renders a presenter for the whole video. The README records what I saw: a three minute video took 15 to 30 minutes to come back.

The third option, the one I shipped, was the D-ID Talks API. Talks takes a still image and a script, voices it through an ElevenLabs voice, and returns a short talking-head MP4 in roughly 12 seconds. The trade is that the clip has to be short. In `api/subtitle.ts`, `MAX_PRESENTER_SECONDS` is 45 and `targetWordCount` converts that to about 105 words at 140 words per minute. The presenter talks for 45 seconds and the original video keeps playing underneath in full. That one constraint, driven by render latency, shaped everything downstream.

For the language model I kept DeepInfra, already wired in from the earlier design, and pointed it at `deepseek-ai/DeepSeek-V3` through its OpenAI-compatible chat endpoint, which supports the JSON mode the summary step needs. I did not benchmark alternatives. There was no time.

## What a user actually does

D-ID You opens on a four-step wizard. Step one is the upload: an mp4, mov or webm up to 500 MB, or a YouTube URL. Step two is the presenter. The picker calls `/api/presenters`, which proxies D-ID's `/clips/presenters` endpoint, and shows every presenter with a hover video preview. Step three is voice and style: 16 ElevenLabs voices from `lib/elevenlabs-voices.ts`, filtered by the presenter's gender, plus a narration style (professional, teacher, excited host, calm narrator), one of six languages, a layout, an audio mode and an optional music mood. Step four confirms it.

Then the pipeline transcribes, writes the script and creates the presenter. You can edit the script and regenerate. Once the D-ID clip is ready, compositing starts and a progress bar fills from ffmpeg's own output. At the end you get one MP4, a share link, and a 30 to 60 second highlight clip that DeepSeek picks from the transcript.

## Architecture

D-ID You is one Next.js 15 app with an unusual split: the UI runs on the Pages Router (`pages/app.tsx` mounts `components/avatarlens-shell.tsx`) while every API route lives in the App Router. The pipeline is orchestrated from the browser, and each job lives on local disk under `.avatarlens/videos/<uuid>/`.

![D-ID You architecture: browser wizard, Next.js API routes, local disk, and four external APIs](/blog/diagrams/d-id-you-ai-presenter-architecture.svg)

Reading left to right: the wizard uploads to `/api/videos`, which writes the file and a `manifest.json`. The shell then POSTs to `transcribe`, `knowledge` and `avatar` in sequence: Scribe v2 for the transcript, DeepSeek V3 for the summary and then the script, ElevenLabs TTS for word timings, and a D-ID Talk submission. The browser polls `/api/videos/<id>/presenter` every five seconds until the clip is done.

The final step is `composite`. It downloads the D-ID clip, optionally generates a music bed with ElevenLabs Sound Generation, and spawns `ffmpeg-static` with one `filter_complex` that does the mask, overlay, captions and audio mix in a single pass. Progress is parsed from ffmpeg's stderr into an in-memory map and streamed to the browser over Server-Sent Events.

Each layer and why:

| Layer | Choice | Why |
|---|---|---|
| UI framework | Pages Router for pages, App Router for API | Next 15 RSC crashed with lucide-react; moving the UI off RSC fixed it |
| Transcription | ElevenLabs Scribe v2, word timestamps | Group lines by pauses and sentence ends |
| Script and summary | DeepSeek V3 via DeepInfra | OpenAI-compatible, JSON mode, already wired in |
| Subtitle timing | ElevenLabs `/with-timestamps` TTS | Real speech timing; 140 wpm fallback |
| Presenter render | D-ID Talks API | About 12 seconds versus 15 to 30 minutes for Clips V3 Pro |
| Compositing | `ffmpeg-static` child process | One filter graph for mask, overlay, captions, audio |
| Live progress | `-progress pipe:2` into a Map, served as SSE | Real encoder percentages |
| Storage | Local disk under `AVATARLENS_DATA_DIR` | Simplest thing that worked; weak on serverless |
| Networking | `lib/fetch-safe.ts` over `node:https` | Native fetch gave ECONNRESET on big uploads |

## How it works

### Turning Scribe word timestamps into transcript lines

Scribe v2 returns a flat array of words with `start`, `end` and `type`. In `api/openai.ts`, `transcribeWithScribe` posts the whole video through `form-data` over a raw `https.request` and hands the words to `groupWordsIntoLines`. A line ends on a pause over 1.5 seconds, on sentence punctuation, or at 15 words. Each line keeps its first start and last end, so the transcript is already timestamped when DeepSeek picks a highlight segment for the `highlight` route to trim.

### The 45-second script and the subtitle alignment

The `avatar` route runs `getVideoDuration` on the original file (it spawns `ffmpeg -i` and parses the `Duration:` line), then calls `generatePresenterScript` with the transcript, summary, duration, style and language. The prompt bans "Welcome" openers and asks for prose at 140 wpm.

Before submitting the Talk, the route calls `generateSrtFromElevenLabs`, which hits ElevenLabs `/v1/text-to-speech/{voiceId}/with-timestamps` and gets back three parallel arrays: characters, start times and end times. The code rebuilds words from the characters, then chunks them seven at a time into SRT blocks:

```ts
// api/subtitle.ts
    if (ch === " " || ch === "\n") {
      if (currentWord) {
        words.push({ word: currentWord, start: wordStart, end: ends[i - 1] ?? ends[i] });
        currentWord = "";
      }
    } else {
      if (!currentWord) wordStart = starts[i];
      currentWord += ch;
    }
  }
```

If the call fails or returns no alignment, `generateSrt` estimates timing at 140 words per minute instead. The SRT is only used for burned-in captions.

### Submitting the Talk and polling it

`createTalk` in `api/did.ts` posts to D-ID `/talks` with the presenter image as `source_url` and an ElevenLabs voice provider. The returned ID gets a `talk_` prefix, which is the whole routing mechanism for polling:

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

The `presenter` route reads `presenterClipId` from the manifest and checks the prefix. `talk_` means poll `/talks/{id}`; anything else means `/clips/{id}`. A `segments:` prefix covers an experimental four-clip mode the wizard leaves off because it uses the slow Clips API.

### The ffmpeg filter graph

![One composite request from the browser through ffmpeg and back](/blog/diagrams/d-id-you-ai-presenter-flow.svg)

`compositePresenter` in `api/composite.ts` downloads the D-ID MP4 to a temp directory, reads the SRT if captions are on, and calls `runFfmpeg`. The video half of the filter graph:

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

The circle is the `geq` line. CSS `border-radius: 50%` works for the browser preview, but a file needs real alpha. The presenter stream is scaled to a square (240 px by default), converted to RGBA, and `geq` sets each pixel's alpha to 255 inside the circle of radius `r` and 0 outside. The overlay uses `format=auto` so the alpha is respected, and `eof_action=pass` so the main video keeps going after the presenter clip ends.

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

D-ID's Talks MP4s do not start their audio at timestamp zero. My first composites had a stutter: a short gap, then audio, then a gap, repeating. `asetpts=PTS-STARTPTS` resets the presenter audio to zero, `aresample=44100` matches the rates before `amix`, and `apad` extends the presenter track with silence. On the command line, instead of `-shortest`, the args pass `-t <original duration>` so the output is always full length.

Captions use `drawtext`, and I hit every escaping problem ffmpeg has: apostrophes, colons, percent signs. The fix in `buildCaptionFilterWithFiles` is to never put text in the filter. Each caption line goes to its own `cap_<i>_<ts>.txt` file, mapped to ASCII, referenced with `textfile=` and a relative name, and ffmpeg runs with `cwd` set to the temp directory so there is no path to escape either.

### Streaming progress out of a child process

ffmpeg is started with `-progress pipe:2`, which prints `out_time=` lines on stderr about once a second. `runFfmpeg` parses `Duration:` once, then turns each `out_time=` into a percentage in `progressStore`, a module-level `Map` keyed by video ID, capped at 98 until `progress=end` sets it to 100. The `composite-progress` route wraps that map in a `ReadableStream` that reads the entry every 1.5 seconds and emits `data:` events with `text/event-stream` headers. The browser opens that stream right before it POSTs to `composite`, and the entry is held for four seconds after completion so the client sees 100 percent.

## The hard parts

The Next.js split was an accident I turned into a decision. The UI started in the App Router and crashed at runtime with a webpack module factory error traced to `lucide-react` under React Server Components. Moving the pages to the Pages Router fixed it; `next.config.mjs` also disables client `splitChunks` for the same reason. It works, but it is not a design.

The pivot left a mess. The repo was called AvatarLens for most of the night, and names like `components/avatarlens-shell.tsx` still show it. The `docs/` folder describes an earlier RAG chat design, and `api/rag.ts`, `components/chat-panel.tsx` and the WebRTC routes are dead code.

TLS verification is the shortcut I most want to fix. `lib/fetch-safe.ts` and `instrumentation.ts` only disable certificate checks when `AVATARLENS_INSECURE_TLS=1` is set, as documented. But the two raw `https.request` calls, `transcribeWithScribe` in `api/openai.ts` and `uploadPresenterImage` in `api/did.ts`, hard-code `rejectUnauthorized: false`. That was a workaround for a dev machine whose antivirus broke TLS, and it should be gated on the same flag. It is a one-line fix in each file.

The progress store and the disk storage are process-local. On a long-running Node server they are fine. On Vercel, where the hosted demo runs, each route can land on a different function instance, so the SSE endpoint may never see the map the composite route writes to, and `.avatarlens` is not durable. The README also notes that YouTube import does not work there, because `yt-dlp` is not on the serverless image.

The stage progress bars before compositing are fake. Each stage has an `estSec` and a `setInterval` ticks the bar toward a ceiling while the request is in flight. Only the compositing bar reads real numbers.

## What shipped

D-ID You was submitted to ElevenHacks Hack #11 on the D-ID track on June 4, 2026. No placement or award is recorded. The app is live at d-id-you.vercel.app, the source is public under the MIT license, and the README includes a before and after demo: a German YouTube video converted to English with an AI presenter over it. The README's timing table, measured on a 30 MB upload, puts the run at about 90 seconds: roughly 22 for Scribe, 20 for the script, 15 for the D-ID render and 30 for ffmpeg.

## What I would do differently

Move job state and the progress map to something shared. A Redis entry per video ID would let the SSE and composite routes run on different instances, and object storage would replace the `.avatarlens` folder.

Gate the two `rejectUnauthorized: false` calls on the same flag as everything else, or route them through `safeFetch`.

Run the stages on the server. Right now the wizard drives the chain, and a closed tab abandons the job halfway. A queue worker could run it while the browser subscribes.

Delete the dead code, and try a PNG mask for the circle, since `geq` evaluates an expression per pixel per frame.

## Key takeaways

- When a media API offers a fast mode with a length limit and a slow mode without one, cap your content to fit the fast mode and design around the cap.
- ffmpeg's `geq` filter can punch arbitrary alpha into a stream with one expression. For a circle, test `pow(X-r,2)+pow(Y-r,2) < pow(r,2)` per pixel, write 255 or 0 to alpha, then overlay with `format=auto`.
- If a downloaded clip's audio stutters when mixed, check its PTS offset before blaming the codec. `asetpts=PTS-STARTPTS` fixed every gap I saw.
- Use `-t <duration>` rather than `-shortest` when one input is intentionally shorter, and add `apad` to the short audio so the mix does not end early.
- Never put user text inside an ffmpeg `drawtext` filter string. Write each line to a file, pass `textfile=`, and set ffmpeg's `cwd` to that directory.
- `ffmpeg -progress pipe:2` is enough for a real progress bar. Parse `Duration:` once and `out_time=` per chunk, then stream the percentage over SSE.

## FAQ

### How does D-ID You add a presenter to a video?

D-ID You transcribes the video with ElevenLabs Scribe v2, asks DeepSeek V3 for a short narration script, voices it through an ElevenLabs voice inside the D-ID Talks API, and uses ffmpeg to composite the talking-head clip as a circular overlay on the original video. The output is one MP4 with the presenter in the corner for 45 seconds and the original video playing in full.

### Why does the D-ID You presenter only speak for 45 seconds?

D-ID You uses the D-ID Talks API because it renders a clip in about 12 seconds, where Clips V3 Pro took 15 to 30 minutes for a three minute video. Talks suits short scripts, so the narration is capped at 45 seconds, about 105 words via `targetWordCount` in `api/subtitle.ts`.

### How does D-ID You make the presenter circular in the MP4?

D-ID You scales the presenter clip to a square, converts it to RGBA, and runs ffmpeg's `geq` filter with an alpha expression that returns 255 inside a circle of radius `r` and 0 outside. The masked stream is placed on the main video with `overlay` and `format=auto`, so the transparent corners show the video underneath.

## Links

- Live demo: [d-id-you.vercel.app](https://d-id-you.vercel.app)
- Source: [github.com/anirxdh/D-ID-You](https://github.com/anirxdh/D-ID-You)
