import { Component, useCallback, useEffect, useState } from 'react';

import { OPEN_PALETTE_EVENT, loadCommandPalette, loadedCommandPalette } from './events.js';

// The palette (fuzzy search, icons, article list) is its own chunk. Only this listener ships in
// the main bundle; the chunk loads on the first Cmd/Ctrl+K, or earlier on hover of the navbar hint.

// If the palette throws while rendering, fail closed instead of unmounting the whole page.
class PaletteBoundary extends Component {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch() {
    this.props.onError();
  }

  render() {
    return this.state.failed ? null : this.props.children;
  }
}

const isPaletteShortcut = (e) => {
  if (!(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey || e.repeat || e.isComposing) return false;
  const key = (e.key || '').toLowerCase();
  // e.code covers keyboard layouts where the K key does not produce a Latin "k".
  return key === 'k' || (!/^[a-z]$/.test(key) && e.code === 'KeyK');
};

const CommandPaletteHost = () => {
  const [open, setOpen] = useState(false);
  const [, setLoaded] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  const Palette = loadedCommandPalette();

  useEffect(() => {
    const onKeyDown = (e) => {
      if (!isPaletteShortcut(e)) return;
      e.preventDefault();
      setOpen((o) => !o);
    };
    const onOpen = () => setOpen(true);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener(OPEN_PALETTE_EVENT, onOpen);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener(OPEN_PALETTE_EVENT, onOpen);
    };
  }, []);

  // First open: fetch the chunk, then render. Offline or a stale deploy: just stay closed.
  useEffect(() => {
    if (!open || Palette) return undefined;
    let alive = true;
    loadCommandPalette()
      .then(() => alive && setLoaded(true))
      .catch(() => alive && setOpen(false));
    return () => {
      alive = false;
    };
  }, [open, Palette]);

  if (!open || !Palette) return null;
  return (
    <PaletteBoundary onError={close}>
      <Palette onClose={close} />
    </PaletteBoundary>
  );
};

export default CommandPaletteHost;
