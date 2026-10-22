// What every AniBot surface shares: the chat window (src/hooks/useAiChat.js) and the hero's voice
// call (src/components/hero/voiceCall.js) talk to the same backend and fall back to the same notes.

export const API_URL = import.meta.env.VITE_CHAT_API_URL || '/api/chat';
// Written at build time by scripts/build-anibot-kb.mjs. Same value as KB_URL in src/data/anibotLocal.js,
// repeated here so the knowledge base and the engine chunk can download in parallel.
export const KB_URL = '/anibot-kb.json';
// Give up on the live AI if it has not started answering by then.
export const FIRST_BYTE_TIMEOUT_MS = 15000;
// After a failure, answer from notes for a while before trying the live AI again.
export const RETRY_LIVE_AFTER_MS = 60000;

// The offline engine and its knowledge base load once, on the first failure, then stay in memory.
let notesPromise = null;
export const loadNotes = () => {
  if (!notesPromise) {
    notesPromise = Promise.all([
      import('./anibotLocal.js'),
      fetch(KB_URL).then((r) => {
        if (!r.ok) throw new Error(`Knowledge base: ${r.status}`);
        return r.json();
      }),
    ])
      .then(([engine, kb]) => ({ engine, index: engine.buildIndex(kb) }))
      .catch((err) => {
        notesPromise = null; // let the next message try again
        throw err;
      });
  }
  return notesPromise;
};
