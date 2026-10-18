// Tiny, always-loaded helpers for the command palette. The palette UI itself is a separate
// lazy chunk (CommandPalette.jsx); everything here stays small because it ships in the main bundle.

// Window events other parts of the site can use:
//   'command-palette:open'                         open the palette (navbar button, mobile menu)
//   'anibot:open'      detail?: { question }       open the AniBot chat (the chat widget listens)
//   'projects:show'    detail:  { id }             switch the Selected Work carousel to a project
export const OPEN_PALETTE_EVENT = 'command-palette:open';
export const ANIBOT_OPEN_EVENT = 'anibot:open';
export const SHOW_PROJECT_EVENT = 'projects:show';

export const openCommandPalette = () => window.dispatchEvent(new CustomEvent(OPEN_PALETTE_EVENT));

// The palette chunk is requested on the first open, or earlier when the navbar hint is hovered or
// the mobile menu opens. Once it has loaded, the host renders it synchronously (no Suspense
// round trip), which keeps the input focus inside the tap on phones.
let paletteModule = null;
export const loadCommandPalette = () =>
  import('./CommandPalette.jsx').then((m) => {
    paletteModule = m;
    return m;
  });
export const loadedCommandPalette = () => paletteModule?.default || null;
export const preloadCommandPalette = () => {
  if (!paletteModule) loadCommandPalette().catch(() => {});
};

export const isApplePlatform = () => {
  if (typeof navigator === 'undefined') return false;
  const platform = navigator.userAgentData?.platform || navigator.platform || navigator.userAgent || '';
  return /mac|iphone|ipad|ipod/i.test(platform);
};

// "⌘K" on Apple devices, "Ctrl K" everywhere else.
export const shortcutLabel = () => (isApplePlatform() ? '⌘K' : 'Ctrl K');
