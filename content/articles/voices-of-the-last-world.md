---
draft: true
title: "How I Gave Five AI Characters Their Own ElevenLabs Voices"
description: "Voices of the Last World is a browser crisis game where two AI minds debate in ElevenLabs voices. Here is the voice, DSP, and LLM fallback design behind it."
date: 2026-10-03
slug: voices-of-the-last-world
project: "Voices of the Last World"
tags: [ElevenLabs, Voice AI, Web Audio, Groq, React, Game Design]
repo: https://github.com/anirxdh/voices-of-the-last-world
live: https://voices-of-the-last-world.vercel.app
accent: "#ff8a65"
summary: "Voices of the Last World is a cinematic crisis-simulation game built for the Kiro x ElevenLabs Hack #5. Two AI Archive minds debate a 2098 emergency in distinct ElevenLabs voices, then the player commits the response. This is how the voice layer, the Web Audio robot filter, and the LLM-with-a-local-twin engine work."
---

## Two voices, one argument

Hearing Ares Prime and Nova Sage disagree is what sells this project. Ares is fast and sharp. Nova is slow and warm. Each of them has its own ElevenLabs voice ID and its own voice_settings block in src/voice.js, so back to back they read as two different speakers rather than one voice model reading both parts.

Voices of the Last World is a cinematic crisis-simulation game that lets a player pick a 2098 emergency, deploy two AI "Archive minds" who debate it out loud in distinct ElevenLabs voices, and then commit the final response, built by Anirudh Vasudevan for ElevenLabs Hack #5, the Kiro x ElevenLabs hackathon, in April 2026. It is a React 19 and Vite 7 single-page app with no backend.

The judging rubric was 40 percent creativity, 40 percent partner technology, 20 percent presentation. I read that as: make the voices the product.

## Why the LLM is optional and the voices are not

The obvious build is a chat loop: send the scenario and two character sheets to a model, stream back a debate, read it aloud. The repo has that path: src/engine.js calls Groq's openai/gpt-oss-20b. engine.js applies two guards that show what I did not trust it with. normalizeAgentName(), imported from src/voice.js, maps case variants and partial names of a speaker back to the canonical key (exact match first, then case-insensitive, then a fixed list of partials like "turing" or "omega"), because "Turing Omega" instead of "Turing-Ω" breaks the voice lookup. compactConversationLine() keeps the first sentence, cut at 96 characters, because a paragraph makes the typewriter crawl.

So the LLM became a flavor layer, not the engine. src/simulator.js is a deterministic simulation that produces the debate, the decision, the scoring, and the player's choices from static data. engine.js asks Groq for a strict JSON-schema response, but createFallbackEngineOutput() produces the same shape locally. If the key is missing or the request fails, the local version plays. The JSON shape is identical on both paths; only the wording of the lines differs.

The second constraint was the demo video. My submission guide in the repo says not to let the recorded demo fall back to browser speech, so the ElevenLabs path had to survive a phone, a hover preview, a restart, and eight voice lines in a run. The third was time. The repo has a single commit, no tests, and some dead code, which is what a hackathon build looks like.

## What the player does

Voices of the Last World opens with an intro video and a typewriter storyline you can skip. Next comes a carousel of five crises (Silent Signal, Mars Oxygen Collapse, Global AI Hack, Vanishing City, Archive Echo), each with a brief, a goal, and trait requirements for the scoring engine. Then you pick two Archive minds from a row of image cards. Hovering a card swaps its poster for a muted autoplay video and plays a pre-rendered preview clip of that voice. The engine defines five characters, but only four have media in src/media.js; Turing-Ω never got a portrait.

