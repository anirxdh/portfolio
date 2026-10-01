---
draft: true
title: "Walking Into a Photograph with Gaussian Splats and a Cloned Voice"
description: "How I built Living Photos, a Next.js app that turns one photo into a walkable 3D splat scene with a consent-gated ElevenLabs voice inside it."
date: 2026-09-30
slug: living-photos-gaussian-splats
project: "Living Photos"
tags: [Gaussian Splats, React Three Fiber, ElevenLabs, Stripe, Inngest, Next.js]
award: "Winner, ElevenHacks (Stripe x ElevenLabs)"
repo: https://github.com/anirxdh/Living-Photos
live: https://living-photos-rust.vercel.app/
accent: "#2f6db5"
summary: "Living Photos turns a single old photo into a walkable Gaussian-splat room with a consent-cloned voice playing inside it. This is the story of the mock-first adapter layer, the Inngest pipeline, the Stripe webhook floor, and the Spark.js viewer behind it."
---

## The photo of a kitchen nobody can visit anymore

Most of us have one photo like this. A kitchen, a bedroom, a workshop. The place exists in the picture and nowhere else, and the voice that filled it is gone too. What if you could step into that photo and hear them again, from inside the room?

Living Photos is a web app that turns one interior photograph into a walkable 3D Gaussian-splat scene with a consent-cloned voice speaking inside it, built by Anirudh Vasudevan for ElevenHacks 2026, the Stripe and ElevenLabs hackathon, in May 2026. You upload a photo. A few minutes later you get a URL that opens on any phone, where you walk the room with WASD, look by dragging, and hear a voice you chose speak from within the scene.

The hard part was chaining four paid services (World Labs Marble, FAL Hunyuan3D, ElevenLabs, Stripe) into one pipeline that still ran end to end on my laptop with zero keys. That decision shaped everything else.

## Why I went mock-first instead of wiring the real APIs on day one

The obvious hackathon approach is to grab every API key, call each service from a route handler, and hope the demo holds. But a real Marble world takes four to five minutes to generate, and Hunyuan3D meshes take up to a minute each. Every failed run costs money and minutes I could not get back on a three-day build window.

So the first thing I built in Living Photos was `lib/ai/types.ts`: TypeScript interfaces for every paid upstream, `MarbleAdapter`, `MeshAdapter`, `SfxAdapter`, `VoiceAdapter`, `StripeAdapter`, and `BlobAdapter`. Each has a `Mock*` and a `Real*` class in `lib/ai/`, and `lib/ai/factory.ts` picks the set from `env.MOCK_MODE`. Mocks return fixture URLs deterministically, resolve in about 20 milliseconds, and never touch the network.

The other ways I could have done it were a feature flag per call site, which spreads `if (mock)` across every route, or recorded HTTP responses, which still need a real run per code path. Interfaces plus a factory gave me one swap point and contract tests that loop over both implementations with identical assertions. The constraint was one person, a demo deadline, and a small API budget, and mock mode let me build the whole loop, upload to paywall to viewer, before spending a dollar on generation.

## What Living Photos does, step by step

From the user's side, Living Photos is four screens after the landing page.

On `/create`, you drop a photo into a react-dropzone area. The client gets a signed URL, PUTs the file straight to storage, then POSTs the public URL to `/api/scenes`, which creates a scene row with a 12-character slug and emits a `scene/uploaded` event.

On `/voice`, optionally, you name the person whose voice you are cloning and read a server-issued consent phrase aloud; the server clones the voice with ElevenLabs only after its checks pass. A quick-start dropdown offers pre-consented ElevenLabs library voices instead.

On `/scene/<slug>`, the page polls status while the pipeline runs. When the scene is ready you see a $15 unlock button (`DEFAULT_CENTS = 1500` in `lib/pricing.ts`) that opens Stripe Checkout. After payment, the viewer loads the splat, ambient audio, and narration.

## Architecture

Living Photos is a Next.js 15 App Router app on Vercel. Route handlers under `app/api/` call small service modules (`lib/scenes.ts`, `lib/payments.ts`, `lib/voice/consent.ts`), which call the adapter bag from `lib/ai/factory.ts`. Generation runs in an Inngest step function, or, without an Inngest key, in an inline local pipeline using the same adapters. State lives in a `globalThis`-pinned in-memory store.

![Living Photos architecture: browser, Next.js route handlers, adapter layer, and external APIs](/blog/diagrams/living-photos-gaussian-splats-architecture.svg)

