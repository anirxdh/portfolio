import { useCallback, useEffect, useRef, useState } from 'react';

// Voice in/out for AniBot using the browser's own speech engines (no API keys, no extra cost).
// Recognition: Web Speech API (Chrome, Edge, Safari). Synthesis: speechSynthesis (all modern browsers).

const Recognition = typeof window !== 'undefined' ? window.SpeechRecognition || window.webkitSpeechRecognition : null;
const synth = typeof window !== 'undefined' ? window.speechSynthesis : null;

// Markdown is for the eyes; read only the words. Link lists ("Read more: ...") are for clicking,
// so they are skipped, and link labels are read without their URLs.
export const toSpeech = (md) =>
  String(md || '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/^\s*(\*\*)?read more:(\*\*)?.*$/gim, ' ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/https?:\/\/\S+/g, '')
    .replace(/\s+[·•|]\s+/g, ', ')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/[*_#>|]/g, '')
    // A line break with no punctuation (list items, headings) still needs a pause when spoken.
    .replace(/([^\s.!?:;,])[ \t]*\n+/g, '$1. ')
    .replace(/\p{Extended_Pictographic}/gu, '')
    .replace(/\s+/g, ' ')
    .trim();

// What the visitor sees when recognition fails. `fatal` errors hide the mic for the rest of the visit,
// since every later attempt would fail the same way.
export const RECOGNITION_ERRORS = {
  'not-allowed': { message: 'Microphone access is blocked, so voice input is off. You can type your question instead.', fatal: true },
  'service-not-allowed': { message: 'Voice input is not available in this browser. You can type your question instead.', fatal: true },
  'audio-capture': { message: 'No microphone was found. You can type your question instead.', fatal: true },
  network: { message: 'Voice input is not available in this browser right now. You can type your question instead.', fatal: true },
  'language-not-supported': { message: 'Voice input is not available in this browser. You can type your question instead.', fatal: true },
  'no-speech': { message: "I didn't catch that. Tap the mic and try again.", fatal: false },
};
const START_FAILED = { message: 'Voice input could not start. You can type your question instead.', fatal: true };

export const pickVoice = () => {
  const voices = synth?.getVoices() || [];
  const en = voices.filter((v) => /^en(-|_)/i.test(v.lang));
  const prefer = [/natural/i, /google us english/i, /samantha/i, /aria/i, /jenny/i, /daniel/i];
  for (const re of prefer) {
    const v = en.find((x) => re.test(x.name));
    if (v) return v;
  }
  return en.find((v) => v.default) || en[0] || null;
};

/**
 * onFinalTranscript(text):       the visitor finished speaking; send it.
 * onUnconfirmedTranscript(text): recognition stopped on an error after showing words it never
 *                                confirmed; put them in the input for the visitor to check and send.
 */
const useVoice = ({ onFinalTranscript, onUnconfirmedTranscript } = {}) => {
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState('');
  const [speaking, setSpeaking] = useState(false);
  const [error, setError] = useState('');
  const [blocked, setBlocked] = useState(false);
  const recRef = useRef(null);
  const unlockedRef = useRef(false);
  const finalCb = useRef(onFinalTranscript);
  finalCb.current = onFinalTranscript;
  const unconfirmedCb = useRef(onUnconfirmedTranscript);
  unconfirmedCb.current = onUnconfirmedTranscript;

  const canListen = !!Recognition && !blocked;
  const canSpeak = !!synth;

  useEffect(() => {
    // Some browsers load voices asynchronously; touching getVoices() starts that.
    synth?.getVoices();
    return () => {
      const rec = recRef.current;
      if (rec) {
        rec.cancelled = true;
        rec.abort();
      }
      synth?.cancel();
    };
  }, []);

  // iOS Safari only lets a page speak after speak() has run inside a tap. Call this from a click
  // handler (the mic, the speaker toggle) so later replies, which arrive after a fetch, can play.
  const unlock = useCallback(() => {
    if (!synth || unlockedRef.current || typeof SpeechSynthesisUtterance === 'undefined') return;
    unlockedRef.current = true;
    const u = new SpeechSynthesisUtterance(' ');
    u.volume = 0;
    synth.speak(u);
  }, []);

  const startListening = useCallback(() => {
    if (!Recognition || recRef.current) return;
    unlock();
    synth?.cancel();
    setSpeaking(false);
    setError('');
    const rec = new Recognition();
    rec.lang = 'en-US';
    rec.interimResults = true;
    rec.continuous = false;
    let finalText = '';
    let heard = '';
    let failed = false;
    rec.onresult = (e) => {
      // Rebuild from the start each time: some engines re-deliver earlier results.
      let fin = '';
      let live = '';
      for (let i = 0; i < e.results.length; i += 1) {
        const r = e.results[i];
        if (r.isFinal) fin += r[0].transcript;
        else live += r[0].transcript;
      }
      finalText = fin;
      heard = (fin + live).trim();
      setInterim(heard);
    };
    rec.onerror = (e) => {
      if (rec.cancelled) return;
      failed = true;
      const info = RECOGNITION_ERRORS[e.error];
      if (info) setError(info.message);
      if (info?.fatal) setBlocked(true);
    };
    rec.onend = () => {
      if (recRef.current === rec) recRef.current = null;
      setListening(false);
      setInterim('');
      if (rec.cancelled) return;
      // Some engines (Safari) end without ever marking a result final. When the session ended
      // normally, the words on screen are what the visitor said, so send them. After an error,
      // hand them back for review instead.
      const text = (finalText || (failed ? '' : heard)).trim();
      if (text) finalCb.current?.(text);
      else if (heard) unconfirmedCb.current?.(heard);
    };
    recRef.current = rec;
    setListening(true);
    try {
      rec.start();
    } catch {
      recRef.current = null;
      setListening(false);
      setInterim('');
      setError(START_FAILED.message);
      setBlocked(true);
    }
  }, [unlock]);

  // Finish listening and send what was heard (the mic button's "Stop listening").
  const stopListening = useCallback(() => recRef.current?.stop(), []);

  // Stop listening and throw away what was heard (closing or hiding the chat).
  const cancelListening = useCallback(() => {
    const rec = recRef.current;
    if (!rec) return;
    rec.cancelled = true;
    recRef.current = null;
    setListening(false);
    setInterim('');
    rec.abort();
  }, []);

  const isListening = useCallback(() => recRef.current !== null, []);

  const speak = useCallback((markdown) => {
    // Never talk over an open mic: it would hear the reply.
    if (!synth || recRef.current) return;
    const text = toSpeech(markdown);
    if (!text) return;
    synth.cancel();
    const u = new SpeechSynthesisUtterance(text);
    const voice = pickVoice();
    if (voice) u.voice = voice;
    u.rate = 1.03;
    u.onstart = () => setSpeaking(true);
    u.onend = () => setSpeaking(false);
    u.onerror = () => setSpeaking(false);
    synth.speak(u);
  }, []);

  const stopSpeaking = useCallback(() => {
    synth?.cancel();
    setSpeaking(false);
  }, []);

  const clearError = useCallback(() => setError(''), []);

  return {
    canListen,
    canSpeak,
    listening,
    interim,
    speaking,
    error,
    clearError,
    startListening,
    stopListening,
    cancelListening,
    isListening,
    unlock,
    speak,
    stopSpeaking,
  };
};

export default useVoice;
