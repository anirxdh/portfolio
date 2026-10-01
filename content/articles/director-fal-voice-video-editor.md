---
draft: true
title: "The Video Editor You Talk To, Compiled to One ffmpeg Command"
description: "How I built Director, a voice-directed video editor where a LiveKit agent casts characters, renders shots on fal, and edits an ffmpeg timeline by tool call."
date: 2026-09-30
slug: director-fal-voice-video-editor
project: "Director (fal x Sequoia hackathon)"
tags: [Voice AI, LiveKit, ffmpeg, fal, Next.js, Agents]
repo: https://github.com/anirxdh/Director-FAL
accent: "#ffd166"
summary: "Director is a voice-driven video studio built in 72 hours: a Python LiveKit agent talks you through story, cast, and shots, then applies edits through a pure-functional timeline engine that compiles to a single ffmpeg filter graph. Here is how the pieces fit and what was hacky."
---

## The sentence I wanted to say to a video editor

The whole project started from one sentence. "Around fifteen seconds, make her say I really love you instead." I wanted to say that out loud, see the timeline flash the right range before I finished talking, and watch the fixed clip drop in. No scrubbing, no dragging, no menus.

Director is a voice-directed AI video editor that lets you brainstorm a story, cast characters, render shots, and then edit the result by talking to a LiveKit agent, built by Anirudh Vasudevan for the fal x Sequoia 72-hour video hackathon (developer track, July 17 to 19, 2026). The agent calls fal for images and video, ElevenLabs for every voice, and a local ffmpeg engine for the actual cuts.

I was one person with three days, so the spec I wrote on the first night had a rule I kept rereading: one happy path, and if it does not appear in the three minute demo, it does not get built. The judging weights in the spec (technical execution 35 percent, creativity 25, user value 25, demo 15) pushed me toward making the editing mechanism itself the interesting part.

## Why the edit engine is pure data and not a fal job

The obvious approach was to let fal do everything. fal has an ffmpeg compose endpoint that takes tracks and keyframes and returns a finished video. Every edit becomes "rebuild the keyframe list, resubmit, wait for a URL."

I did not pick it, for three reasons. Latency: a remote compose job for every trim would leave the agent talking over dead air. Keys: I did not have working fal credits until late, and I needed to build the editing surface before any key existed. Range: I wanted crossfades, speed ramps, text presets, and music ducking, and I already knew how to say those as an ffmpeg filter graph.

So I split generation from editing. Generation (portraits, stills, image-to-video, lipsync, music) goes through a `Media` interface in `agent/src/media.py` with two backends: `FalMedia` for real calls and `MockMedia` for placeholder URLs. Editing lives in `agent/src/engine/`: a plain-data `Timeline`, fifteen pure operations, and one renderer that compiles the timeline into a single ffmpeg command. The agent's tools are thin wrappers over both.

The payoff was testability. With the engine on its own, I could render real mp4 files from a keyless REPL on night one and check them with ffprobe in pytest. The voice and fal layers could be wrong and the editor would still be provably right.

## What a session looks like

Director runs on localhost. A `dev.sh` script starts three processes: `livekit-server --dev`, the Python agent, and the Next.js app. You open the landing page, click Enter Studio, and press the talk orb.

1. The agent greets you by voice and asks what you are making. You riff until it locks a logline, scene, and style with `set_story`.
2. It builds a reference sheet per character with `create_character`: a hero portrait plus a four-emotion expression grid, shown in the Cast tab.
3. It proposes three or four shots and calls `plan_shots`, which renders a storyboard still for each. Shot blocks appear on the timeline strip, colored by status.
4. After you approve the storyboard by voice, it calls `render_all`. Each shot goes image-to-video; shots with dialogue get an ElevenLabs line and a fal lipsync pass. The agent narrates progress while this runs.
5. You watch the cut in the preview player, which auto-advances through the shots.
6. You say "around fifteen seconds, make her say I really love you instead." The agent calls `highlight` first, so the strip flashes amber over that range, then `replace_segment` to produce a new take.
7. You say "export" and the engine renders 16:9, 9:16, 1:1, and an 8 second loop. Download cards appear in the Exports tab.

Without keys, `/studio` does not pretend. It renders a setup screen listing the missing environment variables and the commands to run. The spec calls this "no fake product" and `frontend/app/studio/page.tsx` enforces it.

## Architecture

Director is a monorepo with two halves. `frontend/` is a Next.js 15 app started from the LiveKit agent-starter-react template. `agent/` is a Python LiveKit Agents 1.6 process started from agent-starter-python. They share a room on a local `livekit-server` and talk over WebRTC audio plus a reliable data channel. There is no database; one `ProjectState` object in the agent process is mirrored to disk and to the browser after every change.

