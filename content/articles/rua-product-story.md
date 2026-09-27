---
draft: true
title: "From a Chatbot for One Elder to RUA, a Caregiver Command Center"
description: "The 0-to-1 story of RUA across five repos: a 2025 Flask chatbot, a privacy proposal, a pure-HTML mockup, a local-first iOS app, and a waitlist site."
date: 2026-09-27
slug: rua-product-story
project: "RUA (product story)"
tags: [Product Design, Privacy, Next.js, Netlify, React Native, Caregiving]
repo: https://github.com/anirxdh/hearth-app
live: https://rua-care.netlify.app
accent: "#e07a5f"
summary: "RUA started as a chatbot that talked to an older adult and ended as a command center for the person caring for several of them. This is how the idea moved through a proposal, an HTML mockup, a local-first iOS app, and a waitlist site, and why each step changed the architecture."
---

## The chatbot that talked to the wrong person

In 2025 I built a Flask and React app called Elderly Care Agent. It had one chat box. An older adult typed or spoke into it, a LangChain agent answered, and when the message sounded like chest pain the agent asked whether it should call 911. The code is public as `anirxdh/AiCaretaker`. It had a Pinecone index named `elderly-health-agent`, a Whisper transcription route, and a Google Calendar booking tool. It also had two users, John and Mary, hard-coded as buttons in `frontend/src/App.js`.

The thing I got wrong was not the model or the vector store. It was who I was building for. The person who opens a health app forty times a day is not the 81-year-old. It is his daughter, who is also watching her mother and an aunt, and who keeps fill dates on sticky notes. When the HHS Administration for Community Living opened the Caregiver AI Prize Challenge with a July 31, 2026 deadline, I went back to the same problem with a different user.

RUA is a caregiver command center, a local-first iOS app with a web mockup and a waitlist site, that keeps medications, refill runways, records, emergency sheets, and insurance paperwork for several older adults in one place, built by Anirudh Vasudevan for the HHS ACL Caregiver AI Prize Challenge (Track 1). This article is the product story across all five repos. The deep engineering of the native app lives in [the offline-first RUA article](/blog/rua-caregiver-app-offline-first/).

## Why the caregiver became the unit of design

The obvious move was to extend AiCaretaker: add accounts, add a second user role, bolt a dashboard on the Flask server. I considered it for about a day. The agent in `backend/agent.py` is 811 lines of prompt and glue around `ChatOpenAI(model="gpt-4o-mini")`, and its emergency path prints "Calling 911..." to the terminal. Nothing in it was load-bearing for a caregiver.

The second option was the one I actually wrote up first. In a private workspace for the challenge I drafted a concept paper, a gap analysis with 13 ranked ideas, a competitor map, and a PII privacy architecture. That version of RUA was audio-first and server-first: one caregiver keeps watch over four or five older adults, a Postgres database with row-level security keyed to the care relationship isolates every family, and all AI calls run on zero-retention endpoints. The system design page even argued against an "hourly LLM scan" design and for event-driven rules, because 120 model calls a day across five people would mostly find nothing and would be untestable for the challenge's TRL-3 bar.

The constraint that decided everything was the deadline and the fact that I was alone. Phase 1 of the challenge asks for a design and credible proof, not a finished product. So I split the work in two. First, a frontend-only HTML mockup that could be screenshotted for the written report in days. Second, a native app that proved the deterministic core (refill math, digest ranking, label parsing) was real. And I dropped the server. A direct-to-consumer caregiver app is not a HIPAA covered entity, my own compliance framework said never to claim it was, and the honest way to protect someone else's health data on a solo timeline is to never hold it. The proposal's row-level security became a SQLCipher database on the phone with the key in the Keychain. The same privacy promise, enforced by a different mechanism.

## What RUA does, from the caregiver's seat

RUA opens to a Today's Digest. The demo family is Maria caring for her dad Robert, her mom Eleanor, and her aunt Rosa, and the digest shows one lead item (Robert's metformin runs out in a few days) plus a few quiet lines. Every person and record is fictional, and the app and the mockup both say so.

From there Maria taps into a Patient 360 for each person: an allergy banner that never scrolls away, vitals as trends, medications with runway bars, history, labs, and documents. The Medications hub shows every runway across all three people. Scan a label reads a pill bottle photo into fields she confirms one by one before anything is saved. The ER sheet and the one-pager print to PDF for a hospital or a relative. The Handoff Pack gives a respite caregiver a read-only, auto-expiring view. Six emergency guides work with no signal. Six admin workflows (claim denial appeal, prior authorization, Medicaid renewal, records release, discharge-to-home, new patient intake) run as node graphs that pause at a human confirm step before any document is produced.

The waitlist site at rua-care.netlify.app tells the same story in scroll form and asks for one email.

## Architecture