Left to right: the browser uploads to blob storage, then `/api/scenes` emits `scene/uploaded` into Inngest Cloud or the local runner. The pipeline walks Marble, Hunyuan3D, and ElevenLabs, then publishes the scene as ready. Payment is a separate path through `/api/stripe/checkout` and the Stripe webhook, and the viewer only receives asset URLs once `paid` is true.

These are the main choices in the code and why I made them.

| Layer | Choice | Why |
|---|---|---|
| Framework | Next.js 15 App Router, React 19, strict TypeScript | Route handlers, RSC, and Vercel deploy in one repo |
| Paid upstreams | Interface plus Mock/Real adapters in `lib/ai/` | Full loop runs with zero keys; contract tests cover both |
| Background jobs | Inngest 3 step function with `retries: 3` | A real run takes 4 to 5 minutes; a plain serverless function would time out |
| Local fallback | Patched `Inngest.prototype.send` in `lib/inngest/client.ts` | Same event, same adapters, no cloud account for dev or demo |
| Splat rendering | Spark.js v2 inside React Three Fiber 9 | Spark decodes `.spz` in a WASM worker and sorts splats per frame |
| Movement | Drei `CameraControls` driven by `forward()` and `truck()` | Mutating `camera.position` is overwritten by CameraControls each frame |
| Payments | Stripe Checkout plus raw-body webhook verification | One-time $15 unlock; no card data touches my server |
| Idempotency | `(provider, event_id)` key checked before any mutation | Stripe retries webhooks; fulfillment must happen once |
| Persistence | `globalThis.__livingPhotosStore` in-memory maps | RSC and route handlers compile into separate module graphs and need one instance |

## How it works

### The adapter factory refuses to run mocks in production

The factory carries one safety rule. The mock Stripe adapter verifies webhooks with an HMAC secret that is a committed constant. In production that would turn the paywall into a door anyone could open by signing their own event, so `build()` throws if `MOCK_MODE` is true under `NODE_ENV=production`.

```ts
// lib/ai/factory.ts
function build(): Adapters {
  if (env.MOCK_MODE) {
    if (env.NODE_ENV === "production") {
      throw new Error(
        "MOCK_MODE=true is not permitted when NODE_ENV=production. " +
          "Set MOCK_MODE=false and provide real API keys before deploying.",
      );
    }
    const stripeAdapter = env.STRIPE_FORCE_REAL
```

The contract tests in `tests/contract/` make the swap trustworthy. Each file builds `{ name, build }` pairs; the mock always builds, the real one returns `null` unless its key (say `WORLD_LABS_API_KEY`) is set, and the suite calls `it.skip` naming the variable. Same assertions, both implementations.

### One event, two runtimes

`lib/inngest/functions/scene-generate.ts` is the heart of Living Photos: an Inngest function with seven `step.run` calls, `submit-marble`, `wait-marble`, `detect-objects`, one `mesh-<objectId>` per object fanned out with `Promise.all`, `generate-sfx`, an optional `generate-narration`, and `publish`. Each step is memoized, so a crash after Marble finishes does not resubmit it.

![One upload flowing through Living Photos from signed URL to ready scene to paid viewer](/blog/diagrams/living-photos-gaussian-splats-flow.svg)

The trick that kept me productive is in `lib/inngest/client.ts`. When `MOCK_MODE` is on, or there is no `INNGEST_EVENT_KEY`, I replace `send` on the Inngest prototype. The override records the event for tests and fires the local pipeline without awaiting it, so `POST /api/scenes` returns in milliseconds.

```ts
// lib/inngest/client.ts
  const proto = Object.getPrototypeOf(inngest) as { send?: unknown };
  proto.send = async (args) => {
    const list = Array.isArray(args) ? args : [args];
    for (const e of list) {
      sentEvents.push({ name: e.name, data: e.data });
      if (e.name === "scene/uploaded") {
        const data = e.data as { sceneId: string; photoUrl: string };
        import("./mock-pipeline")
          .then((m) => m.runMockScenePipeline(data.sceneId, data.photoUrl))
```

`lib/inngest/mock-pipeline.ts` runs the same sequence with a `pollUntilDone` helper on fixed intervals with a cap. It also does something ugly that saved real money: after submitting to Marble it writes `marble:job:<id>` into the scene's `error` column, so a dev-server restart resumes polling instead of paying for a second world.

### Rendering a Gaussian splat inside React Three Fiber

Marble returns a `.spz` file, a compressed Gaussian splat. `lib/image-blaster/marble.ts` POSTs to `worlds:generate`, polls `operations/{id}`, and `pickSpzUrls` picks a full-res URL for desktop and a `100k` or `50k` variant for phones, because heavy worlds crash Safari's WebGL.

