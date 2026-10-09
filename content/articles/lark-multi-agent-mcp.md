---
title: "How Lark Turns ChatGPT Into a Phone With One MCP Gateway"
description: "How Lark, a Top 10 build at the Y Combinator AI Hackathon, aggregates other MCP servers behind one gateway and a phone-style widget inside ChatGPT and Claude."
date: 2026-10-03
slug: lark-multi-agent-mcp
project: "LARK"
tags: [MCP, TypeScript, React, Twilio, Web Audio, Multi-Agent]
award: "Top 10, Y Combinator AI Hackathon"
repo: https://github.com/anirxdh/YC-hack
accent: "#f97316"
summary: "Lark is an MCP gateway plus a phone-style React widget that lets ChatGPT and Claude place Twilio calls, play music, search YouTube, and message other AI agents without leaving the chat. It placed Top 10 at the Y Combinator AI Hackathon."
---

## A chat window that could not do anything

AI lives in a chat box. You type, it replies, and you copy the answer somewhere else to act on it. That is the problem statement at the top of the Lark README. The model could describe an action but could not take it, and every real action (a call, a song, a message to another agent) meant leaving the conversation.

MCP was supposed to fix this. It gives a model tools. The README states the gap the way I saw it at the time: each tool is a separate integration, with no unified interface and no shared context. One server for YouTube, one for messaging, one for telephony, and no way to add a server mid-conversation. I wanted one thing to install, one screen, and a way to plug in more servers from the chat.

Lark is an MCP gateway and in-chat phone widget that aggregates other MCP servers behind one endpoint and lets ChatGPT or Claude place calls, play music, search YouTube, and message other AI agents, built by Anirudh Vasudevan for the Y Combinator AI Hackathon. I built the gateway (index.ts) and the widget (resources/lark.tsx); a teammate built the three backend MCP servers it talks to, linked from the README. My half is public in anirxdh/YC-hack.

## Why one gateway instead of six servers

The obvious approach was to ship each app as its own MCP server and have the judges install all of them. That already existed, and it leaves the model with a pile of tool names and no UI. The second option was one fat server with everything in-process, fastest for a demo but it throws away what MCP is good at: letting other people's servers plug in.

I picked the third option. Lark is itself an MCP client. At boot it opens a session to each backend listed in mcp-servers.json, asks for its tool list, and re-registers every tool on its own endpoint under a namespaced name like `video-yt__search`. ChatGPT sees one app and the backends never know they are behind a gateway. Because registration runs at boot, it could also run at runtime, which became `register-mcp`: paste any MCP URL into the chat and its tools appear.

The constraint that shaped everything was the host. We deployed to mcp-use cloud hosting and installed Lark into ChatGPT as a custom app with OAuth, so the widget renders inside the host's sandbox under its Content Security Policy. That decided the audio architecture. The other constraint was time: the repo was created on February 21 and last pushed on February 25.

## What you see when Lark wakes up

You tell ChatGPT "wake up Lark," the model calls the `wake-up-lark` tool, and the tool returns a widget instead of text. A black phone-style panel appears with a bird emoji in the middle (the code comment in lark.tsx literally says "Bird emoji"), and six app icons orbit in one after another: Phone, Group Call, Music, YouTube, Messages, Contacts.

Tap an app and the other five collapse while a 280px glass panel slides in. Phone takes a name or number plus a message and places a real Twilio call that speaks the message on pickup. Group Call fires one call per ticked contact at once. Music is a player with cover art, a seek bar, and a canvas visualizer. YouTube searches and plays in an embedded iframe. Messages registers the widget as an agent on a shared mailbox so it can list agents, send, and read replies; that is where the ChatGPT-to-Claude conversation in the demo video happens. The model can also skip the UI: a plain request to call a contact goes straight to `make-call`, which returns its own small status widget (resources/make-call.tsx).

## Architecture

Lark is one TypeScript process built on the mcp-use server SDK: an MCP server toward the chat host, an MCP client toward three teammate-hosted backends, and a small HTTP server for two media proxy routes. State lives in two flat JSON files. The Lark widget is one React file, resources/lark.tsx, which mcp-use discovers next to the smaller make-call widget and serves to the host.

![Lark architecture: chat host and widget, the gateway process with proxy registry, local tools and media routes, and the external servers it fans out to](/blog/diagrams/lark-multi-agent-mcp-architecture.svg)

Reading left to right: ChatGPT or Claude calls tools on the gateway over MCP and renders the Lark widget inside the chat. Every button in the widget goes back through the same channel using `useWidget().callTool`, so the UI and the model share one tool surface. Inside the gateway, proxied tools forward to their backend session, local tools reach Twilio, Audius, and Deezer directly, and the two media routes are plain URLs the widget loads from its own origin.

Each layer and why I chose it:

