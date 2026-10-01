---
draft: true
title: "Building an AI DJ That Never Leaves Dead Air Between Tracks"
description: "How Spotify for Hackers uses Groq, ElevenLabs and browser-side audio ducking so a voiced AI host bridges every track handoff without a gap of silence."
date: 2026-09-30
slug: spotify-for-hackers-ai-dj
project: "Spotify for Hackers"
tags: [Next.js, Groq, ElevenLabs, Voice AI, HTML Audio, Terminal UI]
repo: https://github.com/anirxdh/spotify-for-hackers
live: https://spotifyv2-0-1.vercel.app
accent: "#1db954"
summary: "Spotify for Hackers is a terminal-skinned music player with four AI DJ hosts. Groq writes a one-line handoff for each track, ElevenLabs speaks it, and the browser ducks the music and starts the next preview quietly under the voice so there is never silence."
---

## The silence between two 30-second previews

The first version of the auto-DJ was embarrassing. A track would end, the app would fetch a line from Groq, send it to ElevenLabs, wait for the audio, play it, and only then start the next song. For those few seconds the room was silent. A DJ who goes quiet between every track is not a DJ. It is a loading spinner with a voice.

Spotify for Hackers is a terminal-skinned music player with an AI DJ that writes and speaks its own handoffs between tracks, built by Anirudh Vasudevan for the ElevenLabs and v0 hackathon window in May 2026. Music comes from the iTunes Search API as 30-second previews. Groq writes the words and ElevenLabs speaks them. Everything else (home grid, library, search, player and a real command line) works with no API keys.

The README carries a disclaimer I want to repeat: this is an independent fan and educational UI, not affiliated with, endorsed by, or connected to Spotify AB. I borrowed the product shape people already know and re-skinned it as a green-on-black terminal, so the hackathon time could go to the voice layer.

## Why the DJ lives in the browser, not on a server

The obvious design for a talking DJ is a server-side pipeline. A worker pre-renders each handoff with the LLM and TTS, stitches it into one audio stream, and the client plays that stream. It would give perfect timing.

I did not build that, for three reasons. Time: the whole project took about five days (every commit lands between May 3 and May 7, 2026). State: there is no database and no auth, and a mixing server for one feature would have doubled the surface area. Source: the music is iTunes preview MP3s on Apple's CDN, which I cannot practically re-stream, so it had to play straight from the CDN in an HTML audio element.

Once the music is a browser audio element, the DJ voice has to be one too, and the "mixing" becomes volume math on two elements. That turned out to be enough.

The other decision was the LLM. I used Groq's llama-3.1-8b-instant because a handoff is under 22 words (that number is in the system prompt) and an 8B model returns it in well under a second. The quality gap for a one-liner is small; the latency gap is not, because the voice cannot start until the text exists.

## What a session looks like

Spotify for Hackers opens on a splash screen that reads "build: hackathon edition". You press Enter or tap it, and that tap matters later. Inside, five tabs sit on the number keys: Home, Library, Terminal, DJ, Help. Home shows playlist, chart and artist tiles, each mapped to an iTunes query in `lib/itunesService.ts`.

The Terminal tab is a working command line: `search the weeknd` lists numbered results, `play 3` starts the third one, and `volume 40`, `pause`, `skip` and `prev` do what they say.

The DJ tab is a broadcast booth. You pick one of four hosts: DJ Nova (bright club host), DJ Velvet (late-night radio), DJ Pulse (techno precision) and DJ Kai (hype MC). Each has its own ElevenLabs preset voice and writing persona. When you arm auto-DJ, from the DJ tab or by typing `sudo auto-dj`, the host greets the room with a Groq-written intro, plays the first track, and then speaks a fresh handoff every time a preview ends.

## Architecture

Spotify for Hackers is one Next.js 16 App Router app with a single client page and three thin route handlers. `app/page.tsx` (1,224 lines) owns all state: the active tab, one shared audio element ref, the queue, the autoDJ flag, the selected host and the terminal log. The routes exist to keep vendor keys off the client and to normalize responses.

![Spotify for Hackers architecture: browser shell, three Next.js proxy routes, and the iTunes, Groq and ElevenLabs APIs behind them](/blog/diagrams/spotify-for-hackers-ai-dj-architecture.svg)

Reading left to right: typed commands go through `lib/commandParser.ts`, which returns typed responses, some carrying a `stateChange` payload the shell applies. `GET /api/itunes` proxies the iTunes Search API and returns a normalized track shape, dropping anything without a `previewUrl`. `POST /api/dj` builds a prompt from the current track, the next track, the host persona and a rotating scene index, then calls Groq. `POST /api/tts` forwards the line and voice settings to ElevenLabs and streams back `audio/mpeg` bytes. The DJ voice plays on a second audio element managed by `lib/elevenLabsService.ts`, with `lib/textToSpeech.ts` falling back to the Web Speech API if ElevenLabs fails.

