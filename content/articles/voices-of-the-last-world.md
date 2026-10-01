---
draft: true
title: "How I Gave Five AI Characters Their Own ElevenLabs Voices"
description: "Voices of the Last World is a browser crisis game where two AI minds debate in ElevenLabs voices. Here is the voice, DSP, and LLM fallback design behind it."
date: 2026-09-30
slug: voices-of-the-last-world
project: "Voices of the Last World"
tags: [ElevenLabs, Voice AI, Web Audio, Groq, React, Game Design]
repo: https://github.com/anirxdh/voices-of-the-last-world
live: https://voices-of-the-last-world.vercel.app
accent: "#ff8a65"
summary: "Voices of the Last World is a cinematic crisis-simulation game built for the Kiro x ElevenLabs Hack #5. Two AI Archive minds debate a 2098 emergency in distinct ElevenLabs voices, then the player commits the response. This is how the voice layer, the Web Audio robot filter, and the LLM-with-a-local-twin engine work."
---

## Two voices, one argument

The moment this project clicked was hearing Ares Prime and Nova Sage disagree. Ares is fast and sharp. Nova is slow and warm. Put their lines back to back through ElevenLabs with different voice settings and it sounds like two people arguing, not one engine reading a script. That was the pitch in ten seconds of audio.

Voices of the Last World is a cinematic crisis-simulation game that lets a player pick a 2098 emergency, deploy two AI "Archive minds" who debate it out loud in distinct ElevenLabs voices, and then commit the final response, built by Anirudh Vasudevan for ElevenLabs Hack #5, the Kiro x ElevenLabs hackathon, in April 2026. It is a React 19 and Vite 7 single-page app with no backend.

The judging rubric in the hack docs was 40 percent creativity, 40 percent partner technology, 20 percent presentation. I read that as: make the voices the product. The engine and the LLM exist to give the voices something worth saying.

## Why the LLM is optional and the voices are not

The obvious build is a chat loop. Send the scenario and two character sheets to a model, stream back a debate, read it aloud. I started there with Groq and the openai/gpt-oss-20b model. The problem showed up on the first demo run: the model would spell a speaker as "Turing Omega" instead of "Turing-Ω", or write a paragraph where I wanted one line, and the voice lookup failed or the typewriter ran for twenty seconds. On a demo stage you get one take.

So I made the decision that shaped the rest of the code. The LLM would be a flavor layer, not the engine. src/simulator.js is a deterministic simulation that produces the debate, the decision, the scoring, and the player's choices from static data. src/engine.js asks Groq for a strict JSON-schema response, but it also has createFallbackEngineOutput(), which produces the same shape from the local engine. If the key is missing or the request fails, App.jsx catches it and plays the local version. Nobody watching can tell which path ran.

The second constraint was the demo video. My own submission guide in the repo says not to let the recorded demo fall back to browser speech. So the ElevenLabs path had to survive a phone, a hover preview, a restart, and six voice lines in a row.

The third constraint was time. The repo has a single commit. I built everything in the hackathon window and pushed once, which is why there are no tests and some dead code.

## What the player does

Voices of the Last World opens with a cinematic intro video and a typewriter storyline you can skip.

Next comes a carousel of five crises: Silent Signal, Mars Oxygen Collapse, Global AI Hack, Vanishing City, and Archive Echo. Each has a backdrop, a brief, a goal, and lists of required and bad traits for the scoring engine.

Then you pick exactly two Archive minds from a row of image cards. Hovering a card swaps its poster for a looping video and plays a pre-rendered ElevenLabs preview of that voice. The engine defines five characters (Turing-Ω, Ares Prime, Nova Sage, Lady Astra, Core AI), but only four have media in src/media.js, so the selection screen shows four. Turing-Ω never got portrait art.

You press deploy. The two minds exchange their first two debate lines with voice and synchronized typewriter text. Then the game asks you three things in order: a strategy (one correct, one risky, one wrong for that scenario), a tool from each agent's kit, and a finish style. After each pick the agents respond with two more voiced lines. The final pick resolves the mission into success, partial success, or failure, with a narrated outcome panel.

## Architecture

Voices of the Last World is one Vite bundle on Vercel with no server of its own. The browser calls Groq and ElevenLabs directly with keys read from VITE_ prefixed environment variables at build time. The scoring engine, the audio DSP chain, and the state machine all run in React.

