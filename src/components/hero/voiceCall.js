// The hero's voice call with AniBot, on the browser's own speech engines (no paid voice, no keys).
// AniBot greets out loud, listens with SpeechRecognition, sends the question to the same backend
// as the chat window (POST /api/chat, streamed, with the offline notes as the fallback), speaks the
// answer sentence by sentence as it streams in, captions it word by word, then listens again.
// It runs until the visitor ends the call. No React here: the hero subscribes through callbacks
// and the orb reads levels() once per frame.
//
//   onState(state)        'greeting' | 'listening' | 'thinking' | 'speaking' | 'waiting' | 'ended'
//   onCaption(caption)    { who: 'bot' | 'you', words: string[], shown: number } or null
//   onLine(text)          a whole line for the screen reader live region
//   onNeedText(message)   voice input is unavailable or failed: show the text field with this hint

import { API_URL, FIRST_BYTE_TIMEOUT_MS, RETRY_LIVE_AFTER_MS, loadNotes } from '../../data/anibotClient.js';
import { RECOGNITION_ERRORS, pickVoice, toSpeech } from '../../hooks/useVoice.js';

const Recognition = typeof window !== 'undefined' ? window.SpeechRecognition || window.webkitSpeechRecognition : null;
const synth = typeof window !== 'undefined' && 'speechSynthesis' in window ? window.speechSynthesis : null;

export const canRecognize = () => !!Recognition;

const GREETING = "Hi, I'm AniBot. Ask me anything about Anirudh's work.";
const GREETING_TEXT = "Hi, I'm AniBot. Type a question below and I'll answer out loud.";
const FAILED = 'Sorry, I could not reach my notes just now. Please try again in a moment.';
// A spoken answer stops after about this many words; the chat window is there for the long version.
const MAX_SPOKEN_WORDS = 80;
const MAX_NO_SPEECH = 2;
const RATE = 1.03;

