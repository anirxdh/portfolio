---
title: "Building a Voice CPA That Only Says What It Can Cite"
description: "How Tax It Easy, a voice AI CPA built overnight at the Moss x YC hackathon, grounds every spoken number and tax-law answer in cited retrieval."
date: 2026-10-03
slug: moss-voice-cpa-yc-hackathon
project: "Tax It Easy"
tags: [Voice AI, LiveKit, RAG, Moss, Next.js, Python]
repo: https://github.com/anirxdh/Moss-hack-yc
accent: "#f5b942"
summary: "Tax It Easy is a voice AI CPA built overnight at the Moss x YC Conversational AI Hackathon. It narrates a prepared Form 1040 over LiveKit, reads every number from the user's own documents through Moss, and refuses tax-law questions it cannot cite from an IRS and state corpus."
---

## A tax return you can talk to

The pitch for the Moss (YC F25) x Y Combinator Conversational AI Hackathon was simple. Voice models are fast now. Retrieval is the bottleneck. The organizers wanted Moss's sub-10ms search as the visible hero, not buried behind an LLM call. It ran overnight at YC in San Francisco on June 6 and 7, 2026, with submissions due at 11 AM.

Tax It Easy is a voice AI CPA that narrates a prepared Form 1040 and answers questions about it using only the user's own documents and a cited IRS and state corpus, built by Anirudh Vasudevan with Sathya Kasturi for the Moss x YC Conversational AI Hackathon. This is what I built and which parts were held together with tape.

I picked taxes because a CPA-prepared return reaches the client as a PDF and a bill, with nobody to read it to them. app/.planning/PROJECT.md draws the same line: explain documents, do not file. I wanted a voice that reads the return line by line and says when it does not know.

## Why retrieval instead of one big prompt

Tax It Easy could have been one LLM call: paste the parsed return into the context window, add a system prompt, let the model answer. That is the obvious approach and it works for a demo. I rejected it for two reasons.

The first is the hackathon itself. app/.planning/PROJECT.md records the thesis: "Moss retrieval stays the visible hero." I needed every answer traceable to a specific chunk, with a latency number on screen.

The second is that a tax return is the wrong place for a confident guess. A refund of 4,300 dollars when the return says 4,200 is worse than silence. So I split the problem into two indexes with different rules: numbers come from the user's own parsed documents, filtered by user id and quoted as found; tax-law explanations come from a separate corpus of IRS and state text, and the agent refuses if the top match misses a similarity threshold.

The other constraint was the sponsor stack: Unsiloed, Moss, LiveKit, MiniMax, TrueFoundry, and AWS. I used them as a chain (parse, retrieve, talk, speak, govern, host) instead of bolting each one on for points.

## What the user sees

Tax It Easy is a four-page flow. The user signs in with Clerk, drops tax documents into slots on /upload (the browser sends each file straight to S3 with a presigned POST), then opens /return, where their CPA-prepared 1040 sits in an iframe loaded from a 15-minute presigned URL.

A button on /return starts the call. The browser fetches a LiveKit JWT from /api/token and joins a room where the agent-py worker is dispatched with the user's id in the metadata. The agent opens with the refund or amount owed, then walks through income, withholding, and each state, pausing for questions. Every Moss query appears in a Knowledge Matches panel with chunks, scores, and a millisecond badge. Worries become open concerns that block sign-off.

## Architecture

Tax It Easy is three services in one monorepo under app/. A Next.js 15 App Router frontend owns auth, presigning, and the LiveKit room UI. A Python LiveKit Agents worker in app/agent-py/src/agent.py owns the voice pipeline and the tool calls. A FastAPI service in app/agent-py/src/ingest_service.py owns the write path from S3 through Unsiloed into Moss.

![Tax It Easy architecture: browser, Next.js routes, Python services, and the sponsor APIs](/blog/diagrams/moss-voice-cpa-yc-hackathon-architecture.svg)