![Voices of the Last World architecture: a React SPA that talks directly to Groq and ElevenLabs, with a deterministic local simulator that can replace the LLM](/blog/diagrams/voices-of-the-last-world-architecture.svg)

Reading left to right: App.jsx owns the phase state (scenario, selection, debate) and the debate stage (opening, strategy, tool, execute, result). On deploy, App.jsx calls runSimulationEngine() in engine.js, which either POSTs to Groq or returns the local twin from simulator.js. Either way the result passes through mergeEngineOutputWithLocal(), which overlays only the creative fields onto a fresh local simulation, and the merged simulation feeds DebateScreen in GameScreens.jsx.

Each debate line goes to speakAgentLine() in voice.js. It adjusts the voice settings for emotion, POSTs to the text-to-speech endpoint, and plays the returned MP3 through a Web Audio graph. Core AI gets an extra filter chain. Any failure routes to the browser's speechSynthesis so the game never goes silent.

The real choices, layer by layer:

| Layer | Choice | Why |
| --- | --- | --- |
| App shell | React 19 + Vite 7, no backend | One static deploy to Vercel, nothing to keep alive during judging |
| Game engine | Deterministic simulator.js with trait and synergy scoring | Playable with no API keys, same output shape as the LLM |
| Debate text | Groq openai/gpt-oss-20b with strict json_schema response_format | Exactly four lines, enum'd result, parseable without retries |
| LLM hardening | normalizeAgentName() plus first-sentence compaction to 96 chars | Model drift on speaker names cannot break voice lookup or bubble placement |
| Voice synthesis | ElevenLabs eleven_multilingual_v2 with per-agent voice_settings | Distinct identity per character from one API |
| Emotion | applyEmotionVariation() keyword counting with per-agent clamps | More expressive lines without losing who is speaking |
| Playback | Web Audio BufferSource, GainNode, one persistent AudioContext | iOS Safari stays unlocked across lines |
| Robot voice | highpass, lowpass, notch, DynamicsCompressor chain for Core AI | Synthetic timbre from a normal human voice model |
| Fallback | window.speechSynthesis with per-agent rate and pitch | Silence is worse than a worse voice |

## How it works

### Emotion as a bounded nudge on voice settings

ElevenLabs exposes stability, similarity_boost, style, and speed per request. My first attempt let the LLM pick an emotion label per line, which added a field for the model to get wrong. The shipped version is dumber and more reliable: each character has urgent words and calm words, and the line is scanned for them.

```js
// src/voice.js
const shift = (urgentCount - calmCount) * 0.06;
if (shift === 0) return baseSettings;
const adjusted = { ...baseSettings };
switch (agentName) {
  case "Ares Prime":
    adjusted.stability = clamp(baseSettings.stability - shift, 0.22, 0.52);
    adjusted.style = clamp(baseSettings.style + shift * 0.8, 0.3, 0.65);
    adjusted.speed = clamp(baseSettings.speed + shift * 0.15, 0.95, 1.18);
    break;
```

Each extra urgent word is a 0.06 shift. For Ares Prime that lowers stability, raises style, and speeds him up. For Turing-Ω the same shift only moves style between 0.08 and 0.28, because he stays controlled. Core AI has empty keyword lists, so his settings never move. The clamp ranges are the important part. Without them a line with four urgent words would push stability to zero and the voice would stop sounding like the same person. kiro-specs/voice-emotion-system.md states the rule: prefer slight variation over dramatic distortion.

### Making a human voice sound like a machine with four Web Audio nodes

Core AI is the cold optimizer. I wanted a synthetic, band-limited timbre, but ElevenLabs voices are built to sound human. So I take a normal voice and process it in the browser before it reaches the speakers.

```js
// src/voice.js
if (normalizedName === "Core AI") {
  const lowpass = ctx.createBiquadFilter();
  lowpass.type = "lowpass";
  lowpass.frequency.value = 1320;
  const highpass = ctx.createBiquadFilter();
  highpass.type = "highpass";
  highpass.frequency.value = 260;
  const notch = ctx.createBiquadFilter();
  notch.type = "notch";
  notch.frequency.value = 920;
```

The chain is highpass at 260 Hz, lowpass at 1320 Hz, a notch at 920 Hz with Q 2.8, then a DynamicsCompressor with threshold -30 dB, ratio 14, and a one millisecond attack. The two filters cut the voice down to a narrow telephone-like band. The notch takes a bite out of the middle so it sounds hollow. The compressor flattens the dynamics so every syllable hits at the same level, which reads as machine-like. Every other character connects source to gain directly.