![Director architecture: browser studio, local LiveKit agent with edit engine, and external model APIs](/blog/diagrams/director-fal-voice-video-editor-architecture.svg)

Reading left to right: the browser ships mic audio to the agent through LiveKit. Inside the agent, `AgentSession` runs Deepgram nova-3 for speech-to-text, Anthropic Claude for conversation and tool calls, and ElevenLabs Flash v2.5 for the director's voice. Tool calls land in `agent/src/tools.py`, which either asks the media layer to generate something or applies an engine op to the session timeline. Either way the last thing a tool does is `publish_state`, which sends `ProjectState` to the room on the `state_update` topic.

The browser's job is to render that JSON. `frontend/lib/project-state.ts` listens for the topic and merges each payload into a `useReducer` store. The preview player, timeline strip, right panel, and talk orb are all pure functions of what the agent last published.

The main choices and why they are there:

| Layer | Choice | Why |
|---|---|---|
| Transport | `livekit-server --dev` on localhost | No cloud account; `devkey`/`secret` prefilled in both env examples |
| Voice pipeline | Deepgram nova-3, Claude via `anthropic.LLM`, ElevenLabs `eleven_flash_v2_5` | LiveKit plugins wire all three into one `AgentSession` with turn detection |
| Agent to UI sync | `publish_data(reliable=True, topic="state_update")` | One JSON document after every mutation; frontend is a pure renderer |
| Crash recovery | `agent/project_state.json` written on every publish | Spec said no database; a file is enough for one session |
| Generation | `fal_client.subscribe_async` on flux/schnell, Kling 2.1, sync-lipsync v2, stable-audio | Sponsor APIs; one model id constant per job type in `media.py` |
| Dialogue lines | ElevenLabs REST, uploaded to fal CDN | fal CDN is the only file storage the project has |
| Edit model | `Timeline` dataclass with lossless JSON round trip | Renderer can be swapped without touching ops or tools |
| Renderer | Local ffmpeg, one `filter_complex`, libx264 veryfast crf 19 | Deterministic, keyless, demo-fast at 720p |
| Studio shell | Next.js 15, React 19, `@livekit/components-react`, motion | Template gave me session hooks; motion gave me the highlight flash |

## How it works

### One state document, published after every tool call

`agent/src/state.py` holds a module-level `STATE` of type `ProjectState`: phase, story, characters, shots, highlight, exports, transcript, the assembled `timeline_url`, the engine `Timeline`, and a changelog. Every tool mutates it and awaits `publish_state`. The serializer trims the two unbounded lists so the packet stays under LiveKit's reliable data limit.

```python
# agent/src/state.py
    def to_dict(self) -> dict[str, Any]:
        data = asdict(self)
        # keep the reliable data packet comfortably under the 15KiB limit
        data["transcript"] = data["transcript"][-100:]
        data["timeline"] = _timeline_dict(self.timeline)
        data["changelog"] = data["changelog"][-CHANGELOG_PUBLISHED:]
        return data
```

`_timeline_dict` precomputes each clip's `start` and `duration`, so a client never has to redo crossfade overlap math. The transcript is filled by a `conversation_item_added` hook in `agent/src/agent.py` that appends each utterance and fires a background publish.

### A tool call that highlights before it answers

The moment I most wanted to land was the instant highlight. The system prompt in `agent.py` tells the model: when the user references a moment in time, call `highlight` with that range immediately, before you even reply. The tool sets `STATE.highlight`, publishes, and returns a sentence.

![One voice edit flowing from speech through Claude, highlight, replace_segment, and back to the studio](/blog/diagrams/director-fal-voice-video-editor-flow.svg)

On the browser side, `frontend/components/studio/timeline.tsx` draws the strip at 44 pixels per second and wraps the highlight overlay in `AnimatePresence`, so when `highlight` goes from null to a range an amber band fades in and pulses. Then `replace_segment` does the slow part (a new ElevenLabs line, a lipsync pass, a new assemble) inside `ctx.with_filler(...)`, so the agent keeps talking while fal works. When the shot returns, the tool swaps the new media in with `replace_clip_media`, clears the highlight, and publishes again.

`render_all` uses the same pattern: `ctx.update()` between shots ("Shot 2 of 4 is in the can") and a filler line after 8 seconds of silence, repeating every 15. That is how a voice agent survives a 30 second render without the user wondering if it died.

### Fifteen pure edits that each return a sentence