The left of the diagram is the write path: the browser uploads to S3 under users/{userId}/, and the ingest service downloads the object, sends it to Unsiloed's /parse endpoint, polls until done, and upserts the chunks into the Moss knowledge index tagged with user_id. The right is the read path: the token route stamps the Clerk id into LiveKit dispatch metadata, and every knowledge or memory query filters on it.

The two paths meet at Moss, where create_index.py builds three indexes on the moss-minilm model: knowledge (per-user parsed documents), taxcode (a shared cited corpus), and memory (per-user facts and the approval record).

Each layer, the choice, and why:

| Layer | Choice | Why |
|---|---|---|
| Auth | Clerk middleware on every non-public route | One userId is the join key for S3, Moss, LiveKit, and ingest |
| Upload | S3 presigned POST with starts-with and size conditions | Bytes skip the Next server; the key is pinned under the user's prefix |
| Parsing | Unsiloed /parse with smart_layout_detection | Tax PDFs have tables; chunks come back with page numbers |
| Retrieval | Moss, three indexes, moss-minilm | Sponsor host; filtered query with top_k 3 returns scores and time_taken_ms |
| Voice transport | LiveKit Agents 1.5.16 with explicit dispatch | Dispatch metadata carries the user id; the data channel carries retrieval events |
| STT | Deepgram nova-3 via LiveKit Inference | No extra key; multi-language |
| LLM | build_llm, env-switchable (LiveKit Inference, Qwen via DashScope, or a TrueFoundry gateway) | Swap models without code changes; STATE.md records Qwen as the demo LLM |
| TTS | MiniMax speech-02-turbo through a patched plugin, Cartesia sonic-3 fallback | Sponsor voice; the fallback keeps a fresh clone working |
| Ingest API | FastAPI, X-Ingest-Secret header, 202 plus job_id | Unsiloed parses can take up to 30 minutes |

## How it works

### One Clerk id, four systems, fail closed

Tax It Easy has no per-user database. The Clerk userId is the only identity, enforced at every hop. The presign route reads it from auth() and builds the key as users/{userId}/{docId}/{uuid}-{slug}, and the policy in lib/s3.ts stops the browser writing anywhere else:

```ts
// app/frontend/lib/s3.ts
  const post = await createPresignedPost(client(), {
    Bucket: BUCKET,
    Key: key,
    Conditions: [
      ['content-length-range', 1, MAX_UPLOAD_BYTES],
      ['starts-with', '$key', `users/${userId}/`],
    ],
    Fields: { 'Content-Type': contentType },
    Expires: PRESIGN_TTL_SECONDS,
  });
```

The voice path scared me most. The knowledge index is shared across users and search_knowledge filters by self._user_id, so a wrong id would read someone else's return out loud. resolve_user_id() in agent.py fails closed on malformed metadata:

```python
# app/agent-py/src/agent.py
    try:
        meta = json.loads(metadata)
    except (json.JSONDecodeError, TypeError):
        logger.error("dispatch metadata was not valid JSON; refusing to guess user_id")
        return UNVERIFIED_USER_ID
    user_id = meta.get("user_id") if isinstance(meta, dict) else None
    if not user_id or not isinstance(user_id, str):
        logger.error("dispatch metadata had no usable user_id; refusing to guess")
        return UNVERIFIED_USER_ID
    return user_id
```

UNVERIFIED_USER_ID is the string "__unverified__", so a misconfigured dispatch retrieves nothing. The ingest service does the same on the write side: POST /ingest needs a shared secret header and rejects any s3_key outside users/{user_id}/.

### The citation gate

Tax It Easy answers tax-law questions through search_taxcode, which is where "only say what you can cite" lives. The corpus in app/agent-py/taxcode.json has 71 entries from sources like IRS Publication 17, the Form 1040 instructions, and the California FTB Form 540 instructions, each tagged with a source the agent can name. The gate compares the top Moss score against TAXCODE_MIN_SCORE, default 0.90:

```python
# app/agent-py/src/agent.py
        result = await self._moss.query(TAXCODE_INDEX, query, QueryOptions(top_k=3))
        await self._publish_moss_context(query, result)

        docs = getattr(result, "docs", None) or []
        if not docs:
            return NO_CITATION_FOUND

        top_score = getattr(docs[0], "score", None)
        if top_score is not None and top_score < TAXCODE_MIN_SCORE:
            return NO_CITATION_FOUND
```

NO_CITATION_FOUND is not an empty string. It is an instruction: say you cannot cite this, do not answer from memory, offer to flag it for the CPA, and call record_concern. The system prompt repeats the rule and requires that the returned text actually address the question.

I did not guess the 0.90. measure_taxcode_scores.py runs ten questions the corpus should answer ("what is the SALT deduction cap") and five it deliberately does not ("can I claim my dog as a dependent"). The comment in agent.py records the result against an earlier 60-chunk corpus: in-corpus queries scored at or above 0.975, absent topics around 0.8, so 0.90 sat in the gap. It also admits moss-minilm scores are compressed, so the threshold is a coarse pre-filter and the prompt rule is the real backstop.

![One voice question flowing through STT, Moss retrieval, the citation gate, the data channel, and TTS](/blog/diagrams/moss-voice-cpa-yc-hackathon-flow.svg)

### Retrieval on camera

Tax It Easy had to make retrieval visible, so after every Moss query _publish_moss_context packs the query, the matches, and Moss's time_taken_ms into a moss_context message sent with room.local_participant.publish_data, reliable=True. On the frontend, hooks/useMossContextEvents.ts subscribes to RoomEvent.DataReceived and moss-results-panel.tsx renders the last ten events with the millisecond badge. return-view.tsx adds one trick: when the newest top match carries a numeric page in its metadata, it re-points the PDF iframe to #page=N. Only knowledge chunks have that page (ingest_tax.py copies page_number from Unsiloed's segments), so a tax-law answer leaves the PDF alone.

### Patching the sponsor's TTS plugin

Tax It Easy defaults to MiniMax speech-02-turbo, and the stock livekit-plugins-minimax package (pyproject.toml pins 1.2.9 or newer) did not work out of the box. Three problems, all fixed in minimax_patch.py by subclassing.

The first was silent. The plugin hardcodes api.minimax.chat, MiniMax's China endpoint, which returns HTTP 200 with zero audio for an international account. The fix is api.minimaxi.chat, with an extra "i". The second was a crash on multi-sentence replies: the plugin opens a new audio segment per sentence and livekit-agents 1.5.x throws "start_segment() called before the previous segment was ended". _SingleSegmentStream re-implements _run so one segment spans the whole turn. The third was an outdated pydantic Literal of allowed voice ids, so the constructor pops voice_id and sets it after init:

```python
# app/agent-py/src/minimax_patch.py
        voice_id = kwargs.pop("voice_id", None)
        super().__init__(*args, **kwargs)
        if voice_id is not None:
            self._opts.voice_id = voice_id
        self._opts.base_url = (
            base_url or os.environ.get("MINIMAX_BASE_URL") or DEFAULT_MINIMAX_BASE_URL
        )
```

build_tts() only uses the patch when MINIMAX_API_KEY and MINIMAX_GROUP_ID are set. Otherwise it returns Cartesia sonic-3 through LiveKit Inference, so a fresh clone still talks.

### Concerns and sign-off

Tax It Easy treats approval as a state machine. record_concern stores concern text in an in-process dict as "open"; resolve_concern closes it with a loose substring match. sign_off returns CANNOT_APPROVE_YET naming any open concerns. When nothing is open, it calls RunContext.disallow_interruptions() so a barge-in cannot half-complete the mutation, publishes an approval message to the frontend, and writes one approval document into the Moss memory index.

