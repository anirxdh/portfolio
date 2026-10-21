---
title: "Building Second Shift, a Dispatch Agent That Proves Its Writes"
published: false
description: "How Second Shift re-plans a field crew's day across Slack, Sheets, Calendar and Gmail with a CP-SAT solver, then reads every write back to verify it landed."
tags: ai, agents, python, ortools
canonical_url: https://anirudhvasudevan.com/blog/second-shift-multi-app-dispatch-agent/
cover_image: https://anirudhvasudevan.com/blog/og/second-shift-multi-app-dispatch-agent.png
---

> **TL;DR** Second Shift is a multi-app AI agent that re-plans a field-service crew's day when a technician calls out sick, built for the Multi-App AI Agent Hackathon on September 13, 2026. The LLM only extracts a schema. A CP-SAT solver plans, an independent checker verifies, and an idempotent ledger writes to four apps.

[Live demo](https://youtu.be/fXl8JSo9rTc) · [Source on GitHub](https://github.com/anirxdh/second-shift)

## A 6:45 AM problem

Second Shift is a multi-app AI dispatch agent I, Anirudh Vasudevan, built for the Multi-App AI Agent Hackathon on September 13, 2026. When a technician calls out, it re-plans a field-service crew's day across Slack, Google Sheets, Google Calendar and Gmail, then reads every write back to prove the new day is right.

It is 6:45 in the morning at a small home-services company. Marco, one of only two gas-certified HVAC technicians, posts in Slack that he has a fever. Four customers expect him today, including an 11:00 contract job that cannot move. A dispatcher now has about an hour to find someone certified who can reach each customer inside the promised window, tell the crew, and email the customers whose visit changed.

The hackathon brief was one useful multi-step agent connecting at least three external apps, with proof that it works. The criteria, as I recorded them in ideas/40-hackathon-ideas.md, weighted 30% technical execution, 25% reliability and evaluation, 20% usefulness, 15% originality, 10% demo. The source is public in the anirxdh/second-shift repo. The demo company, Bayside Home Services (six technicians, sixteen jobs), is synthetic.

## Why the LLM only fills a schema

The obvious approach is an LLM with read and write tools for all four apps, reasoning its way to a new schedule. My note in that ideas file said Second Shift "needs a real constraint model, not a model-generated schedule accepted without checking," and the 25% reliability weight made that hard to argue with. A model that picks who does which job cannot be audited. If it sends Ana, who only does plumbing, to a gas furnace job, in that design the only defense is another model call.

A middle option was to let the model propose a schedule and have code validate it. A validator can only say no, though. It cannot find the chain move where Wei's plumbing job goes to Ana so that Wei, the only other gas-certified HVAC tech, is free for Marco's contract job. That is a constraint problem, and OR-Tools CP-SAT solves exactly that.

So I shrank the model's job to one thing: read a Slack message and fill a strict schema saying who is out and for which hours. Everything else is code: guardrails decide whether to plan or ask, the solver decides who does what, a separate checker decides whether the plan is legal, a dispatcher decides whether it happens, and templates decide what customers are told.

## What a dispatcher sees

A technician posts in #dispatch: "Woke up with a fever, can't make it in today." The bot replies in Slack that Marco is out, 3 of his 4 visits can go to teammates, one customer will be asked to pick a new time, and nothing changes until someone approves.

The dispatcher opens the pixel-art console. A crew board shows each tech's day before and after, and a Plan and proof panel lists every write. They click Approve. The agent re-reads Sheets and Calendar, confirms nothing moved, writes to all four apps, then reads them back and shows a pass/fail checklist. A What if? mode runs the same planner as a simulation that can never write.

## Architecture

Second Shift is one Python 3.12 process: FastAPI serving a vanilla JavaScript dashboard and a JSON API, with a daemon thread polling Slack every four seconds in live mode. The core is ports and adapters. second_shift/adapters/base.py defines four Protocol ports (SheetsPort, CalendarPort, ChatPort, MailPort). Live Google and Slack adapters implement them, and so do in-memory fakes with fault injection, so the engine never knows which set it is talking to.

![Second Shift architecture: four external apps, one FastAPI engine with the LLM confined to parsing, and a SQLite ledger between the solver and every write](https://anirudhvasudevan.com/blog/diagrams/second-shift-multi-app-dispatch-agent-architecture.svg)

*Second Shift architecture: four external apps, one FastAPI engine with the LLM confined to parsing, and a SQLite ledger between the solver and every write*

The rule the diagram encodes is that every write that changes the schedule or reaches a customer goes through the ledger. The only thing posted directly is the bot's own Slack reply, an acknowledgment or a clarifying question, which is best-effort and never blocks planning. snapshot() reads three Sheets tabs and reconciles the Jobs tab with every technician's calendar (Calendar wins) before solving, a plan becomes "proposed" only after the checker passes it, and Approve goes back through the engine for a fresh fingerprint check before the first write.

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

The line that matters is `named`. If the model says Wei is out but "Wei" does not appear in the message and Wei is not the sender, the agent asks instead of planning. The scenario model_mistake_caught feeds guard a deliberately wrong reading and checks that it gets a question.

### A solver that can make chain moves

second_shift/solver.py builds one CP-SAT model per plan. Each job gets an IntVar for its start, bounded by the promised window, a bool for whether it is assigned, and one bool per eligible technician (skills plus equipment, minus anyone absent all day). Shift bounds, absences and pairwise no-overlap with zone-to-zone travel time are added with only_enforce_if on those literals. Protected jobs keep their exact time, and jobs that started before now are frozen.

```python
# second_shift/solver.py
PRIORITY_WEIGHT = {1: 3, 2: 2, 3: 1}
W_COVER = 1000
W_PROTECTED = 10_000
W_BUMP = 1_500
W_TECH_CHANGE = 60
W_SHIFT = 1
```

The objective maximizes coverage weighted by priority, with a large bonus for protected jobs, a penalty for bumping a previously covered job, a small penalty for changing a job's technician, and one point per minute of start-time movement. On the demo data with Marco out, the solver moves Wei's plumbing job J601 to Ana so Wei can take the protected gas job J102, covering 3 of 4 displaced jobs. The greedy baseline in evals/scenarios.py, which never moves anyone else's job, covers 1. The fourth job, J104, gets a reschedule request to the customer.

### A checker that shares no code with the solver

second_shift/validate.py is deliberately boring. check_schedule takes a company and a map of job id to placements and re-derives SKILL, EQUIPMENT, WINDOW, SHIFT, ABSENT, PROTECTED_MOVED, DOUBLE_BOOKED and TRAVEL violations from raw data. check_plan adds an ACCOUNTING check that every job appears exactly once. It runs on the proposed plan, and again on the placements read back from the real calendars after execution. The scenario verification_catches_tampering deletes a booking behind the agent's back and confirms that the per-job Calendar check in verify() flags it.

### Approve, fingerprint, ledger, write, read back

![One approval in Second Shift: re-read and fingerprint check, then each write through the ledger with a provider-side lookup before any retry, then read back and verify](https://anirudhvasudevan.com/blog/diagrams/second-shift-multi-app-dispatch-agent-flow.svg)

*One approval in Second Shift: re-read and fingerprint check, then each write through the ledger with a provider-side lookup before any retry, then read back and verify*

When a plan is proposed, snapshot() computes a SHA-256 fingerprint over the planning fields of the company data, every busy block and every booking id, and the plan stores it. approve() takes a fresh snapshot and compares. If anything changed, the plan is marked "stale" and nothing is written. Each write is an Action with a stable key such as `plan-3f9a1c2e:cal+:J102`. build_actions creates new Calendar bookings before deleting old ones, so a job is never missing from every calendar mid-run, then Sheets rows, Slack messages and emails.

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

A TransientError gets up to three attempts with exponential backoff. A PermanentError stops the run and says so. A crash leaves a pending row, and approving again resumes from the ledger. But a crash can land after the provider accepted a write and before the ledger heard back, so every provider needs its own answer to "did this key already land?"

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

Calendar events get a caller-chosen id from clock.event_id, a SHA-1 of plan id and job id, so a 409 means an earlier attempt landed, or the event was deleted and can be restored in place. Slack posts carry message metadata with the key, and find_by_key scans conversations_history with include_all_metadata. Gmail subjects carry a tag derived from the key, and find_by_key searches in:sent. After the last action, verify() reads all four apps back and builds one Calendar check per job, one per sheet row, post and email, plus one for the rules on the real calendars.

## The hard parts

By default the Slack SDK retries a request after a connection error. If the first attempt had actually reached Slack, that retry could post a route message twice while the engine thinks it posted once. SlackChat passes retry_handlers=[] so the engine owns every retry. google_errors.py does not retry either.

Gmail search can lag a few seconds behind a send, so a resume that searched Sent right after a crash might miss the message and send again. The Gmail adapter checks an in-memory dict of the ids it sent first, which covers retries within one process. After a real restart it falls back to searching Sent, so a send just before a crash is still a small duplicate risk.

Some things are simplified. Drive times come from a zone-to-zone table. One technician per message. OpenAI is the default in parse.py, but the trace label "Read the message (Claude)" still names Claude. The dashboard is about 2,000 lines of framework-free app.js, fast to write and slow to change.

## Results

These numbers come from the repo's own reports and README, not independent measurement. evals/REPORT.md records 30 of 30 reliability scenarios passing. evals/LLM_REPORT.md records 15 of 15 real Slack phrasings reaching the correct decision on gpt-4.1-mini, including a prompt injection. Per docs/BRIEF.md the first run was 14 of 15: "Jordan might be out later, not sure yet" was ignored instead of asked about, and one added prompt rule fixed it. The README lists a live run with 36 of 36 read-back checks and 0 retries, and 104 tests passing.

The README links the final demo video and the version submitted before the 4:00 PM deadline. The repo records no placement or award.

## What I would do differently

The fingerprint is both too coarse and too narrow. It covers most planning fields plus every busy block and booking id on the plan day, so any event on any technician's calendar makes the plan stale, even a personal event for a tech the plan does not touch. A fingerprint over only the techs and jobs involved would cut false stales. The second gap runs the other way: Travel-tab, job zone and job priority edits are not fingerprinted, so a plan built on old drive times can still be approved. Slack is the third gap. SlackChat.find_by_key, used before every post and again in verify(), only looks at conversations_history with limit=200, so in a busy channel a post can fall out of view. verify() could look posts up by the ts stored in the ledger, and the pre-post lookup needs a paginated, time-bounded search.

After that: Slack Socket Mode instead of polling, a routing API for drive times, and multi-tech call-outs.

## Key takeaways

- Give the language model the smallest job that still needs language. Extraction into a strict schema is auditable; planning is not.
- Put a deterministic guard between the model and any action. "The named person must appear in the text" catches a whole class of misreads.
- If the domain has hard rules, use a constraint solver plus a separate checker, and run the checker again on what the external systems contain afterwards.
- Map idempotency to each provider's primitives: caller-chosen ids for Calendar, message metadata for Slack, a subject tag for Gmail. A generic retry wrapper cannot do this.
- Fingerprint the inputs at plan time and compare right before the first write. The world changes while approval waits.

## FAQ

### How does Second Shift stop the LLM from making a bad scheduling decision?

Second Shift never lets the language model schedule anything. The model only outputs a ParsedCallout: is this a call-out, which technician, which hours, and how confident. A deterministic guard() then checks that the named technician appears in the message or is the sender, and that the sender is crew or dispatch. Who does which job is decided by an OR-Tools CP-SAT solver, and an independent checker confirms the plan breaks no rule before a dispatcher sees it.

### What happens if Second Shift crashes in the middle of writing to Google Calendar or Slack?

Second Shift marks every write pending in a SQLite ledger under a stable key before performing it, and done afterwards. If the process dies in between, the row stays pending. The next approve resumes and skips done rows. Calendar re-inserts with the same deterministic id and treats a 409 as done, the Sheets row update is naturally idempotent, and Slack and Gmail look up the key (message metadata or a subject tag) before every send. Three crash scenarios in the eval suite, simulated in the in-memory fakes rather than real process kills, check that the resume finishes without duplicates.

### How does Second Shift prove the new schedule is actually correct?

After the last write, Second Shift reads every technician's Google Calendar, the Jobs sheet, Slack history and Gmail Sent back from the live APIs and checks that each booking and sheet row matches the plan, and that each Slack post and email exists under its key. A booking deleted behind its back fails the Calendar check for that job. Then it runs the rule checker on the placements it just read back, which catches double-booking, skill, window and travel violations on the real calendars.

## Links

- Demo video (1:03): [youtu.be/fXl8JSo9rTc](https://youtu.be/fXl8JSo9rTc)
- Source: [github.com/anirxdh/second-shift](https://github.com/anirxdh/second-shift)

---

*Originally published on [anirudhvasudevan.com](https://anirudhvasudevan.com/blog/second-shift-multi-app-dispatch-agent/).*

*I'm Anirudh Vasudevan, a full-stack and AI engineer in San Francisco and a Member of Technical Staff at Rivo, where I build production voice AI agents. I have won five hackathons, hold a granted patent, and co-wrote a paper accepted to EMNLP. More about me at [anirudhvasudevan.com/about](https://anirudhvasudevan.com/about/), and every project write-up is at [anirudhvasudevan.com/blog](https://anirudhvasudevan.com/blog/).*
