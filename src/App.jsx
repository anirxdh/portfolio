/* eslint-disable react/prop-types -- the codebase does not use PropTypes */
import { Component, lazy, Suspense, useEffect, useLayoutEffect, useRef, useState } from 'react';

import About from './sections/About.jsx';
import Footer from './sections/Footer.jsx';
import Navbar from './sections/Navbar.jsx';
import ImpactBand from './sections/ImpactBand.jsx';
import Hackathons from './sections/Hackathons.jsx';
import Writing from './sections/Writing.jsx';
import useScrollReveal from './hooks/useScrollReveal.js';
import CommandPaletteHost from './components/CommandPalette/CommandPaletteHost.jsx';
import { SHOW_PROJECT_EVENT } from './components/CommandPalette/events.js';

// The chat widget (react-markdown + streaming client) is off-screen at load, so keep it out of the
// first paint. It mounts right after that paint (see `painted` in App).
const AiChatbot = lazy(() => import('./components/AiChat/AiChatbot.jsx'));

// A chunk that fails to load (a flaky network, or a tab left open across a deploy) must not take
// the whole page down: only that part goes back to its fallback.
class ChunkBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { failed: false };
  }

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error) {
    console.warn('Section failed to load:', error);
  }

  render() {
    return this.state.failed ? (this.props.fallback ?? null) : this.props.children;
  }
}

// Marks the below-the-fold placeholders, so #hash jumps can wait until every real section is in
// place. The hero stand-in is not marked: it has the hero's height, so it never moves anything.
const hasPlaceholders = () => document.querySelector('[data-deferred-section]') !== null;

// ---------- Hero ----------
// The hero's 3D scene needs three.js, React Three Fiber and drei (about 250 KB gzipped). Loading
// Hero.jsx as its own chunk lets React render the rest of the page without waiting for them.
// Until it arrives, the hero spot shows the static intro from index.html (the same block visitors
// see before any JavaScript runs), moved here as is, so nothing on screen changes. The import
// starts once that intro has painted.
const Hero = lazy(() => import('./sections/Hero.jsx'));

// Runs `fn` once the static intro's text is on screen, so the hero never replaces it unseen. On a
// slow phone that has long happened by the time React runs; on a fast connection the text paint
// waits for the web font. Uses the largest-contentful-paint entries where the browser reports
// them, the first contentful paint elsewhere, and waits 3 seconds at most. Returns a cancel function.
const afterIntroPainted = (intro, fn) => {
  let done = false;
  let raf = 0;
  let next = 0;
  let giveUp = 0;
  let observer = null;
  const cancel = () => {
    done = true;
    observer?.disconnect();
    cancelAnimationFrame(raf);
    clearTimeout(next);
    clearTimeout(giveUp);
  };
  const run = () => {
    if (done) return;
    cancel();
    // One more frame, so the work starts after that paint has been presented.
    raf = requestAnimationFrame(() => {
      next = setTimeout(fn, 0);
    });
  };

  const types = (typeof PerformanceObserver !== 'undefined' && PerformanceObserver.supportedEntryTypes) || [];
  const watch = (type, isTheOne) => {
    observer = new PerformanceObserver((list) => {
      if (list.getEntries().some(isTheOne)) run();
    });
    observer.observe({ type, buffered: true });
    giveUp = setTimeout(run, 3000); // never wait on paint timing for long
  };
  if (intro && types.includes('largest-contentful-paint')) {
    // The intro's paragraph is the largest text on the first screen.
    watch('largest-contentful-paint', (entry) => entry.element && intro.contains(entry.element));
  } else if (types.includes('paint')) {
    watch('paint', (entry) => entry.name === 'first-contentful-paint');
  } else {
    run();
  }
  return cancel;
};

const HeroStandIn = ({ staticIntro }) => {
  const ref = useRef(null);
  useLayoutEffect(() => {
    // React has just emptied #root; put the intro back before the browser paints.
    if (staticIntro && ref.current) ref.current.appendChild(staticIntro);
  }, [staticIntro]);
  if (!staticIntro) return <section className="min-h-screen w-full" />;
  return <div ref={ref} style={{ display: 'contents' }} />;
};

