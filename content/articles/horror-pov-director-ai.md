---
draft: true
title: "How Horror POV Paces Its Ghost With a Director State Machine"
description: "Horror POV is a browser horror game where a Director state machine paces the ghost, sanity is read from the light field, and five floors share a collider list."
date: 2026-09-30
slug: horror-pov-director-ai
project: "Horror POV"
tags: [Three.js, TypeScript, Game AI, Web Audio, Vite, Game Dev]
live: https://horror-pov.vercel.app
accent: "#d64545"
summary: "Horror POV is a first-person browser horror game built in three.js and TypeScript over one weekend. A small Director state machine decides when the ghost lurks, shows itself, or hunts, sanity is computed from the actual room lights, and five stacked floors share one flat collider list."
---

## The ghost was never scary when it was scripted

The first ghost in this project walked toward you the moment the page loaded. Dark shape, two glowing eyes, never stopped. After ten seconds it was not scary, because you knew exactly what it would do. A browser game can still be tense, but only if the threat has rhythm. It has to build, hit, and back off.

Horror POV is a single-player, first-person horror game that runs entirely in the browser, built by Anirudh Vasudevan as a personal weekend project in June 2026 to test whether an Alien: Isolation style pacing AI could ship as a static web page. You spawn in a haunted five-storey house, explore in the dark with a flashlight and a lighter, collect three hidden items, manage a sanity meter, and photograph a hooded presence. Then you open the front door and run for the graveyard gate while it hunts you.

The repo is private, so I will describe it rather than link it. It is three.js, TypeScript and Vite, roughly 4,600 lines across 30 source files, hosted on Vercel. I built it with Claude Code doing most of the typing, and the README says so. Three things made the ghost work: a tiny Director state machine, a sanity meter that reads the light field, and a collision trick that let five floors share one list.

## Why a two-tier Director instead of a monster that chases

Before writing code I had a 275-line research document in the repo (docs/horror-games-research.md) that surveyed around forty horror games and pulled out two models. Alien: Isolation's Director tracks a "menace" gauge and forces the alien backstage on a cooldown once it peaks. Phasmophobia gates hunts behind a sanity meter that only darkness drains. The document is AI-generated and I treated it as a reading list, but those two ideas became the spine.

The obvious approach was one Ghost class with a chase routine and random timers. I had that in the first hour and it was flat. The alternative was to split the problem. A Director decides WHEN: it owns state and gauges and never touches a mesh. A Ghost decides WHERE and HOW: it reads the Director's state each frame and teleports, phases, fades, or freezes. That let me tune pacing in one 137-line file and swap the ghost body for a downloaded GLB without touching the brain.

The engine choice came from the same document: three.js over Unity or Unreal because a coding agent can write, run, screenshot and deploy it alone, and friends play by clicking a link. Horror hides most of its geometry in darkness, so web fidelity was enough. The constraint was one weekend, so there are no tests, the house is one 18 by 14 metre footprint repeated across floors, and the furniture is box primitives.

## What you do in the house

Horror POV starts with a click-to-play overlay that grabs pointer lock and starts the AudioContext. You are in the entrance hall with a flashlight (F toggles it) and a Zippo lighter in your hand, and the hall bulb flickers. WASD walks, Shift runs (which drains stamina and makes noise), C crouches, and E interacts with whatever you are looking at: doors, wall switches, keys and items. The objective reads "Find a way out, items 0 / 3". Staircases in four corners connect two basements, the ground floor and two upper floors. Your sanity bar drains in darkness, and the flashlight does not count as light.

Right mouse raises the photo camera, left click fires the flash, and you have twelve shots. If the ghost is in frame, visible, within 20 metres and not behind a wall, the photo counts, and the ghost comes for you. When a hunt starts the lights collapse, a scream plays, the camera shakes and a red pulse fills the screen. The ghost phases straight at you. If it reaches you on the same floor, it lunges into your face and the end screen names the species that took you. Collect the three items, open the front door, and the final flee begins: the hunt never stops until you reach the gate.

## Architecture

