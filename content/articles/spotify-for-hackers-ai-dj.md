---
title: "Building an AI DJ That Never Leaves Dead Air Between Tracks"
description: "How Spotify for Hackers uses Groq, ElevenLabs and browser-side audio ducking so a voiced AI host bridges every track handoff without a gap of silence."
date: 2026-10-03
slug: spotify-for-hackers-ai-dj
project: "Spotify for Hackers"
tags: [Next.js, Groq, ElevenLabs, Voice AI, HTML Audio, Terminal UI]
repo: https://github.com/anirxdh/spotify-for-hackers
live: https://spotifyv2-0-1.vercel.app
accent: "#1db954"
summary: "Spotify for Hackers is a terminal-skinned music player with four AI DJ hosts. Groq writes a one-line handoff for each track, ElevenLabs speaks it, and the browser ducks the music and starts the next preview quietly under the voice so there is never silence."
---

## The silence between two 30-second previews

The obvious order for an auto-DJ sounds fine on paper. A track ends, the app fetches a line from Groq, sends it to ElevenLabs, waits for the audio, plays it, and only then starts the next song. Do that and the room goes quiet at every handoff. A DJ who goes silent between tracks is not a DJ. It is a loading spinner with a voice. Spotify for Hackers is a terminal-skinned music player with an AI DJ that writes and speaks its own handoffs between tracks, built by Anirudh Vasudevan in a short hackathon sprint in May 2026.

Music comes from the iTunes Search API as 30-second previews. Groq writes the words and ElevenLabs speaks them. Everything else (home grid, library, search, player and a command line) works with no API keys.

The README also carries a disclaimer I want to repeat: this is an independent fan and educational UI, not affiliated with, endorsed by, or connected to Spotify AB. I borrowed a product shape people know and re-skinned it as a green-on-black terminal so the time could go to the voice.

## Why the DJ lives in the browser, not on a server

The obvious design for a talking DJ is a server-side pipeline: a worker pre-renders each handoff with the LLM and TTS, stitches it into one audio stream, and the client plays that stream. It would give perfect timing.

I did not build that, for three reasons. Time: the commit history runs from May 3 to May 6, 2026, four days. State: there is no database and no auth, and a mixing server for one feature would have doubled the surface area. Source: the music is iTunes preview clips on Apple's CDN, which I cannot practically re-stream, so it had to play straight from the CDN in an HTML audio element. Once the music is a browser audio element, the DJ voice has to be one too, and the "mixing" becomes volume math on two elements. That was enough.

The other decision was the LLM. I used Groq's llama-3.1-8b-instant because a handoff is under 22 words (that number is in the system prompt) and a small model returns a line that short quickly. I did not benchmark it, but the voice cannot start until the text exists, so latency here is heard. The quality gap for a one-liner is small.

## What a session looks like

Spotify for Hackers opens on a splash screen that reads "build: hackathon edition". You press Enter or tap it, and that tap matters later. Five tabs sit on the number keys: Home, Library, Terminal, DJ, Help. Home shows playlist and chart tiles mapped to iTunes queries in `lib/itunesService.ts`, plus artist tiles from `lib/discovery.ts`.

The Terminal tab is a working command line (`search the weeknd`, `play 3`, `volume 40`). The DJ tab is a broadcast booth. You pick one of four hosts: DJ Nova (bright club host), DJ Velvet (late-night radio), DJ Pulse (techno precision) and DJ Kai (hype MC). Each has its own ElevenLabs preset voice and writing persona. When you arm auto-DJ, from the DJ tab or by typing `sudo auto-dj`, the host greets the room with a Groq-written intro, plays the first track, and speaks a fresh handoff every time a preview ends. One catch: the host speaks only while the DJ tab (key 4) is open and voice is on. Arm it from the Terminal and the lines are still fetched, but you hear nothing until you switch to tab 4.

## Architecture

Spotify for Hackers is one Next.js 16 App Router app with a single client page and three thin route handlers. `app/page.tsx` (1,224 lines) owns all state: the active tab, one shared audio element ref, the queue, the autoDJ flag, the selected host and the terminal log. The routes keep vendor keys off the client.

![Spotify for Hackers architecture: browser shell, three Next.js proxy routes, and the iTunes, Groq and ElevenLabs APIs behind them](/blog/diagrams/spotify-for-hackers-ai-dj-architecture.svg)

Typed commands go through `lib/commandParser.ts`, which returns responses that can carry a `stateChange` the shell applies. `GET /api/itunes` proxies the iTunes Search API, `POST /api/dj` builds a prompt from the current track, the next track, the host persona and a rotating scene index and calls Groq, and `POST /api/tts` forwards the line to ElevenLabs and returns the `audio/mpeg` bytes, which `lib/elevenLabsService.ts` turns into a blob URL on a second audio element.

The main choices, and why:

| Layer | Choice | Why |
|---|---|---|
| Framework | Next.js 16 App Router, React 19 | A server-side proxy per vendor, no separate backend |
| UI bootstrap | v0, then hand-edited | A credible shell on day one; the time saved went to the DJ and audio work |
| Music source | iTunes Search API via `/api/itunes` | Free, no auth, 30-second previews with artwork |
| DJ script | Groq llama-3.1-8b-instant, max_tokens 70 to 80 | A fast one-liner beats a smarter paragraph |
| DJ voice | ElevenLabs eleven_v3 via `/api/tts` | Preset voices plus bracketed delivery tags per host |
| Voice fallback | Web Speech API in `textToSpeech.ts` | The DJ still talks with no keys or after a failed request |
| Mixing | Two HTML audio elements, ratios 0.14 and 0.26 | No server mixing, no re-encoding of CDN audio |

## How it works

### The link-mix: starting the next song under the voice

This is the part that fixes the dead air. The `ended` listener on the music element in `app/page.tsx` picks the next track. When auto-DJ is off, it swaps `src` and plays. When auto-DJ is on, it swaps first, drops the volume, and only then asks for the handoff:

```ts
// app/page.tsx
a.src = nt.previewUrl
a.load()
try {
  await a.play()
  setIsPlaying(true)
} catch {
  setIsPlaying(false)
  return
}
a.volume = normal * AUTO_DJ_LINK_BED_RATIO
```

`AUTO_DJ_LINK_BED_RATIO` is 0.26, so the next preview starts at about a quarter of the user's volume, and the music never stops. Then `announceDjTransitionRef.current(pt, nt, qLen, { holdDuckRefAfterSpeak: true })` POSTs to `/api/dj`, gets a line, and speaks it through `withPreviewDucked`. When the voice ends, a `finally` block restores full volume. If Groq or ElevenLabs is slow, the listener hears quiet music a bit longer, a far better failure than silence. If the DJ tab is not open, `announceDjTransition` fetches the line but returns without speaking, and the same `finally` block restores the volume at once.

![One auto-DJ handoff from the ended event through Groq and ElevenLabs and back to the browser](/blog/diagrams/spotify-for-hackers-ai-dj-flow.svg)

### Ducking, and stopping the volume slider from undoing it

Every spoken line goes through `withPreviewDucked`, which sets a `previewDuckActiveRef` flag, drops the music to 14 percent of the user's level, awaits the speech, then restores it. The tricky bug was the volume slider: a `useEffect` writes `volume / 100` into the audio element whenever React's `volume` state changes, and it fired mid-sentence and snapped the music back up. The fix is a guard:

```ts
// app/page.tsx
useEffect(() => {
  if (audioRef.current && !previewDuckActiveRef.current) {
    audioRef.current.volume = volume / 100
  }
}, [volume])
```

The `holdDuckRefAfterSpeak` option exists because in the link-mix path the `ended` handler owns the duck, so the helper must not clear the flag when speech ends.

### One host, three systems: voice, delivery, persona

Picking a host changes one number, `aiDjHostIndex`. `lib/aiDjHosts.ts` holds four `AiDjHost` records, each with an ElevenLabs `voiceId` (public presets: Elli, Antoni, Rachel, Josh), a `delivery` string like `[young female DJ, festival hype, crisp mic, big smile in the voice]`, and three Groq prompt fragments: a persona, a lens on the scene, and a hint for the user message.

`speakWithElevenLabs` prepends the delivery string to every utterance before it goes to `/api/tts`. The `eleven_v3` model reads bracketed text as acting direction, so the same line sounds hyped from Nova and unhurried from Velvet. The Groq fragments ride along in every `/api/dj` request and are spliced into the prompt:

```ts
// app/api/dj/route.ts
{
  role: "system",
  content: `${DJ_SYSTEM_PROMPT}${personaBlock} ${TRANSITION_FLOW_SYSTEM[flowIndex]}${journeyLensBlock}`,
},
{
  role: "user",
  content: `${transition} Queue size: ${queueSize}. ${TRANSITION_FLOW_USER[flowIndex]}${journeyUserBlock}`,
},
```

`DJ_SYSTEM_PROMPT` is the fixed part: one spoken line, under 22 words, mention the next song, no markdown or hashtags. `flowIndex` comes from a client counter (`djFlowCycleRef`) that wraps at 5 and picks a row from `lib/djFlows.ts`. Intros rotate through five scenes (rooftop FM takeover, warehouse, late-night drive, beach shack, neon arcade) and handoffs through five tones (festival mainstage, intimate club booth, college radio chaos, pirate radio static, afterhours loft). The rotation is there so a small model at temperature 0.9 (1 for intros) does not settle into one phrasing. If Groq fails, the route still returns HTTP 200 with a hard-coded line, so the client always has something to say.

### Getting iOS Safari to let the DJ speak

On an iPhone the DJ did not speak, and the music often did not start either. The fix landed in a May 4 commit whose message starts with "fix(audio): unlock music + TTS audio elements on iPhone Safari from splash gesture". Safari requires each audio element to be played inside a user gesture before it can be played programmatically later, and a `new Audio()` created after the tap has no gesture behind it.

