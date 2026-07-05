// Deterministic layout for the Explore world: a small city on a road grid.
// Everything is generated once at module load with a seeded PRNG so the world
// is identical on every visit. All sizes are in world units (~meters).

// --- seeded random -----------------------------------------------------------
let seed = 1337;
const rand = () => {
  seed = (seed * 1664525 + 1013904223) % 4294967296;
  return seed / 4294967296;
};
const randBetween = (a, b) => a + rand() * (b - a);
const pick = (arr) => arr[Math.floor(rand() * arr.length)];

// --- constants ---------------------------------------------------------------
export const WORLD_EDGE = 190; // hedge border sits here
const ROAD_COORDS = [-150, -75, 0, 75, 150];
export const ROAD_HALF = 6; // road width 12
const ROAD_LEN = 384;
const BLOCK_CENTERS = [-112.5, -37.5, 37.5, 112.5];

export const SPAWN = { x: 0, z: 30, heading: 0 }; // on the x=0 road, facing the boulevard

// --- roads -------------------------------------------------------------------
export const ROADS = [];
for (const c of ROAD_COORDS) {
  ROADS.push({ x: c, z: 0, w: ROAD_HALF * 2, l: ROAD_LEN, horizontal: false });
  ROADS.push({ x: 0, z: c, w: ROAD_HALF * 2, l: ROAD_LEN, horizontal: true });
}

// Dashed centre lines (instanced): one dash every 8 units, skipping intersections.
export const DASHES = [];
const nearRoad = (v) => ROAD_COORDS.some((c) => Math.abs(v - c) < 10);
for (const c of ROAD_COORDS) {
  for (let t = -ROAD_LEN / 2 + 6; t <= ROAD_LEN / 2 - 6; t += 8) {
    if (!nearRoad(t)) {
      DASHES.push({ x: c, z: t, horizontal: false });
      DASHES.push({ x: t, z: c, horizontal: true });
    }
  }
}

// --- buildings ---------------------------------------------------------------
const PALETTE = ['#8f7a66', '#7d8a97', '#a08d7b', '#6f7f8e', '#96a0a8', '#b3a28e', '#77685c', '#8a94a5', '#5b7f9e'];
const PARK_BLOCKS = new Set(['112.5,-112.5', '-112.5,112.5', '112.5,112.5', '-112.5,-112.5']);

export const BUILDINGS = [];
for (const bx of BLOCK_CENTERS) {
  for (const bz of BLOCK_CENTERS) {
    if (PARK_BLOCKS.has(`${bx},${bz}`)) continue;
    if (bx === 37.5 && bz === 37.5) {
      // Landmark tower.
      BUILDINGS.push({ x: bx, z: bz, w: 16, d: 16, h: 44, color: '#5b6f8a' });
      continue;
    }
    // 2–3 buildings per block, placed in quadrants so they never overlap.
    const spots = [
      [-13, -13],
      [13, -13],
      [-13, 13],
      [13, 13],
    ];
    const count = 2 + Math.floor(rand() * 2);
    const chosen = [...spots].sort(() => rand() - 0.5).slice(0, count);
    for (const [ox, oz] of chosen) {
      BUILDINGS.push({
        x: bx + ox + randBetween(-2, 2),
        z: bz + oz + randBetween(-2, 2),
        w: randBetween(11, 18),
        d: randBetween(11, 18),
        h: pick([8, 10, 12, 14, 18, 22, 26]),
        color: pick(PALETTE),
      });
    }
  }
}

// --- trees, lamps, obstacles ---------------------------------------------------
export const TREES = [];
// Park trees.
const parkTreeBlocks = [
  [-112.5, 112.5],
  [112.5, 112.5],
  [-112.5, -112.5],
];
for (const [bx, bz] of parkTreeBlocks) {
  const n = bx === -112.5 && bz === -112.5 ? 4 : 9; // plaza gets fewer
  for (let i = 0; i < n; i++) {
    TREES.push({ x: bx + randBetween(-24, 24), z: bz + randBetween(-24, 24), s: randBetween(0.8, 1.5) });
  }
}
// Perimeter ring of trees just inside the hedge.
for (let t = -176; t <= 176; t += 22) {
  const j = () => randBetween(-4, 4);
  TREES.push({ x: t + j(), z: -179 + j(), s: randBetween(0.9, 1.6) });
  TREES.push({ x: t + j(), z: 179 + j(), s: randBetween(0.9, 1.6) });
  TREES.push({ x: -179 + j(), z: t + j(), s: randBetween(0.9, 1.6) });
  TREES.push({ x: 179 + j(), z: t + j(), s: randBetween(0.9, 1.6) });
}

export const LAMPS = [];
for (const x of [-140, -105, -40, 40, 105, 140]) {
  LAMPS.push({ x, z: -8 });
  LAMPS.push({ x, z: 8 });
}