// ---------- Below-the-fold sections ----------
// Projects (the 3D computer and its screenshots), Work Experience (the animated avatar) and
// Contact (EmailJS) are their own chunks too. The small sections (ImpactBand, Hackathons,
// Writing) are not worth a request each.
//
// A deferred section renders a placeholder first: an empty <section> with the real id (so #anchor
// links, the command palette and AniBot always find their target) and roughly the real height (so
// the scrollbar and the sections below barely move when it swaps in). The real section mounts
// when the first of these happens:
//   1. it comes within one and a half screens of the viewport,
//   2. the page goes idle after load (all of them, so crawlers that render JavaScript without
//      scrolling still see every section),
//   3. someone follows a #hash link (all of them, then the target is scrolled into place again,
//      because the sections above it may have changed height).
const Projects = lazy(() => import('./sections/Projects.jsx'));
const WorkExperience = lazy(() => import('./sections/Experience.jsx'));
const Contact = lazy(() => import('./sections/Contact.jsx'));

// Heights measured on the built page at 390px and 1440px wide (the layouts switch at lg).
const RESERVE = {
  projects: 'min-h-[1220px] lg:min-h-[670px]',
  work: 'min-h-[2350px] lg:min-h-[1010px]',
  contact: 'min-h-screen',
};

const DeferredSection = ({ component: Section, id, active, ...props }) => {
  const ref = useRef(null);
  const [near, setNear] = useState(false);
  const show = active || near;

  useEffect(() => {
    if (show) return undefined;
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined') {
      setNear(true);
      return undefined;
    }
    const io = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return;
        io.disconnect();
        setNear(true);
      },
      { rootMargin: '150% 0px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [show]);

  const placeholder = <section ref={ref} id={id} className={`c-space my-20 ${RESERVE[id]}`} data-deferred-section="" />;
  if (!show) return placeholder;
  return (
    <ChunkBoundary>
      <Suspense fallback={placeholder}>
        <Section {...props} />
      </Suspense>
    </ChunkBoundary>
  );
};

// ---------- #hash links ----------
const USER_SCROLL_EVENTS = ['wheel', 'touchstart', 'keydown', 'pointerdown'];

const hashTarget = () => {
  let id = '';
  try {
    id = decodeURIComponent(window.location.hash.slice(1));
  } catch {
    return null;
  }
  return id ? document.getElementById(id) : null;
};

// Scroll without the page-wide `scroll-behavior: smooth` (index.css), in every browser.
const scrollInstantly = (el) => {
  const root = document.documentElement;
  const previous = root.style.scrollBehavior;
  root.style.scrollBehavior = 'auto';
  el.scrollIntoView({ block: 'start' });
  root.style.scrollBehavior = previous;
};

// Waits until every deferred section has mounted, then brings the #hash target into view. On a
// fresh load it also keeps the target in place for a moment while late content above it settles
// (the Writing cards arrive after a fetch), and stops as soon as the visitor scrolls.
// Returns a cancel function.
const alignToHash = ({ smooth }) => {
  let raf = 0;
  let timer = 0;
  let observer = null;
  let stopped = false;
  const startedAt = performance.now();

  const stop = () => {
    stopped = true;
    cancelAnimationFrame(raf);
    clearTimeout(timer);
    observer?.disconnect();
    USER_SCROLL_EVENTS.forEach((type) => window.removeEventListener(type, stop, true));
  };

  const align = () => {
    const el = hashTarget();
    if (!el) return;
    if (smooth) el.scrollIntoView({ block: 'start', behavior: 'smooth' });
    else scrollInstantly(el);
  };

  const whenReady = () => {
    if (stopped) return;
    if (hasPlaceholders() && performance.now() - startedAt < 8000) {
      raf = requestAnimationFrame(whenReady);
      return;
    }
    align();
    if (smooth) {
      stop();
      return;
    }
    const main = document.querySelector('main');
    if (main && typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver(align);
      observer.observe(main);
    }
    timer = setTimeout(stop, 2500);
  };

  USER_SCROLL_EVENTS.forEach((type) => window.addEventListener(type, stop, { capture: true, passive: true }));
  raf = requestAnimationFrame(whenReady);
  return stop;
};

// A reload or Back/Forward restores the visitor's own scroll position; only a fresh visit to
// /#section should jump to the section.
const isFreshNavigation = () => {
  const nav = performance.getEntriesByType?.('navigation')?.[0];
  return !nav || nav.type === 'navigate';
};

const App = ({ staticIntro = null }) => {
  useScrollReveal();

  // Once the intro text has painted, start the hero chunk (see Hero above) and the AniBot chunk
  // (the chat button), so neither competes with the CSS and fonts for that first paint.
  const [painted, setPainted] = useState(false);
  useEffect(() => afterIntroPainted(staticIntro, () => setPainted(true)), [staticIntro]);

  // A #hash on arrival (the About page and the blog link to /#contact) needs every section in
  // place before the browser can land on it.
  const [mountAll, setMountAll] = useState(() => window.location.hash.length > 1);

  // The command palette can ask the Selected Work carousel for a project before Projects has
  // mounted. Remember the last request so Projects can start on it.
  const requestedProject = useRef(null);

  useEffect(() => {
    const onShowProject = (e) => {
      requestedProject.current = e.detail?.id ?? null;
      setMountAll(true);
    };
    window.addEventListener(SHOW_PROJECT_EVENT, onShowProject);
    return () => window.removeEventListener(SHOW_PROJECT_EVENT, onShowProject);
  }, []);

  // Mount everything once the page is idle after load.
  useEffect(() => {
    if (mountAll) return undefined;
    let idle = 0;
    let timeout = 0;
    const go = () => setMountAll(true);
    const schedule = () => {
      if ('requestIdleCallback' in window) idle = window.requestIdleCallback(go, { timeout: 3000 });
      else timeout = window.setTimeout(go, 1200);
    };
    if (document.readyState === 'complete') schedule();
    else window.addEventListener('load', schedule, { once: true });
    return () => {
      window.removeEventListener('load', schedule);
      if (idle) window.cancelIdleCallback(idle);
      clearTimeout(timeout);
    };
  }, [mountAll]);

  // #hash links: on arrival, and every in-page jump (navbar, command palette, About's contact
  // button) while some sections are still placeholders.
  useEffect(() => {
    let cancel = () => {};
    if (hashTarget() && isFreshNavigation()) cancel = alignToHash({ smooth: false });

    const onHashChange = () => {
      if (!hashTarget() || !hasPlaceholders()) return; // everything is in place: the browser got it right
      setMountAll(true);
      cancel();
      cancel = alignToHash({ smooth: true });
    };
    window.addEventListener('hashchange', onHashChange);
    return () => {
      window.removeEventListener('hashchange', onHashChange);
      cancel();
    };
  }, []);

  const heroStandIn = <HeroStandIn staticIntro={staticIntro} />;

  return (
    <>
      <a
        href="#home"
        className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-[60] focus:bg-black-300 focus:text-white focus:px-4 focus:py-2 focus:rounded-md"
      >
        Skip to main content
      </a>
      <Navbar />
      <main className="max-w-7xl mx-auto relative">
        {painted ? (
          <ChunkBoundary fallback={heroStandIn}>
            <Suspense fallback={heroStandIn}>
              <Hero />
            </Suspense>
          </ChunkBoundary>
        ) : (
          heroStandIn
        )}
        <About />
        <ImpactBand />
        <DeferredSection
          component={Projects}
          id="projects"
          active={mountAll}
          getInitialProjectId={() => requestedProject.current}
        />
        <Hackathons />
        <Writing />
        <DeferredSection component={WorkExperience} id="work" active={mountAll} />
        <DeferredSection component={Contact} id="contact" active={mountAll} />
      </main>
      <div className="max-w-7xl mx-auto relative">
        <Footer />
      </div>
      {painted && (
        <ChunkBoundary>
          <Suspense fallback={null}>
            <AiChatbot />
          </Suspense>
        </ChunkBoundary>
      )}
      {/* Cmd/Ctrl+K. Only the key listener is in the main bundle; the palette UI is lazy. */}
      <CommandPaletteHost />
    </>
  );
};

export default App;
