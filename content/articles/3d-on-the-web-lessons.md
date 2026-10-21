---
title: "What Six 3D Web Builds Taught Me About Three.js and R3F"
description: "Lessons from Apartment 4B, Living Photos, Horror POV, Jellyverse, Anirudh's World and FaceTime from Mars on React Three Fiber, Three.js and performance."
date: 2026-10-21
slug: 3d-on-the-web-lessons
project: "3D web lessons"
kind: guide
tags: [Three.js, React Three Fiber, Gaussian Splats, GLSL, Game Dev, Web Audio]
accent: "#e0a458"
summary: "I shipped six 3D web projects in 2026, several in a few days each. This guide covers what they taught me: when to use React Three Fiber or plain Three.js, how to ship with no art assets, why gameplay belongs in data tables, and the budgets that keep a scene alive on a phone."
---

## Six 3D builds, most of them in days

Every 3D project I start has the same risk: a scene that looks great on my laptop can be a black canvas on someone's phone. The builds that shipped were the ones where I made a few boring decisions early.

This guide collects what Anirudh Vasudevan learned shipping 3D on the web across six projects built with Three.js and React Three Fiber in 2026. Each lesson links to the write-up with the code:

- [Apartment 4B](/blog/apartment-4b-horror-game/): a first-person horror puzzle game in React Three Fiber, a 36-hour build per its README. 3rd Place at ElevenHacks (ElevenLabs x Zed).
- [Living Photos](/blog/living-photos-gaussian-splats/): one photo becomes a walkable Gaussian-splat room. Winner of ElevenHacks (Stripe x ElevenLabs).
- [Horror POV](/blog/horror-pov-director-ai/): a five-floor haunted house in plain Three.js, built in one day.
- [Jellyverse](/blog/jellyverse-jelly-dice-physics/): jelly dice on a hand-written physics solver and a GLSL deformer.
- [Anirudh's World](/blog/anirudhs-world-deterministic-village/): a low-poly village that is a pure function of the clock.
- [FaceTime from Mars](/blog/facetime-from-mars/): a voice call to Mars with a 3D camera that follows the conversation. 2nd Place at the ElevenLabs x Replit Hackathon.

## Lesson 1: pick React Three Fiber or plain Three.js by who owns the lifecycle

React Three Fiber is great when the 3D is one part of a React app. Apartment 4B swaps scenes with a conditional render, keeps state in Zustand stores and draws eighteen HTML overlay components on top of the canvas. FaceTime from Mars lifts a focus value into the page and lets the 3D scene follow it. In both, the UI and the scene share one state, and R3F makes that free.

It stops helping when a library manages its own async lifecycle. In Living Photos, the declarative way of adding Spark.js created the splat mesh but never started its WASM decode: a black canvas and no request for the file. The vendor's plain Three.js example worked, so I run it inside a useEffect, add the renderer and the mesh as siblings, and wait for the mesh to finish initializing before disposing it, because React Strict Mode mounts twice and the first cleanup crashed the worker.

For a game loop, plain Three.js was simpler. Horror POV registers seventeen ordered systems on one loop that clamps delta time to 50 milliseconds. Jellyverse and Anirudh's World use plain Three.js too, and Anirudh's World has no bundler at all, just an import map. When I built Horror POV, I ported Apartment 4B's lighter and canvas textures from R3F to plain Three.js.

## Lesson 2: you do not need art assets

None of the games here waited on an artist. Apartment 4B has no glTF files. Every room is R3F primitives, and every texture except two sponsor logos is drawn on a canvas at runtime. One of those canvas textures is a 1957 calendar, and it is a puzzle clue, because the tape never says the year.

FaceTime from Mars draws Mars on a 1024 by 512 canvas: a rust gradient, 8,000 translucent circles for craters, polar bands and dark patches. It is crude up close and fine at the camera's distance, and there is nothing to ship or license. Jellyverse's only image file is the favicon, and all of its sound is synthesized with Web Audio. Horror POV uses box furniture and canvas textures, with one honest exception: the ghost is a downloaded third-party model with no license file in the repo.

Living Photos is the opposite approach. The art is generated: World Labs Marble turns one photo into a Gaussian-splat file, and Spark.js renders it.

## Lesson 3: keep gameplay in data, not in the scene graph

Apartment 4B keeps its world in one table. SCENE_CONFIG holds each room's bounds, obstacle boxes, spawn point and triggers, and each trigger can be gated on a tape you must already have. Every frame the player loop resolves collision against that table, then picks the nearest trigger whose gate passes. Progression became a filter over data.

![One frame of the Apartment 4B player loop: movement from camera yaw, collision against the data table, then the nearest open trigger](/blog/diagrams/3d-on-the-web-lessons-flow.svg)

Horror POV pushed the same idea across five floors. Every wall, prop and railing is an axis-aligned box in one flat array, with an optional height band:

```ts
// src/world/collision.ts
// Skip colliders on other floors (when the box is restricted to a y-band).
if (y !== undefined) {
  if (b.yMax !== undefined && y >= b.yMax) continue;
  if (b.yMin !== undefined && y < b.yMin) continue;
}
```

The ghost's line-of-sight test walks the same array. A door owns one box and adds or removes it when it closes or opens, so closing a door blocks the ghost's sight with no separate occlusion system.

Anirudh's World made the same point about tools. Its collision geometry lives in one module that both the player's movement and an offline audit import, so the game and the audit cannot disagree. The audit sweeps 12,906,000 villager positions, and its first run found 43,239 hits.

## Lesson 4: keep the brain out of the renderer

Horror POV's ghost has two parts. A Director state machine decides when the ghost lurks, shows itself or hunts, and it does not import Three.js. The Ghost decides where and how, reading the Director's state each frame. I could tune pacing in one 137-line file. Its sanity meter does not know what a room is either: it reads the summed light level at the player's position, so flickering bulbs and hunt darkness change gameplay for free.

Anirudh's World takes this furthest. The whole village is a pure function of a seed and Date.now(), and the renderer only draws what that function returns. A villager's position is a binary search over a path's arc lengths, not an integration, so any instant is a lookup. A golden test hashes the world across 23 days into one digest that must stay 8dfc5c74.

Pure logic is testable without a GPU. Jellyverse's engine knows nothing about scores or the DOM, and its 80 tests run with node --test and no WebGL. The irony is Horror POV: its Director is pure and takes a context object, the easiest thing in that repo to test, and I never wrote the tests.

## Lesson 5: patch stock materials instead of writing shaders from scratch

Jellyverse's dice are rigid boxes in the solver. The jelly is a vertex shader patched into Three.js's own materials:

```js
// src/engine/jelly-shader.js
export function applyJelly(material, uniforms) {
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\n' + jellyGLSL)
      // ... (normal chunk replaced the same way)
      .replace('#include <begin_vertex>', 'vec3 transformed = jelly(position);');
  };
```

The key line is not in that excerpt: the same function is applied to the mesh's custom depth material, so the shadow squashes when the die does. A soft body with a rigid shadow looks fake at once. The catch is that this patch replaces named shader chunks, and those names move between versions, so Three.js is pinned to 0.160.1.

Post-processing can stay cheap. Apartment 4B's look is a noise overlay at 0.06 plus a vignette.

## Lesson 6: budget for the phone from the start

Shadows are the first cost. In Apartment 4B the lighter is the only light that casts shadows, so there is one shadow map per frame. On a touch device, Jellyverse caps the device pixel ratio at 1.5, uses a 1024 shadow map instead of 2048, and picks the cheaper shadow filter. A frame-time governor keeps a moving average and steps the pixel ratio down by 0.25 when frames stay slow for 90 frames in a row.

Assets are the second cost. Living Photos picks a 100k or 50k splat variant for phones, because heavy worlds crash Safari's WebGL.

Time steps are the third. Jellyverse's fixed 240 Hz solver stops at 24 steps per frame and drops the backlog, because a tab hidden for a minute would otherwise run thousands of steps on return and freeze the page. Horror POV clamps delta time to 50 milliseconds. Jellyverse also caps the tray at 36 bodies, because its pair test grows with the square of the body count.

Some limits you cannot budget around. Pointer lock silently fails on iOS Safari, so Apartment 4B is a desktop game. Spark.js needs SharedArrayBuffer, which requires cross-origin isolation headers, and Living Photos sets them only on the scene route, because site-wide they would break Stripe Checkout.

## Lesson 7: move the camera with intent

FaceTime from Mars's camera follows the conversation. The panel reports a focus of Earth, idle or Mars, and a controller eases toward it every frame:

```ts
// frontend/src/components/MarsScene.tsx
    camera.position.lerp(targetPos.current, delta * 1.5);
    currentLookAt.current.lerp(lookAtPos.current, delta * 1.5);
    camera.lookAt(currentLookAt.current);
```

Because the look-at point moves separately from the position, the camera turns and travels at once, and a focus change mid-flight just redirects it. Living Photos taught me the opposite trap: drei's CameraControls overwrites the camera position every frame, so WASD has to call its forward and truck methods instead of writing to the camera.

## Lesson 8: sound carries more than polygons

Apartment 4B's best moment has no new geometry. When you pick up the front-door key, a heartbeat starts and speeds up over 45 seconds while you walk to the door. That ramp proved to me that escalating audio alone carries tension. FaceTime from Mars builds its Mars ambience from oscillators with no audio files. Horror POV gives every sound a synthesized fallback and lets eight ElevenLabs MP3s override it, so the game was playable before any sample existed.

## Shipping 3D in a weekend

Cut scope on the first day, not the last. Apartment 4B's roadmap described a week-long build with five rooms and a hunting AI. The hunt AI's state machine type is still in the repo, and nothing drives it. Horror POV repeats one floor plan five times. Both shipped.

Deploy static. Apartment 4B is on Netlify, Horror POV on Vercel, Jellyverse on GitHub Pages, and Anirudh's World has a static mirror on Vercel. A judge opens a URL, and there is no server to fall over.

![How these six builds split a 3D web project: pure logic and data, a render layer, browser budgets, and a static host](/blog/diagrams/3d-on-the-web-lessons-architecture.svg)

| Layer | Choice | Why |
|---|---|---|
| Scene layer | R3F inside a React app, plain Three.js for game loops | Match whoever owns the lifecycle |
| Imperative libraries | Vendor example inside a useEffect | Spark.js never decoded through JSX |
| Assets | Primitives and canvas textures | No artist, nothing to license |
| World data | One table of boxes and gated triggers | Collision, prompts and progression in one place |
| Logic | Pure modules that never import Three.js | Tunable and testable without WebGL |
| Materials | onBeforeCompile on stock materials, depth included | Shadows deform with the mesh |
| Mobile | Pixel ratio cap, smaller shadows, lighter assets | Phones and Safari survive |
| Time step | Capped accumulator or clamped delta | A hidden tab cannot freeze the page |
| Hosting | Static deploy | Nothing to keep alive |

## Key takeaways

- Use React Three Fiber when 3D is part of a React UI. Drop to the vendor's plain example when a library drives its own async setup.
- Primitives plus canvas textures are enough to ship a game, and a canvas texture can carry a puzzle clue.
- Put collision boxes and triggers in one data table, and let movement and AI perception share the same list.
- Keep pacing and simulation logic free of Three.js so you can tune and test it headless.
- Patch the depth material along with the visible one, or the shadow gives the trick away.
- Budget for phones on day one: one shadow-casting light, a pixel ratio cap, lighter assets and a capped time step.

## FAQ

### Should I use React Three Fiber or plain Three.js?

In my six builds, React Three Fiber worked best when the 3D scene was part of a React app with shared state, as in Apartment 4B and FaceTime from Mars. Plain Three.js was simpler for a single game loop, as in Horror POV and Jellyverse, and for libraries with their own async lifecycle: Living Photos runs Spark.js imperatively inside a useEffect because the declarative version never started decoding.

### How do you make a 3D web game without 3D models?

Build rooms from primitives and paint textures on an HTML canvas at runtime. Apartment 4B has no glTF files and draws every texture except two logos on a canvas, and FaceTime from Mars draws Mars with a gradient and thousands of translucent circles. It looks fine at play distance and leaves nothing to license.

### How do you handle collision across multiple floors in Three.js?

Horror POV keeps every wall and prop as an axis-aligned box in one flat array, with optional yMin and yMax bands. The resolver skips any box outside the player's floor band, interior walls are banded to their floor, and perimeter walls are unbanded. Doors add or remove their box, so the same list also blocks the ghost's line of sight.

### How do you keep a Three.js scene fast on phones?

Jellyverse caps the pixel ratio at 1.5 on touch devices, halves the shadow map, uses a cheaper shadow filter, and lowers the pixel ratio further when frame times stay slow. Apartment 4B lets only one light cast shadows, and Living Photos loads a smaller splat file on phones because large ones crash Safari's WebGL.

### How do you render Gaussian splats in React Three Fiber?

Living Photos uses Spark.js inside a React Three Fiber canvas. It creates the SparkRenderer and the SplatMesh imperatively in a useEffect, adds them to the scene as siblings, rotates the mesh 180 degrees on X to convert Marble's Y-down output to Three.js's Y-up, and sets cross-origin isolation headers on the scene route so Spark's worker can use SharedArrayBuffer.