const now = () => performance.now() / 1000;
const words = (s) => String(s).split(/\s+/).filter(Boolean);
// Complete sentences in cleaned text, and whatever is left after the last one.
const splitSentences = (text) => {
  const out = [];
  const re = /[^.!?]+(?:[.!?]+["')\]]*)(?=\s|$)/g;
  let m;
  let last = 0;
  while ((m = re.exec(text))) {
    const s = m[0].trim();
    if (s) out.push(s);
    last = re.lastIndex;
  }
  return { sentences: out, rest: text.slice(last).trim() };
};

// iOS Safari only lets a page speak after speak() has run inside a tap. Call from the click.
let unlocked = false;
export const unlockSpeech = () => {
  if (!synth || unlocked || typeof SpeechSynthesisUtterance === 'undefined') return;
  unlocked = true;
  try {
    const u = new SpeechSynthesisUtterance(' ');
    u.volume = 0;
    synth.speak(u);
  } catch {
    /* speech stays off; captions still work */
  }
};

export function createVoiceCall({ onState, onCaption, onLine, onNeedText } = {}) {
  let gen = 0; // bumps on end(), so late async work from an old turn does nothing
  let state = 'idle';
  let rec = null;
  let fetchAbort = null;
  let history = [];
  let previousQuestions = [];
  const seen = new Set();
  let liveRetryAt = 0;
  let noSpeech = 0;
  let voiceBlocked = !Recognition;
  let preferText = false; // the visitor chose to type: after an answer, wait for the next one

  // Speech output
  let queue = [];
  let speakingLine = null; // { words, shown, boundary, startAt, timer, watchdog }
  let streamDone = true;
  let spokenWords = 0;
  let afterSpeech = null;
  let ticker = 0;

  // Levels for the orb
  let wordAt = -10;
  let wordLen = 4;
  let speechActive = false;
  let bump = 0;
  let bumpAt = 0;

  const setState = (s) => {
    if (state === s) return;
    state = s;
    onState?.(s);
  };
  const caption = (c) => onCaption?.(c);

  /* ---------- Speaking ---------- */
  const startWord = (w) => {
    wordAt = now();
    wordLen = Math.max(1, String(w || '').replace(/[^A-Za-z0-9]/g, '').length || 3);
  };

  const reveal = (line, n) => {
    if (!line || n <= line.shown) return;
    line.shown = Math.min(n, line.words.length);
    startWord(line.words[line.shown - 1]);
    caption({ who: 'bot', words: line.words, shown: line.shown });
  };

  const estimate = (w) => (Math.max(2, w.replace(/[^A-Za-z0-9]/g, '').length) * 0.064 + 0.09) / RATE;

  // Without word boundary events (many network voices), captions follow an estimated pace.
  const tick = () => {
    const line = speakingLine;
    if (!line || line.boundary) return;
    const el = now() - line.startAt;
    let at = 0;
    let n = 0;
    for (; n < line.words.length; n++) {
      if (at > el) break;
      at += estimate(line.words[n]);
    }
    reveal(line, n);
  };

  const finishLine = (line, myGen) => {
    if (myGen !== gen || speakingLine !== line) return;
    clearTimeout(line.watchdog);
    reveal(line, line.words.length);
    speakingLine = null;
    onLine?.(line.text);
    speakNext(myGen);
  };

  const speakNext = (myGen) => {
    if (myGen !== gen) return;
    const text = queue.shift();
    if (!text) {
      if (streamDone) {
        const after = afterSpeech;
        afterSpeech = null;
        after?.();
      } else setState('thinking'); // waiting for the next sentence of the stream
      return;
    }
    setState(state === 'greeting' ? 'greeting' : 'speaking');
    const line = { text, words: words(text), shown: 0, boundary: false, startAt: now(), watchdog: 0 };
    speakingLine = line;
    caption({ who: 'bot', words: line.words, shown: 0 });
    const total = line.words.reduce((s, w) => s + estimate(w), 0);
    // Some engines never fire onend (Chrome with a long queue): move on anyway.
    line.watchdog = setTimeout(() => finishLine(line, myGen), (total * 2.2 + 3) * 1000);
    if (!synth) {
      clearTimeout(line.watchdog);
      line.watchdog = setTimeout(() => finishLine(line, myGen), total * 1000 + 250);
      return;
    }
    try {
      const u = new SpeechSynthesisUtterance(text);
      const v = pickVoice();
      if (v) u.voice = v;
      u.rate = RATE;
      u.onstart = () => {
        line.startAt = now();
        reveal(line, 1);
      };
      u.onboundary = (e) => {
        if (e.name && e.name !== 'word') return;
        line.boundary = true;
        // charIndex -> how many words have started.
        const before = text.slice(0, e.charIndex + 1);
        reveal(line, words(before).length);
      };
      u.onend = () => finishLine(line, myGen);
      u.onerror = () => finishLine(line, myGen);
      synth.speak(u);
    } catch {
      clearTimeout(line.watchdog);
      line.watchdog = setTimeout(() => finishLine(line, myGen), total * 1000 + 250);
    }
  };

  const enqueue = (sentence, myGen) => {
    if (myGen !== gen || spokenWords >= MAX_SPOKEN_WORDS) return;
    const n = words(sentence).length;
    if (!n) return;
    spokenWords += n;
    queue.push(sentence);
    if (!speakingLine) speakNext(myGen);
  };

  /* ---------- Listening ---------- */
  const needText = (message) => {
    setState('waiting');
    caption(null);
    onNeedText?.(message);
  };

  // After AniBot finishes a line: listen again, or wait for the next typed question.
  const next = () => {
    if (preferText || voiceBlocked || !Recognition) {
      setState('waiting');
      caption(null);
      return;
    }
    listen();
  };

  const listen = () => {
    const myGen = gen;
    if (state === 'ended') return;
    preferText = false;
    if (voiceBlocked || !Recognition) {
      needText('Type your question and AniBot will answer out loud.');
      return;
    }
    try {
      synth?.cancel();
    } catch {
      /* nothing was speaking */
    }
    if (rec) {
      rec.cancelled = true;
      try {
        rec.abort();
      } catch {
        /* already stopped */
      }
    }
    const r = new Recognition();
    r.lang = 'en-US';
    r.interimResults = true;
    r.continuous = false;
    let finalText = '';
    let heard = '';
    let failed = false;
    let errorCode = '';
    r.onspeechstart = () => {
      speechActive = true;
    };
    r.onsoundend = () => {
      speechActive = false;
    };
    r.onspeechend = () => {
      speechActive = false;
    };
    r.onresult = (e) => {
      let fin = '';
      let live = '';
      for (let i = 0; i < e.results.length; i += 1) {
        const res = e.results[i];
        if (res.isFinal) fin += res[0].transcript;
        else live += res[0].transcript;
      }
      finalText = fin;
      heard = (fin + live).trim();
      speechActive = true;
      bump = 1;
      bumpAt = now();
      const ws = words(heard);
      caption({ who: 'you', words: ws, shown: ws.length });
    };
    r.onerror = (e) => {
      if (r.cancelled) return;
      failed = true;
      errorCode = e.error;
    };
    r.onend = () => {
      speechActive = false;
      if (rec === r) rec = null;
      if (r.cancelled || myGen !== gen || state === 'ended') return;
      const text = (finalText || heard).trim();
      if (text) {
        noSpeech = 0;
        ask(text);
        return;
      }
      const info = RECOGNITION_ERRORS[errorCode];
      if (failed && info?.fatal) {
        voiceBlocked = true;
        needText(info.message.replace('You can type your question instead.', 'Type your question and AniBot will answer out loud.'));
        return;
      }
      if (failed && errorCode && errorCode !== 'no-speech' && errorCode !== 'aborted') {
        needText('Voice input stopped. Type your question, or press the mic to try again.');
        return;
      }
      noSpeech += 1;
      if (noSpeech >= MAX_NO_SPEECH) {
        noSpeech = 0;
        needText("I didn't catch that. Type a question, or press the mic to try again.");
        return;
      }
      listen();
    };
    rec = r;
    setState('listening');
    caption({ who: 'you', words: [], shown: 0 });
    try {
      r.start();
    } catch {
      rec = null;
      voiceBlocked = true;
      needText('Voice input could not start. Type your question and AniBot will answer out loud.');
    }
  };

  const stopRecognition = () => {
    const r = rec;
    rec = null;
    speechActive = false;
    if (!r) return;
    r.cancelled = true;
    try {
      r.abort();
    } catch {
      /* already stopped */
    }
  };

  /* ---------- Answering ---------- */
  const streamLive = async (text, myGen, onText) => {
    const controller = new AbortController();
    fetchAbort = controller;
    const timer = setTimeout(() => controller.abort(), FIRST_BYTE_TIMEOUT_MS);
    let response;
    try {
      response = await fetch(API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text, conversationHistory: history.slice(-10), mode: 'voice' }),
        signal: controller.signal,
      });
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
    if (!response.ok || !response.body) return null;
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let acc = '';
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done || myGen !== gen) break;
        acc += decoder.decode(value, { stream: true });
        onText(acc, false);
      }
    } catch {
      /* a stream that breaks after real text keeps what arrived */
    }
    if (myGen !== gen) return acc || null;
    if (!acc.trim()) return null;
    onText(acc, true);
    return acc;
  };

  const ask = async (question) => {
    const text = String(question || '').trim();
    if (!text || state === 'ended') return;
    stopRecognition();
    gen += 1;
    const myGen = gen;
    try {
      synth?.cancel();
    } catch {
      /* nothing was speaking */
    }
    queue = [];
    speakingLine = null;
    spokenWords = 0;
    streamDone = false;
    const ws = words(text);
    caption({ who: 'you', words: ws, shown: ws.length });
    onLine?.(`You: ${text}`);
    setState('thinking');

    let queued = 0;
    const feed = (raw, final) => {
      const clean = toSpeech(raw);
      const { sentences, rest } = splitSentences(clean);
      const ready = final && rest ? [...sentences, rest] : sentences;
      while (queued < ready.length) enqueue(ready[queued++], myGen);
    };

    let answer = null;
    const online = typeof navigator === 'undefined' || navigator.onLine !== false;
    if (online && Date.now() >= liveRetryAt) answer = await streamLive(text, myGen, feed);
    if (myGen !== gen) return;
    if (!answer) {
      liveRetryAt = Date.now() + RETRY_LIVE_AFTER_MS;
      try {
        const { engine, index } = await loadNotes();
        if (myGen !== gen) return;
        const reply = engine.answerLocally(index, text, { previous: previousQuestions, seen });
        reply.ids.forEach((id) => seen.add(id));
        answer = reply.text;
        feed(answer, true);
      } catch {
        if (myGen !== gen) return;
        answer = null;
        feed(FAILED, true);
      }
    }
    if (answer) {
      history.push({ role: 'user', content: text }, { role: 'assistant', content: answer });
      history = history.slice(-10);
      previousQuestions = [...previousQuestions, text].slice(-3);
    }
    streamDone = true;
    afterSpeech = next;
    if (!speakingLine && !queue.length) {
      afterSpeech = null;
      next();
    }
  };

  /* ---------- Lifecycle ---------- */
  const start = ({ greetDelay = 0 } = {}) => {
    if (state !== 'idle') return;
    const myGen = gen;
    state = 'starting';
    clearInterval(ticker);
    ticker = setInterval(tick, 50);
    setTimeout(() => {
      if (myGen !== gen || state === 'ended') return;
      setState('greeting');
      streamDone = true;
      spokenWords = 0;
      afterSpeech = next;
      enqueue(voiceBlocked ? GREETING_TEXT : GREETING, myGen);
    }, greetDelay);
  };

  const end = () => {
    gen += 1;
    stopRecognition();
    fetchAbort?.abort();
    fetchAbort = null;
    if (speakingLine) clearTimeout(speakingLine.watchdog);
    speakingLine = null;
    queue = [];
    afterSpeech = null;
    clearInterval(ticker);
    try {
      synth?.cancel();
    } catch {
      /* nothing was speaking */
    }
    caption(null);
    setState('ended');
  };

  // Per frame, for the orb.
  const out = { speaking: false, listening: false, thinking: false, speak: 0, hi: 0, user: 0 };
  const levels = () => {
    const tt = now();
    const speaking = !!speakingLine;
    out.speaking = speaking;
    out.listening = state === 'listening';
    out.thinking = state === 'thinking' && !speaking;
    if (speaking) {
      const syl = Math.max(1, Math.round(wordLen / 3));
      const dur = estimate('x'.repeat(wordLen));
      const ph = (tt - wordAt) / dur;
      if (ph < 1) {
        const k = ph * syl;
        out.speak = Math.pow(Math.abs(Math.sin(Math.PI * k)), 0.7) * (0.6 + 0.4 * Math.abs(Math.sin(wordAt * 13.7)));
        out.hi = Math.exp(-(k - Math.floor(k)) * 9) * 0.7;
      } else {
        out.speak = 0.12 + 0.08 * Math.sin(tt * 9);
        out.hi = 0;
      }
    } else {
      out.speak = 0;
      out.hi = 0;
    }
    if (out.listening) {
      const b = bump * Math.exp(-(tt - bumpAt) * 4);
      const noise = 0.5 + 0.5 * Math.sin(tt * 11.3) * Math.sin(tt * 4.7 + 1.3);
      out.user = speechActive ? Math.min(1, 0.3 + 0.35 * noise + 0.45 * b) : 0.05 + 0.05 * Math.sin(tt * 2.2);
    } else out.user = 0;
    return out;
  };

  // The visitor pressed "Type instead": stop the mic and wait for typed questions.
  const typeInstead = () => {
    preferText = true;
    if (state === 'listening') {
      stopRecognition();
      setState('waiting');
      caption(null);
    }
  };

  return {
    start,
    end,
    ask,
    listen,
    typeInstead,
    levels,
    get state() {
      return state;
    },
    get canListen() {
      return !!Recognition && !voiceBlocked;
    },
  };
}