The fix is one silent WAV data URI used in two places. `enterApp` in `page.tsx` runs on the splash Enter or tap. Inside that gesture it plays the silent clip on the music element at volume zero, then calls `primeTtsAudio` in `lib/elevenLabsService.ts`, which does the same for a module-level TTS element:

```ts
// lib/elevenLabsService.ts
const a = new Audio()
a.preload = "auto"
a.setAttribute("playsinline", "")
a.src = SILENT_AUDIO_DATA_URI
a.volume = 0
const p = a.play()
```

`speakWithElevenLabs` reuses that primed element for every utterance, setting each response as a blob URL and revoking it when playback ends. So the splash screen is not decoration. It is the one guaranteed tap that unlocks two audio elements.

### A terminal that replays a script

`parseCommand` in `lib/commandParser.ts` is pure: it takes the input and a snapshot of player state and returns an array of `{ type, text, stateChange? }` objects. The shell walks that array, waiting 800 ms after each `typing` entry and passing each `stateChange` to `applyStateChange`, which maps fields like `isPlaying`, `volume` and `autoDJ` onto React state and the audio element. Two commands need the network and bypass the parser: `search` calls `/api/itunes`, and `sudo auto-dj` with an empty queue first searches "top hits 2024" with a limit of 12.

## The hard parts

The whole app is one 1,224-line client component. Playback, queue, DJ, terminal and UI state all live in `page.tsx` and go down as props. That was fast to write, and the cost shows: `announceDjTransitionRef` and `handleCommandRef` exist only to dodge stale closures, a sign the state belonged in a store.

I turned off TypeScript build errors in `next.config.mjs` (`ignoreBuildErrors: true`) to keep Vercel deploys green. That is a bad habit, and the command parser still types its track lists as `any[]`.

Both key-reading routes fall back to a `NEXT_PUBLIC_` variable if the server-side one is missing, which would ship a key to the browser. The README marks it as not recommended, and I would remove it. Lastly, `public/` is 41 MB of PNG tiles, host portraits and avatars with `images.unoptimized` set, and the home grid pays for it: every playlist, chart and artist tile it shows is a PNG of roughly 1 to 2 MB.

## What shipped

Spotify for Hackers is deployed at spotifyv2-0-1.vercel.app and the source is public at anirxdh/spotify-for-hackers. The commit history runs from May 3 to May 6, 2026. The README tags v0 and ElevenLabs for hackathon rules, but I did not record a submission or placement in the repo, and there is no award to report. The ElevenLabs voices and the Groq-written lines need both keys on the server; without them the host falls back to the browser's Web Speech voice reading a bare title-and-artist line, and everything else works as normal.

## What I would change

I would pre-fetch the handoff. The next track is known well before the current one ends, so the line and the ElevenLabs audio could be fetched at the 20-second mark of a 30-second preview and be waiting in a blob before `ended` fires.

I would also move the mixing to the Web Audio API, where a `GainNode` per source gives a real fade and makes the duck immune to the volume-slider race, and split `page.tsx` into a store plus a `useAudioEngine` hook that owns both elements.

## Key takeaways

- When a voice has to bridge two audio sources, start the second source quietly before the voice begins. A late voice over quiet music is fine; a late voice over silence feels broken.
- Any effect that writes to a shared audio element needs a guard flag in a ref, or it will fight whatever else is ducking it.
- Rotate a small set of prompt scenes with a client-side counter; it costs nothing and breaks up the sameness of a small model at high temperature.
- On iOS Safari, prime every audio element you will ever play inside the first user gesture, and reuse those elements.
- Make the LLM route return HTTP 200 with a canned line on failure, so the client never has to decide what to say when the model is down.

## FAQ

### How does Spotify for Hackers avoid silence between tracks?

In auto-DJ mode, Spotify for Hackers reacts to the music element's `ended` event by immediately playing the next iTunes preview at 26 percent of the user's volume (`AUTO_DJ_LINK_BED_RATIO` in `app/page.tsx`), and only then requests a line from Groq and speech from ElevenLabs. When the voice ends the volume is restored, so a slow API call means quiet music, not dead air.

### What models and APIs does Spotify for Hackers use for the AI DJ?

Spotify for Hackers uses Groq's `llama-3.1-8b-instant` model to write each intro and transition line, called from `app/api/dj/route.ts` with `max_tokens` of 70 to 80. It uses ElevenLabs text-to-speech with the `eleven_v3` model through `app/api/tts/route.ts`, with a preset voice per host. Previews come from the iTunes Search API through `app/api/itunes/route.ts`, and the Web Speech API is the fallback.

### Does Spotify for Hackers work without API keys?

Yes. The home grid, library, search, player and terminal in Spotify for Hackers run with no keys, because the iTunes Search API needs no authentication. Only the DJ voice needs `GROQ_API_KEY` and `ELEVENLABS_API_KEY` on the server; without them `/api/dj` and `/api/tts` return 401, the client falls back to the Web Speech API with a plain title-and-artist line, and playback is unaffected.

## Links

- Live demo: https://spotifyv2-0-1.vercel.app
- Source: https://github.com/anirxdh/spotify-for-hackers
