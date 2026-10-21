// Name-to-orb: the hero name dissolves into particles that flow into one glowing orb (AniBot's
// voice), and flies home to rebuild the name when the call ends. Ported from the approved mockup
// (.claude/hero-mockups/name-to-orb.html). The simulated script is gone: the orb is driven by
// levels() from the real voice call (src/components/hero/voiceCall.js).
//
// No libraries, Canvas 2D only. The canvas covers only the name and the orb, never the whole hero.
// Particles live in typed arrays and are drawn from one sprite atlas, sorted into 32 buckets, so a
// frame does no allocation and never touches fillStyle in the particle loop. The loop runs only
// while something moves, and stops when the tab is hidden or the hero is offscreen. Adaptive
// quality steps the canvas resolution and particle count down on a slow device and back up.
//
// The React hero owns every class name. The engine reports what it does through callbacks:
//   onPhase('rest' | 'forming' | 'live' | 'returning' | 'settling')
//   onNameOut(bool)  hide the DOM name (true when the particles take over, false as they land)
//   onFail(error)    something threw: the hero drops to its static orb

const TAU = Math.PI * 2;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const ease = (u) => (u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2);
const smooth = (u) => u * u * (3 - 2 * u);
const bez = (p0, p1, p2, p3, e) => {
  const v = 1 - e;
  return v * v * v * p0 + 3 * v * v * e * p1 + 3 * v * e * e * p2 + e * e * e * p3;
};

const HOME = 0; // resting in the letter (invisible at rest unless shimmering)
const IN = 1; // waiting to leave, or flying to the orb
const ORB = 2; // part of the sphere
const OUT = 3; // waiting in the orb, or flying home
const NBK = 32; // 4 colours x 8 alpha levels
const SKIP = 255;
const COLORS = [
  [190, 193, 207],
  [213, 216, 234],
  [255, 255, 255],
  [74, 222, 128],
]; // #BEC1CF, #D5D8EA, white, the site's live-dot green
const FK = ['hx', 'hy', 'px', 'py', 'sz', 'ux', 'uy', 'uz', 'rb', 'ph', 'rd', 'dn', 'ro', 'lw', 'fd', 'f0x', 'f0y', 'ft0'];

