---
draft: true
title: "Building a 3D Village That Is a Pure Function of the Clock"
description: "How Anirudh's World keeps 20 villagers living on the real clock with no server, using seeded PRNG streams, the drand beacon and a golden-digest test."
date: 2026-09-27
slug: anirudhs-world-deterministic-village
project: "Anirudh's World (Vivarium)"
tags: [Three.js, Deterministic Simulation, drand, PRNG, Procedural Generation, Replit]
live: https://av-world.replit.app
accent: "#7c9cff"
summary: "Anirudh's World is a low-poly village where every villager's position, mood and job is recomputed each frame from a seed and Date.now(), so it needs no server to stay alive. Here is how the named-stream PRNGs, the drand fate layer, the verification scripts and the project-portal camps work."
---

## The village that kept going while I slept

The first build of this village went live on June 11, 2026. The next morning I opened the URL on my phone and the chief was already at the well, the house on the east lot was a few percent further along, and the night watch had just gone to bed. Nothing had run overnight to make that happen. No cron job, no database write, no server tick. The village had simply been evaluated at a new time.

Anirudh's World (the codebase is called Vivarium) is a browser-based 3D life simulation that keeps a low-poly village of 20 villagers living on the real-world clock with no backend, built by Anirudh Vasudevan as a personal project and as the playable "Explore" world linked from this portfolio. Every frame, the renderer computes the entire shared world as a pure function of two inputs: a fixed seed string and `Date.now()`. There is no save file and no simulation loop. That one decision is the whole project.

I built it over roughly four weeks in June and July 2026, in plain ES-module JavaScript on three.js r184 with no bundler. The source is private; the world is live at av-world.replit.app.

## Why a pure function instead of a server tick

Before writing code I looked at the two systems everyone points to for "living NPC" worlds, and both stop when you look away. Stanford's Generative Agents only advances when an operator issues a step. a16z's AI Town runs a Convex server tick, and its own cron job halts a world after five minutes with no viewers. My notes in `RESEARCH.md` reached a blunt conclusion: if the world needs a process to stay alive, someone pays for it forever, and every returning visitor triggers catch-up logic.

The obvious approach was a server that ticks the village and persists state. The cheaper option was a client-side tick with a localStorage save, but then every visitor gets a diverging village that freezes when the tab sleeps. I chose to make the world a pure function `F(WORLD_SEED, now)`. A visitor returning after three weeks does not trigger catch-up; re-evaluating `F(now)` is the catch-up. Every viewer at the same instant sees the same village, and nothing can pause because there is nothing to pause.

The constraint was cost: a world I could leave alone for a year, on a static host, at zero dollars. The trade is that the shared world cannot react to anyone, so anything interactive lives in a strictly local layer on top.

## What Anirudh's World does, from the visitor's side

You open the page and the village is already mid-day, or mid-night, depending on when you arrive. A HUD shows the village clock (a fixed PST offset, so every viewer sees the same hour), the weekday, and a ticker of events. Twenty villagers go about their day: a chief who is a mini version of me with a golden crown, a woodcutter, a herbalist, a scout, a night watch, and fifteen townsfolk with professions like blacksmith and bard who arrive over the first weeks.

Some nights wolves come and the defenders line up at a gate. Some days the hunters go out. After day 18, some evenings are festivals. Houses go up on twelve lots over multi-day builds, and the label over the chief's head reads something like "Building Bramble Barn, 83%" while he works. Add `#t=2026-07-01T09:00:00Z` to the URL and you see the world at that instant, past or future; add `#speed=600` and a day plays in minutes. Both are the same `evaluate()` call with a different timestamp.

Sign in and you can forge a hero, fight monster camps, mine, fish and take guild quests. Seven of those camps are the Builder's Trials, each guarding a portal to one of my real projects.

## Architecture

Anirudh's World is split into a deterministic spine that must never change by accident, a simulation core that consumes it, a renderer that only draws, and a local play layer on top. The only outside runtime dependencies are three.js and the drand beacon.