RUA is three shipped surfaces plus one private set of documents. The public HTML mockup in `hearth-app` is a single `index.html` with a hash router and inline data, no backend and no build step. The native app in `hearth-native` is a pnpm monorepo where Expo screens read from an encrypted SQLite database and a pure TypeScript core owns every safety-relevant number. The waitlist site in `rua-site` is a Next.js app on Netlify with one API route. The proposal documents are private and are not linked here.

![RUA across five repos: private design docs feed a public HTML mockup, the mockup's design language and workflow data port into a local-first native app, and a separate Next.js waitlist site stores signups in Netlify Blobs](/blog/diagrams/rua-product-story-architecture.svg)

Reading left to right: the proposal and PII architecture set the claims RUA is allowed to make, and the mockup's screens were wired into the written report as Figures 1 to 9 (the mockup's own variants page says so). The mockup then became the spec for the native app. Its Ivory Editorial design tokens became `apps/mobile/src/ds`, and its six `WFDATA` workflow objects became the versioned workflow templates in `packages/workflows`. Nothing flows from the app to a server, because there is no server.

The waitlist site is deliberately disconnected from the app. The form posts JSON to `/api/waitlist`, the route writes to a Netlify Blobs store first, then replays the signup into Netlify Forms so the platform's own `submission_created` event sends me an email. The only personal data the whole system holds off-device is an email address, and the page prints a ledger of exactly that.

Here are the real choices, layer by layer.

| Layer | Choice | Why |
|---|---|---|
| Precursor | Flask + LangChain + Pinecone chat (`AiCaretaker`) | Proved the domain, then showed the elder is the wrong primary user |
| Design docs | Markdown proposal, PII architecture, claims register (private) | Every privacy claim must be provable before it appears in UI copy |
| Mockup | One `index.html`, hash router, inline SVG, no dependencies | Screenshots for the report in days; opens from a file with no install |
| Mockup data | Inline `WFDATA`, `TPDATA`, `ERDATA`, `OPDATA` objects | Fake data next to the renderer, easy to review and later port |
| Native store | SQLCipher SQLite, key in Keychain, Drizzle migrations | Replaces the proposal's server RLS with encryption at rest on device |
| Native logic | `packages/core` pure TypeScript, no React, no clock | Runway and digest are testable in milliseconds and never guess |
| Site framework | Next.js 16 on Netlify with `@netlify/plugin-nextjs` pinned | One API route needs a runtime; pinning stops a static fallback |
| Signup storage | Netlify Blobs store `rua-waitlist`, strong consistency | Durable, no extra account, survives redeploys |
| Notifications | Netlify Forms replay plus optional webhook, best effort | Email without an API key; a flaky notifier can never lose a signup |

## How it works

### From one elder's chat to a caregiver roster

AiCaretaker's whole surface was three routes. The chat route took a message and a user id and returned a string. The other two checked for pending follow-ups and transcribed audio with Whisper.

```python
# AiCaretaker/backend/app.py
@app.route('/chat', methods=['POST'])
def chat():
    try:
        data = request.get_json()
        user_input = data.get("message")
        user_id = data.get("user_id")
        response = agent_response(user_input, user_id=user_id)
        return jsonify({"response": response})
    except Exception as e:
        return jsonify({"error": str(e)}), 500
```

That `user_id` is the seed of RUA. The moment I wanted John's daughter to see both John and Mary, the design flipped: the roster is the home screen, the person is a tab, and the question the app answers is "who, out of everyone I care for, needs me right now?" The concept paper I wrote for the challenge says exactly that, and the three capabilities it centers on (medication supply forecasting, proactive check-ins, a calm multi-person vitals view) are all things the elder never has to type.

### The paper architecture that set the rules

Before any RUA screen existed, I wrote the privacy architecture as a document with a rule at the top: if a claim cannot be proven with a diagram, an audit log, or a test, RUA does not make it. It listed six enforcement layers (isolation, encryption, zero-retention AI, auditability, recipient rights, sharing boundaries) and a claims register of sentences the product may and may not say. "HIPAA-protected" is on the prohibited side. So is "we monitor your loved one's safety."

That register is why the native app ships a visible "Pending clinician review v0.9" stamp on every emergency guide instead of the word "clinician-reviewed," and why the mockup's assistant screen includes a refusal on a dosage question. The document also promised an append-only access log the care recipient could read in print. In the native app that became the `access_log` table and a screen at `apps/mobile/src/app/access-log.tsx`. The mechanism changed from Postgres to SQLite. The promise did not.

### The HTML mockup as the executable spec

I built `hearth-app` in two days in July 2026, and its README is blunt: no backend, no build step, fake data. The entire app is one file with 13 views, an inline style block, and about 350 lines of script. Views are sections toggled by a seven-line router that also syncs the sidebar and the URL hash.

