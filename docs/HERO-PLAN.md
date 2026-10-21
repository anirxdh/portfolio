# Homepage hero: the constellation story

The owner's pick after two rounds of prototypes (gallery: https://claude.ai/artifact/S2quDxrKjULScWq1aMVLXK). Homepage only.

## Act 1: the hero
- His name, large and calm, as real text (the page's one h1), with role, one sentence, proof row and two buttons.
- Behind it, the constellation sky: every star is one of his projects or hackathon results. The nearest stars reach toward the cursor and show a small card that links to the write-up.
- "Talk to AniBot": the name dissolves into particles that flow into one glowing orb. The orb is AniBot's voice: it greets, listens (browser speech recognition), answers through the same backend as the chat (with the offline knowledge base when the API is down), speaks with the browser's free voice, and shows live captions. Ending the call rebuilds the name.
- "or type a question" opens the AniBot chat window, polished to feel slick and on-brand (not the typing panel from the Mission control prototype).

## Act 2: the universe (on scroll)
- The constellation stars drift into a universe where his projects orbit as planets. Hover, tap or focus a planet for its result and links to the write-up and live site. Native scroll, no scroll-jacking.

## Later
- The AniBot console (text, voice and work tabs) as a separate feature.

## Rules
- Text Google can read at first paint (static intro and prerendered HTML match the hero exactly), one h1, no three.js in the hero, reduced-motion and no-canvas fallbacks, phone layouts, Lighthouse mobile 90 or better, no mic request before Talk is pressed.