Playing the MP3 blob through an HTMLAudioElement also died on iOS after the first line. Decoding with decodeAudioData and playing through a BufferSource gave me a graph I could filter and a context I could keep alive.

### Keeping one AudioContext alive for iOS

stopVoicePlayback() disconnects the active source and gain nodes, revokes any object URL, and cancels speechSynthesis. It deliberately does not close the AudioContext. On iOS Safari, audio stays unlocked only while the context resumed inside the user's first gesture is still alive. getOrCreateUnlockedAudioContext() creates it once, resumes it if suspended, and reuses it for every line, preview, and restart. The deploy click is that first gesture.

### Typewriter speed derived from the voice

ElevenLabs returns audio, not timing metadata, so I could not drive the typewriter from the speech. I estimate instead.

```js
// src/voice.js
const words = Math.max(1, text.trim().split(/\s+/).filter(Boolean).length);
const effectiveSpeed = settings.speed || 1;
const wordsPerMinute = 128 * effectiveSpeed;
const spokenMs = (words / wordsPerMinute) * 60000;
return Math.max(1800, spokenMs + 450);
```

128 words per minute times the character's speed, plus 450 ms for the round trip, with a floor of 1.8 seconds. In App.jsx the per-character interval is that duration divided by the line length, clamped between 26 and 74 ms. Speech and typewriter run in a Promise.all, so the bubble finishes near the audio and the next line waits for both. When the API is slow the text finishes first, but it never looks broken.

![One debate line flowing from the merged simulation through emotion settings, the ElevenLabs request, the Web Audio graph, and the typewriter in parallel](/blog/diagrams/voices-of-the-last-world-flow.svg)

### Only trusting the LLM with the creative fields

The merge step is small and it is the reason a model cannot break the game.

```js
// src/simulator.js
return {
  ...local,
  conversation: engineOutput.conversation,
  final_decision: {
    ...local.final_decision,
    summary: engineOutput.final_decision.summary,
    led_by: engineOutput.final_decision.led_by
  },
  result: engineOutput.result,
```

mergeEngineOutputWithLocal() runs simulateScenario() fresh, then overlays the four conversation lines, the decision summary, who led, the result, traits used, and risk level. Everything in meta stays local: the fit score, the strategy options, the tool kits, the influence split. It also rebuilds the narrative from the engine's result, so the outcome panel never contradicts the model. Before the merge, engine.js runs normalizeAgentName() on every speaker and the led_by field, mapping "turing", "omega", or any case variant back to the canonical key, and compactConversationLine() keeps only the first sentence, cut at 96 characters.

The scoring is a layered sum. Team fit is 32 plus the trait match for both agents, plus a synergy value from the GOOD_SYNERGY and BAD_SYNERGY pair maps (+16, -14, or +4 for neutral), minus penalties times 0.72. The three player choices then add STRATEGY_WEIGHTS (+20 correct, +4 risky, -20 wrong), a per-scenario directive fit, and an execution score, each with a stat delta table clamped to -30 to 30. applyPlayerChoice() structuredClone()s the simulation and rewrites the narrative by result tier.

## The hard parts

The async sequencing was the bug farm. React effects re-run, the player can hover a card during a preview, and a restart can land mid-line. My first version leaked voices into the next stage constantly. The fix was two monotonic counters, debateRunTokenRef and previewTokenRef. Every sequence captures the token when it starts, and every interval tick and post-await checkpoint compares it. Effect cleanups bump the token and call stopVoicePlayback(). The same cancel-preview block is copy-pasted into six functions in App.jsx, but it holds.

The thresholds are inconsistent. The local engine marks success at 64 and partial at 34. The prompt to Groq says 70 and 40. The interactive resolution after the player's three choices uses 72 and 46. These drifted during tuning and never got reconciled. The merge step hides it, because the final result always comes from resolveInteractiveOutcome(), but a second day would have cleaned it up.

The browser fallback badge never renders. DebateScreen receives a browserFallback prop and does nothing with it, even though specs/audio.md says fallback must be visible. In practice I watched the [BROWSER FALLBACK] console warning during testing.

API keys ship in the client. VITE_GROQ_API_KEY and VITE_ELEVENLABS_API_KEY are read from import.meta.env, so whatever is set at build time is in the bundle. For a hackathon demo on a scoped key that was an accepted trade-off, not something I would ship to the public.

