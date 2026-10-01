---
draft: true
title: "Building a 3D Village That Is a Pure Function of the Clock"
description: "How Anirudh's World keeps 20 villagers living on the real clock with no server, using seeded PRNG streams, the drand beacon and a golden-digest test."
date: 2026-09-30
slug: anirudhs-world-deterministic-village
project: "Anirudh's World (Vivarium)"
tags: [Three.js, Deterministic Simulation, drand, PRNG, Procedural Generation, Replit]
live: https://av-world.replit.app
accent: "#7c9cff"
summary: "Anirudh's World is a low-poly village where every villager's position, mood and job is recomputed each frame from a seed and Date.now(), so it needs no server to stay alive. Here is how the named-stream PRNGs, the drand fate layer, the verification scripts and the project-portal camps work."
---

## The village that kept going while I slept

The first build of this village went live on June 11, 2026. The next morning I opened the URL on my phone. The chief was already at the well, and the build percentage in the label over his head had crept up a few points from when I closed the tab. Nothing had run overnight to make that happen. No cron job, no database write, no server tick. The village had simply been evaluated at a new time.

Anirudh's World (the codebase is called Vivarium) is a browser-based 3D life simulation that keeps a low-poly village of 20 villagers living on the real-world clock with no backend, built by Anirudh Vasudevan as a personal project and as the playable "Explore" world linked from this portfolio. Every frame, the browser computes the entire shared world as a pure function of two inputs: a fixed seed string and `Date.now()`. There is no save file and no simulation loop. That one decision is the whole project.

It is plain ES-module JavaScript on three.js r184 with no bundler. The source is private; the world is live at av-world.replit.app.

## Why a pure function instead of a server tick

Before writing code I looked at the two systems everyone points to for "living NPC" worlds, and both stop when you look away. Stanford's Generative Agents advances only when an operator issues a step. a16z's AI Town runs a Convex server tick that its own cron job halts after five minutes with no viewers. My notes in `RESEARCH.md` put it bluntly: if the world needs a process to stay alive, someone pays for it forever, and every returning visitor triggers catch-up logic.

The obvious approach was a server that ticks the village and persists state. The cheaper option was a client-side tick with a localStorage save, but then every visitor gets a diverging village that freezes when the tab sleeps. I chose to make the world a pure function `F(WORLD_SEED, now)`. A visitor returning after three weeks needs no catch-up; re-evaluating `F(now)` is the catch-up. Every viewer at the same instant sees the same village, and nothing can pause because there is nothing to pause.

The constraint was cost: a shared world I could leave alone for a year on a free static host at zero dollars. The Vercel mirror is exactly that. The only paid piece, the Replit VM, exists for the optional multiplayer server, not for the village. The trade is that the shared world cannot react to anyone, so anything interactive lives in a strictly local layer on top.

## What Anirudh's World does, from the visitor's side

You open the page and the village is already mid-day, or mid-night, depending on when you arrive. A HUD shows the village clock (a fixed PST offset, so every viewer sees the same hour), the weekday, and a ticker of events. Twenty villagers go about their day: a chief with a golden crown who is a mini version of me, a woodcutter, a herbalist, a scout, a night watch, and fifteen townsfolk who arrive over the first weeks.

Some nights wolves come and the defenders line up at the gate. Some days the hunters go out. Houses go up on twelve lots over multi-day builds. Add `#t=2026-07-01T09:00:00Z` to the URL and you see the world at that instant, past or future. It is the same `evaluate()` call with a different timestamp.

Sign in and you can forge a hero, fight monster camps and take guild quests. Seven camps are the Builder's Trials, each guarding a portal to one of my real projects.

## Architecture

Anirudh's World is split into a deterministic spine that must never change by accident, a simulation core that consumes it, a renderer that only draws, and a local play layer on top. The only outside runtime dependencies are three.js and drand.

