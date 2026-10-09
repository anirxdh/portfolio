---
title: "Faking a 225 Million Kilometer Phone Call to Mars"
description: "How FaceTime from Mars turns browser speech recognition, gpt-4o-mini and ElevenLabs voices into a push-to-talk call with three AI Mars colonists."
date: 2026-10-03
slug: facetime-from-mars
project: "FaceTime from Mars"
tags: [Voice AI, ElevenLabs, Web Audio API, React Three Fiber, FastAPI, Next.js]
award: "2nd Place, ElevenLabs x Replit Hackathon"
repo: https://github.com/anirxdh/facetime-from-mars-2159
accent: "#e0662f"
summary: "FaceTime from Mars is a push-to-talk voice call with three AI colonists living on Mars in 2159, built for the ElevenLabs x Replit hackathon. It hides a multi-second STT, LLM and TTS round trip behind a walkie-talkie interaction, a Web Audio radio filter and a 3D camera that pans between Earth and Mars."
---

## The latency problem that became the product

Most voice AI demos I had seen at hackathons had the same awkward gap. You speak, you stop, and you wait a few seconds while speech recognition, a language model and text-to-speech each take their turn. The gap reads as a bug.

For the ElevenLabs x Replit hackathon I decided to make the gap the whole point. If the person on the other end is 225 million kilometers away, a delay is not a bug. It is physics. So the app became a call to Mars.

FaceTime from Mars is a push-to-talk voice chat web app that lets you talk to three fictional Mars colonists living in the year 2159, built by Anirudh Vasudevan for the ElevenLabs x Replit Hack 3 hackathon. You hold a transmit button, speak, and a character-specific ElevenLabs voice answers through a space-radio filter while a 3D camera swings from Earth to Mars. The design spec is dated April 5, 2026 and the last commit landed April 9, so this was about four days of work.

## Why a walkie-talkie and not a real-time voice agent

The obvious approach was ElevenLabs Conversational AI: full-duplex voice, interruptions and streaming out of the box. I wrote it into the spec as the future upgrade path and did not use it, for three reasons.

First, the demo. A full-duplex agent sounds like a call center. I wanted a radio link, and radio links are half-duplex. The spec, docs/superpowers/specs/2026-04-05-signal-from-mars-design.md, records the decision in one line: walkie-talkie over full duplex, because the intentional delay masks latency.

Second, cost. The browser ships a free speech recognizer. The Web Speech API is not great, but it is zero backend and zero dollars. The spec notes the trade: Web Speech API over Whisper, good enough for demos.

The spec records only those two reasons. The third was in my head and never made it onto the page: control over the audio. The spec does call for a radio filter built from Web Audio nodes, and that is easy when the backend hands me a complete MP3 I can decode into an AudioBuffer. I did not want to spend hackathon hours finding out how to do the same thing to a streaming WebRTC track.

So the pipeline is plain: speech-to-text in the browser, text to a FastAPI backend, a short LLM reply, ElevenLabs text-to-speech, one MP3 back. Everything else exists to make that round trip feel deliberate.

## What a call looks like

FaceTime from Mars opens on three character cards: Zeph, a 16-year-old who has never seen Earth; Chef Riku, a food designer recreating Earth dishes he has never tasted; and Dr. Nova, the chief terraforming engineer. You pick one and accept the transmission.

A three-second "Establishing quantum relay" screen plays. It is a fixed timer in frontend/src/app/page.tsx, not a real connection. Then /api/intro returns the colonist's scripted opening line as audio, so Zeph says hello before you do anything.

You hold the TRANSMIT button, your live transcript appears, and the 3D camera glides toward Earth. You release, a "225M km" indicator pulses, and the camera pulls back. A few seconds later a burst of static plays, the camera dives toward Mars, and the colonist answers through a radio filter.

Topic chips suggest openers, a Mars clock shows the current sol, and every 15 to 30 seconds the screen glitches for 200 milliseconds. Ending the call shows a short report.

## Architecture

