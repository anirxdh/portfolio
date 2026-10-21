---
title: "How I Approach Hackathons, From the First Idea to the Demo"
description: "How I approach a hackathon after entering all 11 hacks of ElevenHacks Season 1: find the constraint, scope to the demo, and treat distribution as part of the hack."
date: 2026-10-21
slug: how-i-approach-hackathons
project: "Hackathon playbook"
kind: guide
draft: true
tags: [Hackathon, ElevenLabs, Voice AI, Product Design]
accent: "#f2c14e"
summary: "I submitted a project to all 11 hacks of ElevenHacks Season 1 and finished 4th overall on the season leaderboard. This is the approach behind those builds: find the constraint that becomes the product, scope to the demo, build so the demo cannot fail, and treat distribution as part of the hack."
---

## Eleven hacks in one season

ElevenHacks is a series of ElevenLabs hackathons. In Season 1 I submitted a project to every one of the 11 hacks and finished 4th overall on the season leaderboard. Across the season I took 3 popular votes and 2 wins.

This is how Anirudh Vasudevan approaches hackathons, written from that season and the other hackathon builds on this site. It is not a list of tips I read somewhere. Every step below points at a build where I did it, or where I learned it by getting it wrong.

These ElevenHacks entries have write-ups here: [Living Photos](/blog/living-photos-gaussian-splats/) (Winner, ElevenHacks, Stripe x ElevenLabs), [Apartment 4B](/blog/apartment-4b-horror-game/) (3rd Place, ElevenHacks, ElevenLabs x Zed), [FaceTime from Mars](/blog/facetime-from-mars/) (2nd Place, ElevenLabs x Replit), [VoiceCaptcha](/blog/voicecaptcha-voice-turing-test/), [Jungle Safari](/blog/jungle-safari-prewarmed-voice-quiz/), [Voices of the Last World](/blog/voices-of-the-last-world/), [Super Nova](/blog/super-nova-voice-companion/), [The Missing Angle](/blog/the-missing-angle-voice-mystery/) and [D-ID You](/blog/d-id-you-ai-presenter/). Two more results come from other write-ups: [LARK](/blog/lark-multi-agent-mcp/) placed Top 10 at the Y Combinator AI Hackathon, and [ScreenSense v3](/blog/screensense-voice-browser-agent/) won Best Voice Agent at the ElevenLabs x Firecrawl Hackathon.

I did not build all of this alone. Some of these builds were with my teammates Isha and Gokul. On LARK a teammate built the three backend servers my gateway talks to, and I built [Tax It Easy](/blog/moss-voice-cpa-yc-hackathon/) overnight with Sathya Kasturi at the Moss x YC hackathon.

## Step 1: find the constraint that becomes the product

The best ideas I had came from a constraint, not a feature list.

FaceTime from Mars started with a problem every voice demo has: you speak, then you wait a few seconds while speech to text, a model and text to speech take turns. Instead of hiding the gap, I made it the story. If the person you are calling is 225 million kilometers away, the delay is physics. The app became a push-to-talk call to Mars, and it took 2nd Place.

Jungle Safari's constraint was the user. A two-year-old does not wait for a spinner, so the whole build became about hiding every AI round trip: every sound and every spoken mascot line is generated ahead of time and cached.

Sometimes the constraint is the brief. The Moss x YC hackathon asked for retrieval as the visible hero, so Tax It Easy shows every search, with its scores and a millisecond badge, on screen, and refuses tax-law questions it cannot cite. The VoiceCaptcha brief asked for Cloudflare and ElevenLabs, and my own goal was for the Cloudflare side to carry real logic, not just hold a key, so challenges live in a Durable Object and are deleted after use.

## Step 2: scope to the demo

Judges see a demo, so the demo is the spec. When I built [Director](/blog/director-fal-voice-video-editor/) alone in 72 hours, the spec I wrote at the start had one rule: one happy path, and if it does not appear in the three minute demo, it does not get built.

