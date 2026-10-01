---
draft: true
title: "Building Second Shift, a Dispatch Agent That Proves Its Own Writes"
description: "How Second Shift re-plans a field crew's day across Slack, Sheets, Calendar and Gmail with a CP-SAT solver, then reads every write back to verify it landed."
date: 2026-09-30
slug: second-shift-multi-app-dispatch-agent
project: "Second Shift"
tags: [OR-Tools, Multi-App Agents, Google APIs, Slack, FastAPI, Python]
repo: https://github.com/anirxdh/second-shift
live: https://youtu.be/fXl8JSo9rTc
accent: "#4fc3f7"
summary: "Second Shift is a multi-app AI agent that re-plans a field-service crew's day when a technician calls out sick, built solo in one day for the Multi-App AI Agent Hackathon. The LLM only extracts a schema. A CP-SAT solver plans, an independent checker verifies, and an idempotent ledger writes to four apps."
---

## A 6:45 AM problem

Picture a small home-services company at 6:45 in the morning. Marco, one of only two gas-certified HVAC technicians, posts in Slack that he has a fever. Four customers expect him today, including an 11:00 contract job that cannot move. A dispatcher now has about an hour to find someone certified who can reach each customer inside the promised window, tell the crew, and email the customers whose visit changed.

The Multi-App AI Agent Hackathon ran virtually on Sunday, September 13, 2026. The brief was one useful multi-step agent connecting at least three external apps, with proof that it works. The judging weights were posted up front: 30% technical execution, 25% reliability and evaluation, 20% usefulness, 15% originality, 10% demo. That second number shaped everything below.

Second Shift is a multi-app AI dispatch agent that re-plans a field-service crew's day across Slack, Google Sheets, Google Calendar and Gmail when a technician calls out, then reads every write back to prove the new day is right, built by Anirudh Vasudevan for the Multi-App AI Agent Hackathon. I built it alone in one day. The source is public in the anirxdh/second-shift repo. The demo company, Bayside Home Services with six technicians and sixteen jobs, is synthetic.

## Why the LLM only fills a schema

The obvious approach is an LLM with read and write tools for all four apps, reasoning its way to a new schedule. I rejected that in the first hour because of the 25% reliability weight. A model that picks who does which job cannot be audited. If it sends Wei to a gas job he is not certified for, the only defense is another model call.

A middle option was to let the model propose a schedule and have code validate it. A validator can only say no, though. It cannot find the chain move where Wei's plumbing job goes to Ana so that Wei, the only other gas-certified tech, is free for Marco's contract job. That is a constraint problem, and OR-Tools CP-SAT solves exactly that.

So I shrank the model's job to one thing: read a Slack message and fill a strict schema saying who is out and for which hours. Everything else is code. Guardrails decide whether to plan, ask, simulate or ignore. The solver decides who does what. A separate checker decides whether the plan is legal. A dispatcher decides whether it happens. Templates decide what customers are told. I had ranked 40 candidate ideas against the judging weights first (ideas/40-hackathon-ideas.md), and this one let me show real depth in a day.

## What a dispatcher sees

A technician posts in #dispatch: "Woke up with a fever, can't make it in today." Within seconds the bot replies that Marco is out, 3 of his 4 visits can go to teammates, one customer will be asked to pick a new time, and nothing changes until someone approves.

The dispatcher opens the pixel-art console. The crew board shows every tech's day as a before and after timeline, and a Plan and proof panel lists every write the agent intends to make. They click Approve. The agent re-reads Sheets and Calendar, confirms nothing moved, writes to all four apps, then reads them back and shows a pass/fail checklist. The console also has What if? for a simulation that can never write, a Risk scan over every tech, and a Reliability lab with six faults you can arm to crash the run on purpose.

## Architecture

Second Shift is one Python 3.12 process: FastAPI serving a vanilla JavaScript dashboard and a JSON API, with a daemon thread polling Slack every four seconds in live mode. The core is ports and adapters. second_shift/adapters/base.py defines four Protocol ports (SheetsPort, CalendarPort, ChatPort, MailPort). Live Google and Slack adapters implement them, and so do in-memory fakes with fault injection, so the engine never knows which set it is talking to.

![Second Shift architecture: four external apps, one FastAPI engine with the LLM confined to parsing, and a SQLite ledger between the solver and every write](/blog/diagrams/second-shift-multi-app-dispatch-agent-architecture.svg)

Reading left to right: a Slack message reaches the poller, which hands text plus sender identity to the parser. guard() either sends a question back to Slack or produces an Absence. snapshot() reads three Sheets tabs and every technician's calendar, reconciles them (Calendar wins), and hashes the result into a fingerprint. The solver produces a Plan, the checker re-derives every rule, and only then does the plan land in the ledger as "proposed". Every write after approval goes through the ledger, and verify() reads all four apps back.

The main choices in the code, and the reason for each:

