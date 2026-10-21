---
title: "Lessons From Building a Dozen Voice AI Agents and Apps"
description: "What twelve voice AI builds taught me about latency, turn-taking, interruptions, TTS choice, captions, fallbacks, and browser versus server speech to text."
date: 2026-10-21
slug: lessons-building-voice-ai-agents
project: "Voice AI lessons"
kind: guide
tags: [Voice AI, ElevenLabs, LiveKit, Web Audio, Web Speech API, Groq]
accent: "#4fd1c5"
summary: "I built twelve voice AI projects in 2026, from hackathon games to a voice CPA and a browser agent. This guide pulls out what they taught me: design around latency, keep spoken replies short, decide who owns the turn, direct the voice with settings, and ship a fallback that still talks."
---

## Twelve voice builds, one recurring problem

Every voice project I build hits the same wall in the first hour. Someone talks, then waits. Speech to text, a language model and text to speech each take a turn, and the silence between them sounds like a bug.

This guide is a field report on building voice AI agents, written by Anirudh Vasudevan from twelve voice projects he built in 2026, most of them for hackathons. Each lesson points at the project where I learned it. I now build production voice agents at Rivo, but everything here comes from public write-ups you can check.

These are the twelve:

- [FaceTime from Mars](/blog/facetime-from-mars/): push-to-talk calls to Mars (2nd Place, ElevenLabs x Replit).
- ScreenSense [v1](/blog/screensense-v1-talk-to-your-screen/), [v2](/blog/screensense-v2-amazon-nova-agent-loop/) and [v3](/blog/screensense-voice-browser-agent/): a Chrome extension you talk to (v3 won Best Voice Agent, ElevenLabs x Firecrawl).
- [Super Nova](/blog/super-nova-voice-companion/): a voice-only companion over MCP.
- [The Missing Angle](/blog/the-missing-angle-voice-mystery/): interrogate AI suspects out loud.
- [Tax It Easy](/blog/moss-voice-cpa-yc-hackathon/): a voice CPA on LiveKit.
- [Director](/blog/director-fal-voice-video-editor/): a video editor you direct by voice.
- [Spotify for Hackers](/blog/spotify-for-hackers-ai-dj/): an AI DJ.
- [Voices of the Last World](/blog/voices-of-the-last-world/): two AI characters debate out loud.
- [Jungle Safari](/blog/jungle-safari-prewarmed-voice-quiz/): a toddler quiz with a talking owl.
- [VoiceCaptcha](/blog/voicecaptcha-voice-turing-test/): pass a CAPTCHA by speaking.
- [Apartment 4B](/blog/apartment-4b-horror-game/): a horror game with voiced tapes (3rd Place, ElevenHacks).
- [D-ID You](/blog/d-id-you-ai-presenter/): an AI presenter narrating any video.

## Lesson 1: latency is a design problem first

The cheapest way to fix a delay is to give it a reason. In FaceTime from Mars the person on the other end is 225 million kilometers away, so a pause is physics, not lag. The design spec records the choice in one line: walkie-talkie over full duplex, because the intentional delay masks latency. While the request runs, a "225M km" indicator pulses, and when the reply plays the 3D camera dives toward Mars.

The second cheapest fix is to not make the call at all. Jungle Safari has 55 animals, and wrong answers always come from the same category, so the set of possible mascot lines is finite: by my count 469 entries. A script generates every one ahead of time into Upstash Redis, and each round prewarms all four outcomes, so any tap is a cache read. Apartment 4B goes further and treats ElevenLabs as a build tool. Its MP3s are committed to the repo, and the game makes no API calls at runtime.

When the call has to happen live, fill the gap with something useful. Spotify for Hackers starts the next song quietly under the DJ's voice instead of waiting for the voice to finish:

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

The ratio is 0.26, so a slow Groq or ElevenLabs call means a few more seconds of quiet music, never silence. Director does the same with speech: slow tools run inside a filler helper so the agent keeps talking while fal renders, and long renders get a filler line after 8 seconds of silence.

Then cut real time where you can. In The Missing Angle the Groq stream goes straight into the Speech Engine session, so the first words reach text to speech before the model finishes. ScreenSense v3 runs transcription, the DOM scrape and the Firecrawl scrape under one Promise.all, and sends audio straight to the speech to text provider, skipping its own backend. Super Nova's client still waits for the whole MP3 before the first sound, and streaming playback is the top latency fix in both its write-up and FaceTime from Mars.

## Lesson 2: keep spoken replies short, in the prompt and in code

A sentence that reads fine on screen takes seconds to say. Every extra sentence is more TTS time and more waiting. So every voice build I ship caps reply length twice: once in the prompt and once in code.

FaceTime from Mars tells each colonist to answer in one to three sentences and caps the model at 120 tokens. Spotify for Hackers asks Groq for one spoken line under 22 words and uses llama-3.1-8b-instant, because a small model returns a line that short quickly (I did not benchmark it). Jungle Safari asks for under 30 words. ScreenSense v1 writes a long answer to the screen, then asks for a spoken summary under 20 words.