These are the main choices and why I made them:

| Layer | Choice | Why |
|---|---|---|
| Framework | Next.js 16 App Router, React 19 | A server-side proxy per vendor, no separate backend |
| UI bootstrap | v0, then hand-edited | A credible shell on day one; the other days went to audio |
| Music source | iTunes Search API via `/api/itunes` | Free, no auth, 30-second previews with artwork |
| DJ script | Groq llama-3.1-8b-instant, max_tokens 70 to 80 | A sub-second one-liner beats a smarter paragraph |
| DJ voice | ElevenLabs eleven_v3 via `/api/tts` | Preset voices plus bracketed delivery tags per host |
| Voice fallback | Web Speech API in `textToSpeech.ts` | The DJ still talks with no keys or after a failed request |
| Mixing | Two HTML audio elements, ratios 0.14 and 0.26 | No server mixing, no re-encoding of CDN audio |

## How it works

### The link-mix: starting the next song under the voice

This is the part that fixed the dead air. The `ended` listener on the music element in `app/page.tsx` picks the next track. When auto-DJ is off, it swaps `src` and plays. When auto-DJ is on, it swaps first, drops the volume, and only then asks for the handoff:

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

`AUTO_DJ_LINK_BED_RATIO` is 0.26, so the next preview starts at about a quarter of the user's volume. The music never stops. Then `announceDjTransitionRef.current(pt, nt, qLen, { holdDuckRefAfterSpeak: true })` POSTs to `/api/dj`, gets a line, and speaks it through `withPreviewDucked`. When the voice ends, a `finally` block restores full volume. If Groq or ElevenLabs is slow, the listener hears quiet music for a bit longer, a much better failure than silence.

![One auto-DJ handoff from the ended event through Groq and ElevenLabs and back to the browser](/blog/diagrams/spotify-for-hackers-ai-dj-flow.svg)

### Ducking, and stopping the volume slider from undoing it

Every spoken line goes through `withPreviewDucked`. If the music element is playing, it sets a `previewDuckActiveRef` flag, drops the volume to 14 percent of the user's level, awaits the speech, then restores it. The tricky bug was the volume slider: a `useEffect` writes `volume / 100` into the audio element whenever React's `volume` state changes, and it would fire mid-sentence and snap the music back to full. The fix is a one-line guard:

```ts
// app/page.tsx
useEffect(() => {
  if (audioRef.current && !previewDuckActiveRef.current) {
    audioRef.current.volume = volume / 100
  }
}, [volume])
```

The `holdDuckRefAfterSpeak` option exists because in the link-mix path the duck is owned by the `ended` handler, so the inner helper must not clear the flag when speech ends.

### One host, three systems: voice, delivery, persona

Picking a host changes one number, `aiDjHostIndex`. `lib/aiDjHosts.ts` holds four `AiDjHost` records, each with an ElevenLabs `voiceId` (public presets: Elli, Antoni, Rachel, Josh), a `delivery` string like `[young female DJ, festival hype, crisp mic, big smile in the voice]`, and three Groq prompt fragments: a persona, a lens that recolors the rotating scene, and a hint for the user message.

The delivery string is prepended to every utterance in `speakWithElevenLabs` before it goes to `/api/tts`. The `eleven_v3` model reads bracketed text at the start as acting direction, so the same line sounds hyped from Nova and unhurried from Velvet. The Groq fragments ride along in every `/api/dj` request and are spliced into the prompt on the server:

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

`DJ_SYSTEM_PROMPT` is the fixed part: one spoken line, under 22 words, mention the next song, no markdown or hashtags. `flowIndex` comes from a client counter (`djFlowCycleRef`) that wraps at 5, so consecutive handoffs pull from different scenes in `lib/djFlows.ts` (rooftop FM takeover, warehouse, late-night drive, beach shack, neon arcade). Without that rotation, an 8B model at temperature 0.9 produced lines that rhymed with each other after three tracks. If Groq fails, the route still returns HTTP 200 with a hard-coded line, so the client always gets something speakable.

### Getting iOS Safari to let the DJ speak

On an iPhone the DJ was mute, and the music often did not start either. Safari requires each audio element to be played inside a user gesture before it can be played programmatically later, and a `new Audio()` created after the tap has no gesture behind it.

The fix uses one silent WAV data URI in two places. `enterApp` in `page.tsx` runs on the splash Enter or tap. Inside that gesture it plays the silent clip on the music element at volume zero and pauses it, then calls `primeTtsAudio` in `lib/elevenLabsService.ts`, which does the same for a module-level TTS element:

```ts
// lib/elevenLabsService.ts
const a = new Audio()
a.preload = "auto"
a.setAttribute("playsinline", "")
a.src = SILENT_AUDIO_DATA_URI
a.volume = 0
const p = a.play()
```

