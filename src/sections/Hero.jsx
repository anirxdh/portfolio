// The homepage hero: the name on a horizon under a calm constellation of projects, and AniBot.
//
// Everything a visitor or crawler needs is plain HTML at first paint (index.html ships the same
// markup as a static intro, kept in step by scripts/prerender-home.mjs). The effects load after:
//   - the sky and the universe below it: src/components/story (one fixed Canvas 2D layer)
//   - the name-to-orb particles: src/components/hero/nameOrb.js
//   - the voice call: src/components/hero/voiceCall.js (browser speech, the same /api/chat)
// "Talk to AniBot" turns the name into the orb and starts a real voice conversation. On wide
// screens the orb forms beside the words it is saying; on phones it forms in the sky above them.
// The call ends with the End button, Escape, a click outside the hero, or leaving the page, and
// the name rebuilds. prefers-reduced-motion, no canvas, or an error: a still orb, same call.

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

import { Arrow } from '../components/Arrow.jsx';
import { openAniBot } from '../data/anibotEvents.js';
import { primeVoices, unlockSpeech } from '../data/speechUnlock.js';
import { registerHero, setSkyDim } from '../components/story/story.js';

const loadOrb = () => import('../components/hero/nameOrb.js');
const loadCall = () => import('../components/hero/voiceCall.js');

const STATUS = {
  starting: 'Waking up',
  greeting: 'Speaking',
  speaking: 'Speaking',
  listening: 'Listening',
  thinking: 'Thinking',
  waiting: 'Your turn',
  ended: 'Ready',
};
const ASK_ABOUT = 'Ask about a project, a hackathon or his work at Rivo.';
// The caption starts at its CSS size (a headline) and steps down to fit the space the name and
// the role line leave; below this it scrolls, line by line, to keep the word being spoken in view.
const CAPTION_MIN = 16;
const NO_VOICE = 'Voice input is not available in this browser, so type your question.';

const hasRecognition = () => typeof window !== 'undefined' && !!(window.SpeechRecognition || window.webkitSpeechRecognition);
const wantsMotion = () => {
  if (typeof window === 'undefined' || !window.matchMedia) return true;
  return !window.matchMedia('(prefers-reduced-motion: reduce)').matches && !window.matchMedia('(forced-colors: active)').matches;
};
const canDraw = () => {
  try {
    return !!document.createElement('canvas').getContext('2d');
  } catch {
    return false;
  }
};
// A mouse and a hardware keyboard: moving focus into the text field on its own is welcome.
// On a touch screen it would open the keyboard over the orb, so only a tap on "Type instead" does.
const finePointer = () => typeof window !== 'undefined' && !!window.matchMedia?.('(hover: hover) and (pointer: fine)').matches;

// The orb forms in whichever slot is shown: beside the words on wide screens, in the sky on phones.
const visibleSlot = (a, b) => (a && a.getClientRects().length ? a : b);

const OrbSlot = ({ slotRef, where, status }) => (
  <div ref={slotRef} className={`orb-slot is-${where}`} aria-hidden="true">
    <div className="orb-css" />
    <p className="call-status">
      <span className="call-dot" />
      <span className="call-name">AniBot</span>
      <span className="call-sep" />
      <span>{status}</span>
    </p>
  </div>
);

