// The homepage story: one fixed Canvas 2D layer behind the hero and the universe section.
//
// Act 1, the sky: every star is a project or a write-up (src/components/story/storyData.js). The
// sky drifts a few pixels at most; the nearest stars reach toward the cursor and a small card names
// the closest one. Wins and the patent are the bright stars.
// Act 2, the universe: as the hero scrolls away the same stars travel down and settle into orbits
// around a small dotted orb (AniBot's motif). The homepage projects light up as they leave the sky
// and carry their names down where there is room for them (a name fades out near any text, the
// edges and the other names), then become planets with real DOM labels; every other write-up joins
// an outer belt. While the universe stays pinned the system tilts from a star chart into depth,
// and the picked planet's card opens in a slot under it, joined by a thin line. Native scroll
// only: progress is read from the section's rect.
//
// Cost: about 30 bodies, 4 orbits and a 140-dot sphere, under a millisecond a frame. The loop is
// capped at 30 fps at rest, runs at full rate only while something moves, stops after a quiet
// spell, and stops when the tab is hidden or both sections are offscreen. prefers-reduced-motion
// draws still frames on scroll and input only, with no travel and no drift.
//
// React owns every element except the canvas, which this module creates. It reports through
// callbacks (onCard, onActive) and only writes transform and opacity to the cards and labels.

import { PLANETS, buildStars, loadArticles } from './storyData.js';

const TAU = Math.PI * 2;
const SILVER = '#D5D8EA';
const STRONG = '#E4E4E6';
const WHITE = '#FFFFFF';
const BODY = '#AFB0B6';
const LINE = '#3A3A49';
const ACCENT = '#4ADE80';
const SILVER_RGB = '213,216,234';
const ACCENT_RGB = '74,222,128';

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const smooth = (v) => {
  const u = clamp(v, 0, 1);
  return u * u * (3 - 2 * u);
};
const easeInOut = (u) => (u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2);
const lerp = (a, b, u) => a + (b - a) * u;

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let x = a;
    x = Math.imul(x ^ (x >>> 15), x | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}
function sprite(w, h, paint) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d');
  if (g) paint(g);
  return c;
}
const radial = (rgb, stops) =>
  sprite(64, 64, (g) => {
    const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    stops.forEach(([at, a]) => gr.addColorStop(at, `rgba(${rgb},${a})`));
    g.fillStyle = gr;
    g.fillRect(0, 0, 64, 64);
  });

// Orbit radius (fraction of the system radius) and seconds per lap.
const ORBITS = [
  { r: 0.34, period: 74 },
  { r: 0.53, period: 106 },
  { r: 0.72, period: 142 },
  { r: 0.91, period: 188 },
];
const ORBIT_CAP = [1, 2, 2, 2];
const QUALITY = [
  { dpr: 1, halo: false },
  { dpr: 1.5, halo: true },
  { dpr: 2, halo: true },
];