Horror POV has no backend. Everything is a static Vite build with one entry point, src/main.ts, which constructs about twenty modules and registers them as ordered `(dt) => void` systems on a Game loop that clamps delta time to 50 milliseconds.

![Horror POV architecture: main.ts wires a Game loop, world builders, player, Director and Ghost, sanity, tools and audio, served as a static Vercel build](/blog/diagrams/horror-pov-director-ai-architecture.svg)

Left to right: src/world/levelData.ts holds the house as data. Level.ts and Floors.ts turn it into meshes and push bounding boxes into one shared `colliders` array. Player.ts resolves movement against that array, and Ghost.ts reads it for line of sight. The Director lives inside the Ghost and reads sanity, which Sanity.ts computes from Level.lightLevelAt. Audio.ts and Hud.ts hang off a tension signal derived from menace. The only external pieces are offline: eight ElevenLabs mp3s from a gitignored script, and a third-party ghost GLB with a procedural fallback.

The main choices, with the reasons behind them:

| Layer | Choice | Why |
| --- | --- | --- |
| Renderer | three.js 0.184, ACES tone mapping, PCF shadows | Runs from a link, flashlight shadows sell the darkness |
| Pacing AI | Director state machine with menace and noise gauges | Separates WHEN from WHERE, tunes in one file |
| Sanity | Summed point-light contributions at the player position | Lighting becomes a gameplay lever, not a flag per room |
| Collision | One flat AABB list with optional yMin and yMax bands | Five floors without a spatial structure or physics library |
| Perception | 2D slab-method segment vs AABB plus THREE.Frustum | Doors and walls block sight with no separate occlusion system |
| Audio | Web Audio synth layer with ElevenLabs mp3 overrides | Playable with zero samples, samples upgrade it when present |

## How it works

### The Director only ever sets state

src/ai/Director.ts has four states: retreat, lurking, manifest and hunting. In lurking, a timer calls `rollEvent(sanity)` every 3.5 seconds, which checks noise first, then sanity, then falls through to a manifestation or an ambient whisper or bang. During a hunt, menace rises with time, proximity and line of sight, and the hunt ends when the 11 second timer expires or menace hits 1.

```ts
// src/ai/Director.ts
case "hunting": {
  const prox = ctx.distToPlayer < 6 ? (6 - ctx.distToPlayer) / 6 : 0;
  this.menace = Math.min(
    1,
    this.menace + ctx.dt * (0.04 + prox * 0.05 + (ctx.hasLoS ? 0.04 : 0)),
  );
  if (this.stateTimer <= 0 || this.menace >= 1) this.startRetreat();
  break;
}
```

`startRetreat` sets a 14 second cooldown and zeroes menace. That is the whole tension-and-release mechanism. The Director exposes one-frame flags, `justEnteredHunt` and `justEnteredManifest`, and the Ghost and main.ts read those and do the physical work. Nothing in Director.ts imports three.js.

Noise is the second pressure axis. Running above 3.4 m/s adds `dt * 0.5` per frame, closing a door adds 0.5, and the gauge decays at 0.2 per second. It multiplies the roll rate by `(1 + noise)`, and above 0.45 it gives a `noise * 0.45` chance of a hunt regardless of sanity. That is the Granny "it hears you" rule on top of the Phasmophobia gate.

### Sanity is a function of the light field

src/sanity/Sanity.ts is 27 lines and does not know what a room is. It takes a function `lightLevelAt(pos)` and compares the result to a threshold of 0.45.

```ts
// src/sanity/Sanity.ts
update(dt: number, playerPos: THREE.Vector3): void {
  const lit = this.lightLevelAt(playerPos);
  if (lit >= LIT_THRESHOLD) {
    this.value = Math.min(1, this.value + dt * REGEN_PER_SEC);
  } else {
    const darkness = 1 - lit / LIT_THRESHOLD; // 0 at threshold → 1 in pitch black
    this.value = Math.max(0, this.value - dt * DRAIN_PER_SEC * darkness);
  }
}
```