Prompts are not enough. The Missing Angle's suspects kept adding stage directions and ending replies with a question. So clean_spoken_reply strips markup and parentheticals and drops every sentence ending in a question mark, and trim_reply_length caps the result at three sentences and 52 words. Voices of the Last World keeps only the first sentence of each model line, cut at 96 characters. Treat model text bound for a speaker as untrusted input.

## Lesson 3: decide who owns the turn

I have shipped three answers to the question of who owns the turn.

The first is half duplex: the user holds a button. FaceTime from Mars has a hold-to-talk transmit button, and ScreenSense a backtick key with a 200 ms hold timer. It is predictable, but the user cannot cut in.

The second is to let a voice platform own the turn. In The Missing Angle, ElevenLabs Speech Engine owns the microphone, speech to text, turn-taking, interruptions and text to speech, and my server only supplies the words. Tax It Easy and Director run on LiveKit Agents. Tax It Easy shows the one place you still have to think: before its sign-off tool writes an approval, it calls disallow_interruptions(), so a barge-in cannot half-complete the change.

The third is to build barge-in by hand, which is what Super Nova does with Chrome's speech recognizer. The microphone stays open while the reply plays. If a final transcript arrives during the speaking phase, the hook kills the audio and treats the new sentence as the next request:

```ts
// hooks/use-voice.ts
if (phaseRef.current === "speaking" && final.trim().length > 1) {
  micHoldRef.current = true;
  interruptSpeech();
  lastFinalRef.current = "";
  try { recognitionRef.current?.stop(); } catch { /* ignore */ }
  useSuperNovaStore.getState().setPhase("idle");
  const interruptedIntent = final.trim();
  window.setTimeout(() => onIntent(interruptedIntent), 80);
  return;
}
```

Only final results interrupt, so the reply cannot interrupt itself from its own echo. A media flag keeps the mic running during music but only passes control phrases like "stop video."

![One voice turn with barge-in: the mic stays open, only a final transcript interrupts, and playback ending reopens the mic](/blog/diagrams/lessons-building-voice-ai-agents-flow.svg)

ScreenSense v3 reopens the mic after the agent asks a question, driven by the audio's ended event, not a timer, because speech length varies too much. It also taught me to test the interrupt path: its handler checks for a Speaking state that nothing ever sets, so the branch never runs. That bug shipped.

## Lesson 4: pick the TTS model per job, then direct it

I use different ElevenLabs models for different jobs. For live replies I used eleven_turbo_v2_5 in FaceTime from Mars and Super Nova, and eleven_flash_v2_5 in ScreenSense and Director. For character performances, eleven_multilingual_v2: the Apartment 4B tapes (baked ahead of time), the Voices of the Last World characters and the Jungle Safari owl (cached in Redis). Spotify for Hackers uses eleven_v3 because it reads bracketed text as acting direction, so each DJ host prepends a delivery string like "[young female DJ, festival hype, crisp mic, big smile in the voice]".

Voice settings are direction, and they belong in source control. Apartment 4B's first four tapes use stability around 0.3 so Mrs. Hollis sounds shaken, and tape 5 jumps to 0.45 with style at 0.2 so she sounds flat and certain. Voices of the Last World computes a shift of 0.06 per net urgent keyword and applies it to stability, style and speed inside clamps, so the voice gets tense and still sounds like the same person.

The voice can be shaped after the API, too. FaceTime from Mars runs replies through a 2500 Hz bandpass and a soft-clip WaveShaper to sound like a radio, and Voices of the Last World makes one character robotic with four Web Audio nodes.

Read the vendor plugin before the demo. Tax It Easy's stock MiniMax plugin hit an endpoint that returned HTTP 200 with zero audio for an international account. An empty success is worse than a stack trace.

## Lesson 5: captions need a clock

Text on screen has to match the voice, and the timing has to come from somewhere real. The simplest version is one response: FaceTime from Mars returns the MP3 as the body and the reply text URL-encoded in a custom header, listed in CORS expose_headers so the browser can read it.

Estimated timing drifts. Voices of the Last World paces its typewriter at 128 words per minute times the voice speed, when the decoded AudioBuffer already knows the real duration. D-ID You builds captions from a separate ElevenLabs synthesis, not the audio the presenter speaks, so they can drift (I never measured how far). My [YouTube Shorts Factory](/blog/youtube-shorts-factory-automated-pipeline/) fixed this properly: it sends the final audio to Whisper for word timestamps and burns those captions instead. Time captions against the audio you ship.

## Lesson 6: browser speech to text for feedback, server for decisions

The browser's Web Speech API is free, instant and needs no backend. FaceTime from Mars and Super Nova both use it, and both pay for it: it is Chrome-first, it stops after silence on its own schedule, and Super Nova spends most of its voice hook restarting it.

VoiceCaptcha made the split clear. It runs two recognizers on purpose. Chrome's recognizer only lights up words as you read the phrase, and its text never reaches the server. The one that counts is Groq's whisper-large-v3 on a Cloudflare Worker, which decides pass or fail. A lying client cannot change the result.

