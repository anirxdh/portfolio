---
draft: true
title: "From a Chatbot for One Elder to RUA, a Caregiver Command Center"
description: "The 0-to-1 story of RUA across five repos: a 2025 Flask chatbot, a privacy proposal, a pure-HTML mockup, a local-first iOS app, and a waitlist site."
date: 2026-10-03
slug: rua-product-story
project: "RUA (product story)"
tags: [Product Design, Privacy, Next.js, Netlify, React Native, Caregiving]
repo: https://github.com/anirxdh/hearth-app
live: https://rua-care.netlify.app
accent: "#e07a5f"
summary: "RUA started as a chatbot that talked to an older adult and ended as a command center for the person caring for several of them. This is how the idea moved through a proposal, an HTML mockup, a local-first iOS app, and a waitlist site, and why each step changed the architecture."
---

## The chatbot that talked to the wrong person

RUA is a caregiver command center that keeps medications, refill runways, records, emergency sheets, and insurance paperwork for several older adults in one place, built by Anirudh Vasudevan for the HHS ACL Caregiver AI Prize Challenge (Track 1). It ships as a local-first iOS app, with a web mockup and a waitlist site beside it. It did not start there. It started as a chat box for the elder.

The first version was a Flask and React app called Elderly Care Agent, public as `anirxdh/AiCaretaker`, a repo that dates to 2025. An older adult typed into one chat box, a LangChain agent answered, and when a message sounded like chest pain the agent asked whether to call 911. It had two users, John and Mary, hard-coded as buttons in `frontend/src/App.js`.

What I got wrong was who I was building for. The person who opens a health app every day is not the older adult. It is the daughter who is also watching her mother and an aunt, and who has to track every fill date herself. When the challenge opened with a July 31, 2026 deadline, I went back to the same problem with a different user. This is the product story across five repos; the native app's engineering lives in [the offline-first RUA article](/blog/rua-caregiver-app-offline-first/).

## Why the caregiver became the unit of design

The obvious move was to extend AiCaretaker with accounts and a dashboard. But `backend/agent.py` is 811 lines of prompt and glue around `ChatOpenAI(model="gpt-4o-mini")`, and its emergency path prints "Calling 911..." to the terminal. Nothing in it was load-bearing for a caregiver.

The second option was the one I wrote up first. In a private workspace I drafted a concept paper and a PII privacy architecture with a rule at the top: if a claim cannot be proven with a diagram, an audit log, or a test, RUA does not make it. "HIPAA-protected" went on the prohibited side of its claims register. That RUA was server-first: a server database with row-level security keyed to the care relationship, and zero-retention AI endpoints. The proposal argued against hourly AI scans, which it calls costly, non-reproducible, and regulatorily unsafe, and for event-driven rules instead.

The deadline and being alone decided everything. Phase 1 asks for a design and credible proof, not a product. So I split the work: an HTML mockup I could screenshot for the report in days, then a native app that proved the deterministic core was real. And I dropped the server. A direct-to-consumer caregiver app is not a HIPAA covered entity, and the honest way to protect someone else's health data on a solo timeline is to never hold it. Row-level security became a SQLCipher database on the phone with the key in the Keychain.

## What RUA does, from the caregiver's seat

RUA opens to a Today's Digest. The demo family is Maria caring for her dad Robert, her mom Eleanor, and her aunt Rosa, and the digest shows one lead item: Robert's metformin runs out in a few days. Everyone is fictional, and the app says so. Each person has a Patient 360 with an allergy banner that never scrolls away, vitals, medications with runway bars, labs, and documents. Scan a label parses a pill label into fields Maria confirms one by one; today the native app does this from a bundled sample label, with manual entry as the fallback, and the Apple Vision module is spiked but not yet packaged. The ER sheet prints to PDF, and six emergency guides work with no signal. The Handoff Pack, which would give a respite caregiver a read-only, auto-expiring view, exists only in the mockup so far and sits at phase 31 of the native roadmap. Six admin workflows, from claim denial appeals to Medicaid renewal, run as node graphs that pause at a human confirm step before any document is produced.

## Architecture

RUA is three shipped surfaces plus one private set of documents. The mockup in `hearth-app` is built around one `index.html` with a hash router and inline data, plus `guides.html` for the emergency guide book and `variants.html` for the figure variants. The native app in `hearth-native` is a pnpm monorepo where Expo screens read from an encrypted SQLite database and a pure TypeScript core owns every safety-relevant number. The waitlist site in `rua-site` is a Next.js app on Netlify with one API route.

