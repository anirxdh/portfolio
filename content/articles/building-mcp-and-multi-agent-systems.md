---
title: "What Building MCP Servers and Multi-Agent Systems Taught Me"
description: "Lessons from LARK, Second Shift, ScreenSense, Super Nova and Director on MCP tool design, agent orchestration, and checking what an agent actually did."
date: 2026-10-21
slug: building-mcp-and-multi-agent-systems
project: "Agent lessons"
kind: guide
tags: [MCP, Agents, Multi-Agent, Browser Agents, Multi-App Agents, Chrome Extension]
accent: "#8b9cf7"
summary: "Across an MCP gateway, a browser agent, a multi-app dispatch agent and a voice video editor, the same rule kept winning: give the model the smallest job that still needs language, make tools easy for a model to read, run one step at a time, and verify every write against the real system."
---

## Seven agent builds, one question

Every agent I build comes down to one question: how much do I let the model decide? My first answers gave it too much. The builds that held up in a demo gave it less, and checked everything it did.

This guide is a field report on building MCP servers and multi-agent systems, written by Anirudh Vasudevan from the agent projects he built in 2026. Each lesson links to the write-up with the code:

- [LARK](/blog/lark-multi-agent-mcp/): an MCP gateway and phone-style widget inside ChatGPT and Claude. Top 10 at the Y Combinator AI Hackathon.
- [Second Shift](/blog/second-shift-multi-app-dispatch-agent/): a dispatch agent that re-plans a crew's day across Slack, Sheets, Calendar and Gmail.
- ScreenSense [v2](/blog/screensense-v2-amazon-nova-agent-loop/) and [v3](/blog/screensense-voice-browser-agent/): a voice browser agent in a Chrome extension. v3 won Best Voice Agent at the ElevenLabs x Firecrawl Hackathon.
- [Super Nova](/blog/super-nova-voice-companion/): a voice companion with a hand-written MCP client.
- [Director](/blog/director-fal-voice-video-editor/): a LiveKit voice agent that edits video through tool calls.
- [Tax It Easy](/blog/moss-voice-cpa-yc-hackathon/): a voice CPA whose tools refuse what they cannot cite.
- [The Missing Angle](/blog/the-missing-angle-voice-mystery/): AI suspects whose spoken choices go through a classifier with a deterministic fallback.

## Lesson 1: give the model the smallest job that still needs language

Second Shift is the clearest case. The obvious design was a model with read and write tools for four apps, reasoning its way to a new schedule. I rejected it because a model that picks who does which job cannot be audited. So the model only reads a Slack message and fills a strict schema: who is out, for which hours, how confident. Code does the rest. A guard decides whether to plan or ask, an OR-Tools CP-SAT solver decides who does what, a separate checker decides whether the plan is legal, and a dispatcher approves it.

The guard is plain code between the model and every action:

```python
# second_shift/engine.py
    if parsed.needs_clarification or parsed.confidence == "low":
        return "clarify", parsed.clarifying_question or "Who is out, and for which hours?", None
    techs = {t.id: t for t in company.technicians}
    tech = techs.get(parsed.tech_id or "")
    if tech is None:
        return "clarify", "Which technician is out?", None
    lowered = text.lower()
    named = tech.name.lower() in lowered or tech.name.split()[0].lower() in lowered
```

If the model says Wei is out but "Wei" is not in the message and Wei did not send it, the agent asks instead of planning.

The same rule shows up at smaller scale. Super Nova runs a chain of regexes before any model call, and Groq with tool calling is the last resort. [Voices of the Last World](/blog/voices-of-the-last-world/) has a deterministic engine with the same output shape as the LLM and merges in only the creative fields, so a bad response becomes a boring one, not a broken one. The Missing Angle maps a spoken accusation to a branch with a Groq classifier, accepts it only at 0.55 confidence or higher, and falls back to a token matcher with a negation guard, so "I don't think it was Sara" does not accuse Sara.

## Lesson 2: tools are an interface for a model

A model picks a tool by its name and description, and fills arguments from the schema. Everything else is invisible to it.

Names must be unique. In LARK, two backend servers both exposed a play tool, so the gateway registers every tool as server name, two underscores, tool name, and puts the server name in brackets at the start of the description. Super Nova does the same for Groq function calling with a prefix from the server's hostname.

Keep the description and the required list. LARK's backends publish JSON Schema, but the mcp-use server API wants Zod, so I wrote a bridge. Without it every proxied tool would register as an empty object and the model would not know what to pass. A field wrongly marked required makes the model invent values.

