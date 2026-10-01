---
draft: true
title: "Teaching ScreenSense to Hold a Conversation While It Clicks"
description: "How I rebuilt ScreenSense as a conversational voice browser agent with Firecrawl page context and ElevenLabs voice, and won Best Voice Agent."
date: 2026-09-30
slug: screensense-voice-browser-agent
project: "ScreenSense (v3)"
tags: [Voice AI, Chrome Extension, Firecrawl, ElevenLabs, AWS Bedrock, Agents]
award: "Best Voice Agent, ElevenLabs x Firecrawl Hackathon"
repo: https://github.com/anirxdh/elevenlab_firecrawl
live: https://screen-sense-anirudh.netlify.app/
accent: "#2fb583"
summary: "ScreenSense v3 is a Chrome extension plus FastAPI backend that turns a spoken command into browser actions and can ask you questions mid-task. This is the story of adding Firecrawl page context and a per-tab conversation state machine on top of the v2 agent loop."
---

## The agent could act, but it could not ask

By the third weekend, ScreenSense could already do a lot. [Version one](/blog/screensense-v1-talk-to-your-screen/) answered a spoken question about whatever was on screen. [Version two](/blog/screensense-v2-amazon-nova-agent-loop/) turned that into an agent loop: screenshot, ask the model for one action, run it, look again. It could add a cable to an Amazon cart on its own.

What it could not do was talk back. If I said "fill out this form" and the form wanted an email I never gave, v2 would guess or stall. There was no way for the agent to say "I need your email" and then listen for the answer.

ScreenSense v3 is a voice-controlled Chrome extension and FastAPI backend that turns spoken commands into multi-step browser actions and can hold a back-and-forth conversation while it works, built by Anirudh Vasudevan for the ElevenLabs x Firecrawl Hackathon. It won Best Voice Agent. This article covers what separates v3 from v2: Firecrawl as a content layer, and a conversation manager that lets the agent ask a question and reopen the mic for the reply.

## Why I did not start over

The spec I wrote on March 21, 2026 (still in the repo under docs/superpowers/specs) is headed "Approach 1: Firecrawl as Content Layer". The other approaches never made it into the doc, so here is what I remember weighing.

The obvious one was to hand the whole voice loop to a hosted conversational agent product and expose browser actions as tools. Faster to demo, but the hard part of ScreenSense was never the voice. It was grounding the model in real CSS selectors and re-observing the page after every click, and that loop already worked in v2. The other was to keep the v2 loop and bolt on ElevenLabs speech-to-text and text-to-speech. That gives a nicer voice on a one-shot command, not a conversation.

What I picked: keep the observe-act-observe loop, add Firecrawl so the model reads the whole page instead of just the viewport, and put a small state machine in the service worker that tracks listening, executing, speaking, and waiting on a reply. The spec's rule: Firecrawl reads pages, the DOM scraper acts on pages, ElevenLabs handles all voice.

Constraints drove it. The sponsor APIs were Firecrawl and ElevenLabs, so both had to do real work. The spec is dated March 21, the repo was created March 22 and last pushed March 23, so I had about two days. And demo latency is why transcription runs from the extension straight to the STT provider with no backend hop.

## What a session looks like

From the user's side, ScreenSense v3 works like this:

1. Hold the backtick key. A frosted-glass bubble appears with a live waveform while an offscreen document records the mic.
2. Say "add the cheapest USB-C cable to my cart" and release. Recording also stops after about 1.5 seconds of silence.
3. The service worker captures a screenshot, scrapes the DOM into selectors, and asks the backend to pull the page through Firecrawl.
4. The agent does one action at a time, and ElevenLabs speaks a short phrase for each: "Opening Amazon", "Adding to cart". 
5. If the agent needs something, it asks out loud. When the question finishes playing, the mic reopens for 10 seconds and the loop continues with your reply.
6. When the model returns type done, ScreenSense speaks the summary. Holding the key again continues the same conversation; the per-tab history is only reset when the model classifies your utterance as a new task or when the tab closes. The 30 second idle timer only drops the state back to Idle.