FaceTime from Mars is a monorepo with two services. The frontend is a Next.js 16 app on port 5000 with React 19, Tailwind v4 and React Three Fiber. The backend is a single-file FastAPI server, backend/main.py, on port 8000. frontend/next.config.ts rewrites /api/:path* to localhost:8000, so the browser only ever talks to the Next.js origin.

![FaceTime from Mars architecture: browser, Next.js proxy, FastAPI backend, OpenAI and ElevenLabs](/blog/diagrams/facetime-from-mars-architecture.svg)

On the left is the browser. TransmitButton.tsx is only the hold-to-talk control; it maps mouse and touch events to onStart and onStop. TransmissionPanel.tsx starts and stops the Web Speech API recognizer, owns the conversation state, the fetch calls and the Web Audio playback chain. MarsScene.tsx moves the camera from a focus value lifted up to page.tsx. On the right, backend/main.py holds the character definitions, an in-memory sessions dict and the endpoints: /api/chat calls OpenAI then ElevenLabs, /api/intro seeds a new session with the opening line, and /api/characters returns metadata without the prompts. Here is each layer and why I chose it.

| Layer | Choice | Why |
|---|---|---|
| Speech-to-text | Browser Web Speech API, continuous, interim results | Free, no backend, live transcript |
| Dialogue model | OpenAI gpt-4o-mini, max_tokens 120 | Short walkie-talkie replies; cheap and fast |
| Voice | ElevenLabs REST, eleven_turbo_v2_5, one voice per character | Low latency; stability 0.35, style 0.6 |
| Transport | MP3 body plus URL-encoded text in an X-Zeph-Text header | One round trip for audio and transcript |
| Playback | Web Audio bandpass, WaveShaper, gain, synthesized squelch | Clean TTS sounds like a radio |
| Session memory | In-memory dict keyed character:session_id, last 20 messages | Hackathon scope; no database |
| 3D scene | React Three Fiber, drei, procedural canvas textures | No texture images; camera follows conversation |
| Ambient audio | Oscillators, LFO, lowpass, panned blips | No audio files; created on user gesture |
| Deployment | Replit autoscale, start.sh boots FastAPI then Next.js | One project, one URL |

## How it works

### One response carries both the voice and the words

The chat endpoint has to hand back the MP3 and the text that was spoken. The usual answer is JSON with base64 audio, or two requests. I did neither. The MP3 is the response body and the reply text rides in a custom header.

```python
# backend/main.py
        return Response(
            content=tts_response.content,
            media_type="audio/mpeg",
            headers={
                "X-Zeph-Text": _safe_header(reply_text),
                "X-Session-Id": session_id,
            },
        )
```

HTTP headers must be ASCII and LLM output is not, so _safe_header runs the text through urllib.parse.quote with newlines flattened. The CORS middleware lists both headers in expose_headers so the browser may read them. On the frontend, sendMessage in TransmissionPanel.tsx reads the headers, calls decodeURIComponent on the text, and checks the content-type. Audio becomes a Blob and goes to the playback chain. If ElevenLabs returned anything other than 200, the backend falls back to plain JSON with the text and a null audio field, and the call degrades to a chat instead of failing.

The header is still named X-Zeph-Text even though there are three characters. The design spec only had Zeph, and the header name never changed when the other two colonists arrived.

### Making clean TTS sound like a bad antenna

ElevenLabs output is too clean for a call from Mars. The fix is playWithRadioEffect in TransmissionPanel.tsx. The decoded AudioBuffer goes through a BiquadFilter bandpass at 2500 Hz with a Q of 0.7, which cuts the low and high end like a small speaker, then a WaveShaper with a soft-clip curve.

```ts
// frontend/src/components/TransmissionPanel.tsx
  const waveshaper = ctx.createWaveShaper();
  const curve = new Float32Array(256);
  for (let i = 0; i < 256; i++) {
    const x = (i / 128) - 1;
    curve[i] = (Math.PI + 3) * x / (Math.PI + 3 * Math.abs(x));
  }
  waveshaper.curve = curve;
  source.connect(bandpass);
  bandpass.connect(waveshaper);
```

