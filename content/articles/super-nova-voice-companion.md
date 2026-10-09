---
title: "Wiring a Voice-Only Companion to MCP, Groq and ElevenLabs"
description: "How Super Nova turns continuous speech into MCP tool calls and on-screen widgets with a hand-written MCP client, regex-first routing, and ElevenLabs TTS."
date: 2026-10-03
slug: super-nova-voice-companion
project: "Super Nova"
tags: [MCP, Voice AI, Groq, ElevenLabs, Next.js, Web Speech API]
repo: https://github.com/anirxdh/Voice-companion
live: https://voice-companion-rust.vercel.app
accent: "#00bfa6"
summary: "Super Nova is a voice-only AI companion built for ElevenLabs' #ElevenHacks. Tap one orb, then speech alone summons weather, maps, music, YouTube, news and NASA widgets through a from-scratch MCP client, Groq tool calling and ElevenLabs speech, in a pixel-art office where sprites walk to the matching room."
---

## The orb is the only button

Super Nova has exactly one clickable thing: a glowing orb at the bottom of the screen. You tap it once to wake the microphone. After that, every action comes from your voice. Say "what's the weather in Tokyo" and a weather card slides onto the wall. Say "play some lofi" and a music desk appears with a visualizer. Nine pixel-art sprites snap to the office room that matches your request.

Super Nova is a voice-only AI companion web app that converts continuous speech into tool calls against MCP servers and public APIs, renders each result as an on-screen widget and speaks a reply, built by Anirudh Vasudevan for the ElevenLabs #ElevenHacks hackathon in May 2026. The README states the thesis: chat is still typing into a smaller box. I wanted to know whether voice in, fast inference, and fast speech out could feel like a real interface. The source is public: about 12,500 lines of TypeScript in a Next.js 15 app.

## Why regex runs before the LLM

The obvious design is the one in my own README diagram: speech goes to Groq, Groq classifies the intent, the intent runs. The shipped code does not work that way. "What's the weather" does not need a 70B model to decide it is a weather request. The README's own estimate puts a Groq classification at about 200 ms, and that is a round trip spent before anything moves on screen. A regex makes the same decision for free.