## Architecture

ScreenSense v3 has three tiers. Content scripts run inside every page and own the DOM: scraping, executing actions, drawing the bubble, playing audio. The Manifest V3 service worker orchestrates the offscreen mic document, the transcription chain, the conversation state, and the agent loop. A FastAPI backend on localhost:8000 holds the AWS and Firecrawl keys and makes the model call.

![ScreenSense v3 architecture: content scripts, service worker, FastAPI backend, and external APIs](/blog/diagrams/screensense-voice-browser-agent-architecture.svg)

Audio never touches the backend. The offscreen document sends base64 audio to the service worker, and src/background/transcription-service.ts calls Groq Whisper, then ElevenLabs Scribe, then Deepgram, until one returns text. In parallel, the worker asks the content script for a DOM snapshot and the backend's POST /firecrawl/scrape for the page as markdown. All three run under one Promise.all in runPipeline; the DOM and Firecrawl results may fail without killing the request.

POST /task takes the transcript, screenshot, DOM snapshot, Firecrawl markdown, and a text-only conversation history, makes one Bedrock converse call, and returns a single JSON object. The worker classifies it and either executes an action, speaks a phrase, or parks the conversation in AwaitingReply. Text-to-speech goes the other way: the content script asks the worker to fetch ElevenLabs audio, since page CSP would block the fetch, and plays the base64 MP3 it gets back.

The choices, layer by layer:

| Layer | Choice | Why |
|---|---|---|
| Mic capture | MV3 offscreen document with MediaRecorder | Mic permission is granted once on the extension origin and survives navigation |
| Speech to text | Groq Whisper, then ElevenLabs Scribe, then Deepgram, from the service worker | No backend hop; a failed provider falls through |
| Page content | Firecrawl v1 scrape, markdown, main content only, 5 minute cache | The model sees the whole page within the token budget |
| Reasoning | AWS Bedrock converse API, model set by SCREENSENSE_MODEL | One env var switches between four models |
| Conversation state | ConversationManager in the service worker, per tab | Only the worker sees both the mic and the agent loop |
| Text to speech | ElevenLabs eleven_flash_v2_5 via the worker, Web Speech fallback | Site CSP blocks content-script fetches |

## How it works

### Firecrawl as the content layer

v2 gave the model a screenshot and a few thousand characters of DOM text. Fine for "click the blue button", useless for "is there a returns policy on this page" when the policy is three screens down. Firecrawl returns the page as clean markdown with the nav and footer stripped.

backend/services/firecrawl_service.py wraps the synchronous Firecrawl v1 client. Every call goes through asyncio.to_thread so FastAPI's event loop is never blocked, and every URL passes an SSRF check that rejects localhost, 0.0.0.0, ::1, and any private, loopback, or link-local IP.

```python
# backend/services/firecrawl_service.py
        self._validate_url(url)
        cached = self._get_cached(url)
        if cached is not None:
            return cached
        result = await asyncio.to_thread(
            self.client.scrape_url,
            url,
            formats=["markdown"],
            only_main_content=True,
        )
```

The cache is a dict keyed by URL with a 300 second TTL. On the reasoning side, backend/services/nova_reasoning.py caps the markdown at 15,000 characters and, when markdown is present, swaps the DOM snapshot's text_content for a pointer to it. Markdown is what the page says. The DOM snapshot is what you can click.

### The conversation state machine

src/background/conversation-manager.ts is 102 lines. It holds one state (Idle, Listening, Processing, Speaking, AwaitingReply, Executing), a Map from tab id to conversation turns, and a 30 second idle timer that resets on every transition into a non-Idle state. Turns are capped at 20 per tab.

During a conversation, the prompt asks the model to label the utterance as new_task, reply, follow_up, correction, or interruption, and routeByIntent turns that into one of three outcomes:

```typescript
// src/background/conversation-manager.ts
  switch (intent) {
    case 'new_task':
      cm.clearSession(tabId);
      cm.startSession(tabId);
      return 'new_session';
    case 'interruption':
      cm.transition(ConversationState.Idle);
      return 'cancel';
    default:
      return 'continue';
```

After routing, classifyResponse in src/background/agent-executor.ts looks at the shape of the response: needs_clarification wins, then options, then a suggestion with requires_confirmation, then a bare speak, then done, else action. The first three end the same way: the text goes to the content script for TTS, and the state moves to AwaitingReply.

### Closing the loop: the mic reopens itself

![One clarifying turn in ScreenSense v3, from spoken command to the agent's question to the user's reply](/blog/diagrams/screensense-voice-browser-agent-flow.svg)

This is what turned v3 from a command runner into something you can talk to. When the audio finishes in src/content/tts.ts, the ended listener sends tts-playback-finished to the service worker. If the conversation is in AwaitingReply, the handler waits 500 ms, tells the bubble to show listening, and sends start-recording to the offscreen document. A second timer stops the recording after 10 seconds if the user has not spoken.

The transcript then enters the normal pipeline with the conversation history attached, so the model sees its own question and the reply together. For a form fill, the next action types into the right input using the exact selector from the DOM snapshot.

There is a second turn-taking rule for interrupts. If you hold the key while the agent is talking, the shortcut-hold handler is supposed to stop playback:

```typescript
// src/background/service-worker.ts
  if (conversation.getState() === ConversationState.Speaking) {
    const interruptTabId = sender.tab?.id ?? recordingTabId;
    if (interruptTabId) {
      sendToTab(interruptTabId, { action: 'interrupt-tts' });
    }
    conversation.transition(ConversationState.Listening);
  }
```

I say "supposed to" because nothing in the service worker ever transitions the state to Speaking. The content script's interrupt-tts handler works when called; the branch that calls it is dead. Holding the key during speech starts a new recording while the speech keeps playing over you. That bug shipped.

### Keeping the model call inside a budget

Every iteration sends a fresh screenshot and DOM snapshot, plus the Firecrawl markdown from the first scrape, the conversation history, and the action history. nova_reasoning.py trims each before the converse call. Screenshots are downscaled with Pillow to 1024 px wide and re-encoded as JPEG at quality 80. The DOM JSON is held under 30,000 characters by shortening text, trimming tables, lists, and headings to three entries, then capping buttons, links, inputs, and products at 15. Once the action history passes five entries, everything but the last three collapses into one line:

```python
# backend/services/nova_reasoning.py
    if len(action_history) > 5:
        older = action_history[:-3]
        recent = action_history[-3:]
        older_summary = f"Previously completed {len(older)} actions: " + ", ".join(
            entry.get('description', 'Unknown')[:40] for entry in older
        )
```

Failed actions stay in that history as "FAILED: ... Try a different selector or approach." so the model picks a new target next turn. A four-strategy extractor parses the reply: direct json.loads, a fenced code block, the first balanced object, the first balanced array. Small models like to wrap JSON in prose.

## The hard parts

The spec and the code disagree in several places. I would rather list them.

The STT order flipped. The spec says ElevenLabs first, Groq as fallback. The code tries Groq Whisper (whisper-large-v3-turbo) first, then ElevenLabs Scribe, then Deepgram. The comment says "most reliable, free tier". Honest, but the sponsor's STT ended up as the fallback in a hackathon the sponsor ran.

The reasoning model is ambiguous. The README says Claude Haiku 4.5. The code default in SUPPORTED_MODELS is nova-lite. Which one runs depends on SCREENSENSE_MODEL in backend/.env, and I will not claim from memory which value was set for the recorded demo.

Dead code from v2 survived. The spec says delete backend/services/nova_sonic.py (AWS Transcribe streaming) and backend/routers/transcribe.py. Both are still wired into main.py and unused by the extension. The spec also planned to summarize old turns with a model call at the 20-turn cap. The shipped code just drops them.