![Anirudh's World architecture: the deterministic spine feeds a pure evaluate call that the renderer draws every frame, with drand as the only external input](/blog/diagrams/anirudhs-world-deterministic-village-architecture.svg)

Reading left to right: `js/config.js` holds the frozen constants, `js/prng.js` turns names into random streams, `js/clock.js` turns a timestamp into a logical day and time-of-day, and `js/fate.js` fetches beacon values. `js/sim.js` combines them in `evaluate(nowMs)`, which returns every villager's position, pose, label and needs plus every lot, garden plot and animal. `js/main.js` calls that once per frame and hands the result to renderer modules that only draw. `server/server.mjs` serves the static files on Replit and is a no-op unless multiplayer keys are configured.

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

The first rule in `js/sim.js` is that day N never depends on day N-1's random outcome. If it did, evaluating day 400 would mean replaying 399 days of draws. So no single RNG advances. Every decision draws from its own stream, named by what it is for.

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

A wolf night is `fRoll(day, 'world', 'wolves') < 0.26` (with a `day >= 2` guard so the first two days are quiet). The purpose strings are a frozen API, because changing one silently retcons the past for every viewer. At boot, `main.js` fetches the source text of the four spine modules and logs a console error if any contains `Math.random`.

### The fate layer: borrowing entropy from drand

A world that is a pure function of a seed has a problem: the author can read the future. I could evaluate day 1000 and know which nights the wolves come. The fix in `js/fate.js` salts each day's streams with a value that does not exist until that day arrives.

drand is a public randomness beacon run by the League of Entropy that has produced a new signed value every 30 seconds since July 2020. Each village day's fate is the beacon round at that day's 04:00 boundary. `roundForDay(day)` computes the round from the chain's genesis timestamp and period, `fetchRound()` asks `api.drand.sh` (with a Cloudflare mirror as fallback) for `/public/<round>`, and the sim reads it synchronously.

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

Inside `sim.js`, `fRoll()` wraps the stream seeding: for days 0 through 17 it falls back to `roll()`, and from day 18 on it prefixes the stream name with `fate:${hex}`, real or pseudo. Days 0 through 17 predate the layer and stay seed-only as frozen history. For a day whose round is not yet published, `pseudoHex()` returns a deterministic stand-in flagged `real: false`, and the HUD says so. When the clock crosses 04:00, `refreshFates()` in `main.js` fetches the real round and the preview is replaced. The world is reproducible backward and unknown forward, with no mutable server state.

### One frame, start to finish

![One frame of Anirudh's World: main.js asks sim.js to evaluate the current wall-clock time, sim.js resolves the day's fate, compiles each villager's plan and returns positions for the renderer](/blog/diagrams/anirudhs-world-deterministic-village-flow.svg)

`main.js` calls `simNow()` from `clock.js`, which is `Date.now()` unless a debug hash is set. `evaluate(nowMs)` calls `worldClock(nowMs)`, which subtracts `WORLD_EPOCH` and the 04:00 rollover to get a logical `day` and a `tod` in milliseconds. `dayKind(day)` rolls the fated streams for wolves, hunts and festivals.

For each villager, `buildPlan(day, npcId)` runs an archetype script (or a generic script parameterised by one of 15 professions) that pushes walk and at segments from time 0 to `DAY_MS`. Plans are cached with the day's fate hex in the key, so a newly arrived real fate invalidates the preview. `findSegment()` binary-searches the plan for the segment covering `tod`. For a walk, `positionAt(path, WALK_SPEED, tod - seg.t0)` binary-searches the path's cumulative arc lengths and interpolates, so position is a lookup with no per-frame integration.

`needsAt()` then sums hunger, energy, fun and social decay across the segments lived so far, scaled by trait multipliers from `data/cast.js`. Those needs feed a Sims-style argmax that picks where to eat, and the winning reason ends up in the villager's label.

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

The digest must equal `8dfc5c74`. If it drifts, the world changed, and I either revert or day-gate the change so it applies only from a future day forward.

`check-collisions.mjs` sweeps 15 days at one to 30 second resolution and asserts no villager ever intersects a solid: 12,906,000 positions on the current cast. The geometry comes from `core/solids.js`, the same module the player's movement imports, so the game and the audit cannot drift apart. The first run, logged in `docs/qa/evidence.md`, found 43,239 hits. `check-activities.mjs` reads clip names out of each GLB and proves every authored pose is reachable by every villager.

### Camps that guard portals to real projects

The Builder's Trials are why this is my portfolio's Explore page rather than a toy. `data/projects.js` defines seven camps, each with a monster type, stats and a `project` block holding a title, a URL and a screenshot. They sit in the same `CAMPS` list as every other camp, so spawning and loot need no extra code. `js/projectcamps.js` adds a billboard with the screenshot and a portal that stays invisible until the camp is cleared:

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

Unlocks persist in localStorage. Stepping within 2.2 units of an open portal calls `window.open` on the project URL. The camps guard LARK, Apartment 4B, Living Photos, FaceTime from Mars, ScreenSense, TalkativePDF and CIVS.

## The hard parts

The frozen-identifier rule bit me most often. Once the world is live, `WORLD_SEED`, `WORLD_EPOCH`, the PRNG source text, every purpose string and every villager id are append-only. I could not fix an awkward early schedule for day 5 without changing day 5 for everyone who might time-travel there. So every behaviour change is gated on a day index, and the golden digest is why I trust that discipline.

The 04:00 boundary has a small race. `refreshFates()` runs every 120 seconds, so for up to two minutes after a new round lands a viewer may still see the pseudo-fate preview, and a villager can visibly change plans at the swap.

Some things are plainly hacky. The `Math.random` guard is a regex over fetched source text, not a linter. The geography still lives inside `sim.js` because it is tangled with the road graph. `js/player.js` is a 1,750-line file that should be six modules. And the shared world does not know you exist: clearing every camp changes nothing for the villagers.

## Results

Anirudh's World is live at av-world.replit.app as a single Node process on a Replit Reserved VM that serves the game files and hosts the dormant multiplayer server on the same origin. A static mirror on Vercel serves the same village with no server at all. There is no award; this was not a hackathon project. The repo has 20 villagers, 15 professions, seven project camps, and roughly 10,000 lines of hand-written ES modules. All three verification scripts pass on the current build: digest `8dfc5c74`, zero collision penetrations, full cast coverage in the activity audit.

## What I would do differently, and what is next

I would move the geography into `data/geography.js` on day one, before the road graph got entangled with it, and split `player.js` behind an interactables registry earlier. I would also verify the drand signature client-side rather than trusting the JSON. Next on the roadmap in `docs/HANDOFF.md` is weather, seeded by a hash of the week rather than the beacon. Letting fate decide more, say who shows up at the gate on a given day, is an idea, not a plan.

## Key takeaways

- If state is a pure function of time, catch-up logic disappears. Re-evaluating at the new time is the catch-up.
- Give every random decision its own named, seeded stream. A single advancing RNG turns every refactor into a retcon.
- A public randomness beacon like drand gives a deterministic system an unwritten future and a reproducible past, with no server.
- Hash the whole world across a grid of timestamps into one digest and gate every commit on it.
- Import collision geometry from one module in both the game and the offline audit, so they cannot disagree.
- Store walks as arc-length paths so position at any instant is a binary search. Integration drifts; lookup does not.

## FAQ

### How does Anirudh's World keep running with no server?

Anirudh's World never runs in the usual sense. The whole village is a pure function of a fixed seed string and the wall-clock time, implemented as `evaluate(nowMs)` in `js/sim.js`. The browser calls it every frame with `Date.now()` and draws the result. Nothing is stored and nothing ticks, so there is no process to keep alive.

### How does Anirudh's World make the future unpredictable if it is deterministic?

From day 18 onward, `js/fate.js` salts each day's random streams with the drand beacon value at that day's 04:00 boundary. Future rounds do not exist until their time arrives, so nobody, including the author, can evaluate tomorrow's real wolves. For unpublished days, Anirudh's World shows a deterministic preview flagged as not real.

### How does Anirudh's World test that a code change did not alter the world?

`scripts/snapshot.mjs` evaluates the village on 23 days at 17-minute intervals and hashes every villager, animal, lot and garden plot into one FNV-1a digest that must stay `8dfc5c74`. A second script sweeps 12.9 million villager positions against `core/solids.js`, and a third proves every animation clip is reachable.

## Links

- Live world: [av-world.replit.app](https://av-world.replit.app)
- Source: private repository