![Anirudh's World architecture: the deterministic spine feeds a pure evaluate call that the renderer draws every frame, with drand as the only external input](/blog/diagrams/anirudhs-world-deterministic-village-architecture.svg)

Reading left to right: `js/config.js` holds the frozen constants, `js/prng.js` turns names into random streams, `js/clock.js` turns a timestamp into a logical day and time-of-day, and `js/fate.js` fetches beacon values. `js/sim.js` combines them in `evaluate(nowMs)`, which returns every villager's position, pose, label and needs plus every lot, garden plot and animal. `js/main.js` calls that once per frame and hands the result to the renderer modules, which only draw. The play layer reads the same state but writes only to localStorage. The multiplayer server in `server/server.mjs` also serves the static files on Replit and is a no-op unless keys are configured.

These are the choices that define the system.

| Layer | Choice | Why |
| --- | --- | --- |
| World time | Epoch-ms integer math, fixed PST offset, day rolls at 04:00 | No local Date methods, no DST, same for every viewer |
| Randomness | Vendored splitmix32, sfc32, xmur3, cyrb128, squirrel3 with golden vectors | Named streams per decision; drift fails `selfTest()` at boot |
| Unpredictability | drand beacon value at each day's 04:00 boundary, from day 18 on | Future rounds do not exist yet; past rounds last forever |
| Movement | Hand-authored road graph, Dijkstra, arc-length paths | Position at any instant is a binary search |
| Verification | `scripts/snapshot.mjs` FNV-1a digest, must equal `8dfc5c74` | One number says whether the live world changed |
| Collisions | `core/solids.js` imported by player movement and the audit | Game and audit cannot disagree |
| Rendering | three.js r184 via jsDelivr import map, no bundler, no service worker | Plain files deploy anywhere |

## How it works

### Named random streams instead of one RNG

The first rule in `js/sim.js` is that day N never depends on day N-1's random outcome. If it did, evaluating day 400 would mean replaying 399 days of draws. So there is no single RNG that advances. Every decision draws from its own stream, named by what it is for.

```js
// js/prng.js
export function seed32(day, id, purpose) {
  return xmur3(`${WORLD_SEED}|${day}|${id}|${purpose}`)();
}

// One draw in [0,1) for a named decision.
export function roll(day, id, purpose) {
  return splitmix32(seed32(day, id, purpose))();
}
```

A wolf night is `roll(day, 'world', 'wolves') < 0.26`. The purpose strings are a frozen API, because changing one silently retcons the past for every viewer. The same goes for villager ids: the chief's id is still `bram` from the first prototype even though his display name is now Anirudh, because renaming it would reseed every stream he has ever drawn from. `main.js` enforces the rule at boot by fetching the source text of the four spine modules and logging a console error if any contains `Math.random`.

### The fate layer: borrowing entropy from drand

A world that is a pure function of a seed has a problem: the author can read the future. I could evaluate day 1000 and know which nights the wolves come. The fix in `js/fate.js` is to salt each day's streams with a value that does not exist until that day arrives.

drand is a public randomness beacon run by the League of Entropy that has produced a new signed value every 30 seconds since July 2020. Each village day's fate is the beacon round at that day's 04:00 boundary. `roundForDay(day)` computes the round from the chain's genesis timestamp and period, `fetchRound()` asks `api.drand.sh` (with a Cloudflare mirror as fallback) for `/public/<round>`, and the sim looks it up synchronously.

```js
// js/fate.js
export function fateOf(day) {
  if (day < FATE_START_DAY) return { hex: 'era1', real: true };
  if (testProvider) return { hex: testProvider(day), real: true };
  const hex = mem.get(day);
  if (hex) return { hex, real: true };
  return { hex: pseudoHex(day), real: false };
}
```

Inside `sim.js`, `fRoll()` wraps `roll()` and, when a real fate exists, prefixes the stream name with `fate:${hex}`. Days 0 through 17 predate the layer and stay seed-only as frozen history. For a day whose round is not yet published, `pseudoHex()` returns a deterministic stand-in flagged `real: false`, so every viewer previews the same possible future and the HUD says so. When the clock crosses 04:00, `refreshFates()` in `main.js` fetches the real round and the preview is replaced. The world is reproducible forever backward and genuinely unknown forward, with no mutable server state.

### One frame, start to finish

![One frame of Anirudh's World: main.js asks sim.js to evaluate the current wall-clock time, sim.js resolves the day's fate, compiles each villager's plan and returns positions for the renderer](/blog/diagrams/anirudhs-world-deterministic-village-flow.svg)

`main.js` calls `simNow()` from `clock.js`, which is `Date.now()` unless a debug hash is set. `evaluate(nowMs)` calls `worldClock(nowMs)`, which subtracts `WORLD_EPOCH` and the 04:00 rollover to get a logical `day` and a `tod` in milliseconds. `dayKind(day)` rolls the fated streams for wolves, hunts, festivals, pack size and gate.

For each villager, `buildPlan(day, npcId)` runs an archetype script (or a generic script parameterised by one of 15 professions) that pushes walk and at segments from time 0 to `DAY_MS`. Plans are cached with the day's fate hex in the key, so a newly arrived real fate invalidates the preview. `findSegment()` binary-searches the plan for the segment covering `tod`. If it is a walk, `positionAt(path, WALK_SPEED, tod - seg.t0)` binary-searches the path's cumulative arc lengths and interpolates, so position is a closed-form lookup with no per-frame integration. If it is a long work segment, `beatState()` picks a micro-spot every 50 seconds using squirrel3 noise, so builders shuffle around a site.

`needsAt()` then sums hunger, energy, fun and social decay across the segments lived so far, scaled by per-villager trait multipliers from `data/cast.js`, with yesterday's day kind shifting the morning baseline. Those needs feed a Sims-style argmax that picks where to eat, and the winning reason ends up in the villager's label.

### The verification scripts that make refactors safe

Since every viewer sees `F(now)`, a stray refactor that changes one draw changes the live world for everyone, past and present. So before every commit I run three scripts in `scripts/`.

`snapshot.mjs` is the golden-master test. It evaluates the world on 23 chosen days, sampled every 17 minutes, and streams every villager's position, pose, label, level and needs, plus every animal, lot and garden plot, into one FNV-1a hash.

```js
// scripts/snapshot.mjs
let h = 0x811c9dc5 >>> 0;
function feed(str) {
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
}
const q = (n, p = 100) => Math.round(n * p) / p;   // quantize floats (sub-pixel noise is harmless)
```

The digest must equal `8dfc5c74`. If it drifts, the world changed, and I either revert or day-gate the change so it only applies from a future day forward.

`check-collisions.mjs` sweeps 15 days at one to 30 second resolution and asserts no villager ever intersects a solid: 12,906,000 positions on the current cast. The geometry comes from `core/solids.js`, the same module the player's movement imports, so the game and the audit cannot drift apart. The QA log in `docs/qa/evidence.md` records that the first run found 54 violation classes totalling 43,239 hits, from a porch bench inside a cottage wall to lanterns on paths. `check-activities.mjs` reads clip names out of each vendored GLB and proves every authored pose is reachable by every villager.

### Camps that guard portals to real projects

The Builder's Trials are why this is my portfolio's Explore page rather than a toy. `data/projects.js` defines seven camps, each with a monster type, stats and a `project` block holding a title, a tag, a URL and a screenshot. They join the same `CAMPS` list as every other camp, so spawning, loot and respawns need no extra code. `js/projectcamps.js` builds a billboard south of each camp showing the screenshot, plus a portal that stays invisible until the camp is cleared:

```js
// js/projectcamps.js
          if (total > 0 && alive === 0) {
            s.unlocked = true;
            save[s.camp.id] = true;
            persist();
            s.portal.visible = true;
            floatText(s.px, s.pz + 1, 'Portal revealed!', '#7dffc0');
            floatText(s.px, s.pz - 0.4, s.camp.project.title, '#b9ffdd');
          }
```

Unlocks persist in localStorage. Stepping within 2.2 units of an open portal calls `window.open` on the project URL, and walking 4.5 units away re-arms it. The camps guard LARK, Apartment 4B, Living Photos, FaceTime from Mars, ScreenSense, TalkativePDF and CIVS.

## The hard parts

The frozen-identifier rule bit me most often. Once the world is live, `WORLD_SEED`, `WORLD_EPOCH`, the PRNG source text, every purpose string and every villager id are append-only. I could not fix an awkward early schedule for day 5 without changing day 5 for everyone who might time-travel there. So every behaviour change is gated on a day index, and the golden digest is the only reason I trust that discipline.

The 04:00 boundary has a small race. `refreshFates()` runs every 120 seconds, so for up to two minutes after a new round lands a viewer may still see the pseudo-fate preview, and a villager could visibly change plans at the swap.

Some things are plainly hacky. The `Math.random` guard is a regex over fetched source text, not a linter. The Dijkstra in `roadPath()` is a linear scan per step, fine only because the graph has 12 nodes and a cache. The geography still lives inside `sim.js` rather than a data file because it is tangled with the road graph. `js/player.js` is a 1,750-line file that should be five modules. And the shared world does not know you exist: killing every monster in the valley changes nothing for the villagers.

## Results

Anirudh's World is live at av-world.replit.app as a single Node process on a Replit Reserved VM that serves the game files and hosts the dormant multiplayer server on the same origin, with a static mirror on Vercel. There is no award; this was not a hackathon project. The repo has 20 villagers, 15 professions, seven project camps, and roughly 10,000 lines of hand-written ES modules. All three verification scripts pass on the current build: the digest equals `8dfc5c74`, the collision sweep finds no penetrations, and the activity audit reports full cast coverage.

## What I would do differently, and what is next

I would move the geography into `data/geography.js` on day one, before the road graph got entangled with it, and split `player.js` behind an interactables registry earlier. I would also verify the drand signature client-side rather than trusting the JSON, so the fate is provably unpredictable. Next is letting fate do more: weather, visiting traders and villager arrivals could all hang off the same beacon.

## Key takeaways

- If state is a pure function of time, catch-up logic disappears. Re-evaluating at the new time is the catch-up.
- Give every random decision its own named, seeded stream. A single advancing RNG turns every refactor into a retcon.
- A public randomness beacon like drand gives a deterministic system an unwritten future while keeping history reproducible, with no server.
- Hash the whole world across a grid of timestamps into one digest and gate every commit on it.
- Import collision geometry from one module in both the game and the offline audit, so they cannot disagree.
- Store walks as arc-length parameterised paths so position at any instant is a binary search. Integration drifts; lookup does not.

## FAQ

### How does Anirudh's World keep running with no server?

Anirudh's World never runs in the usual sense. The whole village is a pure function of a fixed seed string and the wall-clock time, implemented as `evaluate(nowMs)` in `js/sim.js`. The browser calls it every frame with `Date.now()` and draws the result. Nothing is stored and nothing ticks, so there is no process to keep alive.

### How does Anirudh's World make the future unpredictable if it is deterministic?

From day 18 onward, `js/fate.js` salts each day's random streams with the drand beacon value at that day's 04:00 boundary. Future rounds do not exist until their time arrives, so nobody, including the author, can evaluate tomorrow's real wolves. For unpublished days, Anirudh's World shows a deterministic preview flagged as not real.

### How does Anirudh's World test that a code change did not alter the world?

`scripts/snapshot.mjs` evaluates the village on 23 days at 17-minute intervals and hashes every villager, animal, lot and garden plot into one FNV-1a digest that must stay `8dfc5c74`. A second script sweeps 12.9 million villager positions against `core/solids.js` to prove nobody walks through a wall, and a third proves every animation clip is reachable.

## Links

- Live world: [av-world.replit.app](https://av-world.replit.app)
- Source: private repository
