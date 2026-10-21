---
title: "How I Gave Four AI Characters Their Own ElevenLabs Voices"
description: "Voices of the Last World is a browser crisis game where two AI minds debate in ElevenLabs voices. Here is the voice, DSP, and LLM fallback design behind it."
date: 2026-10-17
slug: voices-of-the-last-world
project: "Voices of the Last World"
tags: [ElevenLabs, Voice AI, Web Audio, Groq, React, Game Design]
repo: https://github.com/anirxdh/voices-of-the-last-world
live: https://voices-of-the-last-world.vercel.app
screenshot: /blog/shots/voices-of-the-last-world.webp
accent: "#ff8a65"
summary: "Voices of the Last World is a cinematic crisis-simulation game built for the Kiro x ElevenLabs Hack #5. Two AI Archive minds debate a 2098 emergency in distinct ElevenLabs voices, then the player commits the response. This is how the voice layer, the Web Audio robot filter, and the LLM-with-a-local-twin engine work."
---

## Two voices, one argument

Voices of the Last World is a cinematic crisis-simulation game built by Anirudh Vasudevan for ElevenLabs Hack #5, the Kiro x ElevenLabs hackathon. A player picks a 2098 emergency, sends two AI "Archive minds" to debate it out loud in distinct ElevenLabs voices, and then commits the final response. I built it in April 2026.

Hearing Ares Prime and Nova Sage disagree out loud is what sells it. Ares Prime runs at speed 1.04 and Nova Sage at 0.83, each with its own voice ID and voice_settings block in src/voice.js, so they read as two different speakers. The game is a React 19 and Vite 7 single-page app with no backend.

The judging rubric was 40 percent creativity, 40 percent partner technology, 20 percent presentation. ElevenLabs was the partner, so the voice layer in Voices of the Last World does more than call text-to-speech. It shifts settings per line, filters one character's voice, and falls back to the browser.

## Why the LLM is optional and the voices are not

The obvious build is a chat loop: send the scenario and two character sheets to a model and read the debate aloud. The repo has that path, src/engine.js calling Groq's openai/gpt-oss-20b, with two guards that show what I did not trust it with. normalizeAgentName(), imported from src/voice.js, maps case variants and partial names back to the canonical key, because "ares prime" instead of "Ares Prime" would drop the line into a centered bubble with no avatar and leave neither portrait lit as the speaker. compactConversationLine() keeps the first sentence, cut at 96 characters.

So the LLM became a flavor layer, not the engine. src/simulator.js deterministically produces the debate, decision, scoring, and choices from static data. engine.js asks Groq for a strict JSON-schema response, createFallbackEngineOutput() builds the same shape locally when the key is missing, and if the Groq request throws, App.jsx catches it and uses the local simulateScenario() result directly. The game state has the same shape on every path; only the content differs.

Another option is to have the model tag each line with an emotion. voice.js counts keywords instead, which fits the guardrail in kiro-specs/voice-emotion-system.md: prefer slight variation over dramatic distortion.

The demo video was the other constraint. The submission guide in the repo says not to let the recorded demo fall back to browser speech, so voice playback had to survive hover previews cutting each other off, a restart, and eight voice lines in a run. It was a hackathon build, and the repo has no tests.

## What the player does

The game opens with a skippable intro video and typewriter storyline. Next comes a carousel of five crises (Silent Signal, Mars Oxygen Collapse, Global AI Hack, Vanishing City, Archive Echo), each with a brief, a goal, and trait requirements. Then you pick two of four Archive minds from image cards. Hovering a card plays a muted video and a pre-rendered preview clip of that voice. The engine defines a fifth character, Turing-Ω, but src/appContent.jsx builds the roster from CHARACTER_MEDIA in src/media.js, which has no entry for it, so it never appears.