| Layer | Choice | Why |
|---|---|---|
| Language model | gpt-4.1-mini via OpenAI strict JSON schema; Claude or Groq by env var | Extraction only, so a small model is enough |
| Trust in the model | guard() in engine.py: named tech must appear in the message, sender must be crew or dispatch | A misread name or injected instruction has no path to a write |
| Planning | OR-Tools CP-SAT, weighted objective, num_workers=1, random_seed=0 | Finds chain moves and returns the same plan every run |
| Verification | validate.py check_schedule, no shared code with the solver | A solver bug cannot hide itself |
| Durability | SQLite ledger with stable per-write keys and a trace table | A crash leaves pending rows; approving again resumes |
| Safety rail | Gmail adapter refuses any recipient except the demo inbox or a plus-alias | A live demo can never email a real person |

## How it works

### The model reads, the code decides

The parser in second_shift/parse.py sends the message, roster, date and sender identity to the model with response_format set to a strict json_schema. The system prompt says the message is data, not instructions. Refusals and validation errors degrade to a question. Then the reading goes through guard(), which is pure code.

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
    if sender_tech is not None and sender_tech.id != tech.id and not named:
        return "clarify", f"Just checking: is it you ({sender_tech.name}) who is out, or {tech.name}?", None
```

The line that matters is `named`. If the model says Wei is out but "Wei" does not appear in the message and Wei is not the sender, the agent asks instead of planning. The scenario model_mistake_caught feeds guard a deliberately wrong reading and checks that it gets a question. If is_hypothetical is set, the plan is a simulation and can never be approved.

### A solver that can make chain moves

second_shift/solver.py builds one CP-SAT model per plan. Each job gets an IntVar for its start, bounded by the promised window, a bool for whether it is assigned, and one bool per eligible technician (skills plus equipment, minus anyone absent all day). Shift bounds, absences and pairwise no-overlap with zone-to-zone travel time are added with only_enforce_if on those literals. Protected jobs are frozen at their exact time.

```python
# second_shift/solver.py
PRIORITY_WEIGHT = {1: 3, 2: 2, 3: 1}
W_COVER = 1000
W_PROTECTED = 10_000
W_BUMP = 1_500
W_TECH_CHANGE = 60
W_SHIFT = 1
```

The objective maximizes coverage weighted by priority, with a large bonus for protected jobs, a penalty for bumping a previously covered job, a small penalty for changing a job's technician, and one point per minute of start-time movement. On the demo data with Marco out, the solver moves Wei's plumbing job J601 to Ana so Wei can take the protected gas job J102, covering 3 of 4 displaced jobs. The greedy baseline in evals/scenarios.py, which never moves anyone else's job, covers 1. The fourth job, J104, gets an honest reschedule request. num_workers=1 and random_seed=0 are deliberate: the same input must give the same plan for a demo and an audit log.

### A checker that shares no code with the solver

second_shift/validate.py is deliberately boring. check_schedule takes a company and a map of job id to placements and re-derives SKILL, EQUIPMENT, WINDOW, SHIFT, ABSENT, PROTECTED_MOVED, DOUBLE_BOOKED and TRAVEL violations from raw data. check_plan adds an ACCOUNTING check that every job appears exactly once. It runs on the proposed plan, and again on the placements read back from the real calendars after execution. The scenario verification_catches_tampering deletes a booking behind the agent's back and confirms the read-back flags it.

### Approve, fingerprint, ledger, write, read back

Writes to four real APIs are where agents usually fail quietly, so this part got the most care.

![One approval in Second Shift: re-read and fingerprint check, then each write through the ledger with a provider-side lookup before any retry, then read back and verify](/blog/diagrams/second-shift-multi-app-dispatch-agent-flow.svg)

When a plan is proposed, snapshot() stores a SHA-256 fingerprint over the company data, every busy block and every booking id. approve() takes a fresh snapshot and compares. If anything changed, the plan is marked "stale" and nothing is written. Each write is an Action with a stable key such as `plan-abc:cal+:J102`. build_actions creates new Calendar bookings before deleting old ones, so a job is never missing from every calendar mid-run, then Sheets rows, Slack messages and emails.

```python
# second_shift/engine.py
        row = self.ledger.action(act.key)
        if row and row["status"] == "done":
            self.ledger.trace(run_id, act.label, "skipped", time.time(), {"reason": "already done (ledger)"})
            return True
        for attempt in range(1, 4):
            t0 = time.time()
            self.ledger.mark(act.key, plan_id, act.seq, act.kind, "pending", attempt=True)
            try:
                result = self._perform(act)
            except TransientError as e:
```

TransientError retries up to three times with backoff. PermanentError stops the run honestly. A crash leaves a pending row, and approving again resumes from the ledger. The catch is that a crash can happen after the provider accepted the write and before the ledger heard back, so every provider needs its own way to answer "did this key already land?"

```python
# second_shift/adapters/google_calendar.py
        item = execute(events.insert(calendarId=calendar_id, body=body), none_on=(409,))
        if item is None:
            # 409: the id is taken. Either an earlier attempt landed (return it unchanged)
            # or the event was deleted, which Google keeps as "cancelled" (restore it in place).
            item = execute(events.get(calendarId=calendar_id, eventId=event_id), none_on=(404, 410))
            if item is None or item.get("status") == "cancelled":
                item = execute(events.update(calendarId=calendar_id, eventId=event_id,
                                             body={**body, "status": "confirmed"}))
