import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { GROUP_ORDER, articleCommands, askAniBotCommand, buildStaticCommands } from './commands.js';
import { isApplePlatform } from './events.js';
import { filterCommands } from './fuzzy.js';
import { loadBlogIndex } from '../../data/blogIndex.js';

// ---------- data ----------
// /blog/index.json is written by scripts/build-blog.mjs. It is fetched once per visit (shared with
// the homepage sections); a failed fetch is retried on the next open.
const loadArticles = loadBlogIndex;

// Recently used commands, per browser. Storage can be blocked, so every access is guarded.
const RECENT_KEY = 'av:palette-recent';
const readRecent = () => {
  try {
    const v = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]');
    return Array.isArray(v) ? v.filter((x) => typeof x === 'string').slice(0, 5) : [];
  } catch {
    return [];
  }
};
const writeRecent = (ids) => {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(ids.slice(0, 5)));
  } catch {
    // ignore: private mode or blocked storage
  }
};

// ---------- icons ----------
const ICONS = {
  search: ['M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14z', 'm20 20-4.2-4.2'],
  hash: ['M5 9h14', 'M5 15h14', 'M10 3 8 21', 'M16 3l-2 18'],
  page: ['M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z', 'M14 3v5h5', 'M9 13h6', 'M9 17h4'],
  article: [
    'M12 7v14',
    'M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z',
  ],
  download: ['M12 3v12', 'm8 11 4 4 4-4', 'M4 21h16'],
  copy: ['M10 9h9a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-9a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2z', 'M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1'],
  mail: ['M4 5h16a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z', 'm3 7 9 6 9-6'],
  chat: ['M21 12a8 8 0 0 1-11.6 7.1L4 20l1.1-4.2A8 8 0 1 1 21 12z', 'M8.5 12h.01', 'M12 12h.01', 'M15.5 12h.01'],
  external: ['M14 4h6v6', 'M20 4l-9 9', 'M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5'],
  project: ['M12 3 3 7.5 12 12l9-4.5z', 'M3 7.5v9L12 21l9-4.5v-9', 'M12 12v9'],
  sparkle: ['M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z', 'M19 15l.7 1.8 1.8.7-1.8.7L19 20l-.7-1.8-1.8-.7 1.8-.7z'],
  check: ['m5 12.5 4.5 4.5L19 7'],
  alert: ['M12 8v5', 'M12 16.5h.01', 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z'],
  clock: ['M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z', 'M12 7.5V12l3 2'],
};

const Icon = ({ name, className = '' }) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.75"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
    aria-hidden="true"
    focusable="false"
  >
    {(ICONS[name] || ICONS.page).map((d) => (
      <path key={d} d={d} />
    ))}
  </svg>
);

const TILE = 'flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border';

const CommandIcon = ({ command, status }) => {
  const [broken, setBroken] = useState(false);
  if (status) {
    const ok = status === 'ok';
    return (
      <span className={`${TILE} ${ok ? 'border-green-500/30 bg-green-500/10 text-green-400' : 'border-red-500/30 bg-red-500/10 text-red-400'}`}>
        <Icon name={ok ? 'check' : 'alert'} className="h-[18px] w-[18px]" />
      </span>
    );
  }
  if (command.image && !broken) {
    return (
      <span className={`${TILE} border-black-500/40 bg-black-300`} style={command.image.style}>
        <img
          src={command.image.src}
          alt=""
          className="h-5 w-5 object-contain"
          loading="lazy"
          decoding="async"
          onError={() => setBroken(true)}
        />
      </span>
    );
  }
  const tint = command.accent
    ? { color: command.accent, backgroundColor: `${command.accent}1a`, borderColor: `${command.accent}33` }
    : undefined;
  return (
    <span className={`${TILE} border-black-500/40 bg-black-300 text-white-600`} style={tint}>
      <Icon name={command.icon} className="h-[18px] w-[18px]" />
    </span>
  );
};

// Title with the fuzzy-matched characters emphasised.
const Highlight = ({ text, indices }) => {
  if (!indices || indices.length === 0) return text;
  const hit = new Set(indices);
  const parts = [];
  let buf = '';
  let on = hit.has(0);
  for (let i = 0; i < text.length; i += 1) {
    const m = hit.has(i);
    if (m !== on) {
      parts.push({ text: buf, on });
      buf = '';
      on = m;
    }
    buf += text[i];
  }
  parts.push({ text: buf, on });
  return parts.map((p, k) =>
    p.on ? (
      <mark key={k} className="bg-transparent font-semibold text-white">
        {p.text}
      </mark>
    ) : (
      <span key={k}>{p.text}</span>
    ),
  );
};