Every function in `agent/src/engine/ops.py` has the same shape: take a `Timeline` and arguments, deep-copy, validate, return a new `Timeline` plus a `ChangelogEntry`. The entry's `summary` is written to be spoken: "Split 's2' at 15s into 's2' and 's2-b'." The agent reads it back verbatim.

Here is the heart of `split_clip`. Timeline time is not source time once a clip has a speed, so the cut point is mapped through `speed` before the halves are built.

```python
# agent/src/engine/ops.py
    src_at = clip.in_point + (at - start) * clip.speed
    second = Clip(
        clip_id=_unique_clip_id(tl, f"{clip.clip_id}-b"),
        src=clip.src,
        in_point=src_at,
        out_point=clip.out_point,
        speed=clip.speed,
    )
    clip.out_point = src_at
    tl.clips.insert(tl.clips.index(clip) + 1, second)
```

Validation errors are plain sentences too: "A 3.5s crossfade needs both neighbours longer than that (shortest is 3s)." The `_apply` helper in `tools.py` catches `ValidationError` and returns the message as the tool result, so the model speaks the correction and moves on.

Because ops never mutate input, undo came for free. `state.apply_edit` pushes the outgoing timeline onto a stack capped at 20, and `undo_last` pops it. The spec said no undo stack; it cost about ten lines, so it went in.

### Compiling a timeline into one filter graph

`agent/src/engine/render.py` is the only module that touches ffmpeg. `build_render_command` walks the timeline and emits a single `filter_complex`. Each clip gets a normalization chain: `trim`, `setpts` for speed, `fps`, `scale` with `force_original_aspect_ratio=increase` then `crop` for a center-crop reframe, and `format=yuv420p`. Clips without audio get a silent `anullsrc` bed so every later step has something to mix.

Then clips are folded left to right. A clip with a `transition_in` gets `xfade` and `acrossfade` with an offset computed from elapsed program time; otherwise it is a hard `concat`.

```python
# agent/src/engine/render.py
        if clip.transition_in is not None:
            dur = clip.transition_in.duration
            chains.append(
                f"[{v_label}][v{i}]xfade=transition=fade:duration={_f(dur)}"
                f":offset={_f(elapsed - dur)}[vx{i}]"
            )
            chains.append(f"[{a_label}][a{i}]acrossfade=d={_f(dur)}[ax{i}]")
            v_label, a_label = f"vx{i}", f"ax{i}"
            elapsed += clip.duration - dur
```

Text is burned in with `drawtext`. The three presets (title, lower-third, caption) size font, margins, box padding, and shadow as fractions of the frame's short edge, so the same overlay reads correctly in 16:9, 9:16, and 1:1. User text gets two levels of backslash escaping because ffmpeg parses filter option values twice.

Music is the part I am most pleased with. There is no sidechain compressor. Captions mark dialogue intervals, and the music gets a per-frame `volume` expression that drops 12 dB whenever the playhead is inside any caption range.

```python
# agent/src/engine/render.py
    base = 10.0 ** (timeline.music.gain_db / 20.0)
    intervals = timeline.captions if timeline.music.duck_under_dialogue else []
    if not intervals:
        return f"volume={_f(base)}"
    ducked = base * 10.0 ** (_DUCK_DB / 20.0)
    cond = "+".join(f"between(t,{_f(c.start)},{_f(c.end)})" for c in intervals)
    return f"volume='if(gt({cond},0),{_f(ducked)},{_f(base)})':eval=frame"
```

Speeds outside ffmpeg's per-stage `atempo` range of 0.5 to 2.0 are handled by chaining stages, so 0.25x and 4x stay pitch-correct. The command ends with libx264 veryfast, crf 19, aac 192k, and `+faststart`.

### Proving it without keys

The engine has 23 pytest tests in `agent/tests/test_engine.py`. Most check op behavior: splits account for speed, reorder to the front drops a transition, ops never mutate input, JSON round trips. Two are real renders. They apply split, trim, reorder, speed, title, lower-third, caption, crossfade, and music to two segments of a bundled clip, render 16:9 and 9:16, and verify both with ffprobe (both streams present, exact resolution, duration within 0.35 seconds). One assertion checks the compiled command is identical across two calls.

`agent/src/repl.py` drives the same engine from a terminal, and `--script demo` renders an mp4 with no keys. `scripts/state_demo.py` replays a scripted `state_update` sequence into a local LiveKit room so the studio UI can be exercised with no agent and no model keys.

## The hard parts