You press deploy. The two minds exchange two opening lines with voice and synchronized typewriter text. Then the game asks three things in order: a strategy (two options, one correct and one risky; each scenario also defines a wrong option that buildChoiceOptions() slices off), one of two tools (each drawn from a different agent's kit), and a finish style (Careful or Split Teams; EXECUTION_OPTIONS also defines Full Commit, and simulator.js slices that off the same way). After each pick the agents respond with two more voiced lines. The final pick resolves the mission into success, partial success, or failure, shown in an outcome panel with a written narrative.

## Architecture

Voices of the Last World is one Vite bundle on Vercel with no server of its own. The browser calls Groq and ElevenLabs directly with keys read from VITE_ prefixed environment variables at build time.

![Voices of the Last World architecture: a React SPA that talks directly to Groq and ElevenLabs, with a deterministic local simulator that can replace the LLM](/blog/diagrams/voices-of-the-last-world-architecture.svg)

App.jsx owns the phase (scenario, selection, debate) and the debate stage (opening, strategy, tool, execute, result). On deploy it calls runSimulationEngine() in engine.js, which either POSTs to Groq or returns the local twin from simulator.js. Either way the result passes through mergeEngineOutputWithLocal(), which overlays only the creative fields. If the Groq request throws, App.jsx skips the merge and uses simulateScenario() directly. DebateScreen in GameScreens.jsx renders the typed text; the line loop lives in App.jsx. Each line goes to speakAgentLine() in voice.js, which adjusts the settings for emotion, POSTs to the text-to-speech endpoint, and plays the MP3 through a Web Audio graph. Core AI gets an extra filter chain. Any failure routes to speechSynthesis.

The real choices, layer by layer:

| Layer | Choice | Why |
| --- | --- | --- |
| App shell | React 19 + Vite 7, no backend | One static deploy, nothing to keep alive |
| Game engine | Deterministic simulator.js with trait and synergy scoring | Playable with no keys, same shape as the LLM |
| Debate text | Groq openai/gpt-oss-20b with strict json_schema response_format | Four lines, enum'd result, no retries |
| LLM hardening | normalizeAgentName() plus first-sentence compaction to 96 chars | Name drift cannot break voice lookup |
| Voice synthesis | ElevenLabs eleven_multilingual_v2 with per-agent voice_settings | Distinct identity per character |
| Emotion | applyEmotionVariation() keyword counting with per-agent clamps | Expressive without losing identity |
| Playback | Web Audio BufferSource, GainNode, one persistent AudioContext | iOS Safari stays unlocked |
| Robot voice | highpass, lowpass, notch, DynamicsCompressor chain for Core AI | Synthetic timbre from a human voice model |
| Fallback | window.speechSynthesis with per-agent rate and pitch | Silence is worse than a worse voice |

## How it works

### Emotion as a bounded nudge on voice settings

ElevenLabs exposes stability, similarity_boost, style, and speed per request. An LLM-picked emotion label would be one more field to get wrong. The shipped version is dumber: each character has urgent words and calm words, and the line is scanned for them.

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

Each extra urgent word is a 0.06 shift. For Ares Prime that lowers stability, raises style, and speeds him up. For Turing-Ω the same shift only nudges style between 0.08 and 0.28 and stability between 0.62 and 0.86. Core AI has empty keyword lists, so his settings never move. The clamps matter most: without them four urgent words would push stability to zero and the voice would stop sounding like the same person. kiro-specs/voice-emotion-system.md states the rule: prefer slight variation over dramatic distortion.

### Making a human voice sound like a machine with four Web Audio nodes

ElevenLabs voices are built to sound human, so to give Core AI a synthetic timbre I process a normal voice in the browser before it reaches the speakers.

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

The chain is highpass at 260 Hz, lowpass at 1320 Hz, a notch at 920 Hz with Q 2.8, then a DynamicsCompressor with threshold -30 dB, ratio 14, and a one millisecond attack. The two filters cut the voice to a narrow telephone-like band. The notch hollows out the middle. The compressor flattens the dynamics so every syllable hits at the same level, which sounds mechanical. Every other character connects source to gain directly. The shipped path decodes the blob with decodeAudioData into a BufferSource, which gives me a graph I can filter.

### Keeping one AudioContext alive for iOS

stopVoicePlayback() disconnects the active source and gain nodes, revokes any object URL, and cancels speechSynthesis, but it never closes the AudioContext. voice.js notes why: on iOS Safari, audio often stays unlocked only while a single context created after the user's first gesture is still alive. getOrCreateUnlockedAudioContext() creates it once on first playback (inside playWithWebAudio, after the ElevenLabs fetch resolves), resumes it if suspended, and reuses it for every line, preview, and restart.

### Typewriter speed derived from the voice

ElevenLabs returns audio, not timing metadata, so I estimate the duration.

```js
// src/voice.js
const words = Math.max(1, text.trim().split(/\s+/).filter(Boolean).length);
const effectiveSpeed = settings.speed || 1;
const wordsPerMinute = 128 * effectiveSpeed;
const spokenMs = (words / wordsPerMinute) * 60000;
return Math.max(1800, spokenMs + 450);
```

128 words per minute times the character's speed, plus 450 ms for the round trip, floored at 1.8 seconds. In App.jsx the per-character interval is that duration divided by the line length, clamped between 26 and 74 ms. Speech and typewriter run in a Promise.all, so the next line waits for both.

![One debate line flowing from the merged simulation through emotion settings, the ElevenLabs request, the Web Audio graph, and the typewriter in parallel](/blog/diagrams/voices-of-the-last-world-flow.svg)

### Only trusting the LLM with the creative fields

The merge step is why a model cannot break the game.

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

mergeEngineOutputWithLocal() runs simulateScenario() fresh, then overlays the four conversation lines, the decision summary, who led, the result, traits used, and risk level. Everything else in meta (fit score, strategy options, tool kits, influence split) stays local, and the narrative is rebuilt from the engine's result so the outcome panel never contradicts the model. One honest detail: the opening effect in App.jsx plays only conversation.slice(0, 2), so lines three and four of the merged output are never spoken or shown. The six voiced reactions after the player's choices come from buildStrategyResponse(), buildDirectiveResponse(), and buildExecutionResponse() in App.jsx, scripted, not generated.

The scoring is a layered sum: 32 plus the trait match for both agents, plus a synergy value from the GOOD_SYNERGY and BAD_SYNERGY pair maps, minus penalties times 0.72, then STRATEGY_WEIGHTS (+20 correct, +4 risky; the -20 wrong branch is unreachable because buildChoiceOptions() slices the wrong option off before the player sees it), a directive fit, and an execution score.

## The hard parts

The async sequencing was the bug farm. React effects re-run, the player can hover a card during a preview, and a restart can land mid-line. Without a guard, a voice leaks into the next stage. The fix was two monotonic counters, debateRunTokenRef and previewTokenRef. Every sequence captures the token at start. The opening sequence in runOpening() re-checks it after each await; the follow-up loop in playFollowupLines() only checks it inside the typewriter interval, so after a restart the typewriter bails out but the for loop itself keeps going until its lines run out. Effect cleanups bump the token and call stopVoicePlayback(). The same cancel-preview block appears seven times in App.jsx: six identical copies plus a variant in the hover handler that runs the steps in a different order.

The thresholds are inconsistent. The local engine marks success at 64 and partial at 34. The prompt to Groq says 70 and 40. The interactive resolution after the three choices uses 72 and 46. It only works because the final result always comes from resolveInteractiveOutcome().

The browser fallback badge never renders. DebateScreen receives a browserFallback prop and does nothing with it, even though specs/audio.md says not to fall back silently and the README promises a visible warning. Only the [BROWSER FALLBACK] console log holds.

API keys ship in the client. VITE_GROQ_API_KEY and VITE_ELEVENLABS_API_KEY are read from import.meta.env, so whatever is set at build time is in the bundle. Fine for a demo on a scoped key, not for a public release.

Dead code is there. ChoiceScreen and ResultScreen in GameScreens.jsx are exported and never mounted; DebateScreen handles both itself. The narrate() stub is empty. The repo root also has about 95 MB of demo video and GIFs committed next to the source.

## Results

Voices of the Last World shipped as a working build at voices-of-the-last-world.vercel.app with the full loop: intro, five scenarios, two-agent selection with voice previews, two voiced opening lines from the engine, six scripted voiced reactions to the three choices, and an outcome panel with a written narrative. It runs with zero keys. The repo includes a gameplay recording (demo.mp4) and two agent-selection GIFs. It was built for ElevenLabs Hack #5. No placement is recorded in the repo, so I will not claim one.

## What I would do differently

Move the keys behind a tiny proxy. Two serverless routes on Vercel, one for Groq and one for ElevenLabs, would take the keys out of the bundle and allow a rate limit.

Pre-render the deterministic lines. The local engine has a finite set of lines per character per scenario, so I could generate the MP3s once, store them under public/assets, and only hit the API for LLM lines.

Fix the thresholds, write tests, and give Turing-Ω a portrait. simulateScenario() and resolveInteractiveOutcome() are pure functions over static data, so a table of every agent pair against every scenario would catch the drift. I would also replace the words-per-minute guess with the real clip length. playWithWebAudio() already has the decoded AudioBuffer and its duration before playback starts, so the typewriter could be paced from that instead of an estimate.

## Key takeaways

- When an LLM feeds a game or a UI, build a deterministic twin with the same schema and merge only the creative fields. A bad response degrades to a boring one, not a broken one.
- Normalize every identifier a model returns before using it as a lookup key. Case variants and partial names are the usual failure.
- Emotion in TTS does not need a model. Counting a few keywords and nudging stability, style, and speed inside clamp ranges keeps the voice recognizable.
- A synthetic voice from a human voice model takes four Web Audio nodes: highpass and lowpass to band-limit, a notch to hollow it out, and a hard compressor to flatten dynamics.
- On iOS Safari, create one AudioContext on first playback, resume it if suspended, and never close it. Disconnect nodes between clips.
- Cancel async UI sequences with a monotonic token captured at start and checked on every interval tick and after the awaits that matter. Cruder than AbortController, but it survives React effect re-runs.

## FAQ

### How does Voices of the Last World give each AI character a different voice?

Voices of the Last World maps each character to an ElevenLabs voice ID and a set of voice_settings (stability, similarity_boost, style, speed) in src/voice.js. Every line goes to the text-to-speech endpoint with the eleven_multilingual_v2 model and those settings, after applyEmotionVariation() nudges them inside per-character clamps.

### Why does Voices of the Last World work without any API keys?

Voices of the Last World has a deterministic simulation engine in src/simulator.js that generates the debate, decision, scoring, and choices from static data. engine.js only calls Groq if VITE_GROQ_API_KEY is set, and otherwise returns createFallbackEngineOutput() in the same JSON shape. Voice falls back to speechSynthesis if the ElevenLabs key is missing or a request fails.

### How does Voices of the Last World make Core AI sound robotic?

Voices of the Last World plays Core AI's ElevenLabs audio through a Web Audio filter chain in the browser: a highpass at 260 Hz, a lowpass at 1320 Hz, a notch at 920 Hz with Q 2.8, and a DynamicsCompressor at 14:1. Band-limiting plus flattened dynamics turns a human voice model into a narrow, hollow, machine-like timbre. The other characters bypass the chain.

## Links

- Live demo: [voices-of-the-last-world.vercel.app](https://voices-of-the-last-world.vercel.app)
- Source: [github.com/anirxdh/voices-of-the-last-world](https://github.com/anirxdh/voices-of-the-last-world)
