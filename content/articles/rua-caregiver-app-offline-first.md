---
draft: true
title: "Building RUA, an Offline-First Caregiver App With Provable Math"
description: "How I built RUA, a SQLCipher-encrypted, no-server iOS caregiver app whose refill math, digest ranking, and label parsing are pure, tested TypeScript."
date: 2026-09-27
slug: rua-caregiver-app-offline-first
project: "RUA (native app)"
tags: [React Native, SQLCipher, Drizzle, Offline-First, Apple Vision, Privacy]
repo: https://github.com/anirxdh/hearth-native
accent: "#e07a5f"
summary: "RUA keeps a family's medication and care records in a SQLCipher database on the phone, with no server and no account. A React-free TypeScript core computes refill runways, ranks a daily digest, and pre-schedules alerts, and a deterministic parser reads pharmacy labels."
---

## The number that must never be wrong

A medication running out is the most preventable failure in family caregiving, and it is fully determined by two numbers printed on the bottle: the fill date and the day supply. That fact shaped everything about how I built RUA. If the app's most important output can be computed with addition, it should never be guessed, inferred, or fetched from a server.

RUA is a local-first iOS caregiver app that tracks medications, refill runways, vitals, records, and paperwork for several older adults on one phone, built by Anirudh Vasudevan for the HHS Administration for Community Living Caregiver AI Prize Challenge (Track 1). The demo family and the reason a caregiver wants one command center are in the [product story](/blog/rua-product-story/). This article is about the engineering underneath: an encrypted SQLite database as the only source of truth, a pure TypeScript core that owns every safety-relevant number, and a label reading pipeline proven with a spike before the feature existed. The repo is public as `anirxdh/hearth-native` (the project started as "Hearth").

## Why no server, no account, and no model

The obvious approach is a backend: accounts, Postgres, a sync layer, and an LLM for the "AI" part of the challenge. I considered it and rejected it for three reasons.

A direct-to-consumer caregiver app is not a HIPAA covered entity, and the compliance framework I wrote for the project says never to claim HIPAA coverage; the honest way to protect someone else's health data is to never hold it. The things a caregiver needs in an emergency (an ER sheet, a medication list, a fall guide) must work in a hospital basement with no signal, a rule I wrote into `HOSPITAL_BASEMENT.md` as a release checklist. And I was solo against a July 31 deadline, where every network path is a failure path.

So RUA runs entirely on the phone: SQLCipher-encrypted SQLite, key in the iOS Keychain, no network calls in shipped code. The "AI" is on-device Apple Vision OCR plus deterministic parsing. There is no LLM in this codebase; the Companion chat in `apps/mobile/src/lib/companion.ts` is a keyword matcher that answers any emergency-sounding message with the 911 line first. I would rather ship a smaller truthful thing than a larger one that guesses.

## What a caregiver does in RUA

RUA opens to a Today's Digest: one lead item and at most four quiet lines, ranked across everyone in the care circle. The demo seed computes fill dates relative to today, so Robert's metformin is always about three days from empty.