The curve maps samples from minus one to one onto a gently saturating S shape. Quiet parts stay almost linear; loud parts get squashed, which adds a slight crunch without turning into noise. A gain of 1.2 after the shaper makes up for level lost in the bandpass.

Around each reply, playRadioBeep fires a squelch: 150 to 200 milliseconds of white noise through a 2000 Hz bandpass, plus a sine chirp at 1200 Hz when the transmission opens and 800 Hz when it closes, decaying in 120 milliseconds. If decodeAudioData throws, a catch block falls back to a plain Audio element: no radio effect, but you still hear the voice.

### The camera follows the conversation

![One transmission in FaceTime from Mars from button press to colonist reply](/blog/diagrams/facetime-from-mars-flow.svg)

TransmissionPanel knows nothing about 3D. It calls an onFocusChange callback with "earth" when you start listening, "idle" while the request is in flight, "mars" when playback starts, and "idle" when it ends. page.tsx passes that value into MarsScene, where a CameraController runs every frame.

```ts
// frontend/src/components/MarsScene.tsx
    camera.position.lerp(targetPos.current, delta * 1.5);
    currentLookAt.current.lerp(lookAtPos.current, delta * 1.5);
    camera.lookAt(currentLookAt.current);
```

Each focus value maps to a camera position and a separate look-at point: near Earth at (5, 2, -2), near Mars at (-3, 0.5, 4), or the wide view at (1, 0.5, 7). Because the look-at point moves independently, the camera turns and travels at once, and a focus change mid-transition just redirects it.

The planets have no texture images. Mars is a THREE.CanvasTexture drawn at runtime: a rust gradient on a 1024 by 512 canvas, 8000 random translucent circles for craters, two pale polar bands and five dark ellipses. Earth is a blue canvas with six green ellipses. Crude up close, fine at the camera's distances, and nothing to ship or license.

### A soundscape with no samples

AmbientSound.tsx builds the background drone from oscillators. Two sawtooth waves at 70 Hz and 63 Hz run through a 120 Hz lowpass, which turns them into a dull rumble. A 45 Hz sine adds sub bass. A low-frequency oscillator at 0.08 Hz bends both drone frequencies by plus or minus 10 Hz so the sound never sits still.

```ts
// frontend/src/components/AmbientSound.tsx
    const lfo = ctx.createOscillator();
    lfo.type = "sine";
    lfo.frequency.value = LFO_RATE;

    const lfoGain = ctx.createGain();
    lfoGain.gain.value = LFO_DEPTH;

    lfo.connect(lfoGain);
    lfoGain.connect(drone1.frequency);
    lfoGain.connect(drone2.frequency);
```

Connecting a GainNode into another oscillator's frequency AudioParam is the Web Audio way to do frequency modulation. On top, a scheduler fires a random sine blip between 2.2 and 4.8 kHz every 5 to 10 seconds, panned across the stereo field. Browsers block audio until a user gesture, so the AudioContext is created only when you click the speaker icon.

### Three characters, one prompt shape

Each colonist in backend/main.py is a dict with a name, a description, an ElevenLabs voice id, a scripted intro line and a system prompt. The prompts share the same closing rules: one to three sentences, no stage directions, one question at a time, PG only. The length rule matters because every extra sentence is more TTS time and more waiting. max_tokens of 120 is the backstop.

Session history is keyed by character and session id together, so switching from Zeph to Dr. Nova never leaks his conversation into her context. Only the last 20 messages go to the model. The intro endpoint seeds the history with the opening line as an assistant turn, so the model knows it already said hello.

## The hard parts

The README says the conversation runs on the Claude API. The code imports the OpenAI SDK and calls gpt-4o-mini. The docs drifted from the code and I never corrected them.

The waveform visualizer is fake. WaveformVisualizer.tsx draws 40 bars with random heights every frame while isPlaying is true. There is no AnalyserNode. It looks right from across the room.