You press deploy. The two minds exchange two voiced opening lines with synchronized typewriter text. Then the game asks for a strategy (one correct, one risky), one of two tools (one from each agent's kit), and a finish style (Careful or Split Teams). A wrong strategy and a Full Commit finish exist in the data, but simulator.js slices both off. After each pick the agents answer with two more voiced lines, and the last pick resolves the mission into success, partial success, or failure.

## Architecture

Voices of the Last World is one Vite bundle on Vercel with no server of its own. The browser calls Groq and ElevenLabs directly with keys read from VITE_ prefixed environment variables at build time.

![Voices of the Last World architecture: a React SPA that talks directly to Groq and ElevenLabs, with a deterministic local simulator that can replace the LLM](/blog/diagrams/voices-of-the-last-world-architecture.svg)

App.jsx owns the phase and the debate stage. On deploy, its runSimulation() gets engine output from engine.js and merges it over the local twin with mergeEngineOutputWithLocal(), or uses the local twin alone if Groq throws. Each line then goes to speakAgentLine() in voice.js, which adjusts the settings for emotion, calls ElevenLabs, plays the MP3 through a Web Audio graph, and routes a missing key, a non-OK response, or a decode failure to speechSynthesis.

The real choices, layer by layer:

| Layer | Choice | Why |
| --- | --- | --- |
| App shell | React 19 + Vite 7, no backend | One static deploy, nothing to keep alive |
| Game engine | Deterministic simulator.js with trait and synergy scoring | Playable with no keys, same shape as the LLM |
| Debate text | Groq openai/gpt-oss-20b with strict json_schema response_format | Exactly four lines and enum'd result, local fallback on any error |
| LLM hardening | normalizeAgentName() plus first-sentence compaction to 96 chars | Name drift cannot knock a line out of its speaker's bubble |
| Voice synthesis | ElevenLabs eleven_multilingual_v2 with per-agent voice_settings | Distinct identity per character |
| Emotion | applyEmotionVariation() keyword counting with per-agent clamps | Expressive without losing identity |
| Playback | Web Audio BufferSource, GainNode, one persistent AudioContext | iOS Safari stays unlocked |
| Robot voice | highpass, lowpass, notch, DynamicsCompressor chain for Core AI | Synthetic timbre from a human voice model |
| Fallback | window.speechSynthesis with per-agent rate and pitch | Silence is worse than a worse voice |

## How it works

### Emotion as a bounded nudge on voice settings

Each character in voice.js has a list of urgent words and calm words, and every line is scanned for them before it goes to ElevenLabs.

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

Each net urgent word is a 0.06 shift. For Ares Prime that lowers stability, raises style, and speeds him up. Core AI has empty keyword lists, so his settings never move. The clamps matter most: Ares Prime starts at stability 0.34, so without them four urgent words would drop it to 0.10 and six would push it below zero, and the voice would stop sounding like the same person. Turing-Ω has clamps too, but since it cannot be selected, they never run in normal play.

### Making a human voice sound like a machine with four Web Audio nodes

To give Core AI a synthetic timbre, I process a normal ElevenLabs voice in the browser before it reaches the speakers.

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

The chain is highpass at 260 Hz, lowpass at 1320 Hz, a notch at 920 Hz with Q 2.8, then a DynamicsCompressor with threshold -30 dB, ratio 14, and a one millisecond attack. The two filters cut the voice to a narrow telephone-like band, the notch hollows out the middle, and the compressor makes every syllable hit at the same level, which sounds mechanical. Decoding the blob into a BufferSource is what gives me a graph to filter. Every other character connects source to gain directly.

### Keeping one AudioContext alive for iOS

stopVoicePlayback() disconnects the active nodes and cancels speechSynthesis, but it never closes the AudioContext. voice.js notes why: on iOS Safari, audio often stays unlocked only while a single context created after the first gesture is still alive. getOrCreateUnlockedAudioContext() creates it once on first playback, resumes it if suspended, and reuses it for every line and restart.

### Typewriter speed derived from the voice

The plain /v1/text-to-speech endpoint the game calls returns only audio, so I estimate the duration.

```js
// src/voice.js
const words = Math.max(1, text.trim().split(/\s+/).filter(Boolean).length);
const effectiveSpeed = settings.speed || 1;
const wordsPerMinute = 128 * effectiveSpeed;
const spokenMs = (words / wordsPerMinute) * 60000;
return Math.max(1800, spokenMs + 450);
```

That is 128 words per minute times the character's speed, plus a fixed 450 ms pad, floored at 1.8 seconds. In App.jsx the per-character interval is that duration divided by the line length, clamped between 26 and 74 ms. Speech and typewriter run in a Promise.all, so the next line waits for both.

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

mergeEngineOutputWithLocal() runs simulateScenario() fresh, then overlays the conversation, decision summary, who led, result, traits used, and risk level. Everything else in meta stays local, and the narrative is rebuilt from the engine's result so the merged state stays consistent. That lasts until the player's third choice. Then applyPlayerChoice() replaces the result, narrative, and decision summary using resolveInteractiveOutcome(), which ignores the model's result, so the final outcome panel can disagree with Groq.

App.jsx plays only conversation.slice(0, 2), so lines three and four of the model's output never play. The six reactions after the player's choices come from buildStrategyResponse(), buildDirectiveResponse(), and buildExecutionResponse(), scripted, not generated.

## The hard parts

The async sequencing is the trickiest code in App.jsx. React effects re-run, previews overlap, and a state change can re-run the opening effect mid-line, so a voice could leak into the next stage. The guard is two monotonic counters, debateRunTokenRef and previewTokenRef, captured by every sequence at start. The opening effect bumps debateRunTokenRef in its cleanup. runOpening() re-checks the token after each await, but playFollowupLines() only checks it inside the typewriter interval, so if the token moves mid-sequence the typing stops but the loop keeps speaking its remaining lines. The same cancel-preview block appears six times in App.jsx, seven counting the hover variant, which should have been one function.

The thresholds are inconsistent: success and partial sit at 64 and 34 in the local engine, 70 and 40 in the Groq prompt, and 72 and 46 in the interactive resolution. It only works because the final result always comes from resolveInteractiveOutcome().

The browser fallback badge never renders. DebateScreen receives a browserFallback prop and ignores it, even though the README promises a visible warning. Only the [BROWSER FALLBACK] console log remains.

The voice fallback has a gap. speakAgentLine() handles a missing key, a non-OK ElevenLabs response, and a decode failure, but it does not catch a rejected fetch. A network or CORS error propagates up to the try/catch in runOpening() or playFollowupLines(), which swallows it. The full line still lands in the debate thread, but it is never spoken and its typing animation is cut short when the next line starts. Wrapping the fetch in the same browser fallback would close it.

VITE_GROQ_API_KEY and VITE_ELEVENLABS_API_KEY are read from import.meta.env, so any key set at build time ends up in the client bundle. That was a hackathon trade-off: fine for a short-lived demo key, not for a public release. The repo also carries dead code (ChoiceScreen and ResultScreen are never mounted, and narrate() is an empty stub) plus about 95 MB of demo video and GIFs next to the source.

## Results

Voices of the Last World shipped as a working build at voices-of-the-last-world.vercel.app. The shipped game has five scenarios and four selectable characters, which makes six possible agent pairs per scenario. Each run speaks eight voiced lines: two opening lines, then two after each of the three choices.

The build runs with zero keys. Without VITE_GROQ_API_KEY the local engine writes the debate, and without VITE_ELEVENLABS_API_KEY every line plays through speechSynthesis with per-agent rate and pitch, so a full playthrough works from a fresh clone. The four hover preview clips are pre-rendered MP3s in public/assets/audio/characters, not API calls.

The repo includes a gameplay recording (demo.mp4) and two agent-selection GIFs. No placement at ElevenLabs Hack #5 is recorded in the repo.

## What I would do differently

Move the keys behind a tiny proxy. Two serverless routes on Vercel, one for Groq and one for ElevenLabs, would take the keys out of the bundle and allow a rate limit.

Pre-render the deterministic lines. The local engine has a finite set of lines, so I could generate those MP3s once and only call the API for LLM lines.

Fix the thresholds, write tests, and give Turing-Ω media so it reaches the roster. simulateScenario() and resolveInteractiveOutcome() are pure functions over static data, so a table of every agent pair against every scenario would catch the drift. I would also pace the typewriter from the decoded AudioBuffer's duration, which playWithWebAudio() already has before playback starts, instead of a words-per-minute guess.

## Key takeaways

- When an LLM feeds a game or a UI, build a deterministic twin with the same schema and merge only the creative fields. A bad response degrades to a boring one, not a broken one.
- Normalize every identifier a model returns before using it as a lookup key. Case variants and partial names are the usual failure.
- Emotion in TTS does not need a model. Counting a few keywords and nudging stability, style, and speed inside clamp ranges keeps the voice recognizable.
- A synthetic voice from a human voice model can take four Web Audio nodes: highpass and lowpass to band-limit, a notch to hollow it out, and a hard compressor to flatten dynamics.
- On iOS Safari, create one AudioContext on first playback, resume it if suspended, and never close it. Disconnect nodes between clips.
- Cancel async UI sequences with a monotonic token captured at start and checked on every interval tick and after the awaits that matter. Cruder than AbortController, but it survives React effect re-runs.

## FAQ

### How does Voices of the Last World give each AI character a different voice?

Voices of the Last World maps each character to an ElevenLabs voice ID and a set of voice_settings (stability, similarity_boost, style, speed) in src/voice.js. When an ElevenLabs key is configured, every line goes to the text-to-speech endpoint with the eleven_multilingual_v2 model and those settings, after applyEmotionVariation() nudges them inside per-character clamps.

### Why does Voices of the Last World work without any API keys?

Voices of the Last World has a deterministic simulation engine in src/simulator.js that generates the debate, decision, scoring, and choices from static data. engine.js only calls Groq if VITE_GROQ_API_KEY is set, and otherwise returns createFallbackEngineOutput() in the same JSON shape. If the Groq request throws, App.jsx uses the local simulateScenario() result directly. Voice falls back to speechSynthesis if the ElevenLabs key or voice ID is missing, ElevenLabs returns an error status, or the audio cannot be decoded.

### How does Voices of the Last World make Core AI sound robotic?

Voices of the Last World plays Core AI's ElevenLabs audio through a Web Audio chain in the browser: a highpass at 260 Hz, a lowpass at 1320 Hz, a notch at 920 Hz, and a DynamicsCompressor at 14:1. Band-limiting plus flattened dynamics turns a human voice into a narrow, machine-like timbre.

## Links

- Live demo: [voices-of-the-last-world.vercel.app](https://voices-of-the-last-world.vercel.app)
- Source: [github.com/anirxdh/voices-of-the-last-world](https://github.com/anirxdh/voices-of-the-last-world)