`speakWithElevenLabs` reuses that primed element for every utterance, setting each ElevenLabs response as a blob URL and revoking it when playback ends. So the splash screen is not decoration. It is the one guaranteed tap I get to unlock two audio elements.

### A terminal that replays a script

`parseCommand` in `lib/commandParser.ts` is pure: it takes the input and a snapshot of player state and returns an array of `{ type, text, stateChange? }` objects. The shell walks that array, waiting 800 ms after each `typing` entry and passing each `stateChange` to `applyStateChange`, which maps fields like `isPlaying`, `volume` and `autoDJ` onto React state and the audio element. So `sudo auto-dj` prints "access granted..." and pauses before it flips the flag. Two commands bypass the parser because they need the network: `search` calls `/api/itunes`, and `sudo auto-dj` with an empty queue searches "top hits 2024" with a limit of 12 before announcing the intro.

## The hard parts

The whole app is one 1,224-line client component. Playback, queue, DJ, terminal and UI state all live in `page.tsx` and are threaded down as props. It was fast to write and painful to change by day four. `announceDjTransitionRef` and `handleCommandRef` exist only to dodge stale closures in effect callbacks, a sign the state belonged in a store.

I turned off TypeScript build errors in `next.config.mjs` (`ignoreBuildErrors: true`) to keep Vercel deploys green. That is a bad habit, and the command parser types its track lists as `any[]` because of it.

Both key-reading routes fall back to a `NEXT_PUBLIC_` variable if the server-side one is missing. That path would ship a key to the browser. The README marks it as not recommended, and I would remove the fallback entirely. Set `ELEVENLABS_API_KEY` and `GROQ_API_KEY` on the server and nothing else. Lastly, `public/` is 41 MB of PNG tiles with `images.unoptimized` set, and the first load pays for it.

## What shipped

Spotify for Hackers is deployed at spotifyv2-0-1.vercel.app and the source is public at anirxdh/spotify-for-hackers. The repo history runs from May 3 to May 7, 2026. The README tags v0 and ElevenLabs for hackathon rules, but I did not record a formal submission or placement anywhere in the repo, and there is no award to report. The player, search, library and terminal work with no keys; the DJ speaks only when the deployment has ElevenLabs and Groq keys on the server.

## What I would change

I would pre-fetch the handoff. The next track is known well before the current one ends, so the line could be requested at the 20-second mark of a 30-second preview and the ElevenLabs audio could be sitting in a blob before `ended` fires. The voice would land within a few hundred milliseconds instead of a second or two.

I would move the mixing to the Web Audio API, where a `GainNode` per source with a short ramp gives a real fade and makes the duck immune to the volume-slider race by construction. I would also split `page.tsx` into a small store plus a `useAudioEngine` hook that owns both elements, drop the `NEXT_PUBLIC_` key fallbacks, turn TypeScript errors back on, and compress the tile art.

## Key takeaways

- When a voice has to bridge two audio sources, start the second source quietly before the voice begins. A late voice over quiet music is fine; a late voice over silence feels broken.
- Any effect that writes to a shared audio element needs a guard flag in a ref, or it will fight whatever else is ducking that element.
- For one-line generations that gate audio playback, pick the model by latency, not capability.
- Rotate a small set of prompt scenes with a client-side counter; it costs nothing and removes the sameness small models produce at high temperature.
- On iOS Safari, prime every audio element you will ever play inside the first user gesture, and reuse those elements.
- Make the LLM route return HTTP 200 with a canned line on failure, so the client never has to decide what to say when the model is down.

## FAQ

### How does Spotify for Hackers avoid silence between tracks?

In auto-DJ mode, Spotify for Hackers reacts to the music element's `ended` event by immediately playing the next iTunes preview at 26 percent of the user's volume (`AUTO_DJ_LINK_BED_RATIO` in `app/page.tsx`), and only then requests a handoff line from Groq and speech from ElevenLabs. When the voice ends the volume is restored, so a slow API call means quiet music rather than dead air.

### What models and APIs does Spotify for Hackers use for the AI DJ?

Spotify for Hackers uses Groq's `llama-3.1-8b-instant` model to write each intro and transition line, called from `app/api/dj/route.ts` with `max_tokens` of 70 to 80. It uses ElevenLabs text-to-speech with the `eleven_v3` model through `app/api/tts/route.ts`, with a different preset voice per host. Previews come from the iTunes Search API through `app/api/itunes/route.ts`, and the Web Speech API is the fallback if ElevenLabs fails.

### Does Spotify for Hackers work without API keys?

Yes. The home grid, library, search, player and terminal in Spotify for Hackers run with no keys, because the iTunes Search API needs no authentication. Only the DJ voice needs `GROQ_API_KEY` and `ELEVENLABS_API_KEY` on the server; without them the `/api/dj` and `/api/tts` routes return 401 and the DJ is silent, but playback still works.

## Links

- Live demo: https://spotifyv2-0-1.vercel.app
- Source: https://github.com/anirxdh/spotify-for-hackers