The drain rate is 0.013 per second, about 75 seconds from full to empty in total darkness. Level.lightLevelAt sums `(intensity / 5) * (1 - dist / range)` over every point light in the house. The flashlight is a SpotLight that is never added to that list, on purpose: hunting the ghost in the dark should cost you.

Lit rooms are not safe either. Three of the four ground floor bulbs are flagged `flicker` in levelData and dip at random, and Level.setHuntMode multiplies every house light toward 0.06 during a hunt. Lower sanity means more hunts, hunts mean darker rooms, darker rooms mean lower sanity. That feedback loop is the whole escalation curve.

### Five floors on one flat collider list

The house has floors at y = -6, -3, 0, 3 and 6. I did not want a spatial structure or a physics library, so every wall, prop and railing is an AABB in one array. The trick is in src/world/collision.ts: makeAABB takes optional yMin and yMax, and resolveCircle skips boxes outside the player's current floor band.

```ts
// src/world/collision.ts
// Skip colliders on other floors (when the box is restricted to a y-band).
if (y !== undefined) {
  if (b.yMax !== undefined && y >= b.yMax) continue;
  if (b.yMin !== undefined && y < b.yMin) continue;
}
```

Level.buildWall decides the band. Interior walls are banded to 0..3, so they exist only on the ground floor; perimeter walls are left unbanded so they contain the player on every storey. Player height comes from Floors.floorHeightAt, which is "sticky": it computes a ramp height inside each stair rectangle but only returns it if the player's current Y is within 1.4 metres of the ramp, so walking past the foot of an up-staircase does not yank you upward. Off all stairs it snaps to the nearest of five levels. The staircases sit in four different corners so their footprints never stack. During a hunt, main.ts lerps the ghost's Y toward `player.floorLevel` so it can follow you upstairs.

### Doors are colliders, so closing one blinds the ghost

src/world/Door.ts is a hinge-pivot group with a slab, two panels and a brass handle. The door owns one AABB and pushes it into, or splices it out of, the same array the player slides against.

```ts
// src/world/Door.ts
private toggle(): void {
  this.open = !this.open;
  this.targetAngle = this.open ? this.openAngle : 0;
  if (this.open) {
    const k = this.colliders.indexOf(this.collider);
    if (k >= 0) this.colliders.splice(k, 1);
  } else if (!this.colliders.includes(this.collider)) {
    this.colliders.push(this.collider);
  }
```

The ghost's line-of-sight test, `segmentBlocked` in collision.ts, is a 2D slab-method segment-vs-AABB walk over that same array, so a closed door literally breaks the ghost's sight. Two of the six species (Stalker and Mannequin) have `freezeWhenObserved: true` in config.ts and stop moving while in frustum and unblocked, and the "distant" manifest flavor fades out the instant you look at it.

### What happens when you photograph the ghost

Here is the chain for the game's signature verb, from a right-click to the forced cooldown.

![One photo of the ghost flowing through PhotoCamera, Ghost, Director, Level and Audio in Horror POV](/blog/diagrams/horror-pov-director-ai-flow.svg)

Right mouse calls PhotoCamera.raise, and update lerps the FOV from 72 toward 46. Left click calls shoot, which decrements film, sets a 0.8 second cooldown, and fires a 0.13 second flash on a 1500-intensity PointLight. It then asks `ghostInFrame`, wired to `ghost.isPhotographable`. If true, onShoot plays the shutter, triggers the GLB's hit clip, and calls `director.provoke()`, which calls startHunt.

Next frame, Ghost.update sees `justEnteredHunt`, teleports to the nearest room center if it is more than 11 metres away, and phases toward the player at its species hunt speed (2.75 to 3.9 m/s against a walk of 2.6 and a run of 4.6). main.ts notices the state change, calls level.setHuntMode(true), shakes the camera and plays the scream, and Audio.update raises the heartbeat rate from `ghost.tension`. Eleven seconds later, or sooner if menace caps, startRetreat fires and the lights return.

## The hard parts

The y-banded colliders were learned the hard way. The first railing collider ran the full height of the climb, which put an invisible wall on the floor below. The comment in Floors.buildStair still records the fix: only block at this railing's own floor level. Every bug like that was found with a backtick-toggled debug overlay printing x, z, floor Y and ghost state.

