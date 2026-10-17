import { Component, useEffect, useRef, useState } from 'react';
import { Canvas } from '@react-three/fiber';
import { useGLTF } from '@react-three/drei';

// Draco decoder served from this site (public/models/draco, copied from three r173
// examples/jsm/libs/draco/gltf, Apache-2.0) instead of drei's default gstatic CDN.
// Set at module load: Hero.jsx imports this file before any component that preloads a model,
// so every useGLTF call, including the ones that only pass `true`, picks up this path.
export const DRACO_PATH = '/models/draco/';
useGLTF.setDecoderPath(DRACO_PATH);

// R3F rethrows scene errors (no WebGL, a model that fails to load or no longer matches the code)
// into the React tree. Without a boundary that unmounts the whole page; with it, only this
// canvas disappears. Exported so other WebGL widgets (the About globe) can be wrapped the same way.
export class SceneBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { failed: false };
  }

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error) {
    console.warn('3D scene disabled:', error);
  }

  render() {
    return this.state.failed ? null : this.props.children;
  }
}

/**
 * Drop-in replacement for R3F's <Canvas>.
 *
 * - Mounts the WebGL canvas only once its box is within `mountMargin` of the viewport.
 *   IntersectionObserver reports after layout, so even the above-the-fold hero canvas is created
 *   after the first paint of the page text instead of blocking it.
 * - Stays mounted after that (a new WebGL context per scroll pass would be far more expensive),
 *   but renders continuously only while on screen. Offscreen it switches to frameloop "demand":
 *   no render loop, only a single frame when something in the scene changes (for example when a
 *   model finishes loading, which also warms up shaders before the section scrolls in).
 * - Contains its own errors (see SceneBoundary).
 */
const LazyCanvas = ({ mountMargin = '100% 0px', frameloop = 'always', children, ...props }) => {
  const holder = useRef(null);
  const [mounted, setMounted] = useState(false);
  const [onScreen, setOnScreen] = useState(false);

  useEffect(() => {
    const el = holder.current;
    if (!el) return undefined;
    if (typeof IntersectionObserver === 'undefined') {
      setMounted(true);
      setOnScreen(true);
      return undefined;
    }

    const near = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return;
        setMounted(true);
        near.disconnect();
      },
      { rootMargin: mountMargin },
    );
    const visible = new IntersectionObserver(([entry]) => setOnScreen(entry.isIntersecting));
    near.observe(el);
    visible.observe(el);
    return () => {
      near.disconnect();
      visible.disconnect();
    };
  }, [mountMargin]);

  // minHeight: inside a parent with no set height (the Experience card on phones) the mounted canvas
  // falls back to the browser default of 150px. Reserving that up front keeps the content below
  // from jumping when the canvas mounts. Parents with a real height are unaffected.
  return (
    <div ref={holder} style={{ width: '100%', height: '100%', minHeight: 150 }}>
      {mounted && (
        <SceneBoundary>
          <Canvas frameloop={onScreen ? frameloop : 'demand'} {...props}>
            {children}
          </Canvas>
        </SceneBoundary>
      )}
    </div>
  );
};

export default LazyCanvas;