Return structured content. LARK's video and messaging backends return prose, so the widget parses it with regular expressions, and one changed format string would break a panel. If a backend returns prose, the parser is in the wrong place.

Make results speakable. Every edit in Director returns a changelog sentence such as "Split 's2' at 15s into 's2' and 's2-b'." Validation errors are sentences too, and the tool returns the message so the model reads the correction aloud. Tax It Easy goes further: when its tax-law search scores below its threshold, the tool returns NO_CITATION_FOUND, which is an instruction to say it cannot cite this, offer a hand-off to the CPA and record a concern. A refusal should tell the model what to do next.

## Lesson 3: an MCP server can also be an MCP client

LARK's core idea was that the gateway is both. At boot it opens a client session to each backend in a config file, lists its tools and re-registers each one on its own endpoint. ChatGPT sees one app, and the backends never know a gateway is in front of them:

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

Because registration is a function, it also runs at runtime. A register-mcp tool lets a user paste any MCP URL into the chat and its tools appear, saved to a JSON file so they survive a restart. Removal was the honest hack: the SDK cannot unregister a tool, so remove-mcp marks the server removed and the proxy returns an error. It passed the demo and I would not ship it.

LARK is also where models talked to each other. Its Messages panel goes through a teammate's agent mailbox server, so the widget registers as an agent, lists other agents and sends messages. Because ChatGPT and Claude can both install the same gateway, a message sent from one chat can be read in the other.

Super Nova taught me the wire protocol. I skipped the SDK and wrote JSON-RPC 2.0 over HTTP by hand: initialize with a protocol version, keep the mcp-session-id header per server, then tools/list and tools/call. Discovery uses Promise.allSettled so one dead server does not block the others, and every call has a timeout and a retry. When Groq streams a tool call, the arguments arrive as fragments, so the route aggregates them by index and parses only after the stream closes.

## Lesson 4: run one step, then look again

ScreenSense v2 started with a batch: Amazon Nova returned a plan and the extension ran every step. It broke as soon as the page changed, because the page after step one is never the page the model planned against. So I rewrote it to run only the first action, wait for the page, capture it again, and ask for the next one, with a hard cap of 25 iterations.

![One iteration of the ScreenSense v2 browser agent loop: settle, observe, ask the model for one action, execute it, and feed the result back](/blog/diagrams/building-mcp-and-multi-agent-systems-flow.svg)

Each part of that loop needed its own rule. The model never returns coordinates. It gets a DOM snapshot where every element carries a CSS selector and must copy one exactly. "The page is quiet" and "the page has content" are different conditions, so the extension waits for a quiet window and then polls until real buttons, inputs or links exist. A thrown message to the tab is treated as a navigation, not a crash. Every call is budgeted: screenshots downscaled to 1024 pixels wide, the DOM trimmed past 30,000 characters, and older actions collapsed into one summary line.

ScreenSense v3 added a conversation state machine, and put it in the service worker because only the worker can reach both the microphone and the executor. When the model can return several response shapes, v3 classifies by which fields are present, in a fixed priority order, not by trusting a type string.

Director solved state sync the simple way. After every tool call, the agent publishes one JSON state document to the browser over a reliable LiveKit data channel, and the studio is a pure renderer. A reducer that merges a full snapshot cannot drift, and trimming the unbounded lists keeps each packet under the transport's size limit.

## Lesson 5: check what the agent did, not what it said

Feed failures back as text. When a ScreenSense selector matches nothing, the worker does not retry. It writes "FAILED: ... Try a different selector or approach." into the history, and the next prompt sees it.

Second Shift goes furthest. The checker shares no code with the solver, so a solver bug cannot hide itself, and it runs twice: on the proposed plan, and again on placements read back from the real calendars. Before the first write, the agent takes a fresh fingerprint of the data and refuses to act if anything moved. Every write goes through a SQLite ledger with a stable key, and each provider gets its own answer to "did this already land?": a caller-chosen event id for Calendar, message metadata for Slack, a subject tag for Gmail. A generic retry wrapper cannot do that. The README records a live run with 36 of 36 read-back checks passing.

Measure the thresholds you rely on. Tax It Easy's 0.90 citation cutoff came from probes: ten questions the corpus should answer and five it should not. Second Shift's eval report records 15 of 15 real Slack phrasings reaching the right decision; the first run got 14, and one added prompt rule fixed the miss.

## Lesson 6: model output is untrusted input