Dead code is there. ChoiceScreen and ResultScreen in GameScreens.jsx are exported and never mounted, because I folded the choices and the result into DebateScreen late. The narrate() stub for result narration is empty because I turned the system voice off to save ElevenLabs quota for the debate lines. And the repo root has about 90 MB of demo video and GIFs committed next to the source.

## Results

Voices of the Last World shipped as a working build at voices-of-the-last-world.vercel.app with the full loop: intro, five scenarios, two-agent selection with voice previews, a voiced four-line debate, three player choices with voiced reactions, and a narrated outcome. The repo includes a gameplay recording (demo.mp4) and an agent-selection GIF. It was submitted to ElevenLabs Hack #5. No placement is recorded in the repo, so I will not claim one.

The game runs identically with zero API keys. I tested the whole loop with the local engine and browser speech before I added a key, which is why the demo never stalled.

## What I would do differently

Move the keys behind a tiny proxy. Two serverless routes on Vercel, one for Groq and one for ElevenLabs, would take the keys out of the bundle and allow a rate limit. That is an afternoon of work and the first thing I regretted skipping.

Pre-render the deterministic lines. The local engine has a finite set of lines per character per scenario. I could generate them once, store the MP3s under public/assets, and only hit the API for LLM-generated lines. The hover previews already work this way and they are instant.

Fix the thresholds and write tests. simulateScenario() and resolveInteractiveOutcome() are pure functions over static data. A table of every agent pair against every scenario would have caught the drift.

Give Turing-Ω a portrait so he can be picked. And replace the duration estimate with alignment data from ElevenLabs' timestamps endpoint, so the typewriter follows real character timing.

## Key takeaways

- When an LLM feeds a game or a UI, build a deterministic twin that emits the same schema and merge only the creative fields. A bad response degrades to a boring one instead of a broken one.
- Normalize every identifier a model returns before using it as a lookup key. Case variants and partial names are the common failure, and a small mapping function removes a class of demo-day crashes.
- Emotion in TTS does not need a model. Counting a few keywords per character and nudging stability, style, and speed inside clamp ranges gives expressive delivery without losing voice identity.
- You can get a convincing synthetic voice from a human voice model with four Web Audio nodes: highpass and lowpass to band-limit, a notch to hollow it out, and a hard compressor to flatten dynamics.
- On iOS Safari, create one AudioContext inside the first user gesture and never close it. Disconnect nodes between clips instead.
- Cancel async UI sequences with a monotonic token captured at start and checked after every await and inside every interval. It is cruder than AbortController but it survives React effect re-runs and restarts.

## FAQ

### How does Voices of the Last World give each AI character a different voice?

Voices of the Last World maps each character to a specific ElevenLabs voice ID and a per-character set of voice_settings (stability, similarity_boost, style, speed) in src/voice.js. Every debate line goes to the ElevenLabs text-to-speech endpoint with the eleven_multilingual_v2 model and that character's settings. Before the request, applyEmotionVariation() counts urgent and calm keywords in the line and shifts the settings inside per-character clamp ranges, so Ares Prime gets sharper on a line about a breach while Turing-Ω barely moves.

### Why does Voices of the Last World work without any API keys?

Voices of the Last World has a deterministic simulation engine in src/simulator.js that generates the debate, the decision, the scoring, and the player's choices from static data. engine.js only calls Groq if VITE_GROQ_API_KEY is set, and otherwise returns createFallbackEngineOutput(), which has the same JSON shape. Voice falls back to the browser's speechSynthesis if the ElevenLabs key is missing or a request fails. The APIs make the game better, not possible.

### How does Voices of the Last World make Core AI sound robotic?

Voices of the Last World plays Core AI's ElevenLabs audio through a Web Audio filter chain in the browser: a highpass at 260 Hz, a lowpass at 1320 Hz, a notch at 920 Hz with Q 2.8, and a DynamicsCompressor with a 14:1 ratio and one millisecond attack. The band-limiting and flattened dynamics turn a normal human voice model into a narrow, hollow, machine-like timbre. The other characters bypass the chain.

## Links

- Live demo: [voices-of-the-last-world.vercel.app](https://voices-of-the-last-world.vercel.app)
- Source: [github.com/anirxdh/voices-of-the-last-world](https://github.com/anirxdh/voices-of-the-last-world)