The real fal path is marked `UNTESTED WITHOUT KEYS` at the top of `media.py`, and several argument shapes carry comments saying they need confirming against fal's model pages. I built the mock backend first and proved the voice and edit loop against placeholders. I cannot claim the end-to-end generation pipeline was validated during the hackathon window.

The frontend does not render the engine timeline. `state.py` publishes `timeline` and `changelog` keys, but the `ProjectState` type in `project-state.ts` never declares them, and the studio strip draws shot blocks from `shots`. So "speed up shot two" is applied in the engine, spoken back, and visible in the exported mp4, but the on-screen timeline does not move.

The placeholder art was never regenerated. The spec's final milestone said to replace every placeholder with fal output before submission. That did not happen, so the landing page and mock mode still use imagery adapted from an earlier project of mine. None of it is product output and none of it appears here.

Two smaller ones: the token route is the template's dev-only minter and throws outside `NODE_ENV=development`, and `probe_media` is wrapped in `lru_cache` keyed on path, which is wrong the moment a file at that path changes. The render tests call `cache_clear()` by hand.

## Results

Director was built solo during the fal x Sequoia 72-hour hackathon, developer track, July 17 to 19, 2026. The repo's last push is July 18. No award or placement is recorded.

What shipped: the voice pipeline on LiveKit, a 23-tool agent surface, the pure-functional edit engine with a deterministic ffmpeg compiler, the Next.js studio with live state sync, the setup screen, a keyless REPL, and 23 engine tests including real renders verified with ffprobe. There is no live URL.

## What I would do differently

Render the engine timeline in the studio. The data is already in every `state_update`; the strip should draw `timeline.clips` with their precomputed starts and show text overlays and the music bed as lanes. That one change would make every editing tool visible.

Validate the fal argument shapes on day one with a tiny script per model. Mock-first was right for the engine but it let the real media path drift.

Key the `probe_media` cache on path plus mtime, and regenerate the placeholders through the product itself; it was in the spec and I ran out of time.

## Key takeaways

- Separate generation from editing. Put slow, paid, remote calls behind one interface and keep the editing model as plain data a local tool can render. You can then test the editor with no keys and swap the renderer later.
- Make every mutation return a spoken sentence. If tool results and validation errors are already prose, a voice agent needs no summarization step and users hear exactly what changed.
- Publish one state document, not events. A reducer that merges a full snapshot cannot drift, and a size budget on unbounded lists keeps it under the transport's packet limit.
- Compile, do not script. One deterministic `filter_complex` built from a data model means identical timelines produce identical, testable commands.
- Immutable ops make undo a stack of old values. Snapshotting the previous state costs one list append.
- Tell the agent to act before it speaks. For instant UI feedback, instruct the model to call the cheap visual tool first and discuss second.

## FAQ

### How does Director keep the timeline in sync with the voice agent?

Director keeps one `ProjectState` object in the Python agent process. Every tool call mutates it and then calls `publish_state`, which serializes it to JSON, writes it to `agent/project_state.json`, and sends it on a reliable LiveKit data channel with the topic `state_update`. The Next.js studio merges each payload into a `useReducer` store and holds no business state of its own, so it cannot disagree with the agent.

### How does Director turn a voice edit into an ffmpeg command?

Director models an edit as a `Timeline` dataclass: an ordered list of clips with source in and out points, speed, and an optional crossfade, plus text overlays, captions, and a music track. Each edit is a pure function in `engine/ops.py` that returns a new timeline. `engine/render.py` compiles that timeline into a single ffmpeg `filter_complex`: per-clip trim and speed, a left-to-right fold using `xfade` or `concat`, `drawtext` overlays, and a looped music input whose volume ducks during captions.

### Does Director need a cloud account to run?

No. Director runs on localhost with `livekit-server --dev`, which needs no LiveKit account. You bring your own keys for Anthropic, Deepgram, ElevenLabs, and fal. Without them the studio page shows a setup screen rather than a simulated demo, and the edit engine can still be exercised through a REPL and pytest, which render real mp4 files from a bundled clip.

### What AI models does Director use?

Director uses Deepgram nova-3 for speech-to-text, Anthropic Claude for conversation and tool calling (the model id in `agent/src/agent.py` can be overridden with `DIRECTOR_LLM_MODEL`), and ElevenLabs Flash v2.5 for the director's voice and character dialogue. On fal it calls flux/schnell for portraits and stills, Kling 2.1 image-to-video for shots, sync-lipsync v2 for dialogue replacement, and stable-audio for music beds.

## Links

- Source: [github.com/anirxdh/Director-FAL](https://github.com/anirxdh/Director-FAL)