## The hard parts

The biggest shortcut is that the frontend never calls POST /ingest. The 1040 the agent narrates was ingested through the CLI in ingest_tax.py before the demo, and the "Generate 1040" button in upload-view.tsx is a placeholder that routes to /return.

There was a pivot mid-build. One pull request built a real generate-1040 route (Qwen transcribed box values, TypeScript did the math, pdf-lib filled the form); a later one removed it because the agent must never do tax math live. pdf-lib is still a dependency, and lib/s3.ts keeps buildGeneratedKey and putObject with no callers.

return_summary.py is another loose end. It is a typed loader for a finished return (signed refund_or_owed, per-state lines) that the agent never imports; numbers reach the agent through Moss chunks instead. Its fixture, data/returns/demo_return.json, holds placeholder figures (a 4,200 federal refund and three state lines), not real PII.

Other hacky bits: the ingest job store and the concerns dict are both in-process, so a restart forgets them. TrueFoundry governance is wired through build_llm, but STATE.md records that it was still waiting on credentials and a live test.

## Results

Tax It Easy was built for the 11 AM deadline as a working end-to-end demo. No award or placement is recorded for the project.

What shipped: three services, three Moss indexes, seven agent tools, the MiniMax patch, infra/s3-setup.sh, a Dockerfile for LiveKit Cloud, and 123 pytest tests, 118 of them offline behind a 95 percent coverage gate, with ruff in GitHub Actions. The frontend has 18 vitest tests and 3 Playwright tests. Five eval-marked tests (LLM-judged checks plus live TrueFoundry and MiniMax probes) need the network and are excluded from the default run.

## What I would do differently

Wire the upload to the ingest service. The async job exists; what is missing is one fetch from the upload view and a status poll.

Replace the in-memory stores. The job dict and the concerns dict belong in Redis or Postgres keyed by user id, so a restart does not lose a half-finished sign-off.

Use return_summary.py as the numeric source of truth. Retrieval over PDF chunks is fine for "what does line 12 say", but the headline number should come from a validated record.

Grow the taxcode corpus and re-run the calibration. Seventy-one hand-written chunks is a demo.

## Key takeaways

- Make a retrieval tool return an instruction, not an empty string, when it refuses. A sentinel that tells the model what to say next beats hoping the prompt covers silence.
- Calibrate similarity thresholds against your real index with in-corpus and out-of-corpus probes. A guessed cutoff refuses the wrong questions.
- When one id is the security boundary across several systems, enforce it at every hop and fail closed on the read path.
- Publish retrieval events on the same real-time channel as the audio. One data message per query gives you a live debug panel and a UI that follows the conversation.
- Read the vendor plugin source before the demo. An HTTP 200 with an empty body is a worse failure than a stack trace.

## FAQ

### How does Tax It Easy stop the AI from making up tax numbers?

Tax It Easy never lets the language model compute or recall a figure. Every number comes from a search_knowledge query over the user's own parsed documents in Moss, filtered by user id, read exactly as found or reported as missing.

### How does Tax It Easy decide when to refuse a tax-law question?

Tax It Easy runs tax-law questions through search_taxcode over a corpus of IRS and state publication text. If the top Moss score is below TAXCODE_MIN_SCORE (0.90 by default), the tool returns NO_CITATION_FOUND and the agent says it cannot cite the answer, offers a CPA hand-off, and records a concern.

### How does Tax It Easy keep one user's tax return away from another user?

Tax It Easy uses the Clerk userId as the only identity across S3, Moss, LiveKit, and the ingest service. Uploads are pinned under users/{userId}/, the LiveKit token carries the id in dispatch metadata, every Moss query filters on it, and malformed metadata fails closed to a sentinel that matches no user.

## Links

- Source: [github.com/anirxdh/Moss-hack-yc](https://github.com/anirxdh/Moss-hack-yc)