CORS is a wildcard, while replit.md claims it is restricted to localhost. The endpoints have no authentication and every call spends paid credits. /api/health also returns the first eight characters of each API key in its JSON response body. Fine for a weekend demo; not fine for anything public.

Sessions live in a Python dict. Restarting the backend wipes every conversation.

Deployment broke in a way I did not expect. The last commit is titled "Fix ASCII stdout crash in Replit deployment, sanitize TTS error output" and it does two things. It wraps sys.stdout and sys.stderr in a UTF-8 TextIOWrapper, with a code comment saying the Replit deployment defaulted to ASCII. And it ASCII-encodes the ElevenLabs error body before the intro endpoint prints it. Put together, a print of non-ASCII text under an ASCII stdout is the likely trigger, but the commit does not spell that out.

The Web Speech API is Chrome-first. In a browser that has no SpeechRecognition at all, holding the transmit button just shows an alert that says to try Chrome.

## Results

FaceTime from Mars took 2nd place at the ElevenLabs x Replit Hackathon. The shipped build has three characters with their own ElevenLabs voices, the radio chain, the camera choreography, the procedural soundscape, the Mars clock, glitches, topic chips and the end-of-call report. As of this writing, the Replit autoscale deployment returns Replit's "This app isn't live yet" page, so there is no live link here.

## What I would do differently

The upgrade I skipped is the one I would do first: ElevenLabs Conversational AI or a LiveKit agent for full-duplex voice, with the radio filter moved into an AudioWorklet so you can interrupt Dr. Nova mid-sentence. Short of that, I would stream the reply; starting playback on the first chunk would cut the perceived wait more than any model choice.

The waveform would get a real AnalyserNode. The health endpoint would stop returning key prefixes, CORS would be locked to the app origin, and sessions would move to Redis or SQLite so a restart does not drop a call.

## Key takeaways

- When a pipeline has unavoidable latency, build the product fiction around the delay. A push-to-talk radio makes a three-second wait feel correct; a phone call makes it feel broken.
- One HTTP response can carry binary audio in the body and metadata in URL-encoded custom headers. Add the headers to CORS expose_headers or the browser will silently hide them.
- A bandpass filter plus a soft-clip WaveShaper curve is enough to make studio-quality TTS sound like a radio. Bracket it with a noise burst and a chirp and the brain fills in the rest.
- Lerp both the camera position and a separate look-at vector every frame instead of tweening with fixed durations. Focus changes mid-flight stay smooth for free.
- Namespace in-memory chat history by character and session together, and seed it with the scripted opening line so the first reply matches what the user already heard.

## FAQ

### How does FaceTime from Mars handle voice AI latency?

FaceTime from Mars does not hide its latency; it reframes it. The interaction is push-to-talk, so the user expects a pause after releasing the button, and the UI shows a "Signal traveling to Mars" indicator while the request runs. The browser transcribes speech with the Web Speech API, a FastAPI backend calls gpt-4o-mini with a 120-token cap and then ElevenLabs eleven_turbo_v2_5, and the MP3 comes back in one response.

### How does FaceTime from Mars return audio and text in one request?

The FastAPI backend of FaceTime from Mars returns the MP3 bytes as the response body with media type audio/mpeg, puts the URL-encoded reply text in an X-Zeph-Text header and the session id in X-Session-Id, and exposes both through CORS. The frontend decodes the header for the chat log and checks the content-type: audio goes to the Web Audio chain, and a text-only JSON fallback is shown when text-to-speech fails.

### Which models and APIs power FaceTime from Mars?

FaceTime from Mars uses the browser Web Speech API for speech-to-text, OpenAI gpt-4o-mini for the colonist's reply, and the ElevenLabs text-to-speech REST API with the eleven_turbo_v2_5 model and a distinct voice per character. The 3D scene runs on React Three Fiber.

## Links

- Source: [github.com/anirxdh/facetime-from-mars-2159](https://github.com/anirxdh/facetime-from-mars-2159)