export const CONES = [
  { x: 9, z: 9 },
  { x: -9, z: 9 },
  { x: 9, z: -9 },
  { x: -9, z: -9 },
  { x: 66, z: -9 },
  { x: 84, z: 9 },
];

export const CRATES = [];
for (let i = 0; i < 6; i++) {
  CRATES.push({ x: -112.5 + randBetween(-18, 18), z: -112.5 + randBetween(-18, 18), s: randBetween(1.4, 2.2), rot: rand() * Math.PI });
}

export const ROCKS = [];
for (let i = 0; i < 5; i++) {
  ROCKS.push({ x: -112.5 + randBetween(-22, 22), z: 112.5 + randBetween(-22, 22), r: randBetween(1.1, 1.9) });
}

export const BENCHES = [
  { x: 100, z: 100, rot: 0.4 },
  { x: 122, z: 108, rot: -0.8 },
  { x: 108, z: 126, rot: 1.9 },
];

// --- soccer field (mini-game) ---------------------------------------------------
export const FIELD = { x: 112.5, z: -112.5, w: 40, d: 26 };
const GOAL_X = [FIELD.x - FIELD.w / 2, FIELD.x + FIELD.w / 2]; // 92.5 / 132.5
export const GOALS = GOAL_X.map((gx, i) => ({
  x: gx,
  z: FIELD.z,
  dir: i === 0 ? -1 : 1, // which way the goal opens
  posts: [
    { x: gx, z: FIELD.z - 4, hw: 0.35, hd: 0.35 },
    { x: gx, z: FIELD.z + 4, hw: 0.35, hd: 0.35 },
  ],
  back: { x: gx + (i === 0 ? -1.6 : 1.6), z: FIELD.z, hw: 0.3, hd: 4.2 },
  sensor: { x: gx + (i === 0 ? -0.9 : 0.9), z: FIELD.z, hw: 0.7, hd: 3.6 },
}));
export const BALL_SPAWN = { x: FIELD.x, z: FIELD.z };

// --- project billboard spots (along the z=0 boulevard) ---------------------------
export const BILLBOARD_SPOTS = [-130, -95, -55, -20, 20, 55, 95].map((x, i) => ({
  x,
  z: i % 2 === 0 ? 11 : -11,
  // Face the road: signs north of the road look south and vice-versa.
  rotY: i % 2 === 0 ? Math.PI : 0,
}));

// --- coins (mini-game) -----------------------------------------------------------
export const COINS = [];
for (const x of [-120, -80, -40, 40, 80, 120]) COINS.push({ x, z: 0 });
for (const z of [-160, -120, -80, -40, 40, 80, 120, 160]) COINS.push({ x: 0, z });
for (const x of [-120, -40, 40, 120]) COINS.push({ x, z: 75 });
for (const z of [-40, 40]) COINS.push({ x: -150, z });

// --- clouds ----------------------------------------------------------------------
export const CLOUDS = [];
for (let i = 0; i < 9; i++) {
  CLOUDS.push({
    x: randBetween(-170, 170),
    y: randBetween(52, 74),
    z: randBetween(-170, 170),
    s: randBetween(1, 2.2),
  });
}

// --- colliders --------------------------------------------------------------------
export const COLLIDER_BOXES = [
  // Buildings (slightly padded so bumpers don't clip walls).
  ...BUILDINGS.map((b) => ({ x: b.x, z: b.z, hw: b.w / 2 + 0.3, hd: b.d / 2 + 0.3 })),
  // World border hedges.
  { x: 0, z: -WORLD_EDGE, hw: WORLD_EDGE + 2, hd: 1.2 },
  { x: 0, z: WORLD_EDGE, hw: WORLD_EDGE + 2, hd: 1.2 },
  { x: -WORLD_EDGE, z: 0, hw: 1.2, hd: WORLD_EDGE + 2 },
  { x: WORLD_EDGE, z: 0, hw: 1.2, hd: WORLD_EDGE + 2 },
  // Billboard bases.
  ...BILLBOARD_SPOTS.map((s) => ({ x: s.x, z: s.z, hw: 3, hd: 0.7 })),
  // Crates & benches.
  ...CRATES.map((c) => ({ x: c.x, z: c.z, hw: c.s / 2 + 0.2, hd: c.s / 2 + 0.2 })),
  ...BENCHES.map((b) => ({ x: b.x, z: b.z, hw: 1.4, hd: 0.6 })),
  // Goal posts + backs.
  ...GOALS.flatMap((g) => [...g.posts, g.back]),
];

export const COLLIDER_CIRCLES = [
  ...TREES.map((t) => ({ x: t.x, z: t.z, r: 0.55 * t.s + 0.35 })),
  ...LAMPS.map((l) => ({ x: l.x, z: l.z, r: 0.4 })),
  ...CONES.map((c) => ({ x: c.x, z: c.z, r: 0.6 })),
  ...ROCKS.map((r) => ({ x: r.x, z: r.z, r: r.r * 0.9 })),
];