So the shipped build is two tiers, and the LLM is the second one. hooks/use-orchestration.ts walks a chain of matchers from lib/environment-intents.ts: local time, weather, news, sticky notes, browse-a-URL, directions, maps, Wikipedia, NASA APOD, timers and alarms, open and close browser. Each family is a set of regexes with its own extractor (extractWeatherCityQuery, extractDirectionsFromTo, extractTimerDurationSec). On a match, the hook calls an internal /api/* route, opens the widget, and speaks the route's speech string.

Only the residue reaches orchestrateIntent() in lib/mcp-client.ts. Even there, music and YouTube commands are regex-matched and sent straight to the hosted MCP servers. Groq with tool calling is the last resort, and pure conversation goes to a separate /api/conversation route with no tools.

The constraint was the demo loop: ElevenLabs was the sponsor, so the spoken reply had to feel immediate. The cost is brittleness: an unexpected phrasing can fall through to the LLM or hit the wrong family.

## What happens when you talk to it

You open the live site in Chrome (the Web Speech API is Chromium-only) and click the orb. The app requests mic permission, resumes an AudioContext inside that click so autoplay rules do not block later playback, and starts continuous recognition.

You speak. When Chrome marks a result final, the hook strips an optional "hey vee" prefix and hands the sentence to runIntent. The phase moves to thinking, which stops the mic. A widget opens: weather card, map with travel times, news ribbon, countdown timer, Wikipedia dossier, NASA photo, a music player with a 30-second Deezer preview, or a YouTube embed. The sprite for that room walks to its desk, and a reply plays.

## Architecture

Super Nova is a single Next.js 15 App Router project on Vercel. The browser does most of the work. The server side is a set of thin route handlers that hold the two secret keys (Groq and ElevenLabs) and return public data as JSON.

![Super Nova architecture: browser, Next.js routes, MCP servers and public APIs](/blog/diagrams/super-nova-voice-companion-architecture.svg)

On the left, hooks/use-voice.ts feeds final transcripts to hooks/use-orchestration.ts, which either resolves the request through a Next.js route or hands it to lib/mcp-client.ts for JSON-RPC to the hosted MCP servers or a tool pick from /api/groq. One Zustand store drives the widgets, phase machine and sprites. On the right are three hosted MCP servers (music, YouTube, agent messaging) plus key-free public APIs: Open-Meteo, Nominatim, OSRM, OpenStreetMap, Hacker News, Wikipedia, and NASA APOD.

The main choices, and why:

| Layer | Choice | Why |
|---|---|---|
| Speech to text | Web Speech API, continuous and interim | Free and instant; Chrome-only |
| Intent routing | Regex families first, Groq last | Most requests need no LLM |
| LLM | Groq llama-3.3-70b-versatile over SSE | Fast enough for a usable fallback tier |
| Tool protocol | Hand-written MCP client over Streamable HTTP | Wanted to see the wire protocol |
| Local capabilities | Synthetic built-in MCP server (lib/mcp-builtin.ts) | One uniform catalogue for Groq |
| Text to speech | ElevenLabs eleven_turbo_v2_5 via /api/elevenlabs | Sponsor model, four emotion presets |
| Music audio | Deezer preview into AudioContext plus AnalyserNode | Real FFT bars, no music API key |
| State | One Zustand 5 store with persist | Everything reads one place |

## How it works

### Keeping a Chrome microphone open

Chrome's SpeechRecognition is not built for always-on use. It fires onend after a few seconds of silence, raises no-speech and network errors on its own schedule, and transcribes the app's own speaker output. Most of hooks/use-voice.ts deals with this.

On onend, if no hold is active, the hook restarts recognition after 450 ms; no-speech and network errors restart after 300 ms, while not-allowed and audio-capture stop the loop for real.

A phase hold stops the mic while the phase is thinking or orchestrating and re-arms it 420 ms after the phase clears. A media suppression flag from hooks/use-media-mic-suppress.ts keeps the mic running during music or YouTube playback but passes only control phrases like "stop video", so speaker audio cannot trigger random commands.

Barge-in is the piece I like most. If a final transcript arrives while the phase is speaking, the hook kills the ElevenLabs audio and re-queues that transcript as the next intent:

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

Only final results interrupt, so the reply cannot interrupt itself from its own echo.

### A JSON-RPC MCP client in one file

I did not use an MCP SDK. lib/mcp-client.ts speaks the protocol directly: a POST per request with a JSON-RPC 2.0 body, and an accept header that allows either a JSON reply or an SSE stream. On startup, connectToMCPServers() sends initialize to every endpoint with protocolVersion 2024-11-05, stores the mcp-session-id response header per server, then sends tools/list and stamps each tool with its server URL.

```ts
// lib/mcp-client.ts
const sessionId = getSessionId(serverUrl);
const response = await fetch(serverUrl, {
  method: "POST",
  headers: {
    "content-type": "application/json",
    accept: "application/json, text/event-stream",
    ...(sessionId ? { "mcp-session-id": sessionId } : {})
  },
  body: JSON.stringify({ jsonrpc: "2.0", id: uid("rpc"), method, params }),
  signal
});
```

parseMcpPayload() handles both reply shapes: JSON is parsed directly, and an SSE body is parsed from its last data: line. Every JSON-RPC call after initialize runs inside an AbortController timeout (18 seconds by default, 14 for tools/list, 30 for tools/call) and a retry() wrapper with linear backoff. Discovery uses Promise.allSettled so one dead server does not block the others.

The messaging relay added a wrinkle: its inbox and send tools fail with a "not registered" error until an agent calls register. So for any messaging tool that messagingToolLikelyUsesAgent() matches (read-inbox, send-message, unread-count and friends), executeMCPTool() calls invokeRelayRegister() first, with arguments built from the register tool's inputSchema.properties and required arrays, and only then calls the tool. If the result still reads as unregistered, it registers again and retries the original call once. That second path is the fallback, not the normal route.

### Namespacing tools for Groq

When a request falls through to the LLM, the browser POSTs the intent plus the tool catalogue to /api/groq, which calls Groq with OpenAI-style function tools and streams tokens back as SSE.

First, the music server and the YouTube server both expose play and search, and function calling needs unique names. On the server, lib/groq-slugs.ts prefixes each tool with the first label of its hostname:

```ts
// lib/groq-slugs.ts
export function groqSlugForMcpTool(tool: MCPTool): string {
  const prefixed = `${endpointSlugPrefix(tool.serverUrl)}__${tool.name}`
    .replace(/[^a-zA-Z0-9_-]/g, "_");
  return prefixed.slice(0, 112);
}
```

The system prompt in lib/groq.ts tells the model which prefix means music, video or messaging. On the way back, resolveMcpToolFromGroqSlug() maps the slug to the original tool and server. The catalogue is capped at 80 tools.

Second, Groq streams a tool call across many deltas, a few characters of arguments JSON per chunk. app/api/groq/route.ts aggregates by index first:

```ts
// app/api/groq/route.ts
for (const tc of tcs) {
  const ix = tc.index ?? 0;
  let row = toolAgg.get(ix);
  if (!row) { row = { name: "", arguments: "", id: undefined }; toolAgg.set(ix, row); }
  if (tc.id) row.id = tc.id;
  if (tc.function?.name) row.name += tc.function.name;
  if (tc.function?.arguments) row.arguments += tc.function.arguments;
}
```

After the stream ends, the route parses each arguments string and sends one tool_call event per call.

![One request through Super Nova: inbox check via Groq, auto-registration on the messaging MCP, ElevenLabs speech](/blog/diagrams/super-nova-voice-companion-flow.svg)

The diagram follows "check my relay inbox". No regex family claims it, but lib/intent.ts marks it as an action, so it reaches orchestrateIntent(). Groq picks the read-inbox slug, the client registers first, then calls read-inbox, and retries once if the relay still says it is not registered. The relay widget opens while a short reply is spoken.

### Built-in tools that look remote

Half of Super Nova's capabilities are Next.js routes, not MCP servers. I did not want two code paths in the Groq tier, so lib/mcp-builtin.ts declares a synthetic server at a fake veil.builtin URL (Veil was the codename) with six tools: headlines, maps_place, browse_page, wiki_scout, orbit_apod and sticky_note. Each has a JSON-schema inputSchema like the remote ones, and getAvailableTools() returns both kinds in one array.

executeMCPTool() checks isVeilBuiltinServerUrl() first. For built-ins it skips JSON-RPC and calls runVeilBuiltinToolOutput(), which fetches the matching /api/* route and reshapes the JSON into an MCP-style result with a content text block and structuredContent.

### Speaking back

Every reply goes through app/api/elevenlabs/route.ts, which forwards to the ElevenLabs stream endpoint with model eleven_turbo_v2_5, picks one of four voice_settings presets (calm, warm, urgent, focused), and pipes the upstream body back as audio/mpeg.

The client in lib/elevenlabs.ts is simpler than the README suggests: speakWithElevenLabs() awaits response.blob() and plays it through a new Audio element, so the browser waits for the whole MP3 before the first sound. The README's claim that playback starts at the first chunk is not what the code does.

Music is different. A play command returns a Deezer previewUrl, and lib/music-player.ts wires it into an AudioContext with an AnalyserNode (fftSize 256) that components/playback-wall-visualizer.tsx reads every frame. That is the only real FFT in the app; the mic level shown while listening comes from transcript length, not audio.

## The hard parts

The microphone was the hardest part. Stopping it during speech meant no barge-in. Leaving it on meant the reply interrupted itself. The combination that works is finals only, phase holds, and media suppression with a control-phrase allowlist.

Some things are hacky or broken:

- hooks/use-orchestration.ts calls /api/browser at four sites for an agent-browser integration meant to click and type inside the embedded page. The route does not exist, so the calls fail silently.
- Sticky notes write a JSON file at process.cwd(), which does not persist on Vercel's read-only filesystem.
- The README describes lib/mic-analyser.ts and a Three.js colony. The analyser file does not exist, the Three.js scene sits unimported in components/_legacy/three-d next to other unused scaffolding (agents/*.ts, services/proactive-service.ts, lib/context-engine.ts, lib/perception-layer.ts), and the live background is an MP4 loop with PNG backdrops behind the widgets.
- The directions route only trusts OSRM for driving. Walking and cycling are haversine distance times 1.28 and 1.18 path factors.
- There are no tests and no CI.
- The regex tier has sharp edges: wantsMapsOrchestration carries a list of non-map keywords so "show me the news" does not become a map search.

## What shipped

Super Nova is live at voice-companion-rust.vercel.app and the source is public. The README links a demo GIF and a YouTube walkthrough. It was built with Cursor for ElevenLabs #ElevenHacks; the README says seven days, and the Git history shows commits from May 11 to May 14, 2026. No placement or award is recorded in the repository.

## What I would change

I would move speech synthesis to real streaming. The server already proxies a stream; the client should use MediaSource or the Web Audio API to start playback on the first chunk. Nothing else would cut perceived latency more.

I would replace the regex tier with a small classifier that returns a family and extracted slots, keeping the fast path but not the hand-written exception lists. I would also delete the dead scaffolding, move notes to a real store, and switch to an MCP SDK.

## Key takeaways

- Decide whether a request needs an LLM before calling one. A deterministic tier in front of tool calling removes a round trip from the common case.
- Function-calling tool names must be unique, so prefix each tool with a stable label from its server and tell the model what the prefixes mean.
- Streamed tool calls arrive as fragments. Aggregate by index and parse arguments only after the stream closes, or you will JSON.parse half an object.
- Present local capabilities as a fake MCP server with real inputSchemas, so the model sees one shape and the dispatcher picks the transport at runtime.

## FAQ

### How does Super Nova decide whether to use an LLM?

Super Nova runs a chain of regex matchers from lib/environment-intents.ts before any model call. About a dozen families run against internal Next.js routes with no LLM, and music and YouTube commands go straight to their MCP servers. Only requests that match none of these reach Groq's llama-3.3-70b-versatile with tool calling.

### How does Super Nova talk to MCP servers without an SDK?

Super Nova's lib/mcp-client.ts implements the MCP Streamable HTTP transport by hand. It POSTs JSON-RPC 2.0 requests, sends initialize with protocolVersion 2024-11-05, stores the mcp-session-id header per server, then calls tools/list and tools/call. It parses both JSON and SSE replies and wraps each call in a timeout with retries.

### How does Super Nova handle interruptions while it is speaking?

Super Nova keeps the microphone open while a reply plays. If Chrome produces a final transcript during the speaking phase, hooks/use-voice.ts stops the ElevenLabs audio with interruptSpeech() and re-queues that sentence as the next intent. Interim results never interrupt.

## Links

- Live demo: https://voice-companion-rust.vercel.app (Chrome only)
- Source: https://github.com/anirxdh/Voice-companion