const Hero = () => {
  const heroRef = useRef(null);
  const nameRef = useRef(null);
  const fxRef = useRef(null);
  const skySlotRef = useRef(null);
  const stageSlotRef = useRef(null);
  const skyRef = useRef(null);
  const cardRef = useRef(null);
  const talkRef = useRef(null);
  const inputRef = useRef(null);
  const orbRef = useRef(null);
  const orbPromise = useRef(null);
  const callRef = useRef(null);
  const callOnRef = useRef(false);
  const focusFormRef = useRef(false);
  const panelRef = useRef(null);
  const capRef = useRef(null);
  const capLines = useRef(null); // set while a caption is too long to fit: { lh, base, lines }
  const capTop = useRef(0); // how far that caption is scrolled

  const [fx, setFx] = useState(() => wantsMotion() && canDraw());
  const fxRefState = useRef(fx);
  fxRefState.current = fx;
  const [callOn, setCallOn] = useState(false);
  const [vstate, setVState] = useState('ended');
  const [nameOut, setNameOut] = useState(false);
  const [phase, setPhase] = useState('rest');
  const [caption, setCaption] = useState(null);
  const [lastBot, setLastBot] = useState(null);
  const [textMode, setTextMode] = useState(false);
  const [hint, setHint] = useState('');
  const [draft, setDraft] = useState('');
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const [live, setLive] = useState('');
  const [said, setSaid] = useState('');
  const [more, setMore] = useState('');
  const [card, setCard] = useState(null);
  const [canListen, setCanListen] = useState(false);

  useEffect(() => setCanListen(hasRecognition()), []);

  // The sky: register the hero with the story engine (it loads itself when the page is idle).
  useEffect(() => {
    const hero = heroRef.current;
    if (!hero) return undefined;
    return registerHero({ hero, band: skyRef.current, card: cardRef.current, onCard: setCard });
  }, []);

  // The orb engine: created once the page is idle (or on the first hover of Talk), so the name's
  // shimmer and the hand-off are ready before anyone presses the button.
  const ensureOrb = useCallback(() => {
    if (!fxRefState.current) return Promise.resolve(null);
    if (!orbPromise.current) {
      orbPromise.current = loadOrb()
        .then(({ createNameOrb }) => {
          if (!heroRef.current || !fxRefState.current) return null;
          orbRef.current = createNameOrb({
            hero: heroRef.current,
            nameEl: nameRef.current,
            canvas: fxRef.current,
            slot: { getBoundingClientRect: () => visibleSlot(stageSlotRef.current, skySlotRef.current).getBoundingClientRect() },
            levels: () => callRef.current?.levels() || null,
            onPhase: setPhase,
            onNameOut: setNameOut,
            onFail: () => {
              orbRef.current = null;
              setFx(false);
              setNameOut(callOnRef.current);
            },
          });
          return orbRef.current;
        })
        .catch((err) => {
          console.warn('Name-to-orb unavailable:', err);
          setFx(false);
          return null;
        });
    }
    return orbPromise.current;
  }, []);

  useEffect(() => {
    let idle = 0;
    let timer = 0;
    const go = () => {
      ensureOrb();
      loadCall().catch(() => {});
      primeVoices();
    };
    const schedule = () => {
      if ('requestIdleCallback' in window) idle = window.requestIdleCallback(go, { timeout: 4000 });
      else timer = window.setTimeout(go, 1500);
    };
    if (document.readyState === 'complete') schedule();
    else window.addEventListener('load', schedule, { once: true });
    return () => {
      window.removeEventListener('load', schedule);
      if (idle) window.cancelIdleCallback?.(idle);
      clearTimeout(timer);
    };
  }, [ensureOrb]);

  useEffect(
    () => () => {
      callRef.current?.end();
      callRef.current = null;
      callOnRef.current = false;
      orbRef.current?.destroy();
      orbRef.current = null;
      orbPromise.current = null;
    },
    [],
  );

  /* ---------- The call ---------- */
  // `instant`: the hero is out of sight (scrolled away, tab hidden), so the name is simply back.
  const endCall = useCallback(({ instant = false } = {}) => {
    if (!callOnRef.current) return;
    callOnRef.current = false;
    callRef.current?.end();
    callRef.current = null;
    setCallOn(false);
    setVState('ended');
    setCaption(null);
    setLastBot(null);
    setTextMode(false);
    setHint('');
    setDraft('');
    setMore('');
    setSkyDim(0);
    if (orbRef.current) orbRef.current.end({ instant });
    else setNameOut(false);
  }, []);

  const startCall = useCallback(async () => {
    if (callOnRef.current) return;
    unlockSpeech();
    callOnRef.current = true;
    focusFormRef.current = false;
    setCallOn(true);
    setVState('starting');
    setCaption(null);
    setLastBot(null);
    setMore('');
    setLive('');
    const voice = hasRecognition();
    setTextMode(!voice);
    setHint(voice ? '' : NO_VOICE);
    setSkyDim(1);
    if (!fxRefState.current) setNameOut(true);
    let mod;
    let orb = null;
    try {
      [mod, orb] = await Promise.all([loadCall(), ensureOrb()]);
    } catch {
      mod = null;
    }
    if (!callOnRef.current) return;
    if (!mod) {
      const words = 'Voice is not available right now. Try the chat instead.'.split(' ');
      setCaption({ who: 'bot', words, shown: words.length });
      return;
    }
    if (orb) orb.start();
    else setNameOut(true);
    const call = mod.createVoiceCall({
      onState: (s) => {
        if (!callOnRef.current) return;
        setVState(s);
        if (s === 'thinking' || s === 'listening') setMore('');
      },
      onCaption: (c) => {
        if (!callOnRef.current) return;
        setCaption(c);
        if (c?.who === 'bot') setLastBot(c);
      },
      onLine: setLive,
      onNeedText: (message) => {
        setTextMode(true);
        setHint(message);
      },
      onCut: (question) => {
        if (callOnRef.current) setMore(question);
      },
    });
    callRef.current = call;
    call.start({ greetDelay: orb ? 1350 : 350 });
  }, [ensureOrb]);

  const onTalk = () => (callOnRef.current ? endCall() : startCall());

  // Escape, a click outside the hero, a hidden tab or a hero scrolled away ends the call. A touch
  // that starts a scroll is not a click, so scrolling on a phone does not end it by itself.
  useEffect(() => {
    if (!callOn) return undefined;
    const onKey = (e) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      if (document.querySelector('[aria-modal="true"]')) return;
      // The first Escape in the text field clears what was typed; the next one ends the call.
      if (e.target === inputRef.current && draftRef.current) {
        setDraft('');
        return;
      }
      endCall();
      talkRef.current?.focus();
    };
    const onClick = (e) => {
      if (heroRef.current && !heroRef.current.contains(e.target)) endCall();
    };
    const onHide = () => {
      if (document.hidden) endCall({ instant: true });
    };
    let io = null;
    if ('IntersectionObserver' in window && heroRef.current) {
      io = new IntersectionObserver(([entry]) => {
        if (!entry.isIntersecting) endCall({ instant: true });
      });
      io.observe(heroRef.current);
    }
    document.addEventListener('keydown', onKey);
    document.addEventListener('click', onClick, true);
    document.addEventListener('visibilitychange', onHide);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('click', onClick, true);
      document.removeEventListener('visibilitychange', onHide);
      io?.disconnect();
    };
  }, [callOn, endCall]);

  const showForm = callOn && (textMode || vstate === 'waiting');
  useEffect(() => {
    if (!showForm || !textMode) return;
    if (focusFormRef.current || finePointer()) inputRef.current?.focus({ preventScroll: true });
    focusFormRef.current = false;
  }, [showForm, textMode]);

  // Short spoken-state cues for screen readers (the orb and its status pill are decorative).
  useEffect(() => {
    let next = '';
    if (!callOn) next = said ? 'Call ended.' : '';
    else if (vstate === 'starting') next = 'Call started.';
    else if (vstate === 'listening') next = 'AniBot is listening.';
    else if (vstate === 'thinking') next = 'AniBot is thinking.';
    else if (vstate === 'waiting') next = hint || 'Your turn. Type your question.';
    if (next && next !== said) setSaid(next);
    // `said` is only read to skip repeats.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [callOn, vstate, hint]);

  const sendTyped = (e) => {
    e.preventDefault();
    const text = draft.trim();
    if (!text || !callRef.current) return;
    setDraft('');
    setHint('');
    callRef.current.ask(text, { typed: true });
  };

  const typeInstead = () => {
    callRef.current?.typeInstead();
    focusFormRef.current = true;
    setTextMode(true);
    setHint('');
  };

  const switchToMic = () => {
    if (!callRef.current?.canListen) return;
    setTextMode(false);
    setHint('');
    callRef.current.listen();
  };

  const continueInChat = () => {
    const question = more;
    endCall();
    openAniBot(question);
  };

  const arm = (on) => {
    if (on) ensureOrb();
    orbRef.current?.setArmed(on && !callOnRef.current);
  };

  /* ---------- The caption: as large as the space allows ---------- */
  // The call panel covers exactly the space of the name and the role line (it never changes the
  // hero's height, so the buttons stay where they are). The caption takes the top of it, the
  // prompt and the controls sit at the bottom, just above the buttons. The caption is measured
  // when its line or the controls change, never per frame; per word only while a line is too
  // long to fit even at the smallest size.
  const keepWordInView = useCallback(() => {
    const el = capRef.current;
    if (!el) return;
    let top = 0;
    const L = capLines.current;
    if (L) {
      const on = el.querySelectorAll('.cw.on');
      const w = on[on.length - 1];
      const first = el.querySelector('.cw');
      if (w && first) {
        const line = Math.round((w.offsetTop - first.offsetTop) / L.lh);
        if (line >= L.lines) top = L.base + (line - L.lines + 1) * L.lh;
      }
    }
    if (top === capTop.current) return;
    capTop.current = top;
    el.scrollTop = top;
    el.dataset.scrolled = top > 0 ? 'true' : 'false';
  }, []);

  const fitCaption = useCallback(() => {
    const el = capRef.current;
    if (!el) return;
    el.style.fontSize = '';
    el.style.maxHeight = '';
    capLines.current = null;
    capTop.current = -1;
    const fits = () => el.scrollHeight <= el.clientHeight + 1;
    if (!fits()) {
      const max = parseFloat(getComputedStyle(el).fontSize) || CAPTION_MIN;
      let lo = Math.min(max, CAPTION_MIN);
      let hi = max;
      for (let k = 0; k < 7 && hi - lo > 0.5; k++) {
        const mid = (lo + hi) / 2;
        el.style.fontSize = `${mid}px`;
        if (fits()) lo = mid;
        else hi = mid;
      }
      el.style.fontSize = `${Math.floor(lo)}px`;
      // Still too long at the smallest size: show whole lines only, and scroll line by line.
      const first = el.querySelector('.cw');
      if (!fits() && first) {
        const cs = getComputedStyle(el);
        const lh = parseFloat(cs.lineHeight);
        const pad = parseFloat(cs.paddingBottom) || 0;
        if (lh > 0) {
          const base = Math.max(0, first.offsetTop - (lh - first.offsetHeight) / 2);
          const lines = Math.max(1, Math.floor((el.clientHeight - pad - base) / lh));
          el.style.maxHeight = `${Math.floor(base + lines * lh + pad)}px`;
          capLines.current = { lh, base, lines };
        }
      }
    }
    keepWordInView();
  }, [keepWordInView]);

  const status = STATUS[vstate] || 'Ready';
  const listening = vstate === 'listening';
  // What the caption shows: the line being spoken or heard. Between turns, AniBot's last line
  // stays, dimmed, so the hero is never an empty band.
  const heardWords = caption?.who === 'you' && caption.words?.length > 0;
  const current = caption?.who === 'bot' || heardWords ? caption : null;
  const shown = current || (lastBot ? { ...lastBot, shown: lastBot.words.length, past: true } : null);
  const prompt = !heardWords && (listening ? `Listening. ${ASK_ABOUT}` : vstate === 'waiting' && !hint ? `Your turn. ${ASK_ABOUT}` : '');
  const capText = shown ? `${shown.who}:${shown.words.join(' ')}` : '';
  useLayoutEffect(() => {
    if (callOn) fitCaption();
  }, [callOn, capText, prompt, more, showForm, hint, fitCaption]);
  useLayoutEffect(() => {
    if (callOn) keepWordInView();
  }, [callOn, shown?.shown, keepWordInView]);
  // A new size of the space (rotation, a resized window) fits the caption again.
  useEffect(() => {
    const panel = panelRef.current;
    if (!callOn || !panel || !('ResizeObserver' in window)) return undefined;
    const ro = new ResizeObserver(() => fitCaption());
    ro.observe(panel);
    return () => ro.disconnect();
  }, [callOn, fitCaption]);

  const classes = [
    'hero',
    callOn ? 'is-call' : '',
    nameOut ? 'name-out' : '',
    fx ? '' : 'is-static',
    callOn && phase !== 'forming' ? 'is-live' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <section ref={heroRef} className={classes} id="home" aria-labelledby="hero-name" data-turn={callOn ? vstate : undefined}>
      <canvas ref={fxRef} className="hero-fx" width="1" height="1" aria-hidden="true" />

      <div className="hero-wrap">
        <div ref={skyRef} className="hero-sky" aria-hidden="true">
          <OrbSlot slotRef={skySlotRef} where="sky" status={status} />
        </div>

        <div className="hero-copy">
          <div className="hero-mast">
            <p className="hero-eyebrow">
              <span className="hero-dot" aria-hidden="true"></span>Full-stack and AI engineer · San Francisco
            </p>
            <span className="hero-rule" aria-hidden="true"></span>
          </div>

          <div className="hero-stage">
            <h1 className="hero-name" id="hero-name" ref={nameRef}>
              <span className="w">
                Anirudh<span className="bl" aria-hidden="true"></span>
              </span>{' '}
              <span className="w">
                Vasudevan<span className="bl" aria-hidden="true"></span>
              </span>
            </h1>
            <div className="hero-text">
              <p className="hero-role">Member of Technical Staff at Rivo, building voice AI agents.</p>
              <p className="hero-line">Each star here is a project I built and wrote up, and AniBot can tell you about any of them.</p>
            </div>
            <OrbSlot slotRef={stageSlotRef} where="stage" status={status} />

            {callOn && (
              <div ref={panelRef} className="call-panel">
                <p ref={capRef} className={`call-caption${shown?.past ? ' is-past' : ''}`} aria-hidden="true" data-who={shown?.who || 'none'}>
                  {shown?.who === 'you' && <span className="cap-label">You</span>}
                  {shown?.words?.map((w, i) => (
                    <span key={`${i}-${w}`} className={`cw${i < shown.shown ? ' on' : ''}${!shown.past && i === shown.shown - 1 && shown.who === 'bot' ? ' now' : ''}`}>
                      {w}{' '}
                    </span>
                  ))}
                </p>
                <div className="call-foot">
                  {prompt && <p className="call-prompt">{prompt}</p>}
                  {more && (
                    <button type="button" className="call-more" onClick={continueInChat}>
                      Continue in chat
                      <Arrow size={14} />
                    </button>
                  )}
                  {showForm ? (
                    <form className="call-form" onSubmit={sendTyped}>
                      <label className="sr-only" htmlFor="call-input">
                        Ask AniBot a question
                      </label>
                      <input
                        id="call-input"
                        ref={inputRef}
                        className="call-input"
                        type="text"
                        value={draft}
                        onChange={(e) => setDraft(e.target.value)}
                        placeholder="Ask AniBot anything"
                        autoComplete="off"
                        enterKeyHint="send"
                        aria-describedby={hint ? 'call-hint' : undefined}
                      />
                      {canListen && callRef.current?.canListen !== false && (
                        <button type="button" className="call-icon" onClick={switchToMic} aria-label="Speak instead">
                          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true" focusable="false">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M12 18.75a6 6 0 0 0 6-6v-1.5m-6 7.5a6 6 0 0 1-6-6v-1.5m6 7.5v3.75m-3.75 0h7.5M12 15.75a3 3 0 0 1-3-3V4.5a3 3 0 1 1 6 0v8.25a3 3 0 0 1-3 3Z" />
                          </svg>
                        </button>
                      )}
                      <button type="submit" className="call-send" disabled={!draft.trim()} aria-label="Send question">
                        <Arrow />
                      </button>
                      {hint && (
                        <p className="call-hint" id="call-hint">
                          {hint}
                        </p>
                      )}
                    </form>
                  ) : (
                    <button type="button" className="call-switch" onClick={typeInstead}>
                      Type instead
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>

          <div className="hero-below">
            <div className="hero-actions">
              <div className="hero-ctas">
                <button
                  ref={talkRef}
                  type="button"
                  className={`hbtn hbtn-primary${callOn ? ' is-live' : ''}`}
                  onClick={onTalk}
                  onPointerEnter={(e) => e.pointerType === 'mouse' && arm(true)}
                  onPointerLeave={() => arm(false)}
                  onFocus={() => arm(true)}
                  onBlur={() => arm(false)}
                  onTouchStart={() => ensureOrb()}
                >
                  <span className="eq" aria-hidden="true">
                    <i></i>
                    <i></i>
                    <i></i>
                    <i></i>
                  </span>
                  <span className="labels">
                    <span className="l-talk">Talk to AniBot</span>
                    <span className="l-end">End call</span>
                  </span>
                </button>
                <a className="hbtn hbtn-ghost" href="#universe">
                  See my work
                  <Arrow />
                </a>
              </div>
              <p className="hero-type">
                <a
                  href="#anibot"
                  className="hero-typelink"
                  onClick={(e) => {
                    e.preventDefault();
                    endCall();
                    openAniBot();
                  }}
                >
                  or type a question
                </a>
              </p>
            </div>
            <ul className="hero-proof" aria-label="Highlights">
              <li>
                <a href="/hackathons/">5x hackathon winner</a>
              </li>
              <li>
                <a href="/blog/lark-multi-agent-mcp/">YC AI Hackathon top 10</a>
              </li>
              <li>
                <a href="/research/#patent">granted patent</a>
              </li>
            </ul>
          </div>
        </div>
      </div>

      {/* The star you are near, its result and one line. Placed by the story engine. */}
      <div ref={cardRef} className="sky-card">
        {card && (
          <>
            <p className={`sky-kicker${card.mag === 1 ? ' is-award' : ''}`}>{card.kicker}</p>
            <p className="sky-name">{card.name}</p>
            {card.line && <p className="sky-line">{card.line}</p>}
            {card.href && (
              <a
                className="sky-link"
                href={card.href}
                {...(card.external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
              >
                {card.linkLabel}
                <span className="sr-only">: {card.name}</span>
                <Arrow size={14} />
              </a>
            )}
          </>
        )}
      </div>

      <p className="sr-only" role="status">
        {said}
      </p>
      <p className="sr-only" aria-live="polite">
        {live}
      </p>
    </section>
  );
};

export default Hero;
