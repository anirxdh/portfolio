---
title: "How Jellyverse Makes Dice Wobble Without a Physics Library"
description: "Jellyverse is a four-page browser toy suite built on a from-scratch Three.js rigid-body solver and a GLSL jelly deformer that also drives the shadow pass."
date: 2026-10-03
slug: jellyverse-jelly-dice-physics
project: "Jellyverse"
tags: [Three.js, GLSL, Physics Simulation, WebAudio, Vite, Game Dev]
live: https://anirxdh.github.io/jellyverse-site/
accent: "#b388ff"
summary: "Jellyverse is four browser toys (jelly dice, a Pig duel against an AI, a jelly stress toy and a shrunk-you tabletop) on one hand-rolled 240 Hz physics solver and a vertex-shader deformer. No physics library, no audio files, and 80 headless tests."
---

## A die that would not stop buzzing

Three dice land in the tray. Two settle flat. The third comes down on top of the other two, held off the floor by their bounding spheres, and it never stops moving. Every frame the settle code pulls it down toward a flat die's height, and the neighbours push it back up. It sits there vibrating like a phone on a table. The fix is a short branch in `settleStep`, below.

Jellyverse is a four-page browser toy suite that runs jelly dice, a press-your-luck duel against an AI, a jelly stress toy and a shrunk-you tabletop game on one hand-rolled Three.js physics solver and GLSL jelly deformer, built by Anirudh Vasudevan as a personal project in September 2026. The starting point was Ann Nguyen's Virtual Jelly Dice at bubbbly.com; I liked how alive her dice felt and wanted to know why. So I studied how her page does it, directed a design spec dated 2026-09-07, and built a new engine from scratch to that spec.

To be upfront: the spec records that the build ran autonomously on my instruction to proceed without questions. I set the direction, the architecture and the constraints, and an AI coding agent did most of the typing. The decisions below are mine, and the code I quote is real.

## Why I wrote the solver instead of installing one

The obvious approach was to install cannon-es or Rapier and put a wobble shader on top. I decided against it for three reasons.

First, the feel lives in the coupling between contacts and the shader. When a corner hits the floor, the solver knows the contact normal, the slide direction and the impulse per unit mass, and those three numbers become the squash direction, the sway direction and the wobble amplitude. With a library I would be reconstructing that from a contact event after the fact.

Second, the engine had to grow. Squish slices a block into chunks with different half extents, so mass and inertia come from volume. Lilliput stacks sugar cubes at a density of 0.05 and needs them to topple as a stack, so body-to-body contacts had to switch from bounding spheres to corner-sphere-versus-oriented-box.

Third, I wanted it small and playable on a phone with no art assets. The only runtime dependency is three.js, pinned to 0.160.1 because the shader patch replaces named chunks whose names move between versions. The solver is 426 lines. All sound is synthesized with WebAudio, so the only image in the repo is the favicon.

## What the four pages do

Jellyverse opens on Jelly Dice. Roll one to five dice, pick a flavour, and the tally shows the faces and total once everything settles. Poke a die and it jumps. Drag it and it stretches toward your finger; pull too far and the grab tears and the die flicks away.

Jelly Duel is two-dice Pig against an opponent named Wobble, first to 50 or 100. Any 1 ends your turn with nothing and double 1 wipes your banked score. Wobble has three personalities: Cautious banks at 15, Greedy at 30, and Sharp works out a hold from both scores.

Jelly Squish is a tray of jelly blocks with no goal. Hold still on a block for 260 ms and it squashes flatter the longer you press, then boings back. Swipe from empty tray across a block and a knife line slices it into two mass-correct chunks; a piece whose half extent along the cut would drop under 0.15 pops into droplets instead.

Jelly Lilliput shrinks you to die size on a dining table or a computer desk. Orbit the camera, flick jellies, land them in a hollow mug for 10 points, knock down a 4-3-2-1 tower of sugar cubes, or lose a point when one falls off the edge.

## Architecture

Every page in Jellyverse follows the same shape: `createStage` builds the renderer, camera and lights, a `World` holds the bodies and runs the solver, a `Grabber` turns Pointer Events into grabs, and a frame function runs physics, settling, stretch and the jelly clocks, then renders. The engine in `src/engine/` knows nothing about scores or the DOM.

