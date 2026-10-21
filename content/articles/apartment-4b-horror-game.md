---
title: "How Apartment 4B Bakes an Entire Horror Game Into Static Files"
description: "Apartment 4B is a browser horror game whose voices, screams and theme music were generated with ElevenLabs ahead of time, so the site never calls an API."
date: 2026-10-17
slug: apartment-4b-horror-game
project: "Apartment 4B"
tags: [Three.js, React Three Fiber, ElevenLabs, Howler.js, Zustand, Game Dev]
award: "3rd Place, ElevenHacks (ElevenLabs x Zed)"
repo: https://github.com/anirxdh/Apartment-4B
live: https://apartment-4b.netlify.app
screenshot: /blog/shots/apartment-4b-horror-game.webp
accent: "#aa3c30"
summary: "Apartment 4B is a first-person horror puzzle game built in React Three Fiber for ElevenHacks. Every voice line, scream and music cue was generated ahead of time and committed as MP3s, so the shipped site is a static bundle with zero runtime API calls."
---

## Two in the morning, and a scream from upstairs

Apartment 4B is a first-person lo-fi horror puzzle game that runs in the browser, built by Anirudh Vasudevan for ElevenHacks, the hackathon sponsored by ElevenLabs and Zed. You play Joe. It is 2 AM, you hear a scream from upstairs, you go up to check on your neighbor, and the door locks behind you. Five cassette tapes hide the clues to four locks. The README calls it a 36-hour build.

"Hi... whoever's listening to this. My name is Mrs. Hollis." That line sits in a TypeScript array in `scripts/generate-audio.ts`. The script posts it to the ElevenLabs API and writes the first tape to disk as an MP3: an old woman I had invented, telling me she was scared.

One constraint shaped everything: judges would open a URL. If it stalled on a text-to-speech call or leaked an API key, the game was dead. So Apartment 4B has no server and makes no API calls at runtime. Every voice, scream and music cue is a file on disk.

## Why every sound is a file on disk

The obvious approach for an ElevenLabs hackathon is to call ElevenLabs from the browser: stream a voice line when the player picks up a tape.

Three things killed it. Latency, because a tape pickup has to play instantly or the horror beat collapses. The key, because a static site cannot hide one and I did not want a proxy server. Reliability, because a judging room's network is not mine to control.

So I treated ElevenLabs as a build tool. Four Node scripts under `scripts/` call the text-to-speech, sound-generation and music endpoints and write MP3s into `public/audio/` and `src/`. Those MP3s are committed and Netlify serves them. The `.env.example` says the key is used only by build-time scripts, never at runtime. The ambient wind, footsteps, and the gore and scream stingers were generated in ElevenLabs and committed directly rather than through the scripts.

The other constraint was art. With no artist, Apartment 4B has no glTF files, and the only image files used as textures are the two sponsor logo PNGs (Zed and ElevenLabs) on the walls. Every room is React Three Fiber primitives, and everything else is painted onto a canvas at runtime.

## What the player actually does

You hold a button on the start screen for three seconds; that press is the user gesture that unlocks the audio context. An eight-panel cold open plays, then you wake on a couch with the camera swaying because Joe has been drinking. F lights the lighter, the only light in the game that casts shadows. You climb to Apartment 4B and the door slams behind you.

Mrs. Hollis's body is on the kitchen floor. Tape 1 opens the cabinet, which holds tape 2, which points at the closet and tape 3. Tape 3 says the chest code is the year she was born but never says the year; the bedroom calendar does. Tape 4 leads to a five-color pattern that opens the fridge and tape 5.

After tape 4 the body disappears and Margaret's Theme fades in. Margaret is the name Mrs. Hollis admits to on tape 5. After tape 5 the front-door key spawns where the body lay. Picking it up starts a heartbeat that speeds up over the next 45 seconds while you walk to the door. Turning the key triggers a jumpscare, an outro video and credits, then you land back on the start screen. The lighter holds ten minutes of fuel, and if it runs dry you get the jumpscare and go straight back to the start screen, with no outro.

## Architecture

Apartment 4B is a static Vite single-page app with two lifecycles. At build time, Node scripts talk to ElevenLabs and produce audio. At runtime, a React Three Fiber canvas renders one scene, Zustand stores hold state, a data table describes collision and triggers, Howler.js plays the baked audio, and HTML overlays handle everything else.