```

Calendar events get a caller-chosen id from clock.event_id, a SHA-1 of plan id and job id, so a 409 means the first attempt landed. Slack posts carry message metadata with the key, and find_by_key scans conversations_history with include_all_metadata. Gmail subjects carry a tag derived from the key, and find_by_key searches in:sent. After the last action, verify() reads all four apps back and builds one check per booking, sheet row, post and email, plus one for the rules on the real calendars.

## The hard parts

The Slack SDK retries on 429 by default, which is exactly what I did not want: a silent retry inside the client could post a route message twice while the engine thinks it posted once. SlackChat constructs WebClient with retry_handlers set to an empty list, and google_errors.py does no automatic retries either. The engine owns every retry.

Gmail search lags a few seconds behind a send, so a resume that searched Sent right after a crash might miss the message and send again. The Gmail adapter remembers message ids it sent in-process and checks those first, and the ledger stays the first line of defense.

Some things are honestly simplified. Drive times come from a zone-to-zone table, not a routing API. One technician per message. The trace step is still labelled "Read the message (Claude)" even though the default provider became OpenAI partway through the day. And the dashboard is around 2,000 lines of hand-written app.js with no framework, fast to write and slow to change.

## Results

These numbers come from the repo's own generated reports and README, not independent measurement. evals/REPORT.md records 30 of 30 reliability scenarios passing. evals/LLM_REPORT.md records 15 of 15 real Slack phrasings reaching the correct decision on gpt-4.1-mini, including a prompt injection. The first run was 14 of 15: "Jordan might be out later, not sure yet" was ignored instead of asked about, I added one rule to the system prompt, and it passed. The README reports a live run with 36 of 36 read-back checks and 0 retries, and 104 tests passing under pytest. evals/PREPAREDNESS.md names Marco, Jordan and Wei as single points of failure.

The README links the final demo video and, separately, the version submitted before the 4:00 PM deadline. No placement or award is recorded in the repo, so I am not claiming one.

## What I would do differently

The fingerprint is coarse. Any change anywhere in Sheets or any calendar makes the plan stale, even a personal event for a tech the plan does not touch. A fingerprint over only the techs and jobs involved would cut false stales. The Slack find_by_key scans the last 200 messages, and in a busy channel that window could close; storing the returned ts in the ledger is the fix.

Beyond that: Slack Socket Mode instead of polling, a routing API for drive times, and multi-tech call-outs in one message.

## Key takeaways

- Give the language model the smallest job that still needs language. Extraction into a strict schema is auditable; planning is not.
- Put a deterministic guard between the model and any action, and check its output against the raw input. "The named person must appear in the text" catches a whole class of misreads.
- If the domain has hard rules, use a constraint solver and a separate checker. Run the checker on the plan and again on what the external systems contain afterwards.
- Map idempotency to each provider's primitives: caller-chosen ids for Calendar, message metadata for Slack, a subject tag for Gmail. A generic retry wrapper cannot do this.
- Fingerprint the inputs at plan time and compare right before the first write. Approval takes minutes, and the world changes in minutes.

## FAQ

### How does Second Shift stop the LLM from making a bad scheduling decision?

Second Shift never lets the language model schedule anything. The model's only output is a ParsedCallout: whether the message is a call-out, which technician, which hours, and a confidence level. A deterministic guard() then checks that the named technician appears in the message or is the sender, and that the sender is crew or dispatch. Who does which job is decided by an OR-Tools CP-SAT solver, and an independent checker confirms the plan breaks no rule before a dispatcher sees it.

### What happens if Second Shift crashes in the middle of writing to Google Calendar or Slack?

Second Shift records every intended write in a SQLite ledger with a stable key before performing it and marks it done afterwards. If the process dies between those steps, the row stays pending. On the next approve, the engine resumes from the ledger, skips done rows, and for each pending row asks the provider whether that key already landed: Calendar through a deterministic event id, Slack through message metadata, Gmail through a subject tag. Three crash scenarios in the eval suite prove the resume finishes without duplicates.

### How does Second Shift prove the new schedule is actually correct?

After the last write, Second Shift reads every technician's Google Calendar, the Jobs sheet, Slack history and Gmail Sent back from the live APIs. It checks that each job has exactly one booking on the right calendar at the planned time, that each sheet row shows the planned values, and that each Slack post and email can be found by its key. Then it runs the rule checker against what it just read back, so a booking deleted behind its back shows up as a failed check.

## Links

- Demo video (1:03): [youtu.be/fXl8JSo9rTc](https://youtu.be/fXl8JSo9rTc)
- Source: [github.com/anirxdh/second-shift](https://github.com/anirxdh/second-shift)