![Jellyverse architecture: four Vite pages over one shared engine, with the deformer running on the GPU](/blog/diagrams/jellyverse-jelly-dice-physics-architecture.svg)

In the diagram, pointer events enter the Grabber, the World steps bodies at 240 Hz against floor, wall, colliders and each other, and each hard contact writes jelly uniforms shared by the lit and depth materials.

The main choices, and why:

| Layer | Choice | Why |
| --- | --- | --- |
| Rendering | three.js 0.160.1, `MeshPhysicalMaterial` with transmission | Refraction for jelly; the pin keeps chunk names stable |
| Deformation | GLSL patched in via `onBeforeCompile`, depth material included | One shader for mesh and shadow; no CPU vertex updates |
| Physics | Custom impulse solver, 240 Hz sub-steps, 3 iterations | Contacts feed the wobble; chunks need volume-based mass |
| Body contacts | Bounding spheres by default, corner-sphere vs OBB with `boxContacts` | Cheap in the tray; stackable in Lilliput |
| Static world | `BoxCollider` and `CylinderCollider` with a hollow cavity | Tables, ramps and a mug behind one `contact()` interface |
| Input | Pointer Events, one grab per `pointerId` | Multi-touch for free |
| Hosting | Vite with four HTML inputs, static push to a public build repo | Source stays private; GitHub Pages serves the output |

## How it works

### The shader patch that makes shadows wobble too

The deformer in `src/engine/jelly-shader.js` is a GLSL function `jelly(vec3 p)` that returns a displaced position. `applyJelly` injects it into any material by replacing three chunks in the vertex shader.

```js
// src/engine/jelly-shader.js
export function applyJelly(material, uniforms) {
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\n' + jellyGLSL)
      .replace('#include <beginnormal_vertex>',
        'vec3 objectNormal = jellyNormal(position, normal);\n#ifdef USE_TANGENT\nvec3 objectTangent = vec3(tangent.xyz);\n#endif')
      .replace('#include <begin_vertex>', 'vec3 transformed = jelly(position);');
  };
  material.customProgramCacheKey = () => 'jelly';
  return material;
}
```

`flavors.js` calls `applyJelly` on every die material, including a `MeshDepthMaterial` set as the mesh's `customDepthMaterial`. The shadow pass runs the same deformer with the same uniforms, so the shadow squashes when the die does. `jellyNormal` samples `jelly()` at four nearby points and crosses the differences, so lighting slides across a squashed face. Positions are divided by `uHalf` first, so one function serves a unit die and a thin chunk.

### Contacts, the restitution threshold, and two wobble slots

`World.physicsStep` in `src/engine/physics.js` integrates velocity and position, then runs three iterations of contact resolution. Each body collides with the world through eight corner spheres, tested against the floor, the tray wall and every static collider; any penetration goes to `surfaceContact`.

```js
// src/engine/physics.js
    if (pen > 0) d.pos.addScaledVector(n, pen * 0.6);
    _v.crossVectors(d.ang, rw).add(d.vel);           // point velocity
    const vn = _v.dot(n);
    if (vn >= 0) return 0;
    _rn.crossVectors(rw, n);
    const k = d.invM + d.invI * _rn.lengthSq();
    const e = vn < -1.2 ? rest : 0;
    const j = -(1 + e) * vn / k;
    d.vel.addScaledVector(n, j * d.invM);
    d.ang.addScaledVector(_rn, j * d.invI);
```

The line that matters most is `const e = vn < -1.2 ? rest : 0`. Restitution only applies when the contact closes faster than 1.2 units per second. Slower contacts are fully inelastic, which is why dice stop bouncing quickly and do not jitter on their corners. Coulomb friction follows, clamped to `mu * j`, then rolling resistance damps anything touching a surface.

If the impulse per unit mass is above 0.35, the same function calls `body.wobble(n, tan, amp)` and reports a strength to `onImpact`, which the Dice page wires to a synthesized clack. `Body.wobble` keeps two impact slots, each with an amplitude, a clock and an envelope of `amp * exp(-t * 4.2)`. A new wobble replaces the weaker slot unless it is under 75 percent of that slot's envelope.

### Settling, and the die that buzzed