A caregiver adds a patient (with an attestation that they may hold that person's information), adds medications with fill date and day supply, and watches a runway bar count down. High-alert drugs such as anticoagulants get an extra confirmation. Vitals, labs, history, and documents hang off each record. The paper layer prints an ER sheet and a one-pager through `expo-print`, logs every share, and deletes the PDF afterward. Settings offers a passphrase-encrypted backup, an opt-in Face ID lock, and a full wipe. Six emergency guides work offline and carry a visible "Pending clinician review v0.9" stamp. A scan-a-label flow parses a bottle photo into a confirm screen, and six resumable admin workflows (claim appeal, prior auth, Medicaid renewal, and more) pause at a Human Confirm gate before any document is produced.

## Architecture

RUA has three layers and no network. Expo screens read rows straight from SQLite and hold no domain state. The repository in `apps/mobile/src/db/repo.ts` is the only write path, and every write appends to `change_log` and bumps a version counter. The core in `packages/core` never imports React and never reads the clock; "today" is injected from `apps/mobile/src/lib/clock.ts`.

![RUA architecture: screens, repository, SQLCipher, and the pure core beside the iOS Keychain, notifications, and Vision](/blog/diagrams/rua-caregiver-app-offline-first-architecture.svg)

On the JavaScript side, screens call `useData()`, a wrapper over `useSyncExternalStore` that re-runs a synchronous SQLite read whenever the version changes. The repository sits between screens and Drizzle so ids (UUIDv7), timestamps, and audit rows stay consistent. The core is fed rows plus a date and returns runways, a ranked digest, and a desired set of notifications. On the native side, `expo-sqlite` is built with `useSQLCipher: true` in `app.json`, the key lives in the Keychain through `expo-secure-store`, and `expo-notifications` holds pre-scheduled alerts. Apple Vision is looked up optionally as a module named `RuaVision`.

| Layer | Choice | Why |
|---|---|---|
| Storage | expo-sqlite with SQLCipher, WAL mode | PHI unreadable at rest; `PRAGMA key` first on every connection |
| Key custody | expo-secure-store, `AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY` | Key never leaves the Keychain; key loss means data loss by design |
| ORM and migrations | Drizzle ORM, drizzle-kit, embedded by a script | Metro cannot import `.sql`; a test fails CI if the copy is stale |
| Domain logic | `packages/core`, pure TS, no React | Safety math testable on plain Node |
| UI state | `useSyncExternalStore` over a version counter | No Redux mirror to drift from the database |
| Alerts | Pre-scheduled local notifications, diff-reconciled | iOS background execution is throttled, so plan at write time |
| Label reading | Apple Vision on device plus a deterministic parser | A miss is an absence, never a wrong value |

## How it works

### Booting an encrypted database with five explicit states

`bootDatabase()` in `apps/mobile/src/db/client.ts` checks whether the database file exists and whether the Keychain holds a key, and returns one of five states: `ready`, `key-without-db`, `db-without-key`, `migration-failed`, or `boot-error`. Each mismatch renders a recovery screen instead of crash-looping, because a phone restore can bring back the Keychain without the file, or the reverse. The key is 32 random bytes from `expo-crypto`, hex-encoded.

```ts
// apps/mobile/src/db/client.ts
function openEncrypted(key: string): { db: RuaDb; raw: SQLiteDatabase } {
  const raw = openDatabaseSync(DB_NAME);
  // Must be the first statement against the connection.
  raw.execSync(`PRAGMA key = "x'${key}'";`);
  raw.execSync('PRAGMA journal_mode = WAL;');
  raw.execSync('PRAGMA foreign_keys = ON;');
  const db = drizzle(raw, { schema });
  return { db, raw };
}
```

Migrations run through `migrateSafely()`, which checkpoints the WAL, copies the database file to a `.premigrate` sibling, and applies the Drizzle bundle; if `migrate()` throws, it restores the snapshot and surfaces `migration-failed`. `packages/schema/src/__tests__/durability.test.ts` injects a failing migration with `better-sqlite3` and asserts the restored file matches the seeded row counts.

### Every write goes through one door

There are four generated migrations and nineteen tables in `schema.ts`, from `patients` and `med_fills` to `wf_execution_outputs`. Every consequential write in `repo.ts` calls a private `logChange()` that inserts a `change_log` row with a UUIDv7 id, a timestamp, the entity, the action, and a diff, then calls `bumpDataVersion()`. That one choke point lets the UI work without a state store.

![Saving a fill: repository write, change log, re-read, runway, and notification reconcile](/blog/diagrams/rua-caregiver-app-offline-first-flow.svg)

Follow one action through the diagram. The caregiver enters a fill date and day supply. `addFill()` generates a UUIDv7, inserts into `med_fills`, appends to `change_log`, and bumps the version. The home screen's `useData()` callback re-runs: it lists medications, computes each runway with `computeRunway(latestFill, today())`, and hands the results to `buildDigest()`. Then `syncNotifications()` in `apps/mobile/src/lib/notifications.ts` builds the desired alert set, fetches what iOS has pending, and applies a set diff. Nothing is cached in JavaScript between those steps.

### Runway, digest, and alerts are arithmetic

The engine in `packages/core/src/runway.ts` is deliberately boring: `runOutDate = fillDate + daySupply`, `daysRemaining = runOutDate - today`, and the thresholds are constants.

```ts
// packages/core/src/runway.ts
export function statusFor(daysRemaining: number): RunwayStatus {
  if (daysRemaining <= 0) return 'overdue';
  if (daysRemaining <= RUNWAY_THRESHOLDS.urgent) return 'urgent';
  if (daysRemaining <= RUNWAY_THRESHOLDS.soon) return 'soon';
  return 'ok';
}
```

`soon` is 10 days and `urgent` is 3. As-needed medications get no forecast, and a medication with no fill on record produces an explicit "add fill" item rather than a guess. Dates are `YYYY-MM-DD` strings and all day math in `dates.ts` goes through `Date.UTC`, so DST cannot shift a runway; the tests pin spring-forward, fall-back, leap days, and year boundaries. `buildDigest()` ranks items by kind (overdue, urgent, soon, no fill data, stale for 14 or more days, all good), then by a sort key where high-alert breaks ties, and returns one lead plus at most four quiet lines. That cap is the anti-alarm-fatigue rule, and `digest.test.ts` pins the ordering.

Alerts follow from the same arithmetic. Because the run-out date is known when a fill is saved, `planNotifications()` computes the whole desired set up front: lead, urgent, run-out day, and a next-day overdue nudge. Each has a stable key of the form `med:<id>:<tag>:<date>`, sorted nearest-first and sliced to the iOS cap of 64. Reconciliation is a set difference.

```ts
// packages/core/src/notifications.ts
// inside reconcile(desired, existingKeys)
const want = new Map(desired.map((d) => [d.key, d]));
const have = new Set(existingKeys);
return {
  toCancel: existingKeys.filter((k) => !want.has(k)),
  toSchedule: desired.filter((d) => !have.has(d.key)),
};
```

The key becomes the `expo-notifications` identifier, so an identical plan is a no-op and editing a fill date reschedules cleanly. The title is always "A medication needs attention" and the body never names a drug, dose, or person; `scripts/guardrails.sh` greps for that string in CI and fails the build if it changes.

### Reading a pharmacy label without a model

`apps/mobile/src/lib/ocr.ts` asks iOS for a native module called `RuaVision` and falls back to a planted text fixture when the module is not in the build.

```ts
// apps/mobile/src/lib/ocr.ts
const vision = requireOptionalNativeModule<RuaVisionModule>('RuaVision');
if (vision) {
  try {
    const text = await vision.recognizeText(uri);
    if (text && text.trim().length > 0) return text;
  } catch {
    // Fall through: an unreadable photo is handled by the caller.
  }
}
```

The text becomes `OcrLine[]` (text, pixel bounding box, Vision confidence) and enters `parseLabel()` in `packages/label-parser/src/parseLabel.ts`. The parser groups lines into visual rows by comparing vertical centers within 60 percent of line height, then flattens into reading order. Each field has a fixed heuristic. `findDrug()` matches a bundled list of about 80 generics and only falls back to a Levenshtein distance of 1 on words of six or more characters, at a 0.7 confidence factor. `findFillDate()` reads the value beside a "DATE FILLED" label and rejects discard, expiry, and refill-by decoys. Every field's confidence is the Vision line confidence times a heuristic factor. The confirm screen in `apps/mobile/src/app/scan/confirm.tsx` flags anything below 0.8 and refuses to save without a day supply from 1 to 365, because that field drives the runway.

### The OCR spike that came before the feature

I did not want to build the scan UI and then learn Vision could not read labels, so `spike/ocr` came first. `corpus-gen.mjs` renders 40 synthetic US pharmacy labels in headless Chrome across four layout families (CVS-style, Walgreens-style, Kaiser mail-order-style, independent) with rotated, low-contrast, sticker-occluded, and small-font variants, each with ground-truth JSON. `VisionOCR.swift` is a macOS CLI that runs `VNRecognizeTextRequest` with `recognitionLevel = .accurate` and `usesLanguageCorrection = false`, so drug names are not autocorrected into dictionary words.

`docs/ocr-scorecard.md` reports 100 percent exact match on clean images for every field and 85 percent overall for day supply. All six misses were sticker images where the value is physically covered, and the parser returned nothing rather than a wrong number. The scorecard also decided the confirm UI: Vision scores short numeric tokens like "QTY: 60" near 0.5, so absence, not misreads, is the dominant failure. That is why the screen has a strong empty-state treatment rather than red underlines.

## The hard parts

The biggest gap is that the native Vision module is not packaged into the app. `ocr.ts` is written against it and the spike proved the API, but wrapping the Swift into an Expo Module needs a device build, and `TODO.md` lists it as a finishing item. In the current build the scan flow runs on the bundled sample label or a planted fixture. I would rather say that plainly than ship a fake camera.

The web build is a test surface, not a product. `expo-sqlite`'s synchronous API cannot run on the web main thread, so `apps/mobile/src/db/webdb.web.ts` swaps in `sql.js` and replays the embedded migration bundle. It is unencrypted and in-memory per tab, which is right for CI and wrong for real data.

Some code is hackier than I would like. The backup passphrase is interpolated into `PRAGMA key` and `ATTACH DATABASE ... KEY` strings with a hand-rolled quote escaper, because those statements do not accept bound parameters. `useData()` re-runs every screen query on any write. The copy-restore migration protects against a bad migration, not an interrupted file copy. And the emergency guides still say "Pending clinician review v0.9."

## Results

RUA was the native-app deliverable for the ACL Caregiver AI Prize Challenge, Track 1. The last commit ("ACL submission package, onboarding walkthrough, film sidecar files") is dated July 30, 2026. The challenge outcome is not recorded in the repo and I am not claiming one here.

What shipped in code: `TODO.md` counts 290 unit and component tests plus 14 Playwright specs, enforced on every push by GitHub Actions along with `guardrails.sh` and a visible `core-safety` job. When I ran `wc` on the clone, the TypeScript came to roughly 24,000 lines. Scan, workflows, backup, print, and digest all run on the iOS simulator. TestFlight distribution, a physical-device notification soak, and a real-bottle OCR corpus are open items.

## What I would do differently

I would package the Vision Expo Module before writing the confirm screen; the UI ended up designed around a fixture, and real phone photos will move the 0.8 flag threshold. I would move the passphrase-keyed SQL out of string interpolation, and add a checksum on the `.premigrate` snapshot.

Next is sync. The `change_log` table with UUIDv7 ids is already the change feed a sync engine consumes, so sharing becomes a migration rather than a rewrite. The Companion seam, `answerFor(text, ctx)`, is where a model could go later, behind consent and a user-supplied key, with the 911-first rule still enforced locally.

## Key takeaways

- If an output can be computed from stored facts with arithmetic, compute it in a pure package with no framework imports and pin it with golden tests.
- Inject "today" instead of reading the clock inside domain code, and keep calendar dates as strings with UTC-only day math. DST bugs disappear when the core cannot see the clock.
- Pre-schedule local notifications at write time with stable keys and reconcile by set diff. It turns "did the background task run" into a non-question.
- Make the boot path return an explicit state for every key-and-file combination. Encrypted storage has more failure modes than a plain file.
- Run a feasibility spike with a per-field scorecard before building the feature that depends on it, and let those numbers decide the UI.
- A single write path that appends to a change log gives you an audit trail, a UI refresh signal, and a future sync feed for the price of one function.

## FAQ

### How does RUA keep health data private without a server?

RUA never sends data anywhere. All records live in a SQLCipher-encrypted SQLite database on the phone, the key is stored only in the iOS Keychain, and the shipped code makes no network calls. Sensitive reads, prints, shares, and backups are recorded in an `access_log` table, and a privacy overlay covers the UI whenever the app is inactive.

### How does RUA calculate when a medication will run out?

RUA computes a refill runway as fill date plus day supply, compared against today's date, in `packages/core/src/runway.ts`. Thresholds are constants: `soon` at 10 days or fewer, `urgent` at 3 or fewer, `overdue` at 0 or below. As-needed medications get no forecast, and a medication with no recorded fill shows an explicit "add fill" state instead of an estimate.

### Does RUA use an LLM or cloud AI?

No. RUA's shipped code contains no language model and no cloud AI. Scan-a-label uses Apple Vision text recognition on device (proven in a spike, with the native module still to be packaged) and a deterministic TypeScript parser. The Companion chat is a local keyword matcher that leads with the 911 line for emergency-sounding messages.

### How does RUA back up an encrypted database?

RUA attaches a new database keyed with a caregiver-chosen passphrase and runs SQLCipher's `sqlcipher_export`, so the file that leaves the phone is encrypted with something the caregiver knows. Import verifies the passphrase, replaces the live file, and re-exports under this device's Keychain key.

## Links

- Source on GitHub: [anirxdh/hearth-native](https://github.com/anirxdh/hearth-native)
- Product story: [Why I built RUA](/blog/rua-product-story/)
- Waitlist: [rua-care.netlify.app](https://rua-care.netlify.app)