| Layer | Choice | Why |
|---|---|---|
| Server framework | mcp-use `MCPServer` with Hono-style `server.get` routes | One SDK for MCP tools, widget serving, HTTP routes, and deploy |
| Backend fan-out | `MCPClient.fromDict`, one session per server in mcp-servers.json | The same library's client half let the gateway consume other MCP servers |
| Tool schemas | Hand-written `jsonSchemaToZod` bridge | `server.tool` wants Zod, backends publish JSON Schema |
| Runtime registration | `register-mcp`, `list-mcps`, `remove-mcp` persisted to user-servers.json | "Paste a URL and its tools appear," and the file survives a restart |
| Telephony | Twilio REST `Calls.json` with inline TwiML `<Say>` | No SDK, one `fetch` with Basic auth, Twilio speaks the message |
| Music sources | Audius for full tracks, Deezer for short previews | The code takes the stream from Audius and title, artist, cover art, and a `preview` URL from Deezer |
| Audio delivery | Same-origin `/stream/:trackId` proxy with Range passthrough | The host CSP blocked cross-origin audio, and seeking needs 206 responses |
| Persistence | contacts.json and user-servers.json via `writeFileSync` | Zero setup. Not multi-user safe, and I say so below |

## How it works

### The gateway is itself an MCP client

Lark's core loop is `connectBackendServers()` in index.ts. It reads mcp-servers.json, runs `interpolateEnvVars` over it so a URL can reference an env var instead of holding a secret, and builds one `MCPClient.fromDict(config)`. For each server it calls `client.createSession(name)` and `session.listTools()`, then re-registers every tool on the gateway:

```ts
// index.ts
server.tool(
  {
    name: namespacedName,
    description: `[${serverName}] ${tool.description || tool.name}`,
    schema: jsonSchemaToZod(tool.inputSchema),
  },
  async (args: any) => {
    try {
      const result = await session.callTool(tool.name, args);
```

`namespacedName` is `${serverName}__${tool.name}`, so the backend's `search` becomes `video-yt__search`, and the bracketed server name in the description lets the model tell two servers' `play` tools apart. The handler closes over the live `session` and forwards the arguments. `formatBackendResult` normalizes the reply: `isError` becomes `error()`, text that parses as JSON becomes `object()`, anything else passes through as `text()`.