The demo also tells you what can break. For Apartment 4B I knew judges would open a URL. If the game stalled on a text to speech call or leaked an API key, it was dead. So every voice line, scream and music cue was generated ahead of time and committed as MP3s, and the site makes no API calls at runtime. Voices of the Last World's submission guide, in the repo, says not to let the recorded demo fall back to browser speech, so the voice code was built to survive overlapping previews, restarts and eight voiced lines a run.

Scope cuts are part of this. Apartment 4B's roadmap described a week-long game with five rooms and a monster that hunts you. What shipped in 36 hours had no monster, and it placed 3rd. Tax It Easy's "Generate 1040" button routes to a return that was ingested before the demo. I say so in the write-ups.

## Step 3: make the sponsor's tech do real work

Most of these hackathons have sponsors, and I try not to bolt an API on for points. In Voices of the Last World the rubric was 40 percent creativity, 40 percent partner technology and 20 percent presentation, so the ElevenLabs layer does more than call text to speech: it shifts voice settings per line, filters one character into a robot voice, and falls back to the browser.

Tax It Easy had six sponsors, and I used them as one chain: parse, retrieve, talk, speak, govern, host. ScreenSense v3's spec gave Firecrawl and ElevenLabs separate jobs: Firecrawl reads the page, the DOM scraper acts on it, ElevenLabs handles the voice. Apartment 4B used ElevenLabs for speech, sound effects and music, all as a build step.

The criteria shape the architecture too. Second Shift's hackathon weighted reliability and evaluation at 25 percent, so instead of letting a model write the schedule, a solver plans and a separate checker verifies, and the repo ships an eval report.

## Step 4: build so the demo cannot fail

I build the happy path with no keys first. Living Photos chains four paid services, and a real world generation takes minutes. So the first thing I wrote was an interface per service with a mock and a real version, and the factory refuses to run mocks in production:

```ts
// lib/ai/factory.ts
  if (env.MOCK_MODE) {
    if (env.NODE_ENV === "production") {
      throw new Error(
        "MOCK_MODE=true is not permitted when NODE_ENV=production. " +
          "Set MOCK_MODE=false and provide real API keys before deploying.",
      );
    }
```

The whole loop ran before I spent a dollar on generation, and Living Photos won.

When the content is finite, I generate it ahead of time. Apartment 4B's bake script skips any file that already exists, so re-recording one bad line costs one API call:

```ts
// scripts/generate-audio.ts
async function writeIfMissing(
  outPath: string,
  generator: () => Promise<Buffer>,
): Promise<void> {
  const label = outPath.replace(/^public\/audio\//, "");
  if (await exists(outPath)) {
    console.log(`  SKIP  ${label}  (already exists)`);
    return;
  }
```

And every live call gets a fallback that still works. Voices of the Last World plays a full run from a fresh clone with zero keys. Spotify for Hackers returns a canned DJ line when the model fails, so the client always has something to say.

![The steps of a hack weekend, from the brief to the vote, with distribution as part of the build](/blog/diagrams/how-i-approach-hackathons-flow.svg)

## Step 5: reuse last weekend's build

A hackathon project does not have to end at the deadline. ScreenSense started as a hold-to-talk Chrome extension I built solo at TreeLine Hacks 2026, and the following week I re-entered it at Global Engineering Hack 2026. Days later I started a new repo for the Amazon Nova AI Hackathon and turned it into an agent that clicks and types. By the third weekend, for the ElevenLabs x Firecrawl Hackathon, I added page reading and a conversation loop, and that version won Best Voice Agent. Three weekends, one product.

Pivots are fine if they happen early. Jungle Safari started as a guess-the-place game called SoundGuessr, was renamed, and was then rebuilt as a toddler quiz. My D-ID track entry started as ElseWhere, a live avatar in another repo, and for about a day both repos were getting commits before I put my time into D-ID You, which renders a video you can download.

