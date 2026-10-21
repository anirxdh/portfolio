// The browser's speech output, shared by the hero's voice call and the chat window.
//
// iOS Safari only lets a page speak after speak() has run inside a tap, so unlockSpeech() runs in
// the click that starts speech. primeVoices() asks for the voice list early: some browsers load
// it asynchronously, and without it the first line would use a different voice than the rest.

const synth = typeof window !== 'undefined' && 'speechSynthesis' in window ? window.speechSynthesis : null;
let unlocked = false;
let primed = false;

export function primeVoices() {
  if (!synth || primed) return;
  primed = true;
  try {
    synth.getVoices();
    synth.addEventListener?.('voiceschanged', () => synth.getVoices());
  } catch {
    /* voices load when they load */
  }
}

export function unlockSpeech() {
  primeVoices();
  if (!synth || unlocked || typeof SpeechSynthesisUtterance === 'undefined') return;
  unlocked = true;
  try {
    const u = new SpeechSynthesisUtterance(' ');
    u.volume = 0;
    synth.speak(u);
  } catch {
    /* speech stays off; captions still work */
  }
}