Once the dice are slow, Jellyverse does not wait for friction to lay them flat. A body counts as low energy when it is under 0.45 units per second, under 1.0 radians per second, and no higher than its largest half extent plus 0.45 above its `supportY` (so a die still in the air does not qualify). After 0.22 seconds of that, or once the roll clock passes 9 seconds, `settleStep` finds the most upward face, builds a target quaternion that lays it flat while keeping the yaw, and slerps toward it.

![One tap on a die in Jelly Dice, from pointer event to tally](/blog/diagrams/jellyverse-jelly-dice-physics-flow.svg)

```js
// src/engine/physics.js
        const targetY = d.supportY + d.restY;                  // flat on whatever holds it up
        d.quat.slerp(d.targetQuat, Math.min(1, 10 * dt));
        d.pos.y += (targetY - d.pos.y) * Math.min(1, 10 * dt);
        d.vel.multiplyScalar(1 - 8 * dt); d.ang.multiplyScalar(1 - 12 * dt);
        if (d.quat.angleTo(d.targetQuat) < 0.01 && Math.abs(d.pos.y - targetY) < 0.005) {
          d.quat.copy(d.targetQuat); d.pos.y = targetY; d.vel.set(0, 0, 0); d.ang.set(0, 0, 0);
          d.resting = true; d.settling = false;
        }
```

`supportY` makes this work beyond the tray: every contact with an upward normal records the height of the surface under it, 0 on the tray, the saucer top on a saucer, the cavity floor inside the mug.

The buzzing die was the case where `floorContacts` is zero: nothing underneath, only neighbours. Pulling it toward `targetY` shoved it into them and they bounced it back. The fix: with no floor contact, the body only damps its velocity and, after 0.15 seconds of being slow, rests where it lies. A resting body then becomes a static obstacle with zero inverse mass. The Dice tray's sphere contacts (`bodyContact`) wake it only when something penetrates it by more than 0.02; Lilliput's box contacts (`boxPairContact`) also wake it when hit faster than 0.8 units per second or touched by a moving neighbour.

### A mug is a hollow cylinder with no lid

Lilliput needed tables, ramps and a mug. `src/engine/colliders.js` defines one interface, `contact(center, r, out)`, which returns a sphere's penetration into the solid and writes a push-out normal and a support height. `BoxCollider` wraps `sphereVsObb`. `CylinderCollider` is the interesting one.

```js
// src/engine/colliders.js
    if (Ri > 0 && rad < Ri && py > this.cavityBottom - r) {
      // inside the cavity: the wall pushes toward the axis, the bottom pushes up; no lid
      let best = 0;
      const wall = r - (Ri - rad);
      if (wall > 0 && py <= H + r) { out.n.set(-ux, 0, -uz); best = wall; }
      const floor = r - (py - this.cavityBottom);
      if (floor > 0 && py >= this.cavityBottom - 1e-6 && floor > best) { out.n.set(0, 1, 0); best = floor; }
      if (best <= 0) return 0;
      if (out.n.y > 0.5) out.surfaceY = this.position.y + this.cavityBottom;
      return best;
```

An `innerRadius` opens a cavity from `cavityBottom` to the top. Inside it the wall pushes toward the axis and the floor pushes up, with no lid, so a jelly lobbed over the rim drops in. A test in `tests/world.test.js` checks that a die dropped into a mug lands on the cavity bottom, "not on an invisible lid". Getting over the rim was its own problem: an earlier flat fling rule, `min(24, 8 + 10v)` as the code comments record it, could never clear a mug nine units tall, so `flingArc` in `src/lilliput/targets.js` maps release speed to a launch speed (10 to 32 units per second) and an angle (20 to 60 degrees). A gentle push skids, a hard flick lobs.

Squish's slicer uses the same engine pieces. `planCut` in `src/squish/slicer.js` rotates the knife stroke into the body's frame, halves the best-aligned half extent (or pops the block if that would drop under `MIN_HALF`), and `splitBody` spawns two chunks that inherit orientation and velocity. I capped `MAX_BODIES` at 36. The comment in the code only calls it a hard cap on bodies in the tray, but the reason I chose a cap at all is that `physicsStep` tests every pair of bodies in a nested loop, so the cost grows with the square of the body count.

## The hard parts