![One YouTube search flowing from a tap in the widget through the gateway proxy to the teammate's video server and back into an embedded player](/blog/diagrams/lark-multi-agent-mcp-flow.svg)

The flow diagram follows one YouTube search. The widget calls `video-yt__search` through `callTool`, the proxy handler forwards to the backend session, and the numbered plain-text list that comes back passes through `formatBackendResult` untouched because it is not JSON. `parseSearchResults` pulls title, channel, duration, views, and the video id out of each block with regular expressions. Tapping a result calls `video-yt__play` and swaps in a youtube.com/embed iframe.

### Turning JSON Schema back into Zod

The mcp-use server API takes a Zod schema per tool, but a remote MCP server publishes JSON Schema. Without a bridge every proxied tool would register as `z.object({})` and the model would not know what to pass. `jsonSchemaToZod` walks the properties:

```ts
// index.ts
for (const [key, prop] of Object.entries(inputSchema.properties as Record<string, any>)) {
  let field = jsonSchemaPropertyToZod(prop);
  if (prop.description) {
    field = field.describe(prop.description);
  }
  if (!required.includes(key)) {
    field = field.optional();
  }
  shape[key] = field;
}
```

`jsonSchemaPropertyToZod` handles enums, string, number, integer, boolean, and array. A nested object becomes `z.record(z.string(), z.any())`, which is loose on purpose; nothing the widget calls needed a nested object. The two fields that matter are the description, because the model reads it, and the required list, because a field wrongly marked required makes the model invent values.

### Registering a server from inside the chat

Runtime registration is the boot loop again in its own function. `connectAndRegisterServer(name, url)` does the same session, listTools, and register dance for one server, keeps the session in a `liveSessions` Map, and writes the entry to user-servers.json. Phase 2 of boot reads that file and calls the same function to reconnect. Phase 1, for mcp-servers.json, has its own inline copy of the loop.

Removal is the honest hack. The SDK has no way to unregister a tool once `server.tool` has run. So `remove-mcp` deletes the registry entry, drops the session, and adds the name to a `removedServers` Set. The tool names stay visible to the host, but the proxy handler checks the Set first and returns an error asking the user to re-register. A soft delete that passed the demo, and I would not ship it.

### Streaming audio through the gateway's own origin

The music panel's real problem was the sandbox, not the player. The widget runs in an iframe inside ChatGPT under a CSP the host controls, and the browser refused to load audio straight from an Audius URL. The fix was to serve the audio from the widget's own origin, which is the gateway:

```ts
// index.ts
const range = c.req.header("Range");
if (range) reqHeaders["Range"] = range;
const audioRes = await fetch(streamUrl, { headers: reqHeaders, redirect: "follow" });
const respHeaders: Record<string, string> = {
  "Content-Type": audioRes.headers.get("Content-Type") || "audio/mpeg",
  "Access-Control-Allow-Origin": "*",
  "Accept-Ranges": "bytes",
  "Cache-Control": "public, max-age=600",
};
```

That is trimmed from the `/stream/:trackId` handler. The part that matters is Range. Browsers seek by sending `Range: bytes=...`, and if the proxy swallows it the seek bar does nothing. So the route forwards Range upstream, copies back Content-Length and Content-Range, and returns the upstream status, 206 for a partial response. `/cover` does the same for album art. Deezer previews come from a CDN, so the widget metadata adds the dzcdn.net domains to the CSP `resourceDomains` list instead. `PlayerCard` uses `/stream/<audiusTrackId>` when a full Audius track exists and falls back to the Deezer preview on error.

Same-origin audio also unlocked the Web Audio API. On the first play tap, `initAnalyser` wires `createMediaElementSource(audio)` into an AnalyserNode with `fftSize` 512 and smoothing 0.82, and `Visualizer` reads frequency and time-domain data every frame to draw glows, a waveform, and 36 frequency bars on a DPR-scaled canvas. Two things the code does on purpose: `new AudioContext()` is created inside the play handler, so it starts on a tap, and the `Audio` element gets `crossOrigin = "anonymous"` before `createMediaElementSource` is called. I set that flag because the stream crosses origins and I wanted the analyser to be allowed to read it. I did not test what the visualizer does without it.

## The hard parts

The calls are not conversations. `make-call` posts inline TwiML with a single `<Say>`, so the recipient hears the message once and the call ends. `PhonePanel` then pretends: it shows "ringing" while the `make-call` tool is in flight, flips to "connected" the moment the tool returns, and runs an eight second timer before showing "ended." Nothing reads call status back from Twilio. The call is real, the status screen is theater.

The message goes into that TwiML through a plain template literal in index.ts, with no XML escaping, so any message containing `<` or `&` produces malformed TwiML. I never tested what Twilio does with that. `/cover?url=` will fetch any URL it is given, which makes the gateway an open image proxy. Both are five-line fixes I did not make.

The widget parses prose. The video and messaging backends return plain text, so `parseSearchResults` and `readInbox` match their exact formatting with regular expressions. If a backend changes a format string, that panel breaks.

Group calls use `Promise.allSettled`, which was right, but the failure branch labels every rejected recipient "unknown" because it reads the error message instead of the contact. State is two JSON files, so every user of a deployed gateway shares one contacts list and one registry. The server is one 1045-line file with a leftover starter-template prompt. There are no tests.

## Results

Lark placed Top 10 at the Y Combinator AI Hackathon. That result comes from my own records of the event; the README does not mention a placement. The gateway was deployed to mcp-use cloud hosting and installed into ChatGPT as a custom app through its OAuth flow; the README has a screenshot of that dialog. The repo holds three demo recordings: the home screen appearing on "wake up Lark," a real Twilio call placed from ChatGPT to a saved contact, and ChatGPT messaging another agent and reading the reply. The three backend servers are a teammate's work in their own repos.

## What I would do differently

I would make every proxied tool return structured content, which deletes the regex parsing in the widget. I would split index.ts into gateway, telephony, and media modules, and key the JSON state by the OAuth user so contacts and registered servers are per person. I would escape the TwiML, restrict `/cover` to known CDN hosts, and make `remove-mcp` real by keeping my own dynamic tool list.

The thing I would keep is the shape. A gateway that is both an MCP server and an MCP client, with a UI that calls the same tools the model calls, is a clean way to give a chat a home screen. Next would be letting registered servers contribute their own panels.

## Key takeaways

- An MCP server can be an MCP client. Discover a backend's tools at boot, re-register them under a namespaced name, and forward calls through the live session. The host sees one app.
- When you re-expose remote tools, preserve the description and the required list in the schema. Those two fields are what the model reads to pick arguments.
- A widget inside a chat host lives under that host's CSP. If media will not load, proxy it through your own origin and forward the Range header, or seeking breaks.
- Create the AudioContext inside a click handler and set `crossOrigin = "anonymous"` on the media element before calling `createMediaElementSource`, so the analyser is allowed to read a stream from another origin.
- If a backend returns prose, the parser is in the wrong place. Ask for structured content first.

## FAQ

### How does Lark aggregate multiple MCP servers into one?

Lark's gateway opens an MCP client session to each backend at startup, converts each tool's JSON Schema to Zod, and registers it on its own endpoint as `server__tool` with a handler that forwards to the backend session. Lark also exposes register-mcp, list-mcps, and remove-mcp so a user can add any MCP server URL from the chat, persisted to a JSON file and reconnected on restart.

### How does Lark play music inside a chat widget?

Lark's gateway searches Audius and Deezer in parallel and returns an Audius id for full playback with a Deezer preview as fallback. Because the chat host's Content Security Policy blocks cross-origin audio, the widget loads the stream from a `/stream/:trackId` route on the gateway's own origin, which forwards the Range header and returns 206 responses so seeking works.

### Can ChatGPT and Claude talk to each other through Lark?

Yes. Lark's Messages panel proxies to a teammate's agent mailbox MCP server: the widget registers itself as a named agent, lists other agents, sends messages, and reads its inbox through the gateway. Because both ChatGPT and Claude can install the same Lark gateway, a message sent from one model's chat can be read from the other's.

## Links

- Source: [github.com/anirxdh/YC-hack](https://github.com/anirxdh/YC-hack) (gateway and widget; the backend servers are a teammate's repos linked from the README)