![Apartment 4B architecture: build-time ElevenLabs baking on the left, static browser runtime on the right](/blog/diagrams/apartment-4b-horror-game-architecture.svg)

The left side never ships. `scripts/generate-audio.ts` bakes the tapes, narrator, Margaret's Theme and the SFX; three more scripts bake the cinematics, and `build-outro-videos.sh` stitches the outro into an MP4 with ffmpeg. The right side is what Netlify serves. `App.tsx` mounts `GameCanvas`, eighteen overlay components and three hooks: `useGameAudio`, `useSceneFx` and `useLighterBattery`.

The concrete choices:

| Layer | Choice | Why |
| --- | --- | --- |
| Rendering | React Three Fiber 8, Three.js 0.169, one scene at a time | Scene swap is a conditional render |
| Post-processing | Noise overlay at 0.06 plus Vignette | Cheap PS1 look |
| Lighting | One `SpotLight` on the lighter, the only shadow-casting light | One shadow map to render per frame |
| State | Four working Zustand stores plus a dormant `aiStore`; game and puzzle use `subscribeWithSelector` | Narrow re-renders |
| Persistence | Hand-rolled `state/persist.ts` over localStorage | Default persist middleware does not round-trip `Set` |
| World data | `SCENE_CONFIG` table of AABBs and gated triggers | Everything about a room in one file |
| Audio playback | Howler.js, `html5: true` on the cinematic narration | Pitch-preserving 1.25x narration; tapes play at 1.0 |
| Audio source | ElevenLabs TTS, Sound Generation and Music from Node | No runtime latency, no client key |
| Hosting | Netlify static deploy | No server to run |

## How it works

### The bake scripts are the voice director's notebook

`scripts/generate-audio.ts` is a list of objects, each with an id, text, and three voice settings. It skips any file that already exists, so re-baking one bad line costs one API call.

```ts
// scripts/generate-audio.ts
async function writeIfMissing(
  outPath: string,
  generator: () => Promise<Buffer>,
): Promise<void> {
  const label = outPath.replace(/^public\/audio\//, "");
  if (await exists(outPath)) {
    console.log(`  SKIP  ${label}  (already exists)`);
    return;
  }
  process.stdout.write(`  BAKE  ${label}  ...`);
```

The `tts` helper posts to `/v1/text-to-speech/{voiceId}` with `eleven_multilingual_v2` and per-line `stability`, `similarity_boost` and `style`. Tapes 1 through 4 use stability around 0.3 so Mrs. Hollis sounds shaken. Tape 5, the identity reveal, jumps to 0.45 and drops style to 0.2 so she sounds flat and certain. Those numbers are the whole performance direction, and they live in git.

The same script calls `/v1/sound-generation` with text prompts for the scream, lighter flick, door slam and tape hiss, and `/v1/music` for a 30-second music-box lullaby that became Margaret's Theme. `CREDITS.md` lists all three voices as public Voice Library picks. For Joe I wrote `scripts/audition-joe.ts`, which scores Voice Library candidates by regex keyword weights, renders the top five next to the current voice and writes an A/B listening page; the current voice kept the part. `audition-voices.ts` rendered A/B samples for Mrs. Hollis, and `test-narrator-voice.ts` checked the narrator with a single test line.

### One table drives collision, prompts and progression

`src/world/obstacles.ts` exports `SCENE_CONFIG`. Each scene has bounds, axis-aligned obstacle boxes, a spawn point and triggers. A trigger has a kind (`scene`, `tape`, `puzzle`, `ending` or `key`), a position, a radius, a prompt and optional gates.

```ts
// src/world/obstacles.ts
{ kind: "puzzle", position: [7.5, 0.32, -2.4], radius: 1.4,
  prompt: "[E] Open the chest", payload: "chest", requiredTape: "tape-3" },
{ kind: "key", position: [-1.2, 0.5, -1.8], radius: 1.4,
  prompt: "[E] Pick up key", payload: "front-door-key", requiredTape: "tape-5" },
{ kind: "ending", position: [0, 1.0, 4.4], radius: 1.4,
  prompt: "[E] Insert key. Open front door.", payload: "front-door" },
```