export function createNameOrb({ hero, nameEl, canvas, slot, levels, onPhase, onNameOut, onFail }) {
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('no 2d context');

  let destroyed = false;
  let state = 'rest';
  let t = 0;
  let ready = false;
  let wantStart = false;
  let settleT = 0;
  let nameOut = false;
  const listeners = [];
  const on = (target, type, fn, opts) => {
    target.addEventListener(type, fn, opts);
    listeners.push(() => target.removeEventListener(type, fn, opts));
  };

  const setPhase = (s) => {
    if (state === s) return;
    state = s;
    onPhase?.(s);
  };
  const setNameOut = (v) => {
    if (nameOut === v) return;
    nameOut = v;
    onNameOut?.(v);
  };

  /* ---------- Voice levels, smoothed per frame ---------- */
  // amp/hiS: AniBot's voice. uAmp: the visitor's voice. gain: speaking. lgain: listening. kgain: thinking.
  const sp = { amp: 0, uAmp: 0, hiS: 0, gain: 0, lgain: 0, kgain: 0 };
  const voiceStep = (dt) => {
    const L = (levels && levels()) || null;
    const k = dt * 60;
    const speaking = !!(L && L.speaking);
    const listening = !!(L && L.listening);
    const thinking = !!(L && L.thinking);
    const bEnv = speaking ? clamp(L.speak || 0, 0, 1) : 0;
    const uEnv = listening ? clamp(L.user || 0, 0, 1) : 0;
    const hi = speaking ? clamp(L.hi || 0, 0, 1) : 0;
    sp.amp += (bEnv - sp.amp) * (1 - Math.pow(bEnv > sp.amp ? 0.45 : 0.8, k));
    sp.uAmp += (uEnv - sp.uAmp) * (1 - Math.pow(uEnv > sp.uAmp ? 0.5 : 0.82, k));
    sp.hiS += (hi - sp.hiS) * (1 - Math.pow(0.6, k));
    sp.gain += ((speaking ? 1 : 0) - sp.gain) * (1 - Math.pow(0.93, k));
    sp.lgain += ((listening ? 1 : 0) - sp.lgain) * (1 - Math.pow(0.92, k));
    sp.kgain += ((thinking ? 1 : 0) - sp.kgain) * (1 - Math.pow(0.94, k));
  };

  /* ---------- Particles ---------- */
  const P = {};
  let N = 0;
  let CAP = 0;
  const ensureCap = (n) => {
    if (n <= CAP) return;
    const cap = Math.ceil(n * 1.25);
    for (const key of FK) P[key] = new Float32Array(cap);
    P.tn = new Uint8Array(cap);
    P.md = new Uint8Array(cap);
    P.bk = new Uint8Array(cap);
    P.ord = new Int32Array(cap);
    CAP = cap;
  };
  const bcnt = new Int32Array(NBK);
  const boff = new Int32Array(NBK);
  const bpos = new Int32Array(NBK);

  /* ---------- Layout ---------- */
  let W = 0;
  let H = 0;
  let DPR = 1;
  const lowEnd = (navigator.hardwareConcurrency || 8) <= 4 || (navigator.deviceMemory || 8) <= 4;
  let q = lowEnd ? 1 : 2; // quality: 2 full, 1 lighter canvas + no halo, 0 half the dots
  let fontPx = 100;
  let gridStep = 3;
  let nameDot = 3;
  let dustDot = 2;
  let orbDot = 2;
  const box = { l: 0, r: 0, t: 0, b: 0 };
  const orb = { x: 0, y: 0, R: 100 };
  const cb = { x: 0, y: 0, w: 1, h: 1 };
  let layoutKey = '';
  let nameW = 0;

  const off = document.createElement('canvas');
  let octx = null;
  const rg = document.createRange();
  const textRect = (node) => {
    rg.selectNodeContents(node);
    return rg.getBoundingClientRect();
  };
  const nameWidth = () => Math.round(nameEl.getBoundingClientRect().width);
  const keyNow = () => `${hero.clientWidth}x${hero.clientHeight}@${window.devicePixelRatio || 1}`;

  // Draws each word of the name exactly where the browser laid it out, then samples a hex grid.
  function sampleName(hr) {
    const nr = nameEl.getBoundingClientRect();
    const cs = getComputedStyle(nameEl);
    fontPx = parseFloat(cs.fontSize) || 100;
    const fontStr = `${cs.fontStyle} ${cs.fontWeight} ${fontPx}px ${cs.fontFamily}`;
    const pad = Math.ceil(fontPx * 0.3);
    const ss = fontPx < 110 ? 2 : 1;
    const ow = Math.ceil(nr.width) + pad * 2;
    const oh = Math.ceil(nr.height) + pad * 2;
    const ox = nr.left - hr.left - pad;
    const oy = nr.top - hr.top - pad;
    off.width = ow * ss;
    off.height = oh * ss;
    if (!octx) octx = off.getContext('2d', { willReadFrequently: true });
    const o = octx;
    o.setTransform(ss, 0, 0, ss, 0, 0);
    o.clearRect(0, 0, ow, oh);
    o.font = fontStr;
    o.textAlign = 'left';
    o.textBaseline = 'alphabetic';
    o.fillStyle = '#fff';
    // Whole words with canvas letter-spacing keep the browser's kerning; older engines go glyph by glyph.
    const wordRuns = 'letterSpacing' in o;
    const ls = cs.letterSpacing && cs.letterSpacing !== 'normal' ? cs.letterSpacing : '0px';
    if (wordRuns) o.letterSpacing = ls;

    const lines = [];
    for (const w of nameEl.querySelectorAll('.w')) {
      const tnode = w.firstChild;
      const mark = w.querySelector('.bl');
      if (!tnode || tnode.nodeType !== 3 || !mark) continue;
      const base = mark.getBoundingClientRect().top - hr.top;
      const wr = textRect(tnode);
      const str = tnode.data;
      if (wordRuns) o.fillText(str, wr.left - hr.left - ox, base - oy);
      else {
        for (let k = 0; k < str.length; k++) {
          rg.setStart(tnode, k);
          rg.setEnd(tnode, k + 1);
          o.fillText(str[k], rg.getBoundingClientRect().left - hr.left - ox, base - oy);
        }
      }
      const l = wr.left - hr.left;
      const r = wr.right - hr.left;
      const L = lines.find((x) => Math.abs(x.base - base) < fontPx * 0.2);
      if (L) {
        L.l = Math.min(L.l, l);
        L.r = Math.max(L.r, r);
      } else lines.push({ base, l, r });
    }
    if (!lines.length) return null;
    box.l = Math.min(...lines.map((L) => L.l));
    box.r = Math.max(...lines.map((L) => L.r));
    box.t = Math.min(...lines.map((L) => L.base)) - fontPx * 0.74;
    box.b = Math.max(...lines.map((L) => L.base)) + fontPx * 0.05;

    const img = o.getImageData(0, 0, off.width, off.height).data;
    const pw = off.width;
    const phh = off.height;
    let filled = 0;
    for (let i = 3; i < img.length; i += 16) if (img[i] > 127) filled++;
    const area = (filled * 4) / (ss * ss);
    let target = W >= 1280 ? 3400 : W >= 960 ? 2800 : W >= 600 ? 2200 : 1500;
    if (lowEnd) target = Math.round(target * 0.75);
    gridStep = clamp(Math.sqrt(area / (target * 0.866)), 1.5, 7);

    const st = gridStep;
    const jit = st * 0.12;
    const rowH = st * 0.866;
    const tx = [];
    const ty = [];
    const tr = [];
    let row = 0;
    for (let yy = rowH * 0.5; yy < oh; yy += rowH, row++) {
      const xo = row & 1 ? st * 0.5 : 0;
      for (let xx = xo + st * 0.25; xx < ow; xx += st) {
        const jx = xx + (Math.random() - 0.5) * jit;
        const jy = yy + (Math.random() - 0.5) * jit;
        const sx = Math.floor(jx * ss);
        const sy = Math.floor(jy * ss);
        if (sx < 0 || sy < 0 || sx >= pw || sy >= phh) continue;
        if (img[(sy * pw + sx) * 4 + 3] < 128) continue;
        const hx = jx + ox;
        const hy = jy + oy;
        // Reading order: line first, then left to right within the line.
        let li = 0;
        let bd = Infinity;
        for (let k = 0; k < lines.length; k++) {
          const d = Math.abs(hy - (lines[k].base - fontPx * 0.35));
          if (d < bd) {
            bd = d;
            li = k;
          }
        }
        const L = lines[li];
        tx.push(hx);
        ty.push(hy);
        tr.push((li + clamp((hx - L.l) / Math.max(1, L.r - L.l), 0, 1)) / lines.length);
      }
    }
    return { n: tx.length, x: tx, y: ty, ro: tr };
  }

  // Where the orb forms: the centre of the slot the hero reserves for it.
  function computeOrb(hr) {
    const r = slot.getBoundingClientRect();
    orb.x = r.left - hr.left + r.width / 2;
    orb.y = r.top - hr.top + r.height / 2;
    orb.R = clamp(Math.min(r.width, r.height) * 0.5 * 0.74, 34, 170);
  }

  // The canvas covers only what is ever drawn: the name (plus the lift above it) and the orb with
  // its glow and spiral paths.
  function fxBounds() {
    const lift = Math.max(36, fontPx * 0.85);
    const mx = fontPx * 0.45;
    const oR = orb.R * 2.4;
    const l = Math.min(box.l - mx, orb.x - oR);
    const r = Math.max(box.r + mx, orb.x + oR);
    const tp = Math.min(box.t - lift - nameDot * 2, orb.y - oR);
    const b = Math.max(box.b + fontPx * 0.3, orb.y + oR);
    cb.x = Math.max(0, Math.floor(l));
    cb.y = Math.max(0, Math.floor(tp));
    cb.w = Math.max(1, Math.min(W, Math.ceil(r)) - cb.x);
    cb.h = Math.max(1, Math.min(H, Math.ceil(b)) - cb.y);
  }

  // Wrap the name around a Fibonacci sphere: columns of the name map to bands of longitude, and
  // within a column top maps to top. The middle of the name lands facing the viewer.
  function assignSphere(n) {
    const ga = Math.PI * (3 - Math.sqrt(5));
    const sx = new Float32Array(n);
    const sy = new Float32Array(n);
    const sz = new Float32Array(n);
    const lon = new Float32Array(n);
    for (let k = 0; k < n; k++) {
      const y = 1 - ((k + 0.5) * 2) / n;
      const r = Math.sqrt(Math.max(0, 1 - y * y));
      const th = k * ga;
      sx[k] = Math.cos(th) * r;
      sy[k] = y;
      sz[k] = Math.sin(th) * r;
      lon[k] = Math.atan2(sx[k], sz[k]);
    }
    const byX = Array.from({ length: n }, (_, i) => i).sort((a, b) => P.hx[a] - P.hx[b]);
    const byLon = Array.from({ length: n }, (_, i) => i).sort((a, b) => lon[a] - lon[b]);
    const K = Math.max(6, Math.round(Math.sqrt(n) / 1.6));
    for (let g = 0; g < K; g++) {
      const a = Math.floor((g * n) / K);
      const b = Math.floor(((g + 1) * n) / K);
      const ni = byX.slice(a, b).sort((p, r) => P.hy[p] - P.hy[r]);
      const si = byLon.slice(a, b).sort((p, r) => sy[p] - sy[r]);
      for (let j = 0; j < ni.length; j++) {
        const i = ni[j];
        const k = si[j];
        P.ux[i] = sx[k];
        P.uy[i] = sy[k];
        P.uz[i] = sz[k];
      }
    }
  }

  /* ---------- Canvas and sprites ---------- */
  const atlas = document.createElement('canvas');
  let SP = 8;
  let spK = 1;
  let glowS = null;
  let shrunk = true;
  let parkTimer = 0;
  const makeGlow = (rgb) => {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const g = c.getContext('2d');
    const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    gr.addColorStop(0, `rgba(${rgb},1)`);
    gr.addColorStop(0.4, `rgba(${rgb},0.32)`);
    gr.addColorStop(1, `rgba(${rgb},0)`);
    g.fillStyle = gr;
    g.fillRect(0, 0, 128, 128);
    return c;
  };

  function sizeCanvas() {
    const dpr = window.devicePixelRatio || 1;
    let d = Math.min(q === 2 ? 2 : q === 1 ? 1.5 : 1, dpr);
    const area = Math.max(1, cb.w * cb.h);
    const budget = q === 2 ? 4.2e6 : 2.6e6;
    if (area * d * d > budget) d = Math.max(1, Math.sqrt(budget / area));
    DPR = d;
    const cw = Math.max(1, Math.round(cb.w * DPR));
    const ch = Math.max(1, Math.round(cb.h * DPR));
    if (canvas.width !== cw || canvas.height !== ch) {
      canvas.width = cw;
      canvas.height = ch;
    }
    const s = canvas.style;
    s.left = `${cb.x}px`;
    s.top = `${cb.y}px`;
    s.width = `${cb.w}px`;
    s.height = `${cb.h}px`;
    shrunk = false;
  }

  // One atlas: 4 colour rows x 8 alpha columns of round dots.
  function buildSprites() {
    const k = q === 0 ? 1.3 : 1;
    const maxD = Math.max(nameDot, orbDot * 1.3) * k;
    const dia = Math.max(3, Math.ceil(maxD * DPR));
    SP = dia + 2;
    spK = SP / dia;
    atlas.width = SP * 8;
    atlas.height = SP * 4;
    const a = atlas.getContext('2d');
    a.clearRect(0, 0, atlas.width, atlas.height);
    for (let c = 0; c < 4; c++) {
      for (let l = 0; l < 8; l++) {
        const C = COLORS[c];
        a.fillStyle = `rgba(${C[0]},${C[1]},${C[2]},${((l + 1) / 8).toFixed(3)})`;
        a.beginPath();
        a.arc(l * SP + SP / 2, c * SP + SP / 2, dia / 2, 0, TAU);
        a.fill();
      }
    }
    if (!glowS) glowS = makeGlow('213,216,234');
  }

  function clearCanvas() {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  }

  // Loop parked: clear now, and give the backing store back after a few quiet seconds.
  function park() {
    clearCanvas();
    clearTimeout(parkTimer);
    parkTimer = setTimeout(() => {
      if (raf || shrunk || destroyed) return;
      canvas.width = 1;
      canvas.height = 1;
      shrunk = true;
    }, 3000);
  }

  function build() {
    const hr = hero.getBoundingClientRect();
    W = hero.clientWidth;
    H = hero.clientHeight;
    const T = sampleName(hr);
    if (!T || T.n < 60) return false;
    computeOrb(hr);
    nameDot = gridStep * 1.12;
    dustDot = Math.max(1.1, gridStep * 0.78);
    orbDot = clamp(orb.R * 0.0165, 1.4, 2.6);
    fxBounds();

    ensureCap(T.n);
    N = T.n;
    const { hx, hy, px, py, sz, rb, ph, rd, dn, ro, lw, fd, f0x, f0y, ft0, tn, md } = P;
    const split = box.l + (box.r - box.l) * 0.6; // the headline gradient's hard stop
    let dmin = Infinity;
    let dmax = 0;
    for (let i = 0; i < N; i++) {
      const x = T.x[i];
      const y = T.y[i];
      hx[i] = x;
      hy[i] = y;
      px[i] = x;
      py[i] = y;
      f0x[i] = x;
      f0y[i] = y;
      ft0[i] = 0;
      sz[i] = nameDot;
      ro[i] = T.ro[i];
      tn[i] = x < split ? 0 : 1;
      ph[i] = Math.random() * TAU;
      rd[i] = Math.random();
      rb[i] = 1 - 0.14 * Math.pow(Math.random(), 2.5);
      fd[i] = 0.85 + Math.random() * 0.45;
      md[i] = HOME;
      const d = Math.hypot(x - orb.x, y - orb.y);
      dn[i] = d;
      if (d < dmin) dmin = d;
      if (d > dmax) dmax = d;
    }
    const dr = Math.max(1, dmax - dmin);
    for (let i = 0; i < N; i++) {
      dn[i] = (dn[i] - dmin) / dr;
      // A sparse subset near the orb side leans toward it when the button is armed.
      lw[i] = rd[i] > 0.78 ? Math.pow(1 - dn[i], 4) : 0;
    }
    assignSphere(N);
    sizeCanvas();
    buildSprites();
    layoutKey = keyNow();
    nameW = nameWidth();
    hrDirty = true;
    return true;
  }

  /* ---------- Simulation ---------- */
  let spin = 0;
  let Rn = 100;
  let Fp = 500;
  let cyw = 1;
  let syw = 0;
  let cpt = 1;
  let spt = 0;
  let T1 = 0;
  let T2 = 0;
  let T3 = 0;
  let T4 = 0;
  let T5 = 0;
  let T6 = 0;
  let waveA = 0;
  let waveH = 0;
  let waveL = 0;
  let waveK = 0;
  let ampNow = 0;
  let lisNow = 0;
  let uampNow = 0;
  let dimK = 1;
  let OX = 0;
  let OY = 0;
  let OZ = 0;
  let OE = 0;
  let OL = 0;
  let SA = 0;
  let SD = 0;
  let SC = 0;

  // Interaction
  let pX = -9999;
  let pY = -9999;
  let presT = 0;
  let presence = 0;
  let lastMoveT = -10;
  let armed = false;
  let armT0 = 0;
  let lean = 0;
  let glintT0 = -10;
  let glintOn = false;
  let rpX = 0;
  let rpY = 0;
  let rpT0 = -10;
  let rpOn = false;
  let lookX = 0;
  let lookY = 0;
  let lookTX = 0;
  let lookTY = 0;
  let orbP = 0;
  let nIn = 0;
  let nOut = 0;
  let nOrb = 0;

  // Opacity of the canvas copy of the name (the hand-off layer between DOM text and particles).
  let nameA = 0;
  let nameFrom = 0;
  let nameTo = 0;
  let nameT0 = 0;
  let nameDur = 0.1;
  const tweenName = (to, dur, delay = 0) => {
    nameFrom = nameA;
    nameTo = to;
    nameT0 = t + delay;
    nameDur = Math.max(0.001, dur);
  };

  // Sphere position for particle i: voice waves on the surface, yaw/pitch, light perspective.
  function orbPos(i) {
    const ux = P.ux[i];
    const uy = P.uy[i];
    const uz = P.uz[i];
    const z1 = -ux * syw + uz * cyw;
    const z2 = uy * spt + z1 * cpt;
    let w = 0;
    if (waveA > 0.0005) {
      w = waveA * (0.62 * Math.sin(ux * 2.6 + uy * 1.7 + T1) * Math.sin(uz * 2.2 - uy * 1.3 + T2) + 0.38 * Math.sin(uy * 4.1 + uz * 1.4 + T3));
    }
    if (waveH > 0.0005) w += waveH * Math.sin(ux * 7.1 + uz * 6.3 + T4 + P.ph[i]);
    // Listening: soft rings that run inward toward the point facing the viewer.
    if (waveL > 0.0005) w += waveL * Math.sin(z2 * 9 - T5) * (0.35 + 0.65 * (z2 > 0 ? z2 : 0));
    // Thinking: one slow band that travels pole to pole.
    if (waveK > 0.0005) w += waveK * Math.exp(-Math.pow((uy - Math.sin(T6)) * 3.2, 2));
    const rr = Rn * (P.rb[i] + w);
    const x1 = ux * cyw + uz * syw;
    const y2 = uy * cpt - z1 * spt;
    const s = Fp / (Fp - z2 * rr);
    OX = orb.x + x1 * rr * s;
    OY = orb.y + y2 * rr * s;
    OZ = z2;
    OE = w;
    OL = -0.42 * x1 - 0.52 * y2 + 0.74 * z2; // key light from the upper left, toward the viewer
  }

  // Shade a sphere particle (after orbPos): depth, key light, a faint rim, then voice peaks.
  function orbShade(i) {
    const dz = (OZ + 1) * 0.5;
    const lit = OL > 0 ? OL : 0;
    const rim = 1 - Math.abs(OZ);
    const r4 = rim * rim * rim * rim;
    const a = ((0.1 + 0.9 * dz * dz) * (0.5 + 0.5 * lit) + r4 * 0.22 * dz) * dimK;
    SA = a > 1 ? 1 : a;
    SD = orbDot * (0.7 + 0.55 * dz);
    let c = P.tn[i];
    if (lit > 0.9 && dz > 0.8) c = 2; // the highlight cap reads as glass
    if (OE > 0.055 && dz > 0.45) c = 2;
    if (OE > 0.1 && dz > 0.62 && P.rd[i] > 0.55) c = 3; // only the strongest voice peaks touch the accent
    SC = c;
  }

  function step(dt) {
    const k = dt * 60;
    nameA = nameFrom + (nameTo - nameFrom) * smooth(clamp((t - nameT0) / nameDur, 0, 1));
    if (presT && t - lastMoveT > 2.5) presT = 0; // a resting pointer lets the shimmer settle
    presence += (presT - presence) * (1 - Math.pow(presT ? 0.86 : 0.93, k));
    const leanT = armed && state === 'rest' && t - armT0 < 8 ? 1 : 0;
    lean += (leanT - lean) * (1 - Math.pow(0.92, k));
    if (lean < 0.002 && !leanT) lean = 0;
    if (presence < 0.002 && !presT) presence = 0;
    lookX += (lookTX - lookX) * (1 - Math.pow(0.96, k));
    lookY += (lookTY - lookY) * (1 - Math.pow(0.96, k));

    const amp = sp.amp * sp.gain;
    const hiv = sp.hiS * sp.gain;
    const lis = sp.lgain;
    const uamp = sp.uAmp * lis;
    ampNow = amp;
    lisNow = lis;
    uampNow = uamp;
    dimK = 1 - 0.22 * lis;
    spin += dt * (0.2 + 0.3 * sp.gain - 0.1 * lis + 0.35 * sp.kgain);
    const yaw = spin + lookX * 0.55;
    const pitch = -0.36 + lookY * 0.35;
    cyw = Math.cos(yaw);
    syw = Math.sin(yaw);
    cpt = Math.cos(pitch);
    spt = Math.sin(pitch);
    // Speaking swells the sphere; listening draws it in and lets the visitor's voice nudge it.
    Rn = orb.R * (1 + 0.014 * Math.sin(t * 1.6) + 0.04 * amp - 0.045 * lis + 0.03 * uamp);
    Fp = orb.R * 5;
    T1 = t * 4.1;
    T2 = t * 3.3;
    T3 = t * 6.2;
    T4 = t * 15;
    T5 = t * 5.5;
    T6 = t * 1.7;
    waveA = 0.15 * amp;
    waveH = 0.05 * hiv;
    waveL = 0.055 * uamp + 0.012 * lis;
    waveK = 0.035 * sp.kgain;

    const restFx = state === 'rest' || state === 'settling';
    const pres = restFx ? presence : 0;
    const Rs = Math.max(60, fontPx * 0.95);
    const Rs2 = Rs * Rs;
    let gEnv = 0;
    let gx = 0;
    const gw = Math.max(40, fontPx * 0.55);
    if (glintOn) {
      const gu = (t - glintT0) / 1.7;
      if (gu >= 1) glintOn = false;
      else if (gu > 0) {
        gEnv = Math.sin(Math.PI * gu);
        gx = box.l - gw * 2 + (box.r - box.l + gw * 4) * ease(gu);
      }
    }
    let rpR = 0;
    let rpEnv = 0;
    if (rpOn) {
      const ra = t - rpT0;
      rpR = ra * 560;
      rpEnv = 1 - ra / 1.1;
      if (rpEnv <= 0) {
        rpOn = false;
        rpEnv = 0;
      }
    }
    const rpW = Math.max(18, fontPx * 0.22);
    const ln = restFx ? lean : 0;
    const showName = nameA > 0.004;
    const shimmer = restFx && !showName && (pres > 0.003 || gEnv > 0 || rpEnv > 0 || ln > 0.003);
    const half = q === 0 && !restFx;
    const sizeK = q === 0 ? 1.3 : 1;
    const lift = Math.max(36, fontPx * 0.85);
    const speck = Math.max(1.1, nameDot * 0.55);

    bcnt.fill(0);
    nIn = 0;
    nOut = 0;
    nOrb = 0;
    const { hx, hy, px, py, sz, ph, rd, lw, fd, f0x, f0y, ft0, tn, md, bk } = P;
    for (let i = 0; i < N; i++) {
      let m = md[i];
      let x = hx[i];
      let y = hy[i];
      let a = 0;
      let d = nameDot;
      let c = tn[i];
      let flying = false;

      if (m === IN) {
        const u = (t - ft0[i]) / fd[i];
        if (u >= 1) {
          m = ORB;
          md[i] = ORB;
        } else if (u <= 0) {
          // Still in the letter as fine dust: a small tremble in the last 0.2 s before lift-off.
          nIn++;
          const w = 1 + (t - ft0[i]) / 0.2;
          if (w > 0) x += Math.sin(t * 47 + ph[i] * 9) * 0.7 * w;
          a = nameA;
          d = dustDot;
        } else {
          nIn++;
          flying = true;
          orbPos(i);
          const e = ease(u);
          const x0 = f0x[i];
          const y0 = f0y[i];
          const vx = OX - orb.x;
          const vy = OY - orb.y;
          const sw = 0.9 + (rd[i] - 0.5) * 0.6;
          const cs = Math.cos(sw);
          const sn = Math.sin(sw);
          // Lift straight up out of the letter, then spiral into the sphere.
          const c1x = x0 + (OX - x0) * 0.15;
          const c1y = y0 - lift * (0.45 + rd[i] * 0.55);
          const c2x = orb.x + (vx * cs - vy * sn) * 1.7;
          const c2y = orb.y + (vx * sn + vy * cs) * 1.7;
          x = bez(x0, c1x, c2x, OX, e);
          y = bez(y0, c1y, c2y, OY, e);
          orbShade(i);
          a = 1 + (SA - 1) * e;
          d = dustDot + (SD - dustDot) * e;
          if (e > 0.85) c = SC;
          else if (rd[i] > 0.62 && Math.sin(Math.PI * u) > 0.8) c = 2;
        }
      }

      let pendingOut = false;
      if (m === OUT) {
        if (t < ft0[i]) {
          pendingOut = true;
          nOut++;
        } else {
          if (f0x[i] !== f0x[i]) {
            f0x[i] = px[i];
            f0y[i] = py[i];
          } // leave from wherever it is now
          const u = (t - ft0[i]) / fd[i];
          if (u >= 1) {
            m = HOME;
            md[i] = HOME;
          } else {
            nOut++;
            flying = true;
            const e = ease(u);
            const x0 = f0x[i];
            const y0 = f0y[i];
            const vx = x0 - orb.x;
            const vy = y0 - orb.y;
            const sw = -(0.9 + (rd[i] - 0.5) * 0.6);
            const cs = Math.cos(sw);
            const sn = Math.sin(sw);
            // Unwind out of the sphere, then drop into the letter from above.
            const c1x = orb.x + (vx * cs - vy * sn) * 1.6;
            const c1y = orb.y + (vx * sn + vy * cs) * 1.6;
            const c2x = hx[i];
            const c2y = hy[i] - lift * (0.45 + rd[i] * 0.55);
            x = bez(x0, c1x, c2x, hx[i], e);
            y = bez(y0, c1y, c2y, hy[i], e);
            a = 0.6 + 0.4 * e;
            d = orbDot + (nameDot - orbDot) * e;
            if (rd[i] > 0.62 && Math.sin(Math.PI * u) > 0.8) c = 2;
          }
        }
      }

      if (m === ORB || pendingOut) {
        orbPos(i);
        x = OX;
        y = OY;
        orbShade(i);
        a = SA;
        d = SD;
        c = SC;
        if (!pendingOut) nOrb++;
      } else if (m === HOME && !flying) {
        if (showName) {
          a = nameA;
        } else if (shimmer) {
          let s = 0;
          let ox = 0;
          let oy = 0;
          // Sharp twinkle: only a few specks are bright at any moment, so it reads as shimmer.
          const tw0 = 0.5 + 0.5 * Math.sin(t * 2.6 + ph[i] * 7);
          const tw = tw0 * tw0 * tw0;
          const pick = rd[i];
          if (pres > 0.003 && pick > 0.4) {
            const dx = x - pX;
            const dy = y - pY;
            const d2 = dx * dx + dy * dy;
            if (d2 < Rs2) {
              const dd = Math.sqrt(d2) + 0.001;
              const nr = 1 - dd / Rs;
              const f = nr * nr;
              s = pres * f * (0.1 + 0.9 * tw);
              ox += (dx / dd) * f * 2.4;
              oy += (dy / dd) * f * 2.4 - f * 1.4;
            }
          }
          if (gEnv > 0 && pick > 0.35) {
            const gd = (x - gx) / gw;
            const g = gEnv * Math.exp(-gd * gd) * (0.15 + 0.85 * tw) * 0.85;
            if (g > s) s = g;
          }
          if (rpEnv > 0) {
            const dx = x - rpX;
            const dy = y - rpY;
            const dd = Math.sqrt(dx * dx + dy * dy) + 0.001;
            const o = Math.abs(dd - rpR);
            if (o < rpW) {
              const f = (1 - o / rpW) * rpEnv;
              const r = f * (0.3 + 0.7 * tw0) * (pick > 0.3 ? 1 : 0);
              if (r > s) s = r;
              ox += (dx / dd) * f * 2.5;
              oy += (dy / dd) * f * 2.5;
            }
          }
          if (ln > 0.003 && lw[i] > 0) {
            const lv = ln * lw[i];
            const ex = orb.x - x;
            const ey = orb.y - y;
            const el = Math.sqrt(ex * ex + ey * ey) + 0.001;
            ox += (ex / el) * lv * 7;
            oy += (ey / el) * lv * 7;
            const l2 = lv * (0.2 + 0.8 * tw0) * 0.85;
            if (l2 > s) s = l2;
          }
          if (s > 0.035) {
            x += ox;
            y += oy;
            a = s * 0.8;
            d = speck;
            c = 2;
          }
        }
      }

      px[i] = x;
      py[i] = y;
      if (a < 0.03 || (half && i & 1 && m !== HOME)) {
        bk[i] = SKIP;
        continue;
      }
      sz[i] = d * sizeK;
      const lv = a >= 1 ? 7 : (a * 8) | 0;
      const b = c * 8 + lv;
      bk[i] = b;
      bcnt[b]++;
    }
    orbP += (nOrb / Math.max(1, N) - orbP) * (1 - Math.pow(0.9, k));
  }

  function draw() {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(DPR, 0, 0, DPR, -cb.x * DPR, -cb.y * DPR);
    if (orbP > 0.01 && q > 0 && glowS) {
      const r = Rn * 2.2;
      ctx.globalAlpha = orbP * (0.07 + 0.16 * ampNow - 0.025 * lisNow + 0.03 * sp.kgain);
      ctx.drawImage(glowS, orb.x - r, orb.y - r, r * 2, r * 2);
      ctx.globalAlpha = 1;
    }
    // Listening: one thin silver ring that lights with the visitor's voice.
    if (lisNow > 0.02 && orbP > 0.2) {
      ctx.globalAlpha = orbP * lisNow * (0.16 + 0.42 * uampNow);
      ctx.strokeStyle = '#D5D8EA';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(orb.x, orb.y, orb.R * (1.16 + 0.05 * uampNow), 0, TAU);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
    const { px, py, sz, bk, ord } = P;
    let acc = 0;
    for (let b = 0; b < NBK; b++) {
      boff[b] = acc;
      bpos[b] = acc;
      acc += bcnt[b];
    }
    if (!acc) return;
    for (let i = 0; i < N; i++) {
      const b = bk[i];
      if (b !== SKIP) ord[bpos[b]++] = i;
    }
    for (let b = 0; b < NBK; b++) {
      const c = bcnt[b];
      if (!c) continue;
      const sx = (b & 7) * SP;
      const sy = (b >> 3) * SP;
      const end = boff[b] + c;
      for (let j = boff[b]; j < end; j++) {
        const i = ord[j];
        const dd = sz[i] * spK;
        const h = dd * 0.5;
        ctx.drawImage(atlas, sx, sy, SP, SP, px[i] - h, py[i] - h, dd, dd);
      }
    }
  }

  /* ---------- Conversation lifecycle ---------- */
  function start() {
    if (state === 'forming' || state === 'live') return;
    if (!ready) {
      wantStart = true;
      return;
    }
    const prev = state;
    setPhase('forming');
    // Hand-off: the crisp heading and a layer of fine dust cross-fade, and the dust lifts at once.
    tweenName(1, 0.22, 0);
    setNameOut(true);
    if (prev === 'rest' || prev === 'settling') spin = 0; // the middle of the name lands facing you
    const base = t + 0.06;
    const { hx, hy, px, py, rd, dn, fd, f0x, f0y, ft0, md } = P;
    for (let i = 0; i < N; i++) {
      const m = md[i];
      if (m === HOME) {
        md[i] = IN;
        f0x[i] = hx[i];
        f0y[i] = hy[i];
        // The side of the name nearest the orb dissolves first.
        ft0[i] = base + dn[i] * 0.5 + rd[i] * 0.12;
        fd[i] = 0.85 + rd[i] * 0.45;
      } else if (m === OUT) {
        if (t < ft0[i]) md[i] = ORB;
        else {
          md[i] = IN;
          f0x[i] = px[i];
          f0y[i] = py[i];
          ft0[i] = t;
          fd[i] = 0.6 + rd[i] * 0.3;
        }
      }
    }
    kick();
  }

  function end() {
    wantStart = false;
    if (state !== 'forming' && state !== 'live') return;
    if (!ready) {
      setPhase('rest');
      setNameOut(false);
      return;
    }
    setPhase('returning');
    tweenName(1, 0.01, 0);
    const { px, py, rd, ro, fd, f0x, f0y, ft0, md } = P;
    for (let i = 0; i < N; i++) {
      const m = md[i];
      if (m === IN) {
        if (t < ft0[i]) md[i] = HOME;
        else {
          md[i] = OUT;
          f0x[i] = px[i];
          f0y[i] = py[i];
          ft0[i] = t;
          fd[i] = 0.7 + rd[i] * 0.35;
        }
      } else if (m === ORB) {
        md[i] = OUT;
        f0x[i] = NaN; // snapshot the live sphere position at departure
        // The name rebuilds in reading order.
        ft0[i] = t + 0.05 + ro[i] * 0.75 + rd[i] * 0.12;
        fd[i] = 0.85 + rd[i] * 0.45;
      }
    }
    kick();
  }

  function tickState() {
    if (state === 'forming') {
      if (nIn === 0 && nOut === 0) setPhase('live');
    } else if (state === 'returning') {
      if (nIn === 0 && nOut === 0) {
        setPhase('settling');
        settleT = t;
        setNameOut(false);
        tweenName(0, 0.42, 0.06); // the canvas name fades as the real heading fades back in
      }
    } else if (state === 'settling') {
      if (t - settleT > 0.52) {
        setPhase('rest');
        nameA = 0;
        nameTo = 0;
        nameFrom = 0;
      }
    }
  }

  /* ---------- Loop: runs only while something moves ---------- */
  let raf = 0;
  let lastNow = 0;
  let visible = !document.hidden;
  let inView = true;

  const needsFrames = () => {
    if (!visible || !inView || !ready || destroyed) return false;
    if (state !== 'rest') return true;
    return presT > 0 || presence > 0 || lean > 0 || (armed && t - armT0 < 8) || glintOn || rpOn || nameA > 0.001;
  };
  function kick() {
    if (raf || !needsFrames()) return;
    clearTimeout(parkTimer);
    if (shrunk) sizeCanvas();
    lastNow = performance.now();
    raf = requestAnimationFrame(frame);
  }
  function halt() {
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    if (ready) park();
  }

  // Adaptive quality both ways: frame gap, frame-to-frame jitter and script time while the orb is up.
  let qCeil = 2;
  let emaGap = 16.7;
  let emaJit = 0;
  let emaWork = 2;
  let lastGap = 16.7;
  let slow = 0;
  let good = 0;
  let cool = 30;
  let downs = 0;
  let upAt = -100;
  function setQuality(nq) {
    if (nq < q) {
      downs++;
      if (t - upAt < 10) qCeil = nq; // failed again right after a step up: that level is the ceiling
    } else upAt = t;
    q = nq;
    slow = 0;
    good = 0;
    cool = 40;
    sizeCanvas();
    buildSprites();
  }
  function watchPerf(gap, work, dt) {
    if (state === 'rest') {
      cool = 30;
      slow = 0;
      good = 0;
      return;
    }
    const okGap = gap > 0 && gap < 150;
    const r = cool > 0 ? 0.25 : 0.06;
    if (okGap) {
      emaGap += (gap - emaGap) * r;
      emaJit += (Math.abs(gap - lastGap) - emaJit) * r;
      lastGap = gap;
    }
    emaWork += (work - emaWork) * r;
    if (cool > 0) {
      cool--;
      return;
    }
    // A steady ~33 ms cadence (iPhone Low Power Mode, battery savers) is a refresh cap, not jank.
    const capped = emaGap > 25 && emaGap < 40 && emaJit < 4;
    const janky = (emaGap > 25 && !capped) || emaWork > 9;
    if (janky) {
      good = 0;
      if (q > 0 && ++slow > 45) setQuality(q - 1);
      return;
    }
    if (slow > 0) slow--;
    const roomy = emaWork < (q === 0 ? 3.5 : 4.5) && (emaGap < 20 || capped);
    if (q < qCeil && roomy) {
      good += dt;
      if (good > Math.min(12, 3 * (1 + downs))) setQuality(q + 1);
    } else good = Math.max(0, good - dt);
  }

  function frame(now) {
    raf = 0;
    if (destroyed) return;
    const gap = now - lastNow;
    lastNow = now;
    let dt = gap / 1000;
    if (!(dt > 0)) dt = 1 / 60;
    else if (dt > 0.05) dt = 0.05;
    t += dt;
    const w0 = performance.now();
    try {
      voiceStep(dt);
      step(dt);
      draw();
      tickState();
    } catch (err) {
      fail(err);
      return;
    }
    watchPerf(gap, performance.now() - w0, dt);
    if (!raf) {
      if (needsFrames()) raf = requestAnimationFrame(frame);
      else park();
    }
  }

  function fail(err) {
    if (destroyed) return;
    ready = false;
    try {
      clearCanvas();
    } catch {
      /* the canvas is gone too */
    }
    if (nameOut) setNameOut(false);
    console.warn('Name-to-orb effect disabled:', err);
    onFail?.(err);
  }
  const safe = (fn) => {
    try {
      fn();
    } catch (err) {
      fail(err);
    }
  };

  /* ---------- Layout lifecycle ---------- */
  let layoutTimer = 0;
  function rebuild(force) {
    if (!ready) return;
    if (!force && keyNow() === layoutKey) return;
    if (!build()) throw new Error('could not sample the name');
    const { md } = P;
    if (state === 'forming' || state === 'live') {
      for (let i = 0; i < N; i++) md[i] = ORB;
      nameA = 1;
      nameTo = 1;
      nameFrom = 1;
      setNameOut(true);
      if (state === 'forming') setPhase('live');
    } else if (state === 'returning') {
      setPhase('settling');
      settleT = t;
      setNameOut(false);
      nameA = 1;
      tweenName(0, 0.3, 0);
    }
    kick();
    if (!raf) park();
  }
  const schedule = (force) => {
    clearTimeout(layoutTimer);
    layoutTimer = setTimeout(() => safe(() => rebuild(force)), 150);
  };

  const waitFonts = () => {
    if (!document.fonts || !document.fonts.load) return Promise.resolve();
    const cs = getComputedStyle(nameEl);
    return Promise.race([
      document.fonts.load(`${cs.fontWeight} 100px ${cs.fontFamily}`).catch(() => {}),
      new Promise((resolve) => setTimeout(resolve, 600)),
    ]);
  };

  function init() {
    if (ready || destroyed) return;
    if (!build()) throw new Error('could not sample the name');
    ready = true;
    if (wantStart) {
      wantStart = false;
      start();
    } else {
      // One slow glint across the name, so it reads as made of something. Calm, once.
      glintT0 = t + 0.35;
      glintOn = true;
    }
    kick();
  }

  /* ---------- Input ---------- */
  let hrect = null;
  let hrDirty = true;
  const heroRect = () => {
    if (hrDirty || !hrect) {
      hrect = hero.getBoundingClientRect();
      hrDirty = false;
    }
    return hrect;
  };
  const inNameZone = (x, y) => {
    const m = fontPx * 0.4;
    return x > box.l - m && x < box.r + m && y > box.t - m && y < box.b + m;
  };
  const isControl = (el) => !!(el && el.closest && el.closest('a, button, input, textarea'));

  on(
    hero,
    'pointermove',
    (e) => {
      if (!ready) return;
      const r = heroRect();
      pX = e.clientX - r.left;
      pY = e.clientY - r.top;
      lastMoveT = t;
      presT = e.pointerType === 'mouse' && inNameZone(pX, pY) ? 1 : 0;
      lookTX = clamp((pX - orb.x) / (orb.R * 3.5), -1, 1);
      lookTY = clamp((pY - orb.y) / (orb.R * 3.5), -1, 1);
      kick();
    },
    { passive: true },
  );
  on(hero, 'pointerenter', () => {
    hrDirty = true;
  });
  on(hero, 'pointerleave', () => {
    presT = 0;
    lookTX = 0;
    lookTY = 0;
  });
  // Touch has no hover: a tap on the name sends one soft ripple through it.
  on(
    hero,
    'pointerdown',
    (e) => {
      if (!ready || state !== 'rest' || isControl(e.target)) return;
      const r = heroRect();
      const x = e.clientX - r.left;
      const y = e.clientY - r.top;
      if (!inNameZone(x, y)) return;
      rpX = x;
      rpY = y;
      rpT0 = t;
      rpOn = true;
      kick();
    },
    { passive: true },
  );

  on(
    window,
    'scroll',
    () => {
      hrDirty = true;
    },
    { passive: true },
  );
  on(
    window,
    'resize',
    () => {
      hrDirty = true;
      schedule(false);
    },
    { passive: true },
  );
  let ro = null;
  if ('ResizeObserver' in window) {
    ro = new ResizeObserver(() => {
      hrDirty = true;
      schedule(false);
    });
    ro.observe(hero);
  }
  if (document.fonts && document.fonts.addEventListener) {
    // Re-measure only when a newly loaded face actually changed the name's metrics.
    on(document.fonts, 'loadingdone', () => {
      if (ready && nameWidth() !== nameW) schedule(true);
    });
  }
  on(document, 'visibilitychange', () => {
    visible = !document.hidden;
    if (visible) kick();
    else halt();
  });
  let io = null;
  if ('IntersectionObserver' in window) {
    io = new IntersectionObserver((entries) => {
      inView = entries[entries.length - 1].isIntersecting;
      if (inView) {
        hrDirty = true;
        kick();
      } else halt();
    });
    io.observe(hero);
  }

  waitFonts().then(() => safe(init));

  return {
    start: () => safe(start),
    end: () => safe(end),
    setArmed(a) {
      const want = !!a && state === 'rest';
      if (want && !armed) armT0 = t;
      armed = want;
      if (want) kick();
    },
    // Layout changed under the engine (the hero's call layout, a font swap): re-measure soon.
    relayout: () => schedule(true),
    get phase() {
      return state;
    },
    destroy() {
      destroyed = true;
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      clearTimeout(parkTimer);
      clearTimeout(layoutTimer);
      listeners.forEach((off) => off());
      ro?.disconnect();
      io?.disconnect();
      try {
        clearCanvas();
      } catch {
        /* already gone */
      }
    },
  };
}
