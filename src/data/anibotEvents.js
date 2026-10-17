// Open AniBot from anywhere on the homepage (the command palette, a button, a link).
//
//   window.dispatchEvent(new CustomEvent('anibot:open'))
//   window.dispatchEvent(new CustomEvent('anibot:open', { detail: { question: 'Which hackathons has he won?' } }))
//
// or import openAniBot below, which does the same and also covers the moment before the chat
// widget has mounted (it is lazy-loaded, so a very early event would otherwise be missed).
// A link to /#anibot opens the chat too.

export const ANIBOT_OPEN_EVENT = 'anibot:open';
export const ANIBOT_HASH = '#anibot';
const PENDING_KEY = '__anibotPendingOpen';

export function openAniBot(question) {
  if (typeof window === 'undefined') return;
  const detail = question ? { question: String(question) } : {};
  window[PENDING_KEY] = detail; // picked up on mount if the widget is not listening yet
  window.dispatchEvent(new CustomEvent(ANIBOT_OPEN_EVENT, { detail }));
}

// Called by the chat widget: returns a request made before it mounted, and clears it.
export function takePendingOpen() {
  if (typeof window === 'undefined') return null;
  const pending = window[PENDING_KEY];
  delete window[PENDING_KEY];
  return pending || null;
}