Getting Spark.js to render inside R3F took a while. The R3F way, `extend()` plus a JSX element, created the `SplatMesh` but never fired its async WASM decode: black canvas, no `.spz` request. The vanilla Three pattern from Spark's README worked, so I replicated it inside a `useEffect`.

```tsx
// components/viewer/splat-renderer.tsx
sparkRenderer = new SparkRenderer({ renderer: gl });
scene.add(sparkRenderer);

mesh = new SplatMesh({ url });
mesh.raycast = () => {};
if (flipY) {
  mesh.rotation.x = Math.PI;
}
scene.add(mesh);
```

`SparkRenderer` and `SplatMesh` are siblings, not parent and child, because the renderer drives sorting and decode for every splat. `rotation.x = Math.PI` flips Marble's Y-down convention to Three's Y-up. And React 19 Strict Mode mounts, unmounts, and mounts again; the first cleanup disposed a half-decoded mesh and crashed the worker, so disposal now waits on `mesh.initialized`.

Spark's worker also needs `SharedArrayBuffer`, which browsers expose only on cross-origin isolated pages, so `next.config.ts` sets `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: credentialless` on `/scene/*` only. Applied site-wide, they would break Stripe Checkout's cross-origin scripts, which do not set CORP headers. The camera spawns at the origin looking down negative Z, which is where Marble puts the photographer.

WASD lives in `components/viewer/wasd-controls.tsx`, a `requestAnimationFrame` loop calling `controls.forward()` and `controls.truck()` on the Drei `CameraControls` ref, because mutating `camera.position` did nothing; CameraControls lerps the camera back to its own target every frame.

### Stripe fulfillment with an idempotency floor

`app/api/webhooks/stripe/route.ts` runs on the Node runtime, reads `req.text()` for the raw body, and hands it with the `stripe-signature` header to `adapters().stripe.verifyAndParseWebhook`. The real adapter calls `stripe.webhooks.constructEvent`. The mock reimplements Stripe's `t=...,v1=...` scheme with `crypto.createHmac` and `crypto.timingSafeEqual`, so tests exercise the verify path offline. After verification, `lib/payments.ts` marks the event processed before touching anything else.

```ts
// lib/payments.ts
const first = memProcessed.markProcessed({
  id: newId("proc"),
  provider: "stripe",
  eventId: evt.id,
  eventType: evt.type,
  payload: evt,
  processedAt: new Date(),
});
if (!first) return { mutated: false, reason: "duplicate" };
```

Duplicates return `{ mutated: false }` with a 200 so Stripe stops retrying. Only the first sighting calls `markScenePaid` and sends a best-effort Resend email. `lib/db/schema.ts` mirrors this with `UNIQUE(provider, event_id)` on `processed_webhook_events`.

### The voice consent gate

`lib/voice/consent.ts` is the part I am most careful about. `buildConsentDraft(name)` generates a six-character nonce from a confusable-free alphabet and embeds it in a phrase the user reads aloud. `createConsentedVoiceClone` runs three checks before any ElevenLabs call: the name is not on a public-figure denylist (NFKD-normalized, diacritics stripped, matched as a token subsequence), and both the nonce and the name appear in the transcript. Only then does it call `adapters().voice.cloneVoice` and write a `voice_clones` row with `consent_verified_at`. `POST /api/scenes` closes the loop: a supplied `voiceCloneId` must map to a consented, non-revoked clone.

## The hard parts and the shortcuts

Hackathon code has seams.

The consent transcript is client-trusted in this build. The plan was to run the recording through ElevenLabs Scribe. I ran out of time, so `app/voice/voice-client.tsx` sends the draft phrase back as the transcript. The server-side checks are real; their input is not yet.

Postgres is provisioned but unused. `lib/db/schema.ts`, the migration in `drizzle/`, and a lazy Neon client all exist, but every service reads and writes `lib/db/memory.ts`, pinned to `globalThis` because Next.js compiles server components and route handlers into separate module graphs; without the pin, a POST to `/api/scenes` was invisible to the dashboard. A cold start wipes state.

`detect-objects` is a stub returning two fixture objects, a lamp and a chair, so every scene meshes the same two crops. The real SFX adapter returns the MP3 as a base64 data URL instead of piping it through the blob adapter. There is no auth, so anyone with a consented voice id could narrate their own scene in that voice (the code has a `TODO(auth)` for this). The README still claims GitHub Actions CI; I removed the workflow at some point and never updated the README; the remaining gate is a pre-push hook.