Conversation history is stored twice: service-worker.ts keeps a conversations Map from before the refactor and also writes every turn into the ConversationManager. The manager's 30 second idle timer fires an onIdle callback that the service worker never registers, so the timer resets the state and nothing else; history lives until a new_task intent or a tab close. runPipeline and runFollowUp are near-duplicates of roughly 200 lines each; the real differences are whether the input needs transcribing and that the follow-up path scrapes the DOM and Firecrawl sequentially instead of in parallel.

The TaskResponse type has a research field for background scraping. Nothing reads it. Firecrawl's extract and crawl endpoints are implemented and tested, but only scrape is in the live path.

## Results

ScreenSense v3 won Best Voice Agent at the ElevenLabs x Firecrawl Hackathon. The README's setup is load unpacked plus a local backend, and it links the YouTube demo and the Netlify landing page, whose folder in the repo holds two demo videos.

The README claims 414 tests. Counting it() and test() blocks today gives 246 Jest cases across eight frontend files and 188 pytest functions across eight backend files, with AWS and Firecrawl mocked.

## What I would change

Make Speaking a real state. The content script already reports when playback ends; it should report when playback starts too, and the worker should transition on both. That one fix makes the interrupt branch live.

Delete what the spec said to delete, and collapse runPipeline and runFollowUp into one function that takes either audio or text. They diverged because I did not want to break the working path the night before the demo.

Use Firecrawl for more than the current page. The research field and the crawl endpoint were meant to let the agent compare prices across sites the user is not looking at. That is what would make Firecrawl feel essential instead of helpful.

## Key takeaways

- Drive the mic re-open from the audio playback end event, not a timer. Speech length varies too much.
- Split "what the page says" from "what you can click" into separate inputs. Markdown for reading, selectors with viewport flags for acting. Tell the model which is which.
- Put the conversation state machine wherever both the mic and the executor are reachable. In a Manifest V3 extension that is the service worker.
- When the model can return several response shapes, classify by field presence in a fixed priority order, not by the type string.

## FAQ

### How does ScreenSense hold a conversation with the user?

ScreenSense keeps a per-tab ConversationManager in the extension's service worker with six states: Idle, Listening, Processing, Speaking, AwaitingReply, and Executing. When the model responds with needs_clarification, options, or a suggestion that requires confirmation, the text is spoken through ElevenLabs and the state moves to AwaitingReply. When the audio finishes, the content script sends tts-playback-finished and the worker reopens the microphone for up to 10 seconds, then sends the reply to the backend with the text-only history.

### What does Firecrawl do in ScreenSense?

ScreenSense uses Firecrawl to read the whole page, not just the viewport. The backend's POST /firecrawl/scrape requests markdown with only_main_content set to true, caches the result per URL for five minutes, and rejects private or loopback URLs before the request leaves the machine. The markdown, capped at 15,000 characters, goes to the reasoning model alongside the DOM snapshot and screenshot. The DOM snapshot provides the selectors used to act; Firecrawl provides the content used to understand.

### How does ScreenSense keep voice latency low?

ScreenSense transcribes audio directly from the service worker to the STT provider, skipping the backend. Transcription, DOM scraping, and the Firecrawl scrape start together under one Promise.all, so the slowest of the three sets the wait. Screenshots are downscaled to 1024 px JPEG before the model call, and each step's spoken phrase comes from the model as part of the action, so no extra call is needed to produce speech text.

## Links

- Live landing page and demo videos: https://screen-sense-anirudh.netlify.app/
- Source: https://github.com/anirxdh/elevenlab_firecrawl
- Part 1: [ScreenSense v1, talk to your screen](/blog/screensense-v1-talk-to-your-screen/)
- Part 2: [ScreenSense v2, the Amazon Nova agent loop](/blog/screensense-v2-amazon-nova-agent-loop/)