## Step 6: distribution is part of the hack

A project nobody sees cannot win a popular vote. I treat distribution as part of the build, not something for after the deadline.

The demo video gets a strong hook in the first five seconds. I make GIFs that catch attention. Super Nova's README links a demo GIF and a YouTube walkthrough, and Voices of the Last World ships a gameplay recording and two GIFs of choosing your agents. LARK's repo holds three short recordings: the home screen waking up, a real phone call placed from ChatGPT, and ChatGPT messaging another agent. Second Shift's demo video is one minute and three seconds.

Then I share each build with a circle of builders.

## Step 7: write it up honestly

After the hack I write up what I built, including what was held together with tape. LARK's call status screen is theater. Tax It Easy's upload never reaches the ingest service. When a build placed, the write-up says so. When it did not, it says "Entry" and claims nothing. An honest write-up is also distribution: it is how people find the work after the deadline.

## The playbook in one table

![What goes into a hackathon submission: the build, the proof, and the distribution that gets it seen](/blog/diagrams/how-i-approach-hackathons-architecture.svg)

| Layer | Choice | Why |
|---|---|---|
| Idea | A constraint that becomes the story | FaceTime from Mars turned latency into a call to Mars |
| Scope | Only what the demo shows | Director's three minute rule |
| Sponsor tech | Real work in the pipeline | Judges notice bolted-on APIs |
| Build order | Mocks and the keyless path first | Living Photos ran end to end before spending on generation |
| Risk | Pre-generate, then fall back | Apartment 4B makes no runtime API calls |
| Demo video | A strong hook in the first five seconds | Distribution is part of the hack |
| Assets | GIFs that catch attention | Super Nova and Voices of the Last World shipped them |
| Sharing | A circle of builders | A popular vote needs people to see the build |
| After | Reuse the build next weekend | ScreenSense grew across three hackathons |

## Key takeaways

- Look for the constraint that can become the product. A limit you design around beats a feature list.
- Scope to the demo. If it does not appear in the demo, it does not get built.
- Make the sponsor's technology do real work, and let the judging criteria shape the architecture.
- Build the keyless path first, pre-generate what you can, and give every live call a fallback.
- Treat distribution as part of the hack: a five-second hook, GIFs, and a circle of builders.
- Reuse last weekend's build and write up every hack honestly.

## FAQ

### How do you come up with a hackathon idea?

I look for a constraint that can become the product. In FaceTime from Mars the delay of a voice pipeline became the delay of a call to Mars. In Jungle Safari a toddler's patience forced every AI response to be generated ahead of time. In Tax It Easy the hackathon's own brief, retrieval as the visible hero, became the design.

### How do you scope a hackathon project?

Scope to the demo. For Director the rule was one happy path, and anything that did not appear in the three minute demo was not built. For Apartment 4B, knowing judges would open a URL meant no runtime API calls at all. Cut features early and say what was cut.

### How do you make sure a hackathon demo does not break?

Build the keyless path first, as Living Photos did with mock adapters for every paid service. Pre-generate finite content, as Apartment 4B did with its voice lines and music. Give every live call a fallback that still works, as Voices of the Last World does by playing with zero API keys.

### How do you get popular votes at a hackathon?

Treat distribution as part of the build: a strong hook in the first five seconds of the demo video, GIFs that catch attention, and sharing the build with a circle of builders. That is how I worked through ElevenHacks Season 1, where I took 3 popular votes.

### What is ElevenHacks?

ElevenHacks is a series of ElevenLabs hackathons. In Season 1, Anirudh Vasudevan submitted a project to all 11 hacks and finished 4th overall on the season leaderboard. His entries include Living Photos, Apartment 4B, FaceTime from Mars, VoiceCaptcha, Jungle Safari, Voices of the Last World, Super Nova, The Missing Angle and D-ID You.
