// "My work, as a universe": the second act of the homepage story, right after the hero.
// The hero's stars travel down into this section and settle into orbits (src/components/story).
// The canvas only decorates. Every project is real HTML in reading order: a list of rows on wide
// screens (the planet you point at, or the row you hover or focus, lights up and a card opens
// beside it) and a swipeable row of cards on phones. Native scroll; the stage is sticky only on
// wide, tall screens, where the system tilts from a star chart into depth as you keep scrolling.

import { useEffect, useRef, useState } from 'react';

import { PLANETS, linkPlanetArticles, loadArticles, writeUpHref } from '../components/story/storyData.js';
import { registerUniverse, setUniverseActive } from '../components/story/story.js';

const snapshot = () => PLANETS.map((p) => ({ ...p }));

const Universe = () => {
  const sectionRef = useRef(null);
  const stageRef = useRef(null);
  const orbitRef = useRef(null);
  const floatRef = useRef(null);
  const listRef = useRef(null);
  const labelRefs = useRef([]);
  const itemRefs = useRef([]);
  const [planets, setPlanets] = useState(snapshot);
  const [active, setActive] = useState(-1);

  // Planet cards without an `article` pick up their write-up once the article list is known.
  useEffect(() => {
    let live = true;
    loadArticles().then((list) => {
      if (!live) return;
      linkPlanetArticles(list);
      setPlanets(snapshot());
    });
    return () => {
      live = false;
    };
  }, []);

  useEffect(() => {
    if (!sectionRef.current) return undefined;
    return registerUniverse({
      section: sectionRef.current,
      stage: stageRef.current,
      orbit: orbitRef.current,
      labels: labelRefs.current,
      float: floatRef.current,
      onActive: (i, source) => {
        setActive(i);
        // On phones a tapped planet brings its card into view (sideways only).
        if (source !== 'tap' || i < 0) return;
        const list = listRef.current;
        const item = itemRefs.current[i];
        if (!list || !item || list.scrollWidth <= list.clientWidth) return;
        const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
        list.scrollTo({ left: item.offsetLeft - list.offsetLeft - 20, behavior: reduce ? 'auto' : 'smooth' });
      },
    });
  }, []);

  useEffect(() => () => setUniverseActive(-1), []);

  const pick = (i) => setUniverseActive(i);
  const shown = active >= 0 ? planets[active] : null;

  return (
    <section ref={sectionRef} id="universe" className="universe" aria-labelledby="universe-title">
      <div ref={stageRef} className="u-stage">
        <div className="u-head">
          <p className="u-eyebrow">Selected work</p>
          <h2 className="head-text u-title" id="universe-title">My work, as a universe</h2>
          <p className="u-intro">
            The stars in the sky above are the things I build. Here my homepage projects settle into orbit, and the ringed planets won a hackathon or became a granted patent.
          </p>
        </div>

        <div ref={orbitRef} className="u-orbit" aria-hidden="true">
          {planets.map((p, i) => (
            <span
              key={p.id}
              ref={(el) => {
                labelRefs.current[i] = el;
              }}
              className="u-label"
              data-i={i}
            >
              {p.name}
            </span>
          ))}
          <div ref={floatRef} className="u-float">
            {shown && (
              <>
                <p className={`u-float-kicker${shown.award ? ' is-award' : ''}`}>{shown.result}</p>
                <p className="u-float-title">{shown.name}</p>
                <p className="u-float-line">{shown.line}</p>
                <p className="u-float-links">
                  {shown.article && (
                    <a href={writeUpHref(shown.article)} tabIndex={-1}>
                      Read the write-up <span aria-hidden="true">→</span>
                    </a>
                  )}
                  {shown.href && (
                    <a href={shown.href} target="_blank" rel="noopener noreferrer" tabIndex={-1}>
                      {shown.hrefLabel} <span aria-hidden="true">↗</span>
                    </a>
                  )}
                </p>
              </>
            )}
          </div>
        </div>

        <ol ref={listRef} className="u-list">
          {planets.map((p, i) => (
            <li
              key={p.id}
              ref={(el) => {
                itemRefs.current[i] = el;
              }}
              className={`u-item${active === i ? ' is-active' : ''}${p.award ? ' is-award' : ''}`}
              onPointerEnter={(e) => e.pointerType === 'mouse' && pick(i)}
              onPointerLeave={(e) => e.pointerType === 'mouse' && pick(-1)}
              onFocus={() => pick(i)}
              onBlur={(e) => {
                if (!e.currentTarget.contains(e.relatedTarget)) pick(-1);
              }}
            >
              <article className="u-card">
                <p className="u-kicker">{p.result}</p>
                <h3 className="u-name">{p.name}</h3>
                <p className="u-line">{p.line}</p>
                <p className="u-links">
                  {p.article && (
                    <a href={writeUpHref(p.article)}>
                      Read the write-up<span className="sr-only">: {p.name}</span>
                      <span aria-hidden="true"> →</span>
                    </a>
                  )}
                  {p.href && (
                    <a href={p.href} target="_blank" rel="noopener noreferrer">
                      {p.hrefLabel}
                      <span className="sr-only"> for {p.name} (opens in a new tab)</span>
                      <span aria-hidden="true"> ↗</span>
                    </a>
                  )}
                </p>
              </article>
            </li>
          ))}
        </ol>

        <p className="u-more">
          <a href="/projects/">All projects</a>
          <span aria-hidden="true">·</span>
          <a href="/blog/">All write-ups</a>
        </p>
      </div>
    </section>
  );
};

export default Universe;