```js
// hearth-app/index.html
function go(v){
  document.querySelectorAll('.view').forEach(x=>x.classList.remove('on'));
  var el=document.getElementById('v-'+v); if(el) el.classList.add('on');
  document.querySelectorAll('.nav').forEach(n=>n.classList.toggle('on', n.dataset.v===v));
  document.querySelector('main').scrollTop=0;
  if(history.replaceState) history.replaceState(null,'','#'+v);
}
```

The parts that mattered for the product were the inline data objects. `WFDATA` holds the six admin workflows as typed nodes (trigger, extract, lookup, decision, generate, review, output, notify) with `pii: true` flags on 28 inputs. `buildFlow()` draws them as absolutely positioned DOM nodes over an SVG layer of cubic bezier edges, and `runWf()` steps each node through active and done states every 820 milliseconds. It looks like a workflow engine. It is a slideshow. But writing every workflow down as data with a human review node before the output node is what made the real engine in the native app a port instead of a design exercise.

The mockup also carries its own design history. A separate variants page records the first blue build, an ember re-theme, five parallel style directions, and the verdict "TOO COLORFUL" on the way to the Ivory Editorial look that the native app now uses.

### Local-first flips the privacy plan

The native app started two days after the mockup. Its architecture document has one sentence I keep coming back to: a pure TypeScript core computes everything that must be exact, an encrypted local SQLite database is the single source of truth, and there is no server, no account, and no AI anywhere in the first eight phases. The most important number in the product is refill runway, and it is arithmetic.

```ts
// hearth-native/packages/core/src/runway.ts
export function statusFor(daysRemaining: number): RunwayStatus {
  if (daysRemaining <= 0) return 'overdue';
  if (daysRemaining <= RUNWAY_THRESHOLDS.urgent) return 'urgent';
  if (daysRemaining <= RUNWAY_THRESHOLDS.soon) return 'soon';
  return 'ok';
}
// runOutDate = fillDate + daySupply; daysRemaining = runOutDate - today
// PRN meds get no forecast, and "today" is injected, never read from a clock.
```

The proposal had described this exact rule (fill date plus day supply, no adherence guessing, PRN excluded honestly) as the one deterministic engine a judge could bench-test. The native app made it a package with golden tests across DST and leap days. Everything the proposal had pushed to a server, the app pulled onto the phone: row-level security became SQLCipher, the server audit log became `change_log` and `access_log` tables, zero-retention OCR became on-device Apple Vision. The 32-phase roadmap still has Supabase and PowerSync at phases 29 and 30, but they are opt-in additions, not prerequisites.

### The waitlist that shows its receipt

The last repo is the smallest and the only one with a real server request. `rua-site` is a Next.js 16 marketing page with one form. The component `Waitlist.tsx` asks for an email, reveals two optional selects only after the email matches a regex, and renders a ledger under the button titled "What this page sends," with the email masked from the third character. Below that, a struck-through list of things the page never asks for: your name, your phone, the name of the person you care for.

![A waitlist signup flowing from the form through the Next.js API route into Netlify Blobs, then replayed to Netlify Forms and an optional webhook for notification](/blog/diagrams/rua-product-story-flow.svg)

The API route is where I made the one architectural fix worth telling. An earlier version treated a configured webhook as the system of record, so a slow third party could lose a signup. The current route stores first and notifies second.

```ts
// rua-site/src/app/api/waitlist/route.ts (private repo)
async function persist(entry: Signup): Promise<Via> {
  try {
    const { getStore } = await import("@netlify/blobs");
    const store = getStore({ name: STORE, consistency: "strong" });
    await store.setJSON(`${entry.at}__${encodeURIComponent(entry.email)}`, entry);
    return "blobs";
  } catch {}
  // local dev only: append to .data/waitlist.jsonl
  return "file";
}
```

`notify()` then runs two best-effort calls with `Promise.allSettled` and four-second timeouts: an optional JSON webhook, and a URL-encoded replay of the signup to `/__forms.html`, a static file that exists only so Netlify's build can register a form named `waitlist`. Netlify fires `submission_created` and its own notification hook emails me. No email API, no key. The response reports `via: "blobs"` so a silent fall back to the ephemeral file path can never go unnoticed. A hidden `company` field acts as a honeypot, and the GET endpoint that lists signups stays off entirely unless an admin key is set in the environment.

## The hard parts

The mockup lies well, and that was a risk. The OCR viewfinder, the RxNorm check, the grounded assistant with citations, and the animated workflow runs are all static. I kept the README disclaimer and the in-app fictional-data notice on every surface, and when the native app took over I refused to ship any feature that the mockup depicted but the code could not do. That is why the native Companion tab is a keyword matcher with a 911-first rule, not a language model.

