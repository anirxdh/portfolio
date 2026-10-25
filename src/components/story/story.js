// The small, always-loaded half of the homepage story. The hero and the universe register their
// elements here; the engine (storyEngine.js, Canvas 2D) is fetched once the page is idle after
// load, so it never competes with the first paint. Without a usable canvas (or after an error)
// <html data-story="off"> is set and both sections stay plain, readable HTML.

let engine = null;
let booting = false;
const reg = { hero: null, universe: null, dim: 0, uActive: -1 };

const canDraw = () => {
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext && c.getContext('2d'));
  } catch {
    return false;
  }
};

function boot() {
  if (booting || typeof window === 'undefined') return;
  booting = true;
  if (!canDraw()) {
    document.documentElement.dataset.story = 'off';
    return;
  }
  const go = () => {
    import('./storyEngine.js')
      .then(({ createStoryEngine }) => {
        engine = createStoryEngine();
        if (reg.hero) engine.setHero(reg.hero);
        if (reg.universe) engine.setUniverse(reg.universe);
        engine.setDim(reg.dim);
        if (reg.uActive >= 0) engine.setUniverseActive(reg.uActive);
      })
      .catch((err) => {
        console.warn('Story sky unavailable:', err);
        document.documentElement.dataset.story = 'off';
      });
  };
  const idle = () => {
    if ('requestIdleCallback' in window) window.requestIdleCallback(go, { timeout: 2500 });
    else setTimeout(go, 600);
  };
  if (document.readyState === 'complete') idle();
  else window.addEventListener('load', idle, { once: true });
}

export function registerHero(h) {
  reg.hero = h;
  engine?.setHero(h);
  boot();
  return () => {
    if (reg.hero !== h) return;
    reg.hero = null;
    engine?.setHero(null);
  };
}

export function registerUniverse(u) {
  reg.universe = u;
  engine?.setUniverse(u);
  boot();
  return () => {
    if (reg.universe !== u) return;
    reg.universe = null;
    engine?.setUniverse(null);
  };
}

// 0 = the sky as usual, 1 = dimmed behind the AniBot orb.
export function setSkyDim(v) {
  reg.dim = v;
  engine?.setDim(v);
}

export function setUniverseActive(i) {
  reg.uActive = i;
  engine?.setUniverseActive(i);
}

export function relayoutStory() {
  engine?.relayout();
}