The frame accumulator in Jellyverse needed a cap. `World.update` runs as many 240 Hz steps as the elapsed time requires, stops at 24 and drops the backlog. Without that, a tab hidden for a minute would run thousands of steps on return and freeze the page.

Sleeping bodies as static obstacles work until a stack needs to move together. In `boxPairContact`, a cube shoved at the base of a stack slid out from under the resting cubes above it, which a code comment calls an immovable ceiling. The moving-neighbour wake rule fixed that, so a shove at the base of the sugar tower moves the whole tower.

Performance on phones was a budget. On a coarse pointer, `createStage` caps device pixel ratio at 1.5, uses a 1024 shadow map instead of 2048, and picks `PCFShadowMap` over `PCFSoftShadowMap`. A frame-time governor in `stage.render` keeps an exponential moving average of frame time and, after that average stays above 1/40 second for 90 frames in a row, steps the pixel ratio down by 0.25.

Some of it is hacky. The inertia tensor is isotropic, the cube formula `I = m s^2 / 6`, even for a thin chunk. Lilliput runs `boxPairContact` twice per pair, once each way. And every jelly material shares one `customProgramCacheKey`, correct only because they all use the same GLSL.

## Results

Jellyverse shipped as a static site at https://anirxdh.github.io/jellyverse-site/ with all four pages. The source repo stays private by design; `scripts/deploy-pages.sh` builds `dist/`, adds `.nojekyll` and force-pushes a throwaway git repo to the public build repo that GitHub Pages serves.

The test suite runs with `node --test` and no WebGL. When I ran it for this write-up, 80 tests passed across six files, covering settling, tunnelling, chunk mass, the propped die, the sugar tower, the mug, the Pig rules and the AI policy.

There is no award and no user count. It is a personal toy.

## What I would do differently

If I rebuilt Jellyverse I would compute the real box inertia tensor from the half extents. I would put a uniform grid in front of the O(n squared) pair loop before raising `MAX_BODIES`. I would fold the settle logic into the solver's contact phase instead of a second per-frame pass with its own thresholds. And I would try a cheap mass-spring lattice as a real soft-body option for Squish, because the shader wobble cannot do a block folding over an edge.

## Key takeaways

- Put the deformer in the depth material too. A soft body with a rigid shadow reads as fake instantly, and `customDepthMaterial` makes it a one-line fix.
- A restitution threshold does more for stability than extra solver iterations. Below a small closing speed, make contacts inelastic.
- Give every body a `supportY`. If each upward contact records the height underneath, one settle routine works on floors, ramps, pads and the inside of a mug.
- Treat sleeping bodies as static with zero inverse mass. Penetration depth is the minimum wake trigger; for stacks, the box-contact path also needs closing speed and a moving neighbour.
- Cap the fixed-step accumulator and drop the backlog, or a hidden tab becomes a frozen page.

## FAQ

### How does Jellyverse make the dice look like jelly?

Jellyverse does not simulate a soft body. Each die is a rigid box in the solver, and a vertex shader patched into its three.js materials displaces vertices at draw time: two impact slots hold damped oscillations and a pull term follows the finger. The same shader runs in the depth material, so the shadow wobbles too.

### Does Jellyverse use a physics engine like cannon-es or Rapier?

No. Jellyverse has its own 426-line rigid-body solver in `src/engine/physics.js`: fixed 240 Hz sub-steps, eight corner spheres per body, impulse contacts with restitution only above 1.2 units per second, friction, and a settle phase that slerps the nearest face flat.

### Is the Jellyverse source code public?

The Jellyverse source repo is private by design. A deploy script builds the Vite site and force-pushes only the compiled `dist/` output, with a fresh git history, to a public build repo served by GitHub Pages.

### Is Jellyverse a copy of Virtual Jelly Dice?

Jellyverse's first page recreates the feel of Ann Nguyen's Virtual Jelly Dice at bubbbly.com, credited in the README, which records the engine as written from scratch after studying how her page achieves its feel. Duel, Squish and Lilliput are original.

## Links

- Live site: https://anirxdh.github.io/jellyverse-site/ (`index.html`, `duel.html`, `squish.html`, `lilliput.html`)
- Source: private. The public repo `anirxdh/jellyverse-site` holds only the compiled output.