One more thing, said plainly. The Marble, FAL, and ElevenLabs HTTP clients in `lib/image-blaster/` started as a port of the MIT-licensed image-blaster project by neilsonnn, which `.planning/PROJECT.md` records as the foundation. The adapters, pipeline, consent gate, payments, and viewer are mine.

## What shipped

Living Photos won ElevenHacks 2026, the Stripe and ElevenLabs hackathon. The live site is at living-photos-rust.vercel.app. Generation there is currently gated behind a waitlist (`ALLOW_GENERATION = false` in `app/create/create-client.tsx`) so API credits are not consumed by drive-by uploads.

Per the README, the test suite is 122 passing and 5 skipped, the skipped slots being real-adapter contracts waiting on keys. The demo video's voices, music, and SFX came from ElevenLabs through scripts in the repo, mixed with ffmpeg in `scripts/mix-pages.ts`. The source is public under a source-available license for review, not open source.

## What I would do differently

Wire Scribe. The consent gate is only as strong as the transcript, and today the transcript is the phrase we asked for. A real speech-to-text pass turns the gate from a demo into a guarantee.

Swap the memory store for Drizzle behind the same service functions; they share one row shape on purpose. Add auth so voice clones are scoped to their owner. Use Marble's `collider_mesh_url`, already in the response, to stop the camera walking through walls. Move SFX bytes through the blob adapter. Replace the `error` column squat with a `marbleJobId` column and an Inngest `step.waitForEvent` on a Marble webhook instead of polling.

## Key takeaways

- Put every paid upstream behind an interface with a mock and a real implementation, then write one contract test that loops over both. The real suite can `it.skip` itself until the key exists.
- Refuse mock mode in production at the factory, not in documentation. A committed HMAC secret plus one missing env var is an open paywall.
- If a library's async initialization is driven by its own render loop, a declarative wrapper may construct the object and never start it. Use the vendor's imperative example inside a `useEffect`.
- Under React Strict Mode, defer disposal of anything that decodes asynchronously until its ready promise resolves.
- Scope COOP/COEP headers to the routes that need `SharedArrayBuffer`. Site-wide, they would break checkout scripts.
- Record a webhook event as processed before you mutate anything, keyed on `(provider, event_id)`, and return 200 for duplicates.

## FAQ

### How does Living Photos turn a photo into a 3D scene?

Living Photos sends the uploaded photo URL to World Labs Marble 1.1 through a raw `fetch` in `lib/image-blaster/marble.ts`, polls the operation until `done`, and pulls a `.spz` Gaussian-splat URL from the response. An Inngest step function then meshes objects with FAL Hunyuan3D, generates ambient sound with ElevenLabs, and publishes the scene. Real runs take four to five minutes.

### How does Living Photos render Gaussian splats in the browser?

Living Photos uses Spark.js v2 inside a React Three Fiber canvas. The `SplatRenderer` component creates a `SparkRenderer` and a `SplatMesh` imperatively in a `useEffect`, adds them as siblings, and rotates the mesh 180 degrees on X to convert Marble's Y-down output to Three's Y-up. The `/scene/*` routes send COOP and COEP headers so Spark's worker can use `SharedArrayBuffer`.

### How does Living Photos prevent voice cloning without consent?

Living Photos issues a six-character nonce inside a consent phrase, requires the user to read it aloud, and checks server-side that the nonce and the person's name appear in the transcript and that the name is not on a public-figure denylist. Only then does it call ElevenLabs Instant Voice Cloning. In the current build the transcript is supplied by the client; wiring speech-to-text is the planned fix.

### How does Living Photos handle Stripe webhook retries?

Living Photos verifies the raw webhook body against the `stripe-signature` header, then records the event under a `(provider, event_id)` key before any state change. If the key already exists, the handler returns 200 with `mutated: false` and does nothing. Only the first delivery of `checkout.session.completed` marks the scene paid.

### Can Living Photos run without any API keys?

Yes. With `MOCK_MODE=true`, every adapter in `lib/ai/` returns deterministic fixture data, the Inngest client runs the pipeline inline, blob storage is an in-memory map, and Stripe webhooks are signed with a mock HMAC scheme. The factory throws if mock mode is enabled with `NODE_ENV=production`.

## Links

- Live demo: [living-photos-rust.vercel.app](https://living-photos-rust.vercel.app/)
- Source (source-available, for review): [github.com/anirxdh/Living-Photos](https://github.com/anirxdh/Living-Photos)