![RUA across five repos: private design docs feed a public HTML mockup, the mockup ports into a local-first native app, and a separate waitlist site stores signups in Netlify Blobs](/blog/diagrams/rua-product-story-architecture.svg)

Reading left to right: the proposal sets the claims RUA may make, and the mockup's screens became Figures 1 to 9 of the conference report, which is how `variants.html` in `hearth-app` labels them. The mockup then became the spec for the native app: its design tokens became `apps/mobile/src/ds`, and its six `WFDATA` workflow objects became the versioned templates in `packages/workflows`. Nothing flows from the app to a server, because there is no server. The waitlist site is deliberately disconnected from the app and holds only what the signup form sends: an email, two optional answers, and a timestamp (plus the browser's user-agent string, cut to 200 characters).

Here are the real choices, layer by layer.

| Layer | Choice | Why |
|---|---|---|
| Design docs | Markdown proposal, PII architecture, claims register (private) | Every privacy claim must be provable before it appears in UI copy |
| Mockup | `index.html` plus `guides.html`, hash router, inline `WFDATA` and `TPDATA` | Screenshots in days; fake data next to the renderer |
| Native store | SQLCipher SQLite, key in Keychain, Drizzle migrations | Replaces the proposal's server RLS with encryption at rest on device |
| Native logic | `packages/core` pure TypeScript, no React, no clock | Runway and digest are testable in milliseconds and never guess |
| Site framework | Next.js 16 on Netlify, `@netlify/plugin-nextjs` pinned | One API route needs a runtime; pinning stops a static fallback |
| Signup storage | Netlify Blobs store `rua-waitlist`, strong consistency | Durable, no extra account, survives redeploys |
| Notifications | Netlify Forms replay plus optional webhook, best effort | Email without an API key; a flaky notifier can never lose a signup |

## How it works

### From one elder's chat to a caregiver roster

AiCaretaker's chat route took a message and a user id and returned a string.

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
        # ...
        return jsonify({"error": str(e)}), 500
```

That `user_id` is the seed of RUA. The moment I wanted John's daughter to see both John and Mary, the design flipped: the roster is the home screen, the person is a tab, and the question the app answers is "who, out of everyone I care for, needs me right now?"

### The HTML mockup as the executable spec

I built `hearth-app` in one afternoon of commits on July 11, 2026, and its README is blunt: no backend, no build step, fake data. Its main file has 14 views and about 350 lines of script, toggled by a seven-line router that also syncs the sidebar and the URL hash.

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

The parts that mattered were the inline data objects. `WFDATA` holds the six admin workflows as typed nodes, with 21 of its 31 inputs flagged `pii: true`. `buildFlow()` draws them over an SVG layer of bezier edges, and `runWf()` steps each node through active and done states every 820 milliseconds. It looks like a workflow engine. It is a slideshow. But writing every workflow down as data, with a review node before the output node, made the real engine in the native app a port instead of a design exercise.

### Local-first flips the privacy plan

The native app started a day after the mockup. Its architecture document says a pure TypeScript core computes everything that must be exact, an encrypted SQLite database is the single source of truth, and there is no server, no account, and no AI in the first eight phases. The most important number in the product is refill runway.

```ts
// hearth-native/packages/core/src/runway.ts
/**
 * Compute the runway for the most recent fill.
 * Returns null for PRN/as-needed meds (no forecast is honest forecasting).
 */
