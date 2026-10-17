import { useCallback, useEffect, useRef, useState } from 'react';

// Voice in/out for AniBot using the browser's own speech engines (no API keys, no extra cost).
// Recognition: Web Speech API (Chrome, Edge, Safari). Synthesis: speechSynthesis (all modern browsers).

const Recognition = typeof window !== 'undefined' ? window.SpeechRecognition || window.webkitSpeechRecognition : null;
const synth = typeof window !== 'undefined' ? window.speechSynthesis : null;

// Markdown is for the eyes; read only the words.
const toSpeech = (md) =>
  md
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/https?:\/\/\S+/g, '')
    .replace(/[*_#>|]/g, '')
    .replace(/\p{Extended_Pictographic}/gu, '')
    .replace(/\s+/g, ' ')
    .trim();

const pickVoice = () => {
  const voices = synth?.getVoices() || [];
  const en = voices.filter((v) => /^en(-|_)/i.test(v.lang));
  const prefer = [/natural/i, /google us english/i, /samantha/i, /aria/i, /jenny/i, /daniel/i];
  for (const re of prefer) {
    const v = en.find((x) => re.test(x.name));
    if (v) return v;
  }
  return en.find((v) => v.default) || en[0] || null;
};

const useVoice = ({ onFinalTranscript } = {}) => {
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState('');
  const [speaking, setSpeaking] = useState(false);
  const recRef = useRef(null);
  const finalCb = useRef(onFinalTranscript);
  finalCb.current = onFinalTranscript;

  const canListen = !!Recognition;
  const canSpeak = !!synth;

  useEffect(() => {
    // Some browsers load voices asynchronously; touching getVoices() starts that.
    synth?.getVoices();
    return () => {
      recRef.current?.abort();
      synth?.cancel();
    };
  }, []);

  const startListening = useCallback(() => {
    if (!Recognition || recRef.current) return;
    synth?.cancel();
    const rec = new Recognition();
    rec.lang = 'en-US';
    rec.interimResults = true;
    rec.continuous = false;
    let finalText = '';
    rec.onresult = (e) => {
      let live = '';
      for (let i = e.resultIndex; i < e.results.length; i += 1) {
        const r = e.results[i];
        if (r.isFinal) finalText += r[0].transcript;
        else live += r[0].transcript;
      }
      setInterim((finalText + live).trim());
    };
    rec.onerror = () => {};
    rec.onend = () => {
      recRef.current = null;
      setListening(false);
      setInterim('');
      const text = finalText.trim();
      if (text) finalCb.current?.(text);
    };
    recRef.current = rec;
    setListening(true);
    rec.start();
  }, []);

  const stopListening = useCallback(() => recRef.current?.stop(), []);

  const speak = useCallback((markdown) => {
    if (!synth) return;
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

  return { canListen, canSpeak, listening, interim, speaking, startListening, stopListening, speak, stopSpeaking };
};

export default useVoice;