A browser agent's model has just read an untrusted page. ScreenSense's executor treats every action that way:

```ts
// src/content/action-executor.ts
const ALLOWED_ACTIONS = new Set(['click', 'type', 'navigate', 'extract', 'scroll']);
// ...
const DANGEROUS_SELECTOR_PATTERNS = [
  /javascript:/i,
  /<script/i,
  /on\w+=\s*['"]/i, // onclick=', onerror="
  /`/,
];
```

Selectors are also test-run before use, navigation only accepts http and https, and a rate limiter spaces actions out. Second Shift's prompt says the Slack message is data, not instructions, and the Gmail adapter refuses any recipient except the demo inbox or a plus-alias of it, so a live demo can never email a real person. Tax It Easy fails closed: if the user id in the LiveKit dispatch metadata is malformed, retrieval runs as a sentinel that matches no user.

## Lesson 7: make it run without keys

The agents I trust most were built mock-first. [Living Photos](/blog/living-photos-gaussian-splats/) puts every paid service behind an interface with a mock and a real class, and the factory refuses mocks in production. Director's edit engine renders real files with no keys, checked by 23 pytest tests. Second Shift's engine talks to four ports, implemented by live adapters and by in-memory fakes with fault injection, which is how its crash scenarios run.

There is a cost. Director's real fal path is marked untested without keys, because I proved the loop against the mock and never validated the real argument shapes during the hackathon. Next time I would write one tiny script per real model on day one.

## The shape I start from now

![The agent shape these builds converged on: a model that fills a schema, a deterministic guard, namespaced tools, one action at a time, and a checker with a write ledger and read-back](/blog/diagrams/building-mcp-and-multi-agent-systems-architecture.svg)

| Layer | Choice | Why |
|---|---|---|
| Language step | Strict JSON schema extraction | A filled schema can be audited |
| Guard | Plain code between the model and any action | Catches misreads and injected instructions |
| Tool surface | Namespaced tools with full schemas | The model reads names, descriptions and required fields |
| Tool results | Structured data or speakable sentences | No regex parsing, no summary step |
| Orchestration | One action per step, then observe again | The world changes after every step |
| State | One document published after each tool call | The UI cannot drift from the agent |
| Planning | A solver when the rules are hard | It finds moves a validator cannot |
| Proof | Independent checker, ledger and read-back | Verifies the real systems, not the plan |
| Testing | Mock adapters with fault injection | The loop runs before any key exists |

## Key takeaways

- Give the model the smallest job that still needs language, and put a deterministic guard between it and every action.
- Design tools for a model reader: unique names, real descriptions, accurate required fields, structured results.
- An MCP server can be an MCP client. A gateway that re-registers backend tools gives the host one app.
- Run one action, then observe again. Feed failures back as text.
- Verify writes by reading the real systems back, with idempotency keys mapped to each provider.
- Build with mocks first, then validate every real call shape early.

## FAQ

### How should I design tools for an MCP server?

In LARK and Super Nova, what mattered most was what the model can read. Give every tool a unique, namespaced name, keep its real description, mark only truly required fields as required, and return structured content instead of prose. When a tool refuses, as in Tax It Easy, return an instruction that tells the model what to say next.

### Can an MCP server call other MCP servers?

Yes. LARK's gateway is an MCP server toward ChatGPT and Claude and an MCP client toward three backend servers. At boot it opens a session to each backend, converts each tool's JSON Schema to Zod, and re-registers it under a namespaced name with a handler that forwards the call. A register-mcp tool repeats that at runtime for any URL the user pastes.

### How do you stop an AI agent from making bad decisions?

Shrink what the model decides. In Second Shift the model only extracts who is out into a strict schema, a deterministic guard checks that the named person appears in the message, an OR-Tools solver plans, and an independent checker must pass the plan before a dispatcher sees it. Super Nova and The Missing Angle also put deterministic code before or behind the model.

### How do you verify that an AI agent's actions actually worked?

Read the real systems back. Second Shift writes through a SQLite ledger with a stable key per write, then reads Google Calendar, Sheets, Slack and Gmail back and checks each booking, row, post and email against the plan. It then runs its rule checker again on the placements it just read, so a booking deleted behind its back fails a check.

### Why should a browser agent take one action at a time?

Because each action changes the page. ScreenSense v2 first ran a whole plan and broke when a click reloaded the document or swapped a panel. Running one action, waiting for the DOM to settle, and capturing a fresh screenshot and selector snapshot before the next model call fixed it, with a hard cap of 25 iterations.