const Kbd = ({ children }) => (
  <kbd className="inline-flex h-5 min-w-[1.25rem] items-center justify-center rounded border border-black-500/60 bg-black-300 px-1 font-generalsans text-[10px] font-medium text-white-800">
    {children}
  </kbd>
);

// ---------- palette ----------
const CommandPalette = ({ onClose }) => {
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const [articles, setArticles] = useState(null); // null = loading
  const [articlesFailed, setArticlesFailed] = useState(false);
  const [recent] = useState(readRecent);
  const [flash, setFlash] = useState(null); // { id, text, ok }
  const [announcement, setAnnouncement] = useState('');
  const [shown, setShown] = useState(false);
  // Whatever had focus before the palette opened (read during the first render, before the input
  // takes focus), so focus can go back there on close.
  const [returnFocusTo] = useState(() => document.activeElement);

  const dialogRef = useRef(null);
  const inputRef = useRef(null);
  const listRef = useRef(null);
  const closeTimer = useRef(null);
  const mounted = useRef(false);
  const lastPointer = useRef({ x: -1, y: -1 });

  const uid = useId();
  const listId = `${uid}-list`;
  const optionId = (i) => `${uid}-opt-${i}`;
  const apple = useMemo(isApplePlatform, []);

  // Articles: fetched when the palette opens.
  useEffect(() => {
    let alive = true;
    loadArticles()
      .then((list) => alive && setArticles(list))
      .catch(() => {
        if (!alive) return;
        setArticles([]);
        setArticlesFailed(true);
      });
    return () => {
      alive = false;
    };
  }, []);

  // Modal plumbing: focus the input, make the page behind inert, lock its scroll, and hand focus
  // back (without scrolling) on close. Layout effect so the cleanup runs before any follow-up
  // action, such as AniBot opening and taking focus.
  useLayoutEffect(() => {
    mounted.current = true;
    const previous = returnFocusTo;
    const root = document.getElementById('root');
    const html = document.documentElement;
    const body = document.body;
    const prevOverflow = html.style.overflow;
    const prevPadding = body.style.paddingRight;
    const scrollbar = window.innerWidth - html.clientWidth;

    root?.setAttribute('inert', '');
    html.style.overflow = 'hidden';
    if (scrollbar > 0) body.style.paddingRight = `${scrollbar}px`;
    inputRef.current?.focus();
    const raf = requestAnimationFrame(() => setShown(true));

    return () => {
      mounted.current = false;
      cancelAnimationFrame(raf);
      clearTimeout(closeTimer.current);
      root?.removeAttribute('inert');
      html.style.overflow = prevOverflow;
      body.style.paddingRight = prevPadding;
      if (previous instanceof HTMLElement && previous.isConnected && previous !== body) {
        previous.focus({ preventScroll: true });
      }
    };
  }, [returnFocusTo]);

  const staticCommands = useMemo(buildStaticCommands, []);
  const allCommands = useMemo(
    () => [...staticCommands, ...articleCommands(articles || [])],
    [staticCommands, articles],
  );

  const trimmed = query.trim();
  const { sections, matchCount } = useMemo(() => {
    if (!trimmed) {
      const byId = new Map(allCommands.map((c) => [c.id, c]));
      const recentCommands = recent.map((id) => byId.get(id)).filter(Boolean).slice(0, 3);
      const recentIds = new Set(recentCommands.map((c) => c.id));
      const out = [];
      if (recentCommands.length) {
        out.push({ group: 'Recent', items: recentCommands.map((command) => ({ command, indices: [] })) });
      }
      for (const group of GROUP_ORDER) {
        const items = allCommands
          .filter((c) => c.group === group && !recentIds.has(c.id))
          .map((command) => ({ command, indices: [] }));
        if (items.length) out.push({ group, items });
      }
      return { sections: out, matchCount: allCommands.length };
    }
    const ranked = filterCommands(trimmed, allCommands).slice(0, 40);
    const out = [];
    if (ranked.length) out.push({ group: 'Results', items: ranked });
    out.push({ group: 'AniBot', items: [{ command: askAniBotCommand(trimmed), indices: [] }] });
    return { sections: out, matchCount: ranked.length };
  }, [trimmed, allCommands, recent]);

  const flat = useMemo(() => sections.flatMap((s) => s.items), [sections]);
  const activeIndex = flat.length ? Math.min(active, flat.length - 1) : -1;

  // Keep the active row visible while moving with the keyboard.
  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    if (activeIndex <= 0) {
      list.scrollTop = 0;
      return;
    }
    list.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex, trimmed]);

  // Tell screen readers how many results there are once typing pauses.
  useEffect(() => {
    if (!trimmed) return undefined;
    const id = setTimeout(() => {
      setAnnouncement(matchCount === 0 ? 'No matches. Press Enter to ask AniBot.' : `${matchCount} ${matchCount === 1 ? 'result' : 'results'}`);
    }, 350);
    return () => clearTimeout(id);
  }, [trimmed, matchCount]);

  // Saved for the next open only, so rows never jump around under the pointer mid-session.
  const remember = (id) => {
    if (id === 'ask-anibot') return;
    writeRecent([id, ...readRecent().filter((r) => r !== id)]);
  };

  const run = (command, { newTab = false } = {}) => {
    if (!command) return;
    remember(command.id);

    if (command.href && (newTab || command.run === 'external')) {
      window.open(command.href, '_blank', 'noopener,noreferrer');
      onClose();
      return;
    }
    switch (command.run) {
      case 'navigate':
        onClose();
        window.location.assign(command.href);
        break;
      case 'now':
        command.perform();
        onClose();
        break;
      case 'stay':
        // perform may be async (clipboard), so both callbacks ignore a palette that already closed.
        command.perform({
          flash: (text, ok = true) => {
            if (!mounted.current) return;
            setFlash({ id: command.id, text, ok });
            setAnnouncement(text);
            inputRef.current?.focus();
          },
          close: (delay = 0) => {
            if (!mounted.current) return;
            clearTimeout(closeTimer.current);
            closeTimer.current = setTimeout(onClose, delay);
          },
        });
        break;
      default:
        // 'after': close first so focus is restored, then act (scroll, open AniBot, ...).
        onClose();
        setTimeout(command.perform, 0);
    }
  };

  const move = (delta) => {
    if (!flat.length) return;
    setActive((activeIndex + delta + flat.length) % flat.length);
  };

  const onInputKeyDown = (e) => {
    if (e.nativeEvent.isComposing) return;
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        move(1);
        break;
      case 'ArrowUp':
        e.preventDefault();
        move(-1);
        break;
      case 'PageDown':
        e.preventDefault();
        setActive(Math.min(flat.length - 1, activeIndex + 5));
        break;
      case 'PageUp':
        e.preventDefault();
        setActive(Math.max(0, activeIndex - 5));
        break;
      case 'Enter':
        e.preventDefault();
        if (activeIndex >= 0) run(flat[activeIndex].command, { newTab: e.metaKey || e.ctrlKey });
        break;
      default:
    }
  };

  // Escape closes from anywhere in the dialog; Tab stays inside it.
  const onDialogKeyDown = (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      onClose();
      return;
    }
    if (e.key !== 'Tab') return;
    const focusables = [...dialogRef.current.querySelectorAll('input, button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])')];
    if (!focusables.length) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };

  let row = -1;
  const showLoading = !trimmed && articles === null;

  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-start justify-center px-3 pt-3 font-generalsans sm:px-4 sm:pt-[12vh]">
      <div
        aria-hidden="true"
        onClick={onClose}
        className={`absolute inset-0 bg-black-100/75 backdrop-blur-sm transition-opacity duration-200 motion-reduce:transition-none ${
          shown ? 'opacity-100' : 'opacity-0'
        }`}
      />

      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        onKeyDown={onDialogKeyDown}
        className={`relative flex max-h-[calc(100dvh-1.5rem)] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-black-300 bg-black-200 shadow-[0_32px_90px_-16px_rgba(0,0,0,0.9)] transition duration-200 ease-out motion-reduce:transition-none sm:max-h-[min(36rem,76vh)] ${
          shown ? 'translate-y-0 scale-100 opacity-100' : '-translate-y-2 scale-[0.98] opacity-0'
        }`}
      >
        <div className="flex items-center gap-3 border-b border-black-300 px-4">
          <Icon name="search" className="h-5 w-5 shrink-0 text-white-600" />
          <input
            ref={inputRef}
            type="text"
            role="combobox"
            aria-expanded="true"
            aria-controls={listId}
            aria-activedescendant={activeIndex >= 0 ? optionId(activeIndex) : undefined}
            aria-autocomplete="list"
            aria-label="Search the site"
            placeholder="Search or jump to…"
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
            enterKeyHint="go"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(0);
              setFlash(null);
            }}
            onKeyDown={onInputKeyDown}
            className="h-14 min-w-0 flex-1 bg-transparent text-base text-white-800 placeholder:text-white-500 focus:outline-none"
          />
          <button
            type="button"
            onClick={onClose}
            aria-label="Close command palette"
            className="shrink-0 rounded-md border border-black-500/60 bg-black-300 px-2 py-1 text-[11px] font-medium uppercase tracking-wider text-white-600 transition-colors hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400"
          >
            <span className="sm:hidden">Close</span>
            <span className="hidden sm:inline">Esc</span>
          </button>
        </div>

        {trimmed && matchCount === 0 && (
          <p className="px-5 pt-5 text-sm text-white-600">
            Nothing matches <span className="text-white-800">&ldquo;{trimmed}&rdquo;</span>. Try a project name or a topic,
            or ask AniBot.
          </p>
        )}

        <div
          ref={listRef}
          id={listId}
          role="listbox"
          aria-label="Results"
          onMouseDown={(e) => {
            // Keep focus in the search box when a row is clicked (but let the scrollbar work).
            if (e.target !== e.currentTarget) e.preventDefault();
          }}
          className="flex-1 overflow-y-auto overscroll-contain p-2"
          style={{ scrollBehavior: 'auto' }}
        >
          {sections.map((section) => {
            const headingId = `${uid}-group-${section.group.replace(/\W+/g, '-')}`;
            return (
              <div key={section.group} role="group" aria-labelledby={headingId} className="pb-1">
                <div id={headingId} className="flex items-center gap-2 px-3 pb-1.5 pt-3 text-[11px] uppercase tracking-widest text-white-600">
                  {section.group === 'Recent' && <Icon name="clock" className="h-3 w-3" />}
                  {section.group}
                </div>
                {section.items.map(({ command, indices }) => {
                  row += 1;
                  const i = row;
                  const isActive = i === activeIndex;
                  const flashed = flash && flash.id === command.id ? flash : null;
                  return (
                    <div
                      key={command.id}
                      id={optionId(i)}
                      role="option"
                      aria-selected={isActive}
                      data-active={isActive}
                      onMouseMove={(e) => {
                        const p = lastPointer.current;
                        if (p.x === e.clientX && p.y === e.clientY) return; // ignore scroll-induced events
                        lastPointer.current = { x: e.clientX, y: e.clientY };
                        if (!isActive) setActive(i);
                      }}
                      onClick={(e) => run(command, { newTab: e.metaKey || e.ctrlKey })}
                      onAuxClick={(e) => {
                        if (e.button === 1 && command.href) run(command, { newTab: true });
                      }}
                      className={`flex cursor-pointer select-none items-center gap-3 rounded-xl px-3 py-2.5 transition-colors duration-100 ${
                        isActive ? 'bg-black-300' : 'bg-transparent'
                      }`}
                    >
                      <CommandIcon command={command} status={flashed ? (flashed.ok ? 'ok' : 'error') : null} />
                      <div className="min-w-0 flex-1">
                        <p className={`truncate text-[15px] leading-snug ${isActive ? 'text-white' : 'text-white-800'}`}>
                          <Highlight text={command.title} indices={indices} />
                        </p>
                        {(flashed || command.subtitle) && (
                          <p className={`truncate text-xs leading-snug ${flashed ? (flashed.ok ? 'text-green-400' : 'text-red-400') : 'text-white-600'}`}>
                            {flashed ? flashed.text : command.subtitle}
                          </p>
                        )}
                      </div>
                      {trimmed && section.group === 'Results' && (
                        <span className="hidden shrink-0 text-[11px] text-white-500 sm:inline">{command.kind}</span>
                      )}
                      {command.run === 'external' && <Icon name="external" className="h-3.5 w-3.5 shrink-0 text-white-500" />}
                      <span className={`hidden shrink-0 sm:inline-flex ${isActive ? 'opacity-100' : 'opacity-0'}`} aria-hidden="true">
                        <Kbd>↵</Kbd>
                      </span>
                    </div>
                  );
                })}
              </div>
            );
          })}

          {showLoading && (
            <p className="px-3 py-2 text-xs text-white-600" aria-hidden="true">
              Loading articles…
            </p>
          )}
          {!trimmed && articlesFailed && (
            <p className="px-3 py-2 text-xs text-white-600" aria-hidden="true">
              Articles did not load. Pick All writing to see every one.
            </p>
          )}
        </div>

        <div className="hidden items-center justify-between gap-4 border-t border-black-300 px-4 py-2.5 text-[11px] text-white-600 sm:flex">
          <span className="flex items-center gap-4">
            <span className="flex items-center gap-1.5">
              <Kbd>↑</Kbd>
              <Kbd>↓</Kbd>
              move
            </span>
            <span className="flex items-center gap-1.5">
              <Kbd>↵</Kbd>
              open
            </span>
            <span className="flex items-center gap-1.5">
              <Kbd>{apple ? '⌘' : 'Ctrl'}</Kbd>
              <Kbd>↵</Kbd>
              new tab
            </span>
          </span>
          <span className="flex items-center gap-1.5">
            <Kbd>{apple ? '⌘' : 'Ctrl'}</Kbd>
            <Kbd>K</Kbd>
            toggle
          </span>
        </div>

        <div role="status" aria-live="polite" className="sr-only">
          {announcement}
        </div>
      </div>
    </div>,
    document.body,
  );
};

export default CommandPalette;
