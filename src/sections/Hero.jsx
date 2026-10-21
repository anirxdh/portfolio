// The homepage hero: the name on a horizon under a calm constellation of projects, and AniBot.
//
// Everything a visitor or crawler needs is plain HTML at first paint (index.html ships the same
// markup as a static intro, kept in step by scripts/prerender-home.mjs). The effects load after:
//   - the sky and the universe below it: src/components/story (one fixed Canvas 2D layer)
//   - the name-to-orb particles: src/components/hero/nameOrb.js
//   - the voice call: src/components/hero/voiceCall.js (browser speech, the same /api/chat)
// "Talk to AniBot" turns the name into the orb and starts a real voice conversation. It ends with
// the End button, Escape, a click outside the hero, or leaving the page, and the name rebuilds.
// prefers-reduced-motion, no canvas, or an error: a still CSS orb and the same conversation.

import { useCallback, useEffect, useRef, useState } from 'react';

import { openAniBot } from '../data/anibotEvents.js';
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

// iOS Safari only lets a page speak after speak() ran inside a tap, so this runs in the click.
let speechUnlocked = false;
const unlockSpeech = () => {
  const synth = typeof window !== 'undefined' && window.speechSynthesis;
  if (!synth || speechUnlocked || typeof SpeechSynthesisUtterance === 'undefined') return;
  speechUnlocked = true;
  try {
    const u = new SpeechSynthesisUtterance(' ');
    u.volume = 0;
    synth.speak(u);
  } catch {
    /* captions still work */
  }
};

const Arrow = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true" focusable="false">
    <path d="M3 8h9.5M8.5 4l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const Hero = () => {
  const heroRef = useRef(null);
  const nameRef = useRef(null);
  const fxRef = useRef(null);
  const slotRef = useRef(null);
  const skyRef = useRef(null);
  const cardRef = useRef(null);
  const talkRef = useRef(null);
  const inputRef = useRef(null);
  const orbRef = useRef(null);
  const orbPromise = useRef(null);
  const callRef = useRef(null);
  const callOnRef = useRef(false);

  const [fx, setFx] = useState(() => wantsMotion() && canDraw());
  const fxRefState = useRef(fx);
  fxRefState.current = fx;
  const [callOn, setCallOn] = useState(false);
  const [vstate, setVState] = useState('ended');
  const [nameOut, setNameOut] = useState(false);
  const [phase, setPhase] = useState('rest');
  const [caption, setCaption] = useState(null);
  const [textMode, setTextMode] = useState(false);
  const [hint, setHint] = useState('');
  const [draft, setDraft] = useState('');
  const [live, setLive] = useState('');
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
            slot: slotRef.current,
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
  const endCall = useCallback(() => {
    if (!callOnRef.current) return;
    callOnRef.current = false;
    callRef.current?.end();
    callRef.current = null;
    setCallOn(false);
    setVState('ended');
    setCaption(null);
    setTextMode(false);
    setHint('');
    setDraft('');
    setSkyDim(0);
    if (orbRef.current) orbRef.current.end();
    else setNameOut(false);
  }, []);

  const startCall = useCallback(async () => {
    if (callOnRef.current) return;
    unlockSpeech();
    callOnRef.current = true;
    setCallOn(true);
    setVState('starting');
    setCaption(null);
    setLive('');
    const voice = hasRecognition();
    setTextMode(!voice);
    setHint(voice ? '' : 'Type your question and AniBot will answer out loud.');
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
      setCaption({ who: 'bot', words: 'Voice is not available right now. Try the chat instead.'.split(' '), shown: 99 });
      return;
    }
    if (orb) orb.start();
    else setNameOut(true);
    const call = mod.createVoiceCall({
      onState: (s) => {
        if (callOnRef.current) setVState(s);
      },
      onCaption: (c) => {
        if (callOnRef.current) setCaption(c);
      },
      onLine: setLive,
      onNeedText: (message) => {
        setTextMode(true);
        setHint(message);
      },
    });
    callRef.current = call;
    call.start({ greetDelay: orb ? 1350 : 350 });
  }, [ensureOrb]);

  const onTalk = () => (callOnRef.current ? endCall() : startCall());

  // Escape, a click outside the hero, a hidden tab or a hero scrolled away ends the call.
  useEffect(() => {
    if (!callOn) return undefined;
    const onKey = (e) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      if (document.querySelector('[aria-modal="true"]')) return;
      endCall();
      talkRef.current?.focus();
    };
    const onDown = (e) => {
      if (heroRef.current && !heroRef.current.contains(e.target)) endCall();
    };
    const onHide = () => {
      if (document.hidden) endCall();
    };
    let io = null;
    if ('IntersectionObserver' in window && heroRef.current) {
      io = new IntersectionObserver(([entry]) => {
        if (!entry.isIntersecting) endCall();
      });
      io.observe(heroRef.current);
    }
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onDown, true);
    document.addEventListener('visibilitychange', onHide);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onDown, true);
      document.removeEventListener('visibilitychange', onHide);
      io?.disconnect();
    };
  }, [callOn, endCall]);

  const showForm = callOn && (textMode || vstate === 'waiting');
  useEffect(() => {
    if (showForm && textMode) inputRef.current?.focus({ preventScroll: true });
  }, [showForm, textMode]);

  const sendTyped = (e) => {
    e.preventDefault();
    const text = draft.trim();
    if (!text || !callRef.current) return;
    setDraft('');
    callRef.current.ask(text);
  };

  const typeInstead = () => {
    callRef.current?.typeInstead();
    setTextMode(true);
    setHint('Type your question and AniBot will answer out loud.');
  };

  const switchToMic = () => {
    if (!callRef.current?.canListen) return;
    setTextMode(false);
    setHint('');
    callRef.current.listen();
  };

  const arm = (on) => {
    if (on) ensureOrb();
    orbRef.current?.setArmed(on && !callOnRef.current);
  };

  const status = STATUS[vstate] || 'Ready';
  const listening = vstate === 'listening';
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
          <div ref={slotRef} className="orb-slot">
            <div className="orb-css" />
            <p className="call-status">
              <span className="call-dot" />
              <span className="call-name">AniBot</span>
              <span className="call-sep" />
              <span>{status}</span>
            </p>
          </div>
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

            {callOn && (
              <div className="call-panel">
                <p
                  className={`call-caption${(caption?.words?.length || 0) > 22 ? ' is-long' : ''}`}
                  aria-hidden="true"
                  data-who={caption?.who || 'none'}
                >
                  {caption?.who === 'you' && <span className="cap-label">You</span>}
                  {caption?.words?.length
                    ? caption.words.map((w, i) => (
                        <span key={`${i}-${w}`} className={`cw${i < caption.shown ? ' on' : ''}${i === caption.shown - 1 && caption.who === 'bot' ? ' now' : ''}`}>
                          {w}{' '}
                        </span>
                      ))
                    : listening && <span className="cap-hint">Listening. Ask about a project, a hackathon or his work at Rivo.</span>}
                </p>
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
                    {hint && <p className="call-hint">{hint}</p>}
                  </form>
                ) : (
                  <button type="button" className="call-switch" onClick={typeInstead}>
                    Type instead
                  </button>
                )}
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
                <span aria-hidden="true"> →</span>
              </a>
            )}
          </>
        )}
      </div>

      <p className="sr-only" aria-live="polite">
        {live}
      </p>
    </section>
  );
};

export default Hero;