The hunt latch in main.ts is hacky. During the final flee the hunt is re-provoked every frame, so the "hunt started" side effects are gated on `!escape.fleeing` and a `prevGhostState` variable.

There is dead configuration. config.ts still exports `PHOTO_GOAL = 3` from a version where three photos won the game, and the `ROOMS` list the ghost teleports between is four quadrant centers from an older four-room plan, not the hall, living room, kitchen and dining layout levelData grew into. They mostly land somewhere sensible, but not because anyone checked.

package.json describes 3 to 4 player co-op with proximity voice. None of that exists. The ghost model is a downloaded third-party GLB with no license file in the repo; the procedural walker is mine, the model is not. And perception is 2D: line of sight ignores Y, so a ghost one floor down can in principle "see" you.

## Results

Horror POV is playable at horror-pov.vercel.app. It is a personal weekend build, not a hackathon entry, and there is no award to report. What shipped: five floors, six randomized ghost species, a Director with menace and noise gauges, a light-driven sanity meter, working doors and switches, a key inventory, a photo camera and EMF reader, a graveyard exterior, eight ElevenLabs sound effects over a synth fallback, and canvas-drawn textures. The source is private.

The Zippo lighter in src/tools/lighter.ts and the texture generators in src/world/textures.ts were ported from Apartment 4B, my ElevenHacks hackathon game, from React Three Fiber to vanilla three.js. I wrote about that build in [How Apartment 4B Bakes an Entire Horror Game Into Static Files](/blog/apartment-4b-horror-game/), and the audio pipeline is the same idea: generate once with ElevenLabs, commit the mp3s.

## What I would do differently

Give the Director a proper relentless state for the flee sequence. Add Y to perception; a floor band check next to the XZ slab test would remove the only real cheat in the sight model. Make the ghost path instead of phase, because walking through walls is scary the first time and unfair the fifth, and a nav grid would make closing doors matter during a hunt. And write tests. The Director is pure and takes a context object, which makes it the easiest thing in the repo to test, and I never did.

## Key takeaways

- Split pacing from presentation. A state machine that owns only timers and gauges, and exposes one-frame flags, is easy to tune and never breaks rendering.
- Derive gameplay meters from world state. Summing light at the player position made lighting a real lever and gave flicker and hunt darkness for free.
- One flat collider list with optional y-bands handles multiple floors without a spatial structure, as long as each object is assigned a floor.
- If movement collision and AI perception walk the same array, dynamic occluders like doors come for free.
- Give every sound a synthesized fallback and let samples override it. The game was playable before a single mp3 existed.

## FAQ

### How does Horror POV decide when the ghost hunts?

Horror POV uses a Director state machine in src/ai/Director.ts with four states: retreat, lurking, manifest and hunting. While lurking it rolls every 3.5 seconds. A loud player can trigger a hunt regardless of sanity; otherwise, once sanity is at or below the species threshold, the hunt chance is 0.1 plus up to 0.28 scaled by how far sanity has fallen, plus 0.3 times noise. A hunt lasts at most 11 seconds and is always followed by a 14 second retreat.

### What makes sanity drop in Horror POV?

Sanity in Horror POV drains whenever the summed point-light level at the player's position is below 0.45, at 0.013 per second scaled by darkness. A lit room regenerates at 0.02 per second. The flashlight is not counted as light, flickering bulbs dip randomly, and every house light drops to 6 percent during a hunt.

### How does Horror POV handle multiple floors in three.js?

Horror POV keeps every wall, prop and railing as an axis-aligned bounding box in one array, with optional yMin and yMax bands, and the collision resolver skips any box outside the player's current floor band. Interior walls are banded to the ground floor, perimeter walls are unbanded so they contain every storey, and each staircase lives in a different corner.

## Links

- Live demo: [horror-pov.vercel.app](https://horror-pov.vercel.app)
- Source: private repository
- Related: [How Apartment 4B Bakes an Entire Horror Game Into Static Files](/blog/apartment-4b-horror-game/)