export function computeRunway(fill: FillInput, today: LocalDate): Runway {
  // ...
  const runOutDate = addDays(fill.fillDate, fill.daySupply);
  const daysRemaining = daysBetween(today, runOutDate);
```

Fill date plus day supply, compared against a `today` the caller passes in, never read from a clock. The file's header calls it "deliberately boring code with exhaustive tests," and it has golden tests across DST and leap days. Everything the proposal pushed to a server, the app pulled onto the phone: row-level security became SQLCipher, the server audit log became `change_log` and `access_log` tables, zero-retention OCR became an on-device Apple Vision seam. The claims register is also why every emergency guide carries a "Pending clinician review v0.9" stamp instead of the word "clinician-reviewed."

### The waitlist that shows its receipt

`rua-site` is a Next.js 16 page with one form and the only real server request in the product. `Waitlist.tsx` asks for an email, reveals two optional selects once it matches a regex, and renders a ledger titled "What this page sends," with the email masked from the third character.

![A waitlist signup flowing from the form through the API route into Netlify Blobs, then replayed to Netlify Forms and a webhook](/blog/diagrams/rua-product-story-flow.svg)

The API route holds the one fix worth telling. An earlier version treated a configured webhook as the system of record, so a slow third party could lose a signup. The current route stores first and notifies second.

```ts
// rua-site/src/app/api/waitlist/route.ts (private repo)
async function persist(entry: Signup): Promise<Via> {
  try {
    const { getStore } = await import("@netlify/blobs");
    const store = getStore({ name: STORE, consistency: "strong" });
    await store.setJSON(`${entry.at}__${encodeURIComponent(entry.email)}`, entry);
    return "blobs";
  } catch {}
  // ...
  return "file";
}
```

The elided lines append to a local `.data/waitlist.jsonl` for development. `notify()` then runs two best-effort calls with `Promise.allSettled` and four-second timeouts: an optional JSON webhook, and a URL-encoded replay to `/__forms.html`, a static file that exists so Netlify's build registers a form named `waitlist`. The route's comment spells out the intent: Netlify fires `submission_created` for that form, and a notification hook set up in the Netlify dashboard (not in the repo) sends the email, with no email API and no key in the code. The response reports `via: "blobs"` so a silent fall back to the file path is visible, and a hidden `company` field is a honeypot.

## The hard parts

The mockup lies well, and that was a risk. Its OCR, assistant, and workflow runs are all static. When the native app took over I refused to ship any feature the mockup depicted but the code could not do. That is why the native Companion tab is a keyword matcher with a 911-first rule, not a language model.

The project was "Hearth" until July 24, 2026, when I rebranded to RUA, and the public screenshots in `hearth-app/screenshots` still show the old name. The hero number is an estimate, too: `WFDATA` says the claim denial appeal takes "12 min, replaces ~3.5 hrs," and the site animates that ruler. Nothing in any of the repos measures that against a real caregiver's time, so it should be labeled as a design target.

The waitlist copy says RUA is in private TestFlight. The native repo's `TODO.md` is honest that Apple Developer enrollment and the first EAS build were still open when I wrote this. The site got ahead of the app.

## Results

The submission package, committed on July 30, 2026 for the July 31 deadline, is a written design report with the mockup screens as figures, plus a screenshot package from the native repo: 57 desktop captures and 47 iPhone captures per the README of its `acl-image-submission` folder. No placement or award is recorded in any of the repos.

What shipped: the public mockup, the public native app with phases 1 to 28 of a 32-phase roadmap complete and 290 unit and component tests plus 14 Playwright specs green in CI per its `TODO.md` and `ARCHITECTURE.md`, and the live waitlist site.

## What I would do differently

I would write the workflow definitions as JSON files from day one, so the native `packages/workflows` templates could import them rather than re-key them. I would settle the "Hearth" name in week one. And I would put the measured-versus-estimated distinction into the site copy before launch.

Next: package the Apple Vision spike into an Expo module, run the airplane-mode release gate on a physical phone, and send the first TestFlight invites.

## Key takeaways

- Pick the user who opens the app most, not the user the problem is about. The elder was the subject; the caregiver was the user.
- Write the privacy claims register before the UI. If code cannot enforce a sentence, it does not go in a screen or a hero.
- A static mockup with its data as typed objects is a spec you can port. A static mockup with hard-coded strings is a picture.
- Store first, notify second, and report which path handled the write. A notifier is never the system of record.

## FAQ

### What is RUA and who is it for?

RUA is a caregiver command center built by Anirudh Vasudevan for the HHS ACL Caregiver AI Prize Challenge, Track 1. It is for the family caregiver who looks after two or three older adults at once and needs one place for their medications, records, and paperwork. Nothing in the core product requires the older adult to type or tap.

### Why does RUA have no server or account?

RUA keeps every record on the phone in a SQLCipher-encrypted SQLite database because the honest way to protect another person's health data as a direct-to-consumer app is to never hold it off-device. The original proposal used a server database with row-level security; the shipped app moves that promise onto the device. Sync is a planned opt-in, never a login wall.

### Is the RUA web mockup a working app?

No. The RUA mockup at `anirxdh/hearth-app` is a set of static HTML files, built around one `index.html`, with fake data, no backend, and no build step. Its OCR, assistant, and workflow runs are animated depictions. It exists so the design could be screenshotted for the report and ported into the native app.

## Links

- Live waitlist site: [rua-care.netlify.app](https://rua-care.netlify.app)
- Web mockup source: [github.com/anirxdh/hearth-app](https://github.com/anirxdh/hearth-app)
- Native app source: [github.com/anirxdh/hearth-native](https://github.com/anirxdh/hearth-native)
- Precursor chatbot: [github.com/anirxdh/AiCaretaker](https://github.com/anirxdh/AiCaretaker)
- The proposal documents and the waitlist site source are private.