`Player.tsx` runs a `useFrame` loop. It builds movement from camera yaw only, computes a target position, and calls `resolveCollision`, which clamps to the room bounds and pushes the player out of any overlapping box along the axis of smallest penetration. Then it scans the triggers, skips any whose gates fail, and picks the nearest inside its radius. The body is a collision box with an id; once tape 4 flips `bodyVisible` to false, this filter removes it so the player can reach the key.

```ts
// src/canvas/Player.tsx
const bodyVisible = usePuzzleStore.getState().bodyVisible;
const liveObstacles = bodyVisible
  ? cfg.obstacles
  : cfg.obstacles.filter((o) => o.id !== "margaret-body");
const resolved = resolveCollision(targetX, targetZ, cfg.bounds, liveObstacles);
camera.position.x = resolved.x;
camera.position.z = resolved.z;
```

### The audio system is a set of store subscriptions

Nothing in the hooks layer fires from a React render. Most sounds are plain `new Howl(...)` calls inside hooks and overlays. `audio/AudioManager.ts` is a small Howler wrapper, and in practice its one real job is `unlock()`, which resumes the audio context inside the start gesture. `audio/playTape.ts` stops any tape already playing, asks the manager to duck ambient by 14 dB, sets the subtitle, and can chain a follow-up line 600 ms later. That duck does nothing, for reasons I cover below. The follow-up hook was built for Joe's "where is her body?" line, but no tape in `tapes.ts` passes one, so the baked `joe-reaction.mp3` is preloaded and never played.

`useSceneFx` subscribes to `scene`, `bodyVisible` and `hasFrontDoorKey`. When the key lands in the player's hand it fades the theme out and starts a heartbeat loop that ramps over 30 steps of 1.5 seconds.

```ts
// src/hooks/useSceneFx.ts
keyRamp = window.setInterval(() => {
  // ...
  step += 1;
  const progress = Math.min(1, step / TOTAL_STEPS);
  const nextVol = Math.min(1.0, 0.7 + 0.3 * progress);
  const nextRate = 1.05 + 0.55 * progress;
  keyHb.volume(nextVol);
  keyHb.rate(nextRate);
  // ...
}, 1500);
```

Here is the end of the game as one action flowing through the system.

![Apartment 4B end-game flow: key pickup, heartbeat ramp, front door, jumpscare, outro, start-screen reset](/blog/diagrams/apartment-4b-horror-game-flow.svg)

There is no central coordinator. Each piece reacts to the `hasFrontDoorKey` flag on its own: the heartbeat starts, the 60-second scream stingers go quiet, and the door trigger finally shows a prompt. `triggerEnding()` force-clears any modal or pause, and `goToLanding()` flips `started` back to false and wipes `puzzleStore`. The loop counter is untouched; only the Restart button in `PauseOverlay.tsx` bumps it.

### Persisting a Set without the persist middleware

`puzzleStore` holds `collectedTapes` and `solvedPuzzles` as `Set` values. Zustand's persist middleware would need a custom serializer for `Set`, so `state/persist.ts` does it by hand in about 70 lines. The store subscribes to a selector that spreads both sets into sorted arrays, with a custom `equalityFn` so unchanged state never hits localStorage.

### An apartment made of boxes and canvas paint

`Apt4B.tsx` is 1,964 lines and `Apt3B.tsx` is 1,468, almost entirely JSX primitives. Apart from the two sponsor logos, every texture is a function that draws on a canvas and returns a `CanvasTexture` inside a `useMemo`. My favorite is `makeCalendar1957Texture`: aged cream paper, a red MAY banner, the year 1957 in 130-pixel serif, and a day grid. That texture is the chest clue, because tape 3 never speaks the year.

## The hard parts

The scope cut hurt most. `.planning/ROADMAP.md` describes a one-week build with five rooms, five puzzles, and a Margaret hunt AI with patrol, suspect, chase and lurk states. `src/state/aiStore.ts` still holds that state machine type, and nothing drives it. Its `tension` value feeds the lighter flicker, but nothing sets it above zero.

Content drift left fingerprints. `world/tapes.ts` defines a `tape-6` and `Apt4B.tsx` even renders its mesh after tape 5, but no trigger lets you pick it up and no bake entry generates its MP3. `package.json` and the header comment of `generate-audio.ts` still say six tapes. Joe's reaction line is baked but never wired to a tape. The player's apartment is `apt3b` in code, "4A" in the cold-open captions, and "3B" in the README. `useSceneFx` has a door-slam branch for re-entering 4B that can never run, because 4B has no exit trigger.