export function createStoryEngine() {
  const canvas = document.createElement('canvas');
  canvas.className = 'story-canvas';
  canvas.setAttribute('aria-hidden', 'true');
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('no 2d context');
  document.body.prepend(canvas);

  const HALO = radial(SILVER_RGB, [
    [0, 1],
    [0.2, 0.38],
    [0.5, 0.08],
    [1, 0],
  ]);
  const GLOW = radial(SILVER_RGB, [
    [0, 0.9],
    [0.4, 0.22],
    [1, 0],
  ]);
  const GLOW_ACCENT = radial(ACCENT_RGB, [
    [0, 0.7],
    [0.4, 0.16],
    [1, 0],
  ]);

  const mq = (q) => (window.matchMedia ? window.matchMedia(q) : { matches: false });
  const MQ_REDUCE = mq('(prefers-reduced-motion: reduce)');
  const MQ_HOVER = mq('(hover: hover) and (pointer: fine)');
  let reduced = MQ_REDUCE.matches;
  let tier = 2;
  {
    const mem = navigator.deviceMemory;
    const cores = navigator.hardwareConcurrency;
    if ((mem && mem <= 2) || (cores && cores <= 2)) tier = 1;
  }

  /* ---------- Registered elements ---------- */
  let H = null; // { hero, band, card, onCard }
  let U = null; // { section, stage, orbit, labels, float, onActive }
  let dimTarget = 0;
  let dim = 0;

  /* ---------- Bodies ---------- */
  let stars = [];
  let planetStar = []; // planet index -> star
  let travelOrder = []; // the planets' stars, the first to leave the sky first
  const seedRand = rng(20261021);
  function setData(list) {
    const rand = rng(20261021);
    stars = list.map((s, i) => ({
      ...s,
      i,
      placed: false,
      bx: 0,
      by: 0,
      hx: 0,
      hy: 0,
      ph: rand() * TAU,
      w1: TAU / (34 + rand() * 30),
      w2: TAU / (40 + rand() * 36),
      amp: 1.4 + rand() * 2,
      tw: 0.25 + rand() * 0.45,
      twp: rand() * TAU,
      z: 0.3 + rand() * 0.7,
      rr: s.mag === 1 ? 2.5 : s.mag === 2 ? 1.9 : 1.4,
      delay: rand() * 0.3,
      swirl: (rand() - 0.5) * 2,
      prox: 0,
      act: 0,
      ox: 0,
      oy: 0,
      order: 0,
      ign: 0,
      orbit: -1,
      phase: 0,
      period: 200,
      beltR: 1.02 + rand() * 0.12,
      beltY: (rand() - 0.5) * 0.08,
      ux: 0,
      uy: 0,
      uz: 0,
      uk: 1,
      px: 0,
      py: 0,
      prr: 0,
      lab: null,
      la: 0, // travelling name: shown alpha, speed (px/s) and the star's last position
      lv: 0,
      lpx: NaN,
      lpy: 0,
      lx: 0, // where the name was last drawn (screen), and the page's top at that moment
      ly: 0,
      lc: 0,
      lg: false, // let go of its star: fading out where it was
    }));
    planetStar = [];
    // Planets: wins and the patent on the inner orbits, the others further out.
    const order = PLANETS.map((_, i) => i).sort((a, b) => Number(PLANETS[b].award) - Number(PLANETS[a].award) || a - b);
    const fill = ORBITS.map(() => []);
    let o = 0;
    for (const pi of order) {
      while (o < ORBITS.length - 1 && fill[o].length >= ORBIT_CAP[o]) o++;
      fill[o].push(pi);
    }
    fill.forEach((list2, oi) => {
      const base = 0.6 + oi * 1.9;
      list2.forEach((pi, j) => {
        const s = stars.find((x) => x.planet === pi);
        if (!s) return;
        s.orbit = oi;
        s.phase = base + (j * TAU) / list2.length;
        s.period = ORBITS[oi].period;
        planetStar[pi] = s;
      });
    });
    stars.forEach((s) => {
      if (s.orbit >= 0) return;
      s.phase = seedRand() * TAU;
      s.period = 230 + seedRand() * 90;
    });
    travelOrder = planetStar.filter(Boolean).sort((a, b) => a.delay - b.delay || a.i - b.i);
    layoutDirty = true;
    wake();
  }

  /* ---------- Layout ---------- */
  let W = 0;
  let VH = 0;
  let DPR = 1;
  let layoutDirty = true;
  const band = { x: 0, y: 0, w: 0, h: 0 }; // hero-local
  const heroSize = { w: 0, h: 0 };
  let edges = [];
  let sticky = false;
  let Rmax = 200;
  const orbitBox = { w: 0, h: 0 };
  let narrowU = false;
  const heroDust = document.createElement('canvas');
  const uniDust = document.createElement('canvas');
  let heroDustOK = false;
  let uniDustOK = false;
  let labelSize = [];
  let floatSize = { w: 320, h: 150 };
  let cardSize = { w: 260, h: 110 };
  let copyBoxes = []; // the hero's text and buttons, hero-local: the demo card keeps clear of them
  // What the travelling names keep clear of, measured on layout only (never per frame): the boxes
  // and the line boxes of the hero's copy (hero-local) and of the universe's heading, list and
  // links (stage-local), the bottom of the site's fixed nav and the fixed AniBot button. The hero
  // card is placed by this engine, so its box is known without measuring.
  let heroText = [];
  let uniText = [];
  let navBottom = 0;
  let fabEl = null;
  let fabBox = null; // screen box, or null
  let fabCheckAt = 0;
  const cardBox = { x: 0, y: 0, r: 0, b: 0, until: 0 }; // hero-local, kept while it fades out
  let frameNow = 0;
  let domGate = 0; // the planets' DOM labels show only once every canvas name is gone
  let namesOn = false;
  let frameDt = 1 / 60;
  let pageV = 0; // how fast the page moves, px/s (see update())
  let lastRegionTop = 0;
  const labelW = new Map(); // name -> drawn width, cleared on layout (fonts)
  const labelBox = []; // this frame's name boxes, in the order the stars left
  const HERO_TEXT = '.hero-eyebrow, .hero-name, .hero-role, .hero-line, .hero-ctas > *, .hero-type, .hero-proof';
  const UNI_TEXT = '.u-eyebrow, .u-title, .u-intro, .u-list, .u-more';
  const textBoxes = (root, sel, ox, oy) => {
    const out = [];
    const range = document.createRange();
    const push = (r) => {
      if (r.width > 1 && r.height > 1) out.push({ x: r.left - ox, y: r.top - oy, r: r.right - ox, b: r.bottom - oy });
    };
    for (const el of root.querySelectorAll(sel)) {
      push(el.getBoundingClientRect());
      // The letters themselves can reach past the box (the name's tight line height).
      range.selectNodeContents(el);
      for (const r of range.getClientRects()) push(r);
    }
    return out;
  };
  let dock = 0; // pinned universe: room kept under the system for the picked planet's card
  let clipOrbit = false; // the orbit box clips (phones, tablets): labels must stay inside it
  const sphere = [];
  {
    const n = 140;
    const ga = Math.PI * (3 - Math.sqrt(5));
    for (let k = 0; k < n; k++) {
      const y = 1 - ((k + 0.5) * 2) / n;
      const r = Math.sqrt(Math.max(0, 1 - y * y));
      sphere.push([Math.cos(k * ga) * r, y, Math.sin(k * ga) * r]);
    }
  }

  function sizeCanvas() {
    W = canvas.clientWidth || window.innerWidth;
    const CHh = canvas.clientHeight || window.innerHeight;
    VH = window.innerHeight;
    let dpr = Math.min(window.devicePixelRatio || 1, QUALITY[tier].dpr);
    const budget = 3.4e6;
    if (W * CHh * dpr * dpr > budget) dpr = Math.max(1, Math.sqrt(budget / (W * CHh)));
    DPR = dpr;
    const cw = Math.max(1, Math.round(W * DPR));
    const ch = Math.max(1, Math.round(CHh * DPR));
    if (canvas.width !== cw || canvas.height !== ch) {
      canvas.width = cw;
      canvas.height = ch;
    }
  }

  function buildDust(target, w, h, seed, density) {
    const ok = w > 0 && h > 0;
    if (!ok) return false;
    target.width = Math.ceil(w);
    target.height = Math.ceil(h);
    const g = target.getContext('2d');
    if (!g) return false;
    const rand = rng(seed);
    const n = Math.round((w * h) / density);
    g.clearRect(0, 0, w, h);
    g.fillStyle = SILVER;
    for (let k = 0; k < n; k++) {
      const x = rand() * w;
      const y = Math.pow(rand(), 1.25) * h;
      const s = rand() < 0.88 ? 0.8 : 1.3;
      g.globalAlpha = 0.08 + rand() * 0.3;
      g.fillRect(x, y, s, s);
    }
    g.globalAlpha = 1;
    return true;
  }

  // The constellation figure: a minimum spanning tree over each group of stars (Prim).
  function mst(ids) {
    const n = ids.length;
    if (n < 2) return [];
    const inTree = new Uint8Array(n);
    const best = new Float64Array(n).fill(Infinity);
    const from = new Int32Array(n).fill(-1);
    best[0] = 0;
    const out = [];
    for (let k = 0; k < n; k++) {
      let u = -1;
      let bu = Infinity;
      for (let j = 0; j < n; j++) {
        if (!inTree[j] && best[j] < bu) {
          bu = best[j];
          u = j;
        }
      }
      inTree[u] = 1;
      if (from[u] >= 0) out.push([ids[from[u]], ids[u]]);
      const a = stars[ids[u]];
      for (let j = 0; j < n; j++) {
        if (inTree[j]) continue;
        const b = stars[ids[j]];
        const d = (a.bx - b.bx) ** 2 + (a.by - b.by) ** 2;
        if (d < best[j]) {
          best[j] = d;
          from[j] = u;
        }
      }
    }
    return out;
  }

  function placeHeroStars() {
    stars.forEach((s) => {
      s.placed = false;
    });
    edges = [];
    if (!H || !stars.length) return;
    const rand = rng(7051 + Math.round(band.w) * 3 + Math.round(band.h));
    const narrow = W < 720;
    const x0 = band.x + 12;
    const x1 = band.x + band.w - 12;
    const y0 = band.y + 12;
    const y1 = band.y + band.h - 10;
    const bw = x1 - x0;
    const bh = y1 - y0;
    // Unplaced stars still need a start point for the travel into the universe.
    stars.forEach((s) => {
      s.bx = x0 + rand() * Math.max(1, bw);
      s.by = y0 + rand() * Math.max(1, bh);
    });
    if (bw < 160 || bh < 60) return;
    // Every project star is in the sky, so each one can be watched on its way to its planet.
    const nPlanets = stars.filter((s) => s.orbit >= 0).length;
    const n = clamp(Math.max(Math.round((bw * bh) / (narrow ? 4200 : 7800)), nPlanets), 5, stars.length);
    const pick = stars
      .slice()
      .sort((a, b) => Number(b.orbit >= 0) - Number(a.orbit >= 0) || a.mag - b.mag || a.i - b.i)
      .slice(0, n);
    let md = clamp(Math.sqrt((bw * bh) / n) * 0.72, 26, 150);
    const all = [];
    for (const s of pick) {
      let ok = false;
      for (let round = 0; round < 4 && !ok; round++) {
        for (let tries = 0; tries < 60; tries++) {
          const x = x0 + rand() * bw;
          const y = y0 + rand() * bh;
          let good = true;
          for (const o of all) {
            if ((o.bx - x) ** 2 + (o.by - y) ** 2 < md * md) {
              good = false;
              break;
            }
          }
          if (good) {
            s.bx = x;
            s.by = y;
            ok = true;
            break;
          }
        }
        if (!ok) md *= 0.85;
      }
      if (ok) {
        s.placed = true;
        all.push(s);
      }
    }
    all.forEach((s, k) => {
      s.order = k;
    });
    // Groups by position, left to right, each with its own figure.
    const byX = all.slice().sort((a, b) => a.bx - b.bx);
    const groups = clamp(Math.round(all.length / 6), 1, 5);
    for (let g = 0; g < groups; g++) {
      const ids = byX.slice(Math.floor((g * byX.length) / groups), Math.floor(((g + 1) * byX.length) / groups)).map((s) => s.i);
      edges.push(...mst(ids));
    }
  }

  // The AniBot button is fixed in a corner and comes and goes with the chat window: its box is
  // measured when it appears (checked twice a second, no layout read) and on layout.
  function measureFab(el) {
    fabEl = el;
    fabBox = null;
    if (!el) return;
    const r = el.getBoundingClientRect();
    if (r.width > 1 && r.height > 1 && getComputedStyle(el).position === 'fixed') fabBox = { x: r.left - 6, y: r.top - 6, r: r.right + 6, b: r.bottom + 6 };
  }

  function layout() {
    layoutDirty = false;
    sizeCanvas();
    if (H) {
      const hr = H.hero.getBoundingClientRect();
      const br = H.band.getBoundingClientRect();
      heroSize.w = hr.width;
      heroSize.h = hr.height;
      band.x = br.left - hr.left;
      band.y = br.top - hr.top;
      band.w = br.width;
      band.h = br.height;
      placeHeroStars();
      heroDustOK = buildDust(heroDust, hr.width, Math.max(1, band.y + band.h + 40), 99, W < 720 ? 2400 : 3200);
      if (H.card) cardSize = { w: H.card.offsetWidth || 260, h: H.card.offsetHeight || 110 };
      copyBoxes = [...H.hero.querySelectorAll('.hero-eyebrow, .hero-name, .hero-text, .hero-ctas, .hero-type, .hero-proof')].map((el) => {
        const r = el.getBoundingClientRect();
        return { x: r.left - hr.left - 8, y: r.top - hr.top - 8, w: r.width + 16, h: r.height + 16 };
      });
      heroText = textBoxes(H.hero, HERO_TEXT, hr.left, hr.top);
      demoStar = -1;
    }
    const nav = document.querySelector('header');
    navBottom = nav && getComputedStyle(nav).position === 'fixed' ? Math.max(0, nav.getBoundingClientRect().bottom) : 0;
    measureFab(document.querySelector('.anibot-fab'));
    labelW.clear();
    if (U) {
      const orr = U.orbit.getBoundingClientRect();
      const sr = U.stage.getBoundingClientRect();
      sticky = getComputedStyle(U.stage).position === 'sticky';
      narrowU = orr.width < 480;
      orbitBox.w = orr.width;
      orbitBox.h = orr.height;
      clipOrbit = getComputedStyle(U.orbit).overflow !== 'visible';
      if (U.float) floatSize = { w: U.float.offsetWidth || floatSize.w, h: Math.max(130, U.float.offsetHeight || floatSize.h) };
      dock = sticky ? Math.min(Math.round(orr.height * 0.26), floatSize.h + 30) : 0;
      const margin = narrowU ? 34 : 86;
      Rmax = Math.max(60, Math.min(orr.width / 2 - margin, ((orr.height - dock) / 2 - 30) / 0.88));
      uniDustOK = buildDust(uniDust, sr.width, sr.height, 311, narrowU ? 2600 : 3600);
      uniText = textBoxes(U.stage, UNI_TEXT, sr.left, sr.top);
      labelSize = U.labels.map((el) => (el ? { w: el.offsetWidth, h: el.offsetHeight } : { w: 0, h: 0 }));
    }
  }

  /* ---------- Interaction ---------- */
  const P = { x: -9999, y: -9999, sx: -9999, sy: -9999, mouse: false, seen: false, last: -1e9 };
  let t = 0;
  let presence = 0;
  let heroActive = -1;
  let heroHover = -1;
  let heroPinned = -1;
  let hoverCandAt = 0;
  let demoEnd = -1;
  let demoStar = -1; // -1: not chosen yet, -2: none fits
  let overCard = false;
  let uActive = -1;
  let uHover = -1;
  let uPinned = -1;
  let uList = -1;
  let overFloat = false;
  let speedK = 1;
  let tOrb = 0;
  let pT = 0;
  let pSpan = 1; // px of scroll from pT 0 to 1
  let pD = 0;
  let lastInput = performance.now();
  let lastScroll = -1e9;

  const setHeroActive = (i) => {
    if (i === heroActive) return;
    heroActive = i;
    H?.onCard?.(i >= 0 ? stars[i] : null);
    // The card's size is known after React renders it.
    requestAnimationFrame(() => {
      if (H?.card) cardSize = { w: H.card.offsetWidth || cardSize.w, h: H.card.offsetHeight || cardSize.h };
    });
  };
  const setUActive = (i, source) => {
    if (i === uActive) return;
    uActive = i;
    U?.onActive?.(i, source);
    requestAnimationFrame(() => {
      if (U?.float) floatSize = { w: U.float.offsetWidth || floatSize.w, h: U.float.offsetHeight || floatSize.h };
    });
  };

  // Where the hero card goes for a star (hero-local), beside it, inside the sky where it fits.
  function cardPos(s) {
    const lx = s.hx - heroLeft;
    const ly = s.hy - heroTop;
    const gap = 16;
    let x;
    let y;
    const room = cardSize.w + gap * 2 + 24;
    const besideCopy = band.x > heroSize.w * 0.3; // short screens: the sky sits right of the copy
    if (besideCopy) {
      // Stay inside the sky, above or below the star, so the copy is never covered.
      x = clamp(lx - cardSize.w / 2, band.x, Math.max(band.x, band.x + band.w - cardSize.w));
      const top = 84; // below the site nav
      const above = ly - gap - cardSize.h;
      const below = ly + gap;
      const fitsAbove = above >= top;
      const fitsBelow = below + cardSize.h <= heroSize.h - 8;
      y = (ly - band.y > band.h / 2 && fitsAbove) || !fitsBelow ? Math.max(top, above) : below;
    } else if (lx + room <= heroSize.w || lx - room >= 0) {
      x = lx + gap + cardSize.w <= heroSize.w - 12 ? lx + gap : lx - gap - cardSize.w;
      y = clamp(ly - 18, band.y - 6, Math.max(band.y - 6, band.y + band.h - cardSize.h + 12));
    } else {
      // Narrow screens: above or below the star, so the star and the name stay visible.
      x = lx - cardSize.w / 2;
      const below = ly + gap;
      const above = ly - gap - cardSize.h;
      const fitsBelow = below + cardSize.h <= band.y + band.h + 16;
      y = ly < band.y + band.h / 2 && fitsBelow ? below : above >= band.y - 30 ? above : below;
    }
    x = clamp(x, 12, Math.max(12, heroSize.w - cardSize.w - 12));
    return { x, y };
  }

  // The one-time demo card: the first star whose card would not cover any of the hero's text or
  // buttons. A short sky (a phone on its side) gets no demo at all.
  function pickDemo() {
    if (band.h < 200) return -2;
    const order = stars.filter((s) => s.placed).sort((a, b) => a.order - b.order);
    for (const s of order) {
      const c = cardPos(s);
      const b = { x: c.x, y: c.y, w: cardSize.w, h: cardSize.h };
      if (!copyBoxes.some((o) => overlap(b, o) > 0)) return s.i;
    }
    return -2;
  }

  /* ---------- Per-frame geometry ---------- */
  let heroTop = 0;
  let heroLeft = 0;
  let uniRect = null;
  let orbitRect = null;
  let stageRect = null;
  let cx = 0;
  let cy = 0;
  let elev = 1;
  let sinE = 1;
  let cosE = 0;
  let Dp = 800;
  let regionTop = 0;
  let regionBottom = 0;

  function readRects() {
    if (H) {
      const hr = H.hero.getBoundingClientRect();
      heroTop = hr.top;
      heroLeft = hr.left;
      if (Math.abs(hr.width - heroSize.w) > 1 || Math.abs(hr.height - heroSize.h) > 1) layoutDirty = true;
    }
    if (U) {
      uniRect = U.section.getBoundingClientRect();
      orbitRect = U.orbit.getBoundingClientRect();
      stageRect = U.stage.getBoundingClientRect();
      if (Math.abs(orbitRect.width - orbitBox.w) > 1 || Math.abs(orbitRect.height - orbitBox.h) > 1) layoutDirty = true;
    } else {
      uniRect = null;
    }
  }

  function progress() {
    const sy = window.scrollY || window.pageYOffset || 0;
    if (!U || !uniRect) {
      pT = 0;
      pD = 0;
      return;
    }
    const docTop = uniRect.top + sy;
    const S0 = Math.max(0, docTop - VH);
    const S1 = Math.max(S0 + 1, docTop - (sticky ? 0 : VH * 0.12));
    pT = clamp((sy - S0) / (S1 - S0), 0, 1);
    pSpan = S1 - S0;
    pD = sticky ? clamp((sy - S1) / Math.max(1, uniRect.height - VH), 0, 1) : 0;
  }

  function orbitGeometry() {
    if (!U || !orbitRect) return;
    cx = orbitRect.left + orbitRect.width / 2;
    cy = orbitRect.top + (orbitRect.height - dock) / 2;
    elev = reduced ? (sticky ? 0.62 : 0.66) : sticky ? lerp(1.04, 0.52, easeInOut(pD)) : 0.66;
    sinE = Math.sin(elev);
    cosE = Math.cos(elev);
    Dp = Rmax * 4.2;
  }

  // Screen position on an orbit (or the belt) for angle th and radius R; returns depth in -1..1.
  let OX = 0;
  let OY = 0;
  let OK = 1;
  function project(R, th, lift) {
    const x = Math.cos(th) * R;
    const zf = Math.sin(th) * R;
    const z = zf * cosE;
    const y = zf * sinE - lift * cosE;
    const k = Dp / (Dp - z);
    OX = cx + x * k;
    OY = cy + y * k;
    OK = k;
    return z / Math.max(1, R);
  }

  function universePos(s) {
    const scale = clamp(Rmax / 300, 0.62, 1.25);
    if (s.orbit >= 0) {
      const R = ORBITS[s.orbit].r * Rmax;
      const th = s.phase + (TAU / s.period) * tOrb;
      s.uz = project(R, th, 0);
      s.prr = (PLANETS[s.planet]?.award ? 8.6 : 7.2) * scale * OK;
    } else {
      const R = s.beltR * Rmax;
      const th = s.phase + (TAU / s.period) * tOrb;
      s.uz = project(R, th, s.beltY * R);
      s.prr = 1.1 * OK;
    }
    s.ux = OX;
    s.uy = OY;
    s.uk = OK;
  }

  /* ---------- Update ---------- */
  function update(dt, nowMs) {
    const anim = !reduced;
    if (anim) t += dt;
    const e7 = anim ? 1 - Math.exp(-dt * 7) : 1;
    const e5 = anim ? 1 - Math.exp(-dt * 5) : 1;
    const e16 = anim ? 1 - Math.exp(-dt * 16) : 1;
    dim += (dimTarget - dim) * (anim ? 1 - Math.exp(-dt * 3) : 1);

    readRects();
    if (layoutDirty) {
      layout();
      readRects();
    }
    progress();
    orbitGeometry();
    regionTop = H ? heroTop : uniRect ? uniRect.top : 0;
    regionBottom = uniRect ? uniRect.bottom : H ? heroTop + heroSize.h : 0;
    // How fast the page is moving (px/s, held at its peak and let go slowly): the travelling names
    // look ahead by it, so they fade before they reach text instead of popping off.
    frameDt = dt;
    frameNow = nowMs;
    pageV = Math.max(Math.abs(regionTop - lastRegionTop) / Math.max(dt, 1 / 240), pageV * Math.exp(-dt * 8));
    lastRegionTop = regionTop;
    if (nowMs > fabCheckAt) {
      fabCheckAt = nowMs + 500;
      const f = document.querySelector('.anibot-fab');
      if (f !== fabEl || (f && !fabBox)) measureFab(f);
    }

    // Orbits slow down while a planet is picked, so it is easy to read.
    speedK += ((uActive >= 0 ? 0.12 : 1) - speedK) * e5;
    if (anim) tOrb += dt * speedK;

    // Hero: drift, parallax, the lean toward the pointer, and the nearest star.
    const inHeroBand = H && pT < 0.04 && P.y > heroTop + band.y - 30 && P.y < heroTop + band.y + band.h + 40;
    const live = P.mouse && inHeroBand && dimTarget < 0.5;
    presence += ((live ? 1 : 0) - presence) * e7;
    if (anim) {
      P.sx += (P.x - P.sx) * e16;
      P.sy += (P.y - P.sy) * e16;
    } else {
      P.sx = P.x;
      P.sy = P.y;
    }
    const R = W < 720 ? 140 : 200;
    const HOVER_R = W < 720 ? 60 : 110;
    let near = -1;
    let nearD = 1e9;
    for (const s of stars) {
      s.ign = anim ? smooth((t - 0.3 - s.order * 0.05) / 0.9) : 1;
      if (!s.placed) {
        s.hx = heroLeft + s.bx;
        s.hy = heroTop + s.by;
        s.prox = 0;
        continue;
      }
      const bx = heroLeft + s.bx + (anim ? Math.sin(t * s.w1 + s.ph) * s.amp : 0);
      const by = heroTop + s.by + (anim ? Math.cos(t * s.w2 + s.ph * 1.7) * s.amp * 0.7 : 0);
      let p = 0;
      let lx = 0;
      let ly = 0;
      if (presence > 0.001) {
        const ex = P.sx - bx;
        const ey = P.sy - by;
        const d = Math.sqrt(ex * ex + ey * ey);
        if (d < R) {
          p = smooth(1 - d / R) * presence;
          if (anim && d > 1) {
            lx = (ex / d) * 5 * p;
            ly = (ey / d) * 5 * p;
          }
        }
      }
      s.prox = p;
      s.ox += (lx - s.ox) * e5;
      s.oy += (ly - s.oy) * e5;
      s.hx = bx + s.ox;
      s.hy = by + s.oy;
      if (live) {
        const d = Math.hypot(P.x - s.hx, P.y - s.hy);
        if (d < nearD) {
          nearD = d;
          near = s.i;
        }
      }
    }
    let c = live && nearD < HOVER_R ? near : -1;
    if (overCard && heroActive >= 0) c = heroActive;
    if (c !== heroHover) {
      if (c >= 0 || nowMs - hoverCandAt > 320) {
        heroHover = c;
        hoverCandAt = nowMs;
      }
    } else hoverCandAt = nowMs;
    // One short demo card shortly after the sky appears, until the pointer gets there.
    let auto = -1;
    if (anim && demoEnd !== 0 && H) {
      if (P.seen) demoEnd = 0;
      else if (t > 2.6) {
        if (demoEnd < 0) demoEnd = t + 4;
        if (demoStar === -1) demoStar = pickDemo();
        if (t < demoEnd && demoStar >= 0 && pT < 0.02 && dimTarget < 0.5) auto = demoStar;
        else if (t >= demoEnd) demoEnd = 0;
      }
    }
    const heroOk = (i) => i >= 0 && stars[i]?.placed && pT < 0.04 && dimTarget < 0.5;
    const want = heroOk(heroPinned) ? heroPinned : heroOk(heroHover) ? heroHover : heroOk(auto) ? auto : -1;
    setHeroActive(want);

    // Universe positions and the picked planet.
    if (U) for (const s of stars) universePos(s);
    const uOk = U && pT > 0.94;
    if (!uOk && uActive >= 0 && uList < 0) {
      uHover = -1;
      uPinned = -1;
    }
    let uWant = -1;
    if (uOk) {
      if (uList >= 0) uWant = uList;
      else if (uPinned >= 0) uWant = uPinned;
      else if (uHover >= 0) uWant = uHover;
    } else if (uList >= 0 && pT > 0.6) uWant = uList;
    setUActive(uWant, 'engine');

    for (const s of stars) {
      const target = s.placed && s.i === heroActive ? 1 : s.orbit >= 0 && s.planet === uActive ? 1 : 0;
      s.act += (target - s.act) * e7;
    }

    // The picked planet's card: docked under the system, centred on it (pinned layout only; on
    // phones and tablets the card list below the system shows the same details).
    floatPos.on = false;
    const fs = uActive >= 0 ? planetStar[uActive] : null;
    if (U && U.float && fs && sticky && dock > 0 && orbitRect && pT > 0.94) {
      const x = clamp(orbitRect.width / 2 - floatSize.w / 2, 8, Math.max(8, orbitRect.width - floatSize.w - 8));
      const y = Math.min(orbitRect.height - dock + 14, VH - orbitRect.top - floatSize.h - 12);
      floatPos.x = x;
      floatPos.y = y;
      floatPos.on = true;
    }
  }
  const floatPos = { x: 0, y: 0, on: false };

  // Where a star is on its way from the sky to its planet at progress p, for the page as it is
  // now (TX, TY on screen and the eased progress TE). A gentle swirl on the way down, so the
  // stars arrive like a flock, not on rails.
  let TX = 0;
  let TY = 0;
  let TE = 0;
  function travelAt(s, p) {
    const e = easeInOut(clamp((p - s.delay) / 0.7, 0, 1));
    const mx = (s.hx + s.ux) / 2 + (s.uy - s.hy) * 0.22 * s.swirl;
    const my = (s.hy + s.uy) / 2 - (s.ux - s.hx) * 0.12 * s.swirl;
    const v = 1 - e;
    TX = v * v * s.hx + 2 * v * e * mx + e * e * s.ux;
    TY = v * v * s.hy + 2 * v * e * my + e * e * s.uy;
    TE = e;
  }

  /* ---------- Drawing ---------- */
  const bodyOrder = [];
  function drawSphere(R, a) {
    if (a <= 0.01) return;
    if (QUALITY[tier].halo) {
      ctx.globalAlpha = a * 0.22;
      ctx.drawImage(GLOW, cx - R * 3, cy - R * 3, R * 6, R * 6);
    }
    const yaw = t * 0.25;
    const cyw = Math.cos(yaw);
    const syw = Math.sin(yaw);
    const pit = -0.4;
    const cp = Math.cos(pit);
    const sp2 = Math.sin(pit);
    ctx.fillStyle = SILVER;
    for (let k = 0; k < sphere.length; k++) {
      const [ux, uy, uz] = sphere[k];
      const x1 = ux * cyw + uz * syw;
      const z1 = -ux * syw + uz * cyw;
      const y2 = uy * cp - z1 * sp2;
      const z2 = uy * sp2 + z1 * cp;
      const dz = (z2 + 1) / 2;
      ctx.globalAlpha = a * (0.12 + 0.8 * dz * dz);
      const s = 0.8 + dz * 1.1;
      ctx.fillRect(cx + x1 * R - s / 2, cy + y2 * R - s / 2, s, s);
    }
  }

  function drawOrbits(alpha) {
    if (alpha <= 0.01) return;
    const segs = 120;
    const prog = reduced ? 1 : smooth((pT - 0.14) / 0.6);
    ctx.lineWidth = 1;
    for (let oi = 0; oi < ORBITS.length; oi++) {
      const R = ORBITS[oi].r * Rmax;
      const hl = stars.some((s) => s.orbit === oi && s.planet === uActive && uActive >= 0);
      const count = Math.ceil(segs * clamp(prog * 1.1 - oi * 0.05, 0, 1));
      if (!count) continue;
      for (let pass = 0; pass < 2; pass++) {
        ctx.beginPath();
        let open = false;
        for (let j = 0; j < count; j++) {
          const th0 = (j / segs) * TAU - Math.PI / 2;
          const th1 = ((j + 1) / segs) * TAU - Math.PI / 2;
          const back = Math.sin((th0 + th1) / 2) < 0;
          if (back !== (pass === 0)) {
            open = false;
            continue;
          }
          project(R, th0, 0);
          if (!open) {
            ctx.moveTo(OX, OY);
            open = true;
          }
          project(R, th1, 0);
          ctx.lineTo(OX, OY);
        }
        ctx.strokeStyle = hl ? ACCENT : pass === 0 ? LINE : '#4A4A5C';
        ctx.globalAlpha = alpha * (hl ? (pass === 0 ? 0.35 : 0.6) : pass === 0 ? 0.55 : 0.9);
        ctx.stroke();
      }
    }
  }

  // A star in the sky (look 0) or a planet in the universe (look 1), and anything between.
  function drawBody(s, x, y, look, alpha, inUniverse) {
    if (alpha <= 0.01) return;
    const q = QUALITY[tier];
    const lift = Math.min(1, s.act * 0.8 + s.prox * 0.35);
    const isPlanet = s.orbit >= 0;
    const rStar = s.rr * (1 + 0.2 * lift);
    const rr = isPlanet ? lerp(rStar, s.prr, look) : lerp(rStar, s.prr, look);
    const tw = reduced || inUniverse ? 1 : 0.84 + 0.16 * Math.sin(t * s.tw + s.twp);
    const mb = s.mag === 1 ? 1 : s.mag === 2 ? 0.8 : 0.62;
    const a = alpha * tw;
    if (q.halo) {
      const hs = isPlanet ? rr * (3.4 + 2 * look) : rr * (6.5 + 3 * lift) * (1 - look * 0.5);
      ctx.globalAlpha = Math.min(1, (0.16 * mb + 0.3 * lift) * a * (isPlanet ? 1 : 1 - look * 0.6));
      ctx.drawImage(HALO, x - hs, y - hs, hs * 2, hs * 2);
    }
    if (s.mag === 1 && look < 0.6) {
      const L = s.rr * (3.4 + 1.8 * lift);
      ctx.globalAlpha = (0.2 + 0.3 * lift) * a * (1 - look / 0.6);
      ctx.strokeStyle = SILVER;
      ctx.lineWidth = 0.6;
      ctx.beginPath();
      ctx.moveTo(x - L, y);
      ctx.lineTo(x + L, y);
      ctx.moveTo(x, y - L);
      ctx.lineTo(x, y + L);
      ctx.stroke();
    }
    if (isPlanet && look > 0.35 && rr > 3) {
      // Lit from the orb at the centre of the system, in the site's palette only.
      const dx = cx - x;
      const dy = cy - y;
      const dl = Math.sqrt(dx * dx + dy * dy) || 1;
      const hx = x + (dx / dl) * rr * 0.42;
      const hy = y + (dy / dl) * rr * 0.42 - rr * 0.12;
      const gr = ctx.createRadialGradient(hx, hy, rr * 0.05, hx, hy, rr * 1.9);
      gr.addColorStop(0, WHITE);
      gr.addColorStop(0.2, SILVER);
      gr.addColorStop(0.42, BODY);
      gr.addColorStop(0.68, LINE);
      gr.addColorStop(0.9, '#1C1C21');
      gr.addColorStop(1, '#0E0E10');
      ctx.globalAlpha = a * (0.55 + 0.45 * look);
      ctx.fillStyle = gr;
      ctx.beginPath();
      ctx.arc(x, y, rr, 0, TAU);
      ctx.fill();
      // A ring marks a hackathon result or the patent.
      if (PLANETS[s.planet]?.award) {
        ctx.strokeStyle = s.act > 0.5 ? ACCENT : `rgba(${SILVER_RGB},0.6)`;
        ctx.lineWidth = Math.max(0.9, rr * 0.12);
        ctx.globalAlpha = a * look;
        ctx.beginPath();
        ctx.ellipse(x, y, rr * 1.85, rr * 1.85 * Math.max(0.22, sinE * 0.45), -0.32, 0, TAU);
        ctx.stroke();
      }
    } else {
      ctx.globalAlpha = Math.min(1, (0.55 + 0.4 * mb) * a + lift * 0.3);
      ctx.fillStyle = lift > 0.45 ? WHITE : STRONG;
      ctx.beginPath();
      ctx.arc(x, y, Math.max(0.6, rr), 0, TAU);
      ctx.fill();
    }
    if (s.act > 0.01) {
      const ring = rr + 5 + 4 * (1 - s.act);
      if (inUniverse && q.halo) {
        ctx.globalAlpha = 0.45 * s.act;
        ctx.drawImage(GLOW_ACCENT, x - rr * 4, y - rr * 4, rr * 8, rr * 8);
      }
      ctx.globalAlpha = 0.9 * s.act * alpha;
      ctx.strokeStyle = ACCENT;
      ctx.lineWidth = 1.1;
      ctx.beginPath();
      ctx.arc(x, y, ring, 0, TAU);
      ctx.stroke();
    }
  }

  // The project stars on their way down: an accent rim and their name, so a visitor can follow
  // one from the sky to its planet. A name shows only where it has room: it fades out as it nears
  // any text (the hero's copy, the universe's heading and list), the nav, the AniBot button, the
  // hero card, a screen edge or the name of a star that left the sky before it. A moving name
  // looks ahead by its speed, so it has faded by the time it would get there. A jump nothing can
  // see coming (one wheel notch from rest, a page key) would put it on top of something: then the
  // name lets go of its star and fades out where it was, moving with the page like the text beside
  // it (or holding still on screen where the page would carry it under the nav or past an edge).
  // So a name always fades, never pops, and never covers anything. Names fade with time, never
  // with the scroll position, and the planets' own DOM labels only fade in once every name here is
  // gone (writeDom), so a name is never on screen twice. A held scroll position always settles on
  // the same picture.
  const LABEL_FONT = '500 12px "General Sans", "Segoe UI", Helvetica, Arial, sans-serif';
  const LABEL_END = 0.76; // canvas names fade out by here (the DOM labels start at 0.8)
  const ROOM_TEXT = 16; // px of clear space a name needs around it to show at full strength
  const ROOM_NAME = 12;
  const LOOK_AHEAD = 0.1; // s
  const FADE_IN = 6; // alpha per second
  const FADE_OUT = 12; // about five frames from full strength
  // Distance between two boxes (0 when they touch or overlap).
  const apart = (x0, y0, x1, y1, bx0, by0, bx1, by1) => {
    const dx = Math.max(0, bx0 - x1, x0 - bx1);
    const dy = Math.max(0, by0 - y1, y0 - by1);
    return Math.sqrt(dx * dx + dy * dy);
  };
  // Clear space between a name's box and what is fixed on screen: the edges, the nav and the
  // AniBot button.
  function screenRoom(x0, y0, x1, y1) {
    const room = Math.min(x0 - 8, W - 8 - x1, y0 - navBottom, VH - y1);
    return fabBox ? Math.min(room, apart(x0, y0, x1, y1, fabBox.x, fabBox.y, fabBox.r, fabBox.b)) : room;
  }
  // Clear space around a name's box: the screen (screenRoom), text, the hero card, and the first
  // `upto` boxes of other names this frame (only the drawn ones with `drawnOnly`). 0 or less: it
  // touches something. With `noScreen` the screen is left out.
  function nameRoom(x0, y0, x1, y1, upto, drawnOnly, noScreen) {
    let room = noScreen ? Infinity : screenRoom(x0, y0, x1, y1);
    if (room <= 0) return room;
    if (H) {
      for (const b of heroText) {
        room = Math.min(room, apart(x0, y0, x1, y1, b.x + heroLeft, b.y + heroTop, b.r + heroLeft, b.b + heroTop));
        if (room <= 0) return 0;
      }
      if (cardBox.until > frameNow) room = Math.min(room, apart(x0, y0, x1, y1, cardBox.x + heroLeft, cardBox.y + heroTop, cardBox.r + heroLeft, cardBox.b + heroTop));
    }
    if (U && stageRect) {
      const sx = stageRect.left;
      const sy = stageRect.top;
      for (const b of uniText) {
        room = Math.min(room, apart(x0, y0, x1, y1, b.x + sx, b.y + sy, b.r + sx, b.b + sy));
        if (room <= 0) return 0;
      }
    }
    for (let k = 0; k < upto && room > 0; k++) {
      const o = labelBox[k];
      if (!drawnOnly || o[5]) room = Math.min(room, apart(x0, y0, x1, y1, o[0], o[1], o[2], o[3]));
    }
    return room;
  }
  const MIN_ROOM = 1;
  // Where a star takes its name within one step of the page either way (48px of scroll, more than
  // a wheel notch), sampled along the path: scroll offsets, and the boxes' top-left corners
  // relative to the page as it is now (stored after a name's box; one that let go stays put).
  const PATH = [-48, -36, -24, -12, 12, 24, 36, 48];
  const BOX = 6 + PATH.length * 2;
  let boxCount = 0;
  // A name's box this frame: [x0, y0, x1, y1, its look-ahead, drawn, ...its path].
  const pushBox = (x0, y0, x1, y1, ahead, drawn) => {
    const box = labelBox[boxCount] || (labelBox[boxCount] = new Array(BOX).fill(0));
    box[0] = x0;
    box[1] = y0;
    box[2] = x1;
    box[3] = y1;
    box[4] = ahead;
    box[5] = drawn;
    for (let k = 6; k < BOX; k += 2) {
      box[k] = x0;
      box[k + 1] = y0;
    }
    return boxCount++;
  };
  const nameWidth = (name) => {
    let w = labelW.get(name);
    if (w === undefined) {
      w = ctx.measureText(name).width;
      labelW.set(name, w);
    }
    return w;
  };
  function drawName(s, x, y, a) {
    s.la = a;
    s.lx = x;
    s.ly = y;
    s.lc = H ? heroTop : stageRect ? stageRect.top : 0;
    namesOn = true;
    ctx.globalAlpha = 0.85 * a;
    ctx.strokeStyle = '#010103';
    ctx.lineWidth = 4;
    ctx.strokeText(s.name, x, y);
    ctx.globalAlpha = a;
    ctx.fillStyle = STRONG;
    ctx.fillText(s.name, x, y);
  }
  // A name that let go of its star: where it fades this frame. With the page if that is clear,
  // else holding still on screen, else part of the way (a long jump of the page can bring text to
  // one place and another name to the other); null: nowhere clear, the last resort.
  const LET_GO = [1, 0, 0.5, 0.25, 0.75];
  function letGoY(s, w, upto, drawnOnly) {
    const pageTop = H ? heroTop : stageRect ? stageRect.top : 0;
    const moved = pageTop - s.lc;
    for (const f of LET_GO) {
      const y = s.ly + moved * f;
      if (nameRoom(s.lx - 2, y - 9, s.lx + w + 2, y + 9, upto, drawnOnly) >= MIN_ROOM) return y;
      if (!moved) break;
    }
    return null;
  }
  // Clear space for a name's box at (x, y) on the page as it is now, after the page moved by `dy`
  // px of scroll: the text has not moved, the screen has (by dy), and the shown names earlier in
  // the order are where their stars take them (sample k of their path).
  function spotRoom(x, y, w, dy, k, upto) {
    let room = Math.min(screenRoom(x, y - dy, x + w, y - dy + 18), nameRoom(x, y, x + w, y + 18, 0, false, true));
    for (let j = 0; j < upto && room > 0; j++) {
      const o = labelBox[j];
      if (o[5]) room = Math.min(room, apart(x, y, x + w, y + 18, o[6 + k * 2], o[7 + k * 2], o[6 + k * 2] + o[2] - o[0], o[7 + k * 2] + o[3] - o[1]));
    }
    return room;
  }
  function drawTravellers() {
    const go = smooth((pT - 0.02) / 0.08);
    // A late frame (a busy main thread) fades no further than a quarter step, never all at once.
    const out = Math.min(0.25, FADE_OUT * Math.max(frameDt, 1 / 240));
    for (const s of planetStar) {
      if (!s || !s.placed) continue;
      const e = s.pe || 0;
      const rim = go * (1 - smooth((e - 0.82) / 0.18));
      if (rim > 0.01) {
        ctx.globalAlpha = 0.8 * rim;
        ctx.strokeStyle = ACCENT;
        ctx.lineWidth = 1.1;
        ctx.beginPath();
        ctx.arc(s.px, s.py, lerp(s.rr, s.prr, e) + 4.5, 0, TAU);
        ctx.stroke();
      }
    }
    // Names show once a star has left its place in the sky, not while it still sits there.
    const fade = go * (1 - smooth((pT - (LABEL_END - 0.14)) / 0.14)) * (1 - dim);
    ctx.font = LABEL_FONT;
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    boxCount = 0;
    const dt = Math.max(frameDt, 1 / 240);
    // First the names that already let go of their star: they keep their place while they fade.
    for (const s of travelOrder) {
      if (!s.lg) continue;
      const w = nameWidth(s.name);
      const y = letGoY(s, w, boxCount, true);
      const a = y === null ? 0 : Math.max(0, s.la - out);
      s.lpx = NaN;
      s.lv = 0;
      if (a <= 0.01) {
        s.la = 0;
        s.lg = false;
        continue;
      }
      pushBox(s.lx - 2, y - 9, s.lx + w + 2, y + 9, 0, 1);
      drawName(s, s.lx, y, a);
    }
    // Then the names on their stars, in the order the stars left the sky.
    for (const s of travelOrder) {
      if (s.lg) continue;
      const e = s.pe || 0;
      const base = s.placed ? fade * smooth(e / 0.18) : 0;
      if (base <= 0.001 && s.la <= 0.01) {
        s.la = 0;
        s.lv = 0;
        s.lpx = NaN;
        continue;
      }
      const w = nameWidth(s.name);
      // The star's speed, held at its peak and let go slowly, like the page's.
      const v = Number.isNaN(s.lpx) ? 0 : Math.hypot(s.px - s.lpx, s.py - s.lpy) / dt;
      s.lv = Math.max(v, s.lv * Math.exp(-dt * 8));
      s.lpx = s.px;
      s.lpy = s.py;
      const ahead = Math.min(400, (s.lv + pageV) * LOOK_AHEAD);
      // Its place beside the star (the drawn box, with the dark outline around the letters). It
      // is kept for it even while it is hidden, so a later name never sits where this one would
      // fade in.
      const x = s.px + lerp(s.rr, s.prr, e) + 9;
      const x0 = x - 2;
      const x1 = x + w + 2;
      const y0 = s.py - 9;
      const y1 = s.py + 9;
      const room = nameRoom(x0, y0, x1, y1, 0, false);
      let want = base * smooth((room - ahead) / ROOM_TEXT);
      let free = room >= MIN_ROOM;
      const before = boxCount;
      for (let k = 0; k < before; k++) {
        const o = labelBox[k];
        const d = apart(x0, y0, x1, y1, o[0], o[1], o[2], o[3]);
        want *= smooth((d - ahead - o[4]) / ROOM_NAME);
        if (d < MIN_ROOM) free = false;
      }
      const mine = pushBox(x0, y0, x1, y1, ahead, 0);
      // One step of the page either way, this name must still have somewhere clear to be: beside
      // its star, or where it is now, moving with the page or holding still on screen. Where it
      // would not, it makes room now, while it can still fade.
      const path = labelBox[mine];
      for (let k = 0; k < PATH.length; k++) {
        travelAt(s, clamp(pT + PATH[k] / Math.max(1, pSpan), 0, 1));
        path[6 + k * 2] = TX + lerp(s.rr, s.prr, TE) + 7;
        path[7 + k * 2] = TY - 9;
      }
      let safe = Infinity;
      for (let k = 0; k < PATH.length && safe > 2; k++) {
        const dy = PATH[k];
        let best = spotRoom(path[6 + k * 2], path[7 + k * 2], x1 - x0, dy, k, before);
        if (best < ROOM_NAME + 2) best = Math.max(best, spotRoom(x0, y0, x1 - x0, dy, k, before));
        if (best < ROOM_NAME + 2) best = Math.max(best, spotRoom(x0, y0 + dy, x1 - x0, dy, k, before));
        if (best < safe) safe = best;
      }
      want *= smooth((safe - 2) / ROOM_NAME);
      if (free) {
        const a = want > s.la ? Math.min(want, s.la + Math.min(0.25, FADE_IN * dt)) : Math.max(want, s.la - out);
        if (a > 0.01) {
          labelBox[mine][5] = 1;
          drawName(s, x, s.py, a);
        } else s.la = 0;
      } else if (s.la > 0.01) {
        // Its star moved it onto something in one step: let go and fade out where it was.
        const y = letGoY(s, w, before, true);
        const a = y === null ? 0 : Math.max(0, s.la - out);
        if (a > 0.01) {
          s.lg = true;
          s.lpx = NaN;
          s.lv = 0;
          pushBox(s.lx - 2, y - 9, s.lx + w + 2, y + 9, 0, 1);
          drawName(s, s.lx, y, a);
        } else s.la = 0;
      } else s.la = 0;
    }
  }

  // A thin line from the picked planet to its docked card, bowed away from the centre.
  function drawLeader() {
    const s = planetStar[uActive];
    if (!s || s.act < 0.02 || !orbitRect) return;
    const fx0 = orbitRect.left + floatPos.x;
    const ty = orbitRect.top + floatPos.y - 3;
    const tx = clamp(s.ux, fx0 + 28, fx0 + floatSize.w - 28);
    const fromC = Math.atan2(s.uy - cy, s.ux - cx);
    const sx = s.ux + Math.cos(fromC) * (s.prr + 7);
    const sy = s.uy + Math.sin(fromC) * (s.prr + 7);
    const mx = (sx + tx) / 2;
    const my = (sy + ty) / 2;
    const side = sx >= cx ? 1 : -1;
    const bow = Math.min(Rmax * 0.6, Math.abs(ty - sy) * 0.35 + 30);
    ctx.globalAlpha = 0.5 * s.act;
    ctx.strokeStyle = ACCENT;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(sx, sy);
    ctx.quadraticCurveTo(mx + side * bow, my, tx, ty);
    ctx.stroke();
    ctx.globalAlpha = 0.9 * s.act;
    ctx.fillStyle = ACCENT;
    ctx.beginPath();
    ctx.arc(tx, ty, 2, 0, TAU);
    ctx.fill();
  }

  function draw() {
    namesOn = false;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (regionBottom < 0 || regionTop > VH + 40) return false;
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, Math.max(0, regionTop), W, Math.max(0, regionBottom - Math.max(0, regionTop)));
    ctx.clip();
    const fade = reduced ? 1 : smooth(t / 1.6);
    const heroVis = 1 - 0.72 * dim;

    // Dust: the hero's sky, then the universe's.
    if (H && heroDustOK) {
      ctx.globalAlpha = fade * (reduced ? 1 : 1 - 0.5 * smooth(pT * 1.5)) * heroVis;
      ctx.drawImage(heroDust, heroLeft, heroTop, heroDust.width, heroDust.height);
    }
    if (U && uniDustOK && stageRect) {
      ctx.globalAlpha = reduced ? 1 : smooth(pT * 1.8);
      ctx.drawImage(uniDust, stageRect.left, stageRect.top, uniDust.width, uniDust.height);
    }

    // Constellation figures, a faint chart that fades as the stars set off.
    // Constellation figures stay while the first half of the hero leaves, so the sky is still a
    // sky when the stars start to move.
    const figA = (reduced ? 1 : smooth((t - 0.9) / 1.4)) * (reduced ? 1 : 1 - smooth(pT / 0.5)) * heroVis;
    if (figA > 0.01) {
      ctx.lineCap = 'round';
      ctx.strokeStyle = SILVER;
      ctx.lineWidth = W < 720 ? 0.9 : 0.75;
      for (const [ai, bi] of edges) {
        const A = stars[ai];
        const B = stars[bi];
        const dx = B.hx - A.hx;
        const dy = B.hy - A.hy;
        const d = Math.sqrt(dx * dx + dy * dy);
        const ga = A.rr + 6;
        const gb = B.rr + 6;
        if (d <= ga + gb + 2) continue;
        const near = Math.max(A.prox, B.prox);
        const al = (0.08 + 0.26 * near * near + 0.1 * Math.max(A.act, B.act)) * figA * Math.min(A.ign, B.ign);
        if (al < 0.004) continue;
        ctx.globalAlpha = Math.min(0.6, al);
        ctx.beginPath();
        ctx.moveTo(A.hx + (dx / d) * ga, A.hy + (dy / d) * ga);
        ctx.lineTo(B.hx - (dx / d) * gb, B.hy - (dy / d) * gb);
        ctx.stroke();
      }
    }

    // Tethers: the closest few stars reach toward the pointer and fade before touching it.
    if (!reduced && presence > 0.02 && pT < 0.04) {
      const near = stars.filter((s) => s.placed && s.prox > 0.04).sort((a, b) => b.prox - a.prox).slice(0, 4);
      for (const s of near) {
        const dx = P.sx - s.hx;
        const dy = P.sy - s.hy;
        const d = Math.sqrt(dx * dx + dy * dy);
        if (d < s.rr + 24) continue;
        const ux = dx / d;
        const uy = dy / d;
        const x0 = s.hx + ux * (s.rr + 5);
        const y0 = s.hy + uy * (s.rr + 5);
        const x1 = P.sx - ux * 14;
        const y1 = P.sy - uy * 14;
        const gr = ctx.createLinearGradient(x0, y0, x1, y1);
        gr.addColorStop(0, `rgba(${SILVER_RGB},1)`);
        gr.addColorStop(1, `rgba(${SILVER_RGB},0)`);
        ctx.strokeStyle = gr;
        ctx.lineWidth = 0.9;
        ctx.globalAlpha = 0.36 * s.prox * s.prox * s.ign;
        ctx.beginPath();
        ctx.moveTo(x0, y0);
        ctx.lineTo(x1, y1);
        ctx.stroke();
      }
    }

    // The universe: orbits, the centre orb, then the bodies back to front.
    const uA = U ? (reduced ? 1 : smooth((pT - 0.12) / 0.55)) : 0;
    const showU = U && orbitRect && orbitRect.bottom > -40 && orbitRect.top < VH + 40;
    if (showU) drawOrbits(uA);

    const bodies = bodyOrder;
    bodies.length = 0;
    for (const s of stars) bodies.push(s);
    if (U) bodies.sort((a, b) => a.uz - b.uz);
    let centerDrawn = !showU;
    for (const s of bodies) {
      if (!centerDrawn && s.uz >= 0) {
        drawSphere(Rmax * 0.12, (reduced ? 1 : smooth((pT - 0.4) / 0.4)) * 0.9);
        centerDrawn = true;
      }
      if (reduced || !U) {
        // No travel: the sky stays in the hero and the planets wait in the universe.
        if (s.placed) drawBody(s, s.hx, s.hy, 0, s.ign * heroVis, false);
        if (showU) drawBody(s, s.ux, s.uy, 1, s.orbit >= 0 ? 1 : 0.4 + 0.3 * (s.uz + 1) * 0.5, true);
        continue;
      }
      travelAt(s, pT);
      const e = TE;
      const x = TX;
      const y = TY;
      const heroA = s.placed ? s.ign * heroVis : 0;
      const uniA = s.orbit >= 0 ? 1 : 0.35 + 0.35 * (s.uz + 1) * 0.5;
      drawBody(s, x, y, e, lerp(heroA, uniA, e), e > 0.5);
      s.px = x;
      s.py = y;
      s.pe = e;
    }
    if (!centerDrawn) drawSphere(Rmax * 0.12, (reduced ? 1 : smooth((pT - 0.4) / 0.4)) * 0.9);
    if (!reduced && U) drawTravellers();
    if (floatPos.on) drawLeader();
    ctx.restore();
    ctx.globalAlpha = 1;
    return true;
  }

  /* ---------- DOM: the hero card, planet labels, the floating card ---------- */
  const lastStyle = new WeakMap();
  const place = (el, x, y, o) => {
    if (!el) return;
    const tr = `translate3d(${Math.round(x)}px,${Math.round(y)}px,0)`;
    const op = o.toFixed(3);
    const prev = lastStyle.get(el);
    if (prev && prev[0] === tr && prev[1] === op) return;
    lastStyle.set(el, [tr, op]);
    el.style.transform = tr;
    el.style.opacity = op;
    el.style.visibility = o > 0.01 ? 'visible' : 'hidden';
  };
  // Fade out where it stands (the card's own CSS transition does the fade).
  const hide = (el) => {
    if (!el || el.style.opacity === '0') return;
    const prev = lastStyle.get(el);
    lastStyle.set(el, [prev ? prev[0] : '', '0.000']);
    el.style.opacity = '0';
    el.style.visibility = 'hidden';
  };
  const boxes = [];
  const overlap = (a, b) => Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));

  function writeDom() {
    // Hero card, beside its star, inside the hero.
    if (H?.card) {
      const s = heroActive >= 0 ? stars[heroActive] : null;
      if (s) {
        const c = cardPos(s);
        place(H.card, c.x, c.y, 1);
        // The travelling names keep clear of it, also while its fade-out runs.
        cardBox.x = c.x;
        cardBox.y = c.y;
        cardBox.r = c.x + cardSize.w;
        cardBox.b = c.y + cardSize.h;
        cardBox.until = frameNow + 400;
      } else hide(H.card);
    }
    if (!U) return;
    // The planets' labels take over from the travelling names: they wait until every name on the
    // canvas is gone, then fade in.
    domGate = reduced ? 1 : namesOn ? 0 : Math.min(1, domGate + 6 * frameDt);
    const labA = (reduced ? 1 : smooth((pT - 0.8) / 0.18)) * domGate;
    // Planet labels: nearest first, each on the side that covers the least.
    const planets = planetStar.filter(Boolean).slice().sort((a, b) => b.uz - a.uz);
    boxes.length = 0;
    for (const s of planets) {
      const el = U.labels[s.planet];
      const sz = labelSize[s.planet] || { w: 80, h: 22 };
      if (!el) continue;
      const lx = s.ux - orbitRect.left;
      const ly = s.uy - orbitRect.top;
      const gap = s.prr * (PLANETS[s.planet]?.award ? 2.1 : 1.3) + 6;
      // Outward from the centre first (labels never crowd the core), then the other sides.
      const ox = cx - orbitRect.left;
      const oy = cy - orbitRect.top;
      const rx = lx - ox;
      const ry = ly - oy;
      const side = { x: rx >= 0 ? lx + gap : lx - gap - sz.w, y: ly - sz.h / 2 };
      const flip = { x: rx >= 0 ? lx - gap - sz.w : lx + gap, y: ly - sz.h / 2 };
      const vert = { x: lx - sz.w / 2, y: ry >= 0 ? ly + gap * 0.8 : ly - gap * 0.8 - sz.h };
      const vflip = { x: lx - sz.w / 2, y: ry >= 0 ? ly - gap * 0.8 - sz.h : ly + gap * 0.8 };
      const cands = Math.abs(rx) * sinE >= Math.abs(ry) ? [side, vert, vflip, flip] : [vert, side, flip, vflip];
      let best = cands[0];
      let bestCost = Infinity;
      for (let ci = 0; ci < cands.length; ci++) {
        const c = cands[ci];
        const b = { x: c.x, y: c.y, w: sz.w, h: sz.h };
        let cost = ci * 25;
        if (b.x < -orbitRect.left + 4 || b.x + b.w > W - orbitRect.left - 4) cost += 1e6;
        if (clipOrbit && (b.x < 2 || b.x + b.w > orbitRect.width - 2 || b.y < 2 || b.y + b.h > orbitRect.height - 2)) cost += 1e6;
        for (const o of boxes) cost += overlap(b, o) * 10;
        for (const p of planets) {
          if (p === s) continue;
          const pr = p.prr * (PLANETS[p.planet]?.award ? 1.9 : 1) + 4;
          cost += overlap(b, { x: p.ux - orbitRect.left - pr, y: p.uy - orbitRect.top - pr, w: pr * 2, h: pr * 2 }) * 6;
        }
        const cr = Rmax * 0.16;
        cost += overlap(b, { x: ox - cr, y: oy - cr, w: cr * 2, h: cr * 2 }) * 3;
        // A ring running through the text makes it hard to read.
        const k = 1 / Math.max(0.2, sinE);
        let rMin = Infinity;
        let rMax = 0;
        for (const [px2, py2] of [
          [b.x, b.y],
          [b.x + b.w, b.y],
          [b.x, b.y + b.h],
          [b.x + b.w, b.y + b.h],
          [b.x + b.w / 2, b.y + b.h / 2],
        ]) {
          const r = Math.hypot(px2 - ox, (py2 - oy) * k);
          if (r < rMin) rMin = r;
          if (r > rMax) rMax = r;
        }
        for (const orb of ORBITS) {
          const R = orb.r * Rmax;
          if (R > rMin && R < rMax) cost += 60;
        }
        if (cost < bestCost) {
          bestCost = cost;
          best = c;
        }
      }
      boxes.push({ x: best.x, y: best.y, w: sz.w, h: sz.h });
      const depthA = 0.62 + 0.38 * smooth((s.uz + 0.8) / 1.6);
      const isAct = s.planet === uActive;
      const dimOthers = uActive >= 0 && !isAct ? 0.55 : 1;
      place(el, best.x, best.y, labA * (isAct ? 1 : depthA * dimOthers));
      if (el.dataset.on !== String(isAct)) el.dataset.on = String(isAct);
    }
    // The picked planet's card, in its slot under the system (see update()).
    if (U.float) {
      if (floatPos.on && labA > 0.5) place(U.float, floatPos.x, floatPos.y, 1);
      else hide(U.float);
    }
  }

  /* ---------- Loop ---------- */
  let raf = 0;
  let timer = 0;
  let lastDraw = 0;
  let running = false;
  let visibleDoc = !document.hidden;
  let cost = 2;
  let frames = 0;
  let slowFrames = 0;
  let destroyed = false;
  let failedOnce = false;

  function busy(nowMs) {
    return nowMs - lastScroll < 900 || nowMs - P.last < 1600 || t < 4.5 || (pT > 0.001 && pT < 0.999) || Math.abs(dim - dimTarget) > 0.01;
  }

  function frame(now) {
    raf = 0;
    if (!running || destroyed) return;
    const fast = busy(now);
    const gap = 1000 / (fast ? 60 : 30);
    if (now - lastDraw < gap * 0.7) {
      raf = requestAnimationFrame(frame);
      return;
    }
    const dt = Math.min(0.1, (now - lastDraw) / 1000 || 1 / 60);
    if (now - lastDraw > gap * 1.25 + 4 && now - lastDraw < 250 && fast) slowFrames++;
    frames++;
    lastDraw = now;
    const c0 = performance.now();
    let visible = true;
    try {
      update(dt, now);
      visible = draw();
      writeDom();
    } catch (err) {
      fail(err);
      return;
    }
    cost = cost * 0.9 + (performance.now() - c0) * 0.1;
    if (frames >= 90) {
      if ((slowFrames > 30 || cost > 8) && tier > 0) {
        tier--;
        layoutDirty = true;
      }
      frames = 0;
      slowFrames = 0;
    }
    // Stop when nothing is on screen, or after a quiet spell (a still frame stays up).
    const idleFor = now - lastInput;
    if (!visible || reduced || (!fast && idleFor > (MQ_HOVER.matches ? 30000 : 15000))) {
      running = false;
      return;
    }
    if (fast) raf = requestAnimationFrame(frame);
    else {
      clearTimeout(timer);
      timer = setTimeout(() => {
        if (running) raf = requestAnimationFrame(frame);
      }, gap - 4);
    }
  }

  function wake() {
    if (destroyed || !visibleDoc) return;
    if (running) return;
    running = true;
    if (!lastDraw) lastDraw = performance.now() - 16;
    raf = requestAnimationFrame(frame);
  }

  const input = () => {
    lastInput = performance.now();
    wake();
  };

  /* ---------- Events ---------- */
  const listeners = [];
  const on = (target, type, fn, opts) => {
    target.addEventListener(type, fn, opts);
    listeners.push(() => target.removeEventListener(type, fn, opts));
  };
  on(
    window,
    'scroll',
    () => {
      lastScroll = performance.now();
      input();
    },
    { passive: true },
  );
  on(
    window,
    'resize',
    () => {
      layoutDirty = true;
      input();
    },
    { passive: true },
  );
  on(
    window,
    'pointermove',
    (e) => {
      P.x = e.clientX;
      P.y = e.clientY;
      P.mouse = e.pointerType === 'mouse';
      P.last = performance.now();
      if (H && P.mouse && P.y < heroTop + band.y + band.h + 40 && P.y > heroTop) P.seen = true;
      // Universe hover: planets by distance, the labels and the card by their own events.
      if (U && orbitRect && pT > 0.94 && P.mouse) {
        let hit = -1;
        let hd = 1e9;
        for (const s of planetStar) {
          if (!s) continue;
          const d = Math.hypot(P.x - s.ux, P.y - s.uy);
          if (d < s.prr + 16 && d < hd) {
            hd = d;
            hit = s.planet;
          }
        }
        if (hit >= 0) uHover = hit;
        else if (!overFloat && !(e.target && e.target.closest && e.target.closest('.u-label'))) uHover = -1;
        U.orbit.classList.toggle('is-over', hit >= 0);
      }
      input();
    },
    { passive: true },
  );
  on(window, 'keydown', input, { passive: true });
  on(document, 'visibilitychange', () => {
    visibleDoc = !document.hidden;
    if (visibleDoc) input();
    else {
      running = false;
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
    }
  });
  const onReduce = () => {
    reduced = MQ_REDUCE.matches;
    layoutDirty = true;
    input();
  };
  if (MQ_REDUCE.addEventListener) {
    MQ_REDUCE.addEventListener('change', onReduce);
    listeners.push(() => MQ_REDUCE.removeEventListener('change', onReduce));
  }
  let ro = null;
  if ('ResizeObserver' in window) {
    ro = new ResizeObserver(() => {
      layoutDirty = true;
      input();
    });
    ro.observe(canvas);
  }
  if (document.fonts && document.fonts.addEventListener) {
    on(document.fonts, 'loadingdone', () => {
      layoutDirty = true;
      input();
    });
  }

  // Taps and clicks: a star or planet pins its card; anywhere else lets go.
  const heroDown = (e) => {
    if (!H || pT > 0.04) return;
    if (e.target.closest && e.target.closest('a, button, input, textarea, .sky-card')) return;
    const x = e.clientX;
    const y = e.clientY;
    let hit = -1;
    let hd = e.pointerType === 'mouse' ? 26 : 38;
    for (const s of stars) {
      if (!s.placed) continue;
      const d = Math.hypot(x - s.hx, y - s.hy);
      if (d < hd) {
        hd = d;
        hit = s.i;
      }
    }
    heroPinned = hit;
    P.seen = true;
    input();
  };
  const uniDown = (e) => {
    if (!U || pT < 0.94) return;
    if (e.target.closest && e.target.closest('a, button, .u-float')) return;
    let hit = -1;
    let hd = 1e9;
    for (const s of planetStar) {
      if (!s) continue;
      const d = Math.hypot(e.clientX - s.ux, e.clientY - s.uy);
      if (d < s.prr + (e.pointerType === 'mouse' ? 16 : 26) && d < hd) {
        hd = d;
        hit = s.planet;
      }
    }
    const label = e.target.closest && e.target.closest('.u-label');
    if (label) hit = Number(label.dataset.i);
    uPinned = hit;
    uHover = hit;
    if (hit >= 0) {
      uActive = -2; // force a report with the tap as its source
      setUActive(hit, 'tap');
    }
    input();
  };

  const cleanupHero = [];
  const cleanupUni = [];

  /* ---------- Data ---------- */
  setData(buildStars([]));
  loadArticles().then((list) => {
    if (destroyed) return;
    setData(buildStars(list));
  });
  requestAnimationFrame(() => {
    canvas.classList.add('on');
    document.documentElement.classList.add('sky-on');
  });
  wake();

  function fail(err) {
    console.warn('Story sky disabled:', err);
    failedOnce = true;
    api.destroy();
    document.documentElement.dataset.story = 'off';
  }

  const api = {
    setHero(h) {
      cleanupHero.splice(0).forEach((f) => f());
      H = h;
      heroActive = -1;
      heroPinned = -1;
      if (h) {
        h.hero.addEventListener('pointerdown', heroDown);
        cleanupHero.push(() => h.hero.removeEventListener('pointerdown', heroDown));
        if (h.card) {
          const enter = () => {
            overCard = true;
          };
          const leave = () => {
            overCard = false;
          };
          h.card.addEventListener('pointerenter', enter);
          h.card.addEventListener('pointerleave', leave);
          cleanupHero.push(() => {
            h.card.removeEventListener('pointerenter', enter);
            h.card.removeEventListener('pointerleave', leave);
          });
        }
      }
      layoutDirty = true;
      input();
    },
    setUniverse(u) {
      cleanupUni.splice(0).forEach((f) => f());
      U = u;
      uActive = -1;
      uPinned = -1;
      uHover = -1;
      uList = -1;
      if (u) {
        u.stage.addEventListener('pointerdown', uniDown);
        cleanupUni.push(() => u.stage.removeEventListener('pointerdown', uniDown));
        // Its text can move without the window resizing (the list grows when write-ups arrive),
        // and the travelling names steer by the cached boxes.
        if (ro) {
          ro.observe(u.stage);
          cleanupUni.push(() => ro.unobserve(u.stage));
        }
        const labelEnter = (e) => {
          const el = e.target.closest && e.target.closest('.u-label');
          if (el && e.pointerType === 'mouse') uHover = Number(el.dataset.i);
        };
        u.orbit.addEventListener('pointerover', labelEnter);
        cleanupUni.push(() => u.orbit.removeEventListener('pointerover', labelEnter));
        if (u.float) {
          const enter = () => {
            overFloat = true;
          };
          const leave = () => {
            overFloat = false;
          };
          u.float.addEventListener('pointerenter', enter);
          u.float.addEventListener('pointerleave', leave);
          cleanupUni.push(() => {
            u.float.removeEventListener('pointerenter', enter);
            u.float.removeEventListener('pointerleave', leave);
          });
        }
        document.documentElement.dataset.story = 'on';
      }
      layoutDirty = true;
      input();
    },
    setDim(v) {
      dimTarget = clamp(v, 0, 1);
      if (dimTarget > 0.5) heroPinned = -1;
      input();
    },
    // From the project list: hover or focus a row to light its planet (-1 lets go).
    setUniverseActive(i) {
      uList = i;
      if (i < 0) uPinned = -1;
      input();
    },
    unpinHero() {
      heroPinned = -1;
      input();
    },
    relayout() {
      layoutDirty = true;
      input();
    },
    get failed() {
      return failedOnce;
    },
    destroy() {
      destroyed = true;
      running = false;
      if (raf) cancelAnimationFrame(raf);
      clearTimeout(timer);
      listeners.forEach((f) => f());
      cleanupHero.forEach((f) => f());
      cleanupUni.forEach((f) => f());
      ro?.disconnect();
      canvas.remove();
      document.documentElement.classList.remove('sky-on');
    },
  };
  return api;
}