Server-side choices moved with constraints. ScreenSense v1 shipped Groq Whisper because one free key covered transcription and vision. v2 used AWS Transcribe with a Groq fallback. v3 tries Groq Whisper, then ElevenLabs Scribe, then Deepgram. The LiveKit builds use Deepgram nova-3.

Two browser details cost me time. In a Chrome extension, record in an offscreen document so the mic permission is granted once on the extension origin. And await MediaRecorder's stop event before reading the chunks, because the last ondataavailable fires just before stop.

## Lesson 7: every voice needs a fallback that still talks

Silence is worse than a worse voice. Voices of the Last World plays a full run with zero keys: a deterministic engine writes the debate, and every line falls back to the browser's speechSynthesis with per-character rate and pitch. Spotify for Hackers returns HTTP 200 with a hard-coded line when Groq fails. FaceTime from Mars falls back to text when ElevenLabs fails. Tax It Easy switches to Cartesia when the MiniMax keys are missing.

Test the fallback with the key unset. Voices of the Last World catches a missing key, an error status and a decode failure, but not a rejected fetch, so on a network error the line is never spoken.

## Lesson 8: the first tap is infrastructure

Browsers block audio until a user gesture, and iOS Safari is strict. On an iPhone the Spotify for Hackers DJ stayed silent until the splash tap primed both audio elements with a silent clip. Voices of the Last World creates one AudioContext on first playback and never closes it. Apartment 4B makes you hold a button for three seconds, and that press unlocks the audio. Super Nova resumes its AudioContext inside the orb click. Plan the first tap on purpose.

## How I would build a voice agent today

This is the pipeline I start from now. Each piece comes from a build above.

![A voice turn assembled from twelve builds: browser capture, server STT, a router before the LLM, a short-reply model, a cleaner, TTS and Web Audio playback, with fallbacks](/blog/diagrams/lessons-building-voice-ai-agents-architecture.svg)

| Layer | Choice | Why |
|---|---|---|
| Turn model | Push to talk for a demo, a voice platform for conversation | Speech Engine and LiveKit handle barge-in |
| Live captions | Browser recognizer, never trusted | Instant words, no say in the result |
| Speech to text | Hosted Whisper or Deepgram in a provider chain | One failing vendor does not end the turn |
| Routing | Deterministic matcher before the LLM | Super Nova skips the model for timers and maps |
| Reply model | Small fast model with a hard token cap | Short replies are fast replies |
| Reply hygiene | Code that strips questions and stage directions | Prompts alone did not hold |
| Voice | Turbo or Flash live, multilingual v2 for characters | What worked for each job |
| Playback | One long-lived AudioContext | iOS unlock, filters, ducking |
| Fallback | Browser speech or a canned line | Silence is the worst outcome |

## Key takeaways

- Give the delay a reason or remove the call. A walkie-talkie makes a pause feel correct, and a finite answer space can be generated ahead of time.
- Fill gaps with sound that means something: quiet music under a voice, or a filler line while a tool runs.
- Cap spoken length in the prompt and again in code.
- Decide who owns the turn first. Only final transcripts should interrupt, and the playback ended event should reopen the mic.
- Use browser speech recognition for feedback and server transcription for anything that decides an outcome.
- Every voice path needs a fallback that still speaks, and you should test it with the key removed.

## FAQ

### How do you reduce latency in a voice AI agent?

In my twelve voice builds the biggest wins were design, not models. FaceTime from Mars made the delay part of the story, Jungle Safari pre-generated every reply into Redis, and Spotify for Hackers started the next song quietly under the voice. After that: stream the LLM into TTS, run steps in parallel, keep replies short, and play the first audio chunk early.

### Should a voice agent use browser speech recognition or a server STT model?

Use both, for different jobs. The browser Web Speech API is free and instant, good for live captions, but it is Chrome-first and stops on its own schedule. VoiceCaptcha uses it only for feedback and lets Groq Whisper on a Cloudflare Worker decide. ScreenSense v3 chains three hosted providers so one failure does not end the turn.

### How do you handle interruptions (barge-in) in a voice agent?

Either let a platform own it or build it carefully. ElevenLabs Speech Engine and LiveKit Agents handle barge-in for you, as in The Missing Angle and Tax It Easy. Super Nova builds it by hand: the mic stays open while the reply plays, and only a final transcript stops the audio and becomes the next request, so the reply cannot interrupt itself from its own echo.

### Which ElevenLabs model should I use for a voice agent?

In my twelve voice builds I used eleven_turbo_v2_5 or eleven_flash_v2_5 for live replies, eleven_multilingual_v2 for character performances such as Apartment 4B's tapes, and eleven_v3 in Spotify for Hackers for bracketed acting direction. Keep voice settings like stability and style in source control next to the text.

### What should a voice agent do when the TTS API fails?

It should still talk. Voices of the Last World and Spotify for Hackers fall back to the browser's speech synthesis, FaceTime from Mars falls back to text, and Tax It Easy switches TTS provider when keys are missing. Test every fallback with the key removed, including network errors.