Apartment 4B's ambient ducking is a no-op. `duckAmbient` only lowers Howls registered in the manager's own `active` map under an `ambient:` or `music:` id. The wind loop in `useGameAudio.ts` and Margaret's Theme in `useSceneFx.ts` are raw Howls the manager never sees, so when a tape plays, the duck finds nothing to lower. The only `audioManager.play` call in `src` is the door slam, on the branch that never runs.

The outro video was a rabbit hole. Instead of animating cross-fades and film grain in React, `build-outro-videos.sh` is a 288-line ffmpeg pipeline: it probes each MP3, chains `xfade` and `acrossfade`, adds `zoompan` and `noise`, and prints a cue table I paste into `EndingVideo.tsx`. The result is a 36 MB MP4 in `src/final-outro/`, the least hackathon-appropriate thing in the repo.

Mobile is unsupported: DEV.md notes that pointer lock silently fails on iOS Safari.

## Results

Apartment 4B placed 3rd at ElevenHacks, sponsored by ElevenLabs and Zed. The game is deployed at apartment-4b.netlify.app and is built for desktop browsers.

What shipped: the cold open and entry cinematic, five tapes with sequential gating, four lock puzzles, the lighter fuel timer with the death ending, the front-door key flow with jumpscare, the outro video (the README still lists it as pending, but the MP4 and `EndingVideo.tsx` are in the repo), and the reset to the start screen. The public source holds roughly 10,000 lines of TypeScript, TSX and shell.

## What I would do differently

I would build the hunt AI. The heartbeat ramp proves escalating audio alone carries tension, but a horror game should have something in the dark.

I would move scene geometry out of TSX into data; two thousand lines of nested primitives is fine for a weekend and miserable after that. I would give `AudioManager` ownership of every Howl, so the tape duck actually lowers the wind and the theme, and stop-all covers everything. And I would add an audible low-fuel warning, because the fuel bar pulsing red under fifteen percent is easy to miss.

## Key takeaways

- Treat a paid generative API as a build step when the output is static. Committed MP3s need no client key and cannot fail in front of a judge.
- Make bake scripts idempotent by checking for the output file first. "Delete one file and re-run" is how creative iteration actually happens.
- Keep voice settings in source control next to the text. Stability and style numbers are performance direction, and a diff of them records what you tried.
- Put collision boxes and interaction triggers in one data table with declarative gates. Progression becomes a filter over that table.
- Drive cross-cutting effects from store subscriptions, not component effects. A heartbeat that starts when a boolean flips does not care which component flipped it.

## FAQ

### How does Apartment 4B use ElevenLabs without calling the API from the browser?

Apartment 4B never calls ElevenLabs from the browser. Four Node scripts under `scripts/` write most of the MP3s, a few ambient and stinger files were generated in ElevenLabs by hand, and all of them are committed and served by Netlify as static assets. The deployed site never contacts ElevenLabs and the bundle holds no key.

### Does Apartment 4B use 3D models or texture files?

No 3D models. Every mesh in Apartment 4B is a React Three Fiber primitive written in TSX. Every texture except the two sponsor logo PNGs (Zed and ElevenLabs, loaded by `WallLogo.tsx` with drei's `useTexture`) is painted onto an HTML canvas at runtime and wrapped in a `THREE.CanvasTexture`.

### How does Apartment 4B handle collision and interaction triggers?

Apartment 4B keeps a `SCENE_CONFIG` table in `src/world/obstacles.ts` with bounds, obstacle boxes, a spawn point and gated triggers per scene. Each frame, `Player.tsx` pushes the camera out of any overlapping box, then scans the triggers, drops any whose gate fails, and selects the nearest within radius.

### How does Apartment 4B save progress between page loads?

Apartment 4B writes collected tapes, solved puzzles and the key flag to localStorage under `apt4b:puzzle:v1`, and the loop count under `apt4b:game:v1`, through a hand-written adapter in `src/state/persist.ts`, with every read and write wrapped in try/catch.

## Links

- Live demo: https://apartment-4b.netlify.app
- Source: https://github.com/anirxdh/Apartment-4B