Two repos with the same product name and different names in git was a mess I made myself. The project was "Hearth" until July 25, 2026, when I rebranded to RUA. The public screenshots in `hearth-app/screenshots` still show the old name and two sidebar links I later hid.

The mockup's hero number is an estimate. `WFDATA` says the claim denial appeal takes "12 min, replaces ~3.5 hrs," and the site's hero animates a ruler from three and a half hours down to a twelve-minute sliver. I have not measured that with a caregiver. The number is a design target from the workflow data, and I should label it that way on the site.

The waitlist copy says RUA is in private TestFlight. The native repo's `TODO.md` is honest that Apple Developer enrollment, the first EAS build, and the internal TestFlight group were still on my list when I wrote this. The site got ahead of the app by a few days, which is the kind of gap a one-person team creates.

## Results

The submission went in for the July 31, 2026 deadline as a written design report with the mockup screens as figures, plus a screenshot package from the native repo: 57 desktop captures and 47 iPhone captures per its README. No placement or award is recorded in any of the repos, and I am not claiming one here.

What shipped in code: the public mockup (`hearth-app`), the public native app (`hearth-native`) with phases 1 to 28 of a 32-phase roadmap complete and 290 unit and component tests plus 14 Playwright specs green in CI per its `TODO.md` and `ARCHITECTURE.md`, and the waitlist site live at rua-care.netlify.app with working storage and email notification.

## What I would do differently

I would write the workflow definitions as JSON files from day one instead of as an inline JavaScript object in the mockup, so the native `packages/workflows` templates could import them rather than re-key them. I would fold the "Hearth" name decision into week one so screenshots did not need re-capturing. And I would put the measured-versus-estimated distinction into the site copy before launch, not after.

What is next is on the list already: package the Apple Vision spike into an Expo module, run the airplane-mode release gate on a physical phone, get a licensed reviewer's name onto the emergency guides, and send the first TestFlight invites to the people on the list.

## Key takeaways

- Pick the user who opens the app most, not the user the problem is about. The elder was the subject; the caregiver was the user.
- Write the privacy claims register before the UI. If a sentence cannot be enforced by code, it should not appear in a screen, a README, or a hero.
- A static mockup with its data as typed objects is a spec you can port. A static mockup with hard-coded strings is a picture.
- A design proposal's server-side guarantees can often be replaced by on-device guarantees when the app is direct-to-consumer and offline is a feature.
- Store first, notify second, and report which path handled the write. A notifier is never the system of record.
- When marketing gets ahead of the build, say so in the repo. A public `TODO.md` is cheaper than a broken promise.

## FAQ

### What is RUA and who is it for?

RUA is a caregiver command center built by Anirudh Vasudevan for the HHS ACL Caregiver AI Prize Challenge, Track 1. It is for the family caregiver who looks after two or three older adults at once and needs one place for their medications, refill runways, vitals, records, emergency sheets, and insurance paperwork. RUA is not built for the older adult to operate; nothing in the core product requires them to type or tap.

### Why does RUA have no server or account?

RUA keeps every record on the phone in a SQLCipher-encrypted SQLite database because the honest way to protect another person's health data as a direct-to-consumer app is to never hold it off-device. The original proposal used Postgres with row-level security and zero-retention AI endpoints; the shipped app moves each of those promises onto the device. Accounts and sync are planned as opt-in additions in later phases of the RUA roadmap, never as a login wall.

### Is the RUA web mockup a working app?

No. The RUA mockup at `anirxdh/hearth-app` is a single HTML file with fake data, no backend, and no build step. Its OCR, assistant, and workflow runs are animated depictions. It exists so the design could be screenshotted for the challenge report and so the native app had a concrete spec to port from.

### How does the RUA waitlist store signups?

The RUA waitlist site is a Next.js app on Netlify. Its `/api/waitlist` route validates the email, checks a honeypot field, writes the signup to a Netlify Blobs store with strong consistency, and only then replays it to Netlify Forms and an optional webhook so a notification email goes out. Storage never depends on the notifier, and the page shows a ledger of exactly which fields it sends.

### Did RUA win the ACL Caregiver AI Prize Challenge?

No result is recorded in any of the RUA repos, and this article does not claim one. The Phase 1 submission was a written design report with the mockup's screens as figures and a screenshot package from the native app.

## Links

- Live waitlist site: [rua-care.netlify.app](https://rua-care.netlify.app)
- Web mockup source: [github.com/anirxdh/hearth-app](https://github.com/anirxdh/hearth-app)
- Native app source: [github.com/anirxdh/hearth-native](https://github.com/anirxdh/hearth-native)
- Precursor chatbot: [github.com/anirxdh/AiCaretaker](https://github.com/anirxdh/AiCaretaker)
- Native app deep dive: [Building RUA, an offline-first caregiver app](/blog/rua-caregiver-app-offline-first/)
- The proposal documents and the waitlist site source are private.
