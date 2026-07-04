import { Suspense, useEffect, useRef, useState } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import {
  KeyboardControls,
  useKeyboardControls,
  Grid,
  Billboard,
  Text,
  useTexture,
} from '@react-three/drei';
import * as THREE from 'three';

import { myProjects } from '../constants/index.js';

// Lay the projects out in a ring around the origin.
const PORTALS = myProjects.map((p, i) => {
  const angle = (i / myProjects.length) * Math.PI * 2;
  const radius = 26;
  return {
    short: p.title.split('—')[0].trim(),
    href: p.href,
    texture: (p.textures && p.textures[0]) || '/textures/project/lark-1.jpg',
    position: [Math.sin(angle) * radius, 0, Math.cos(angle) * radius],
  };
});

const keyMap = [
  { name: 'forward', keys: ['ArrowUp', 'KeyW'] },
  { name: 'back', keys: ['ArrowDown', 'KeyS'] },
  { name: 'left', keys: ['ArrowLeft', 'KeyA'] },
  { name: 'right', keys: ['ArrowRight', 'KeyD'] },
  { name: 'action', keys: ['KeyE', 'Space'] },
];

const NEAR_DIST = 8;

function Car({ carRef }) {
  const wheels = [
    [-0.9, 0.35, 1],
    [0.9, 0.35, 1],
    [-0.9, 0.35, -1],
    [0.9, 0.35, -1],
  ];
  return (
    <group ref={carRef}>
      <mesh castShadow position={[0, 0.5, 0]}>
        <boxGeometry args={[1.6, 0.6, 3]} />
        <meshStandardMaterial color="#7c5cf6" metalness={0.5} roughness={0.3} />
      </mesh>
      <mesh castShadow position={[0, 1, -0.2]}>
        <boxGeometry args={[1.3, 0.55, 1.4]} />
        <meshStandardMaterial color="#c9c2ff" metalness={0.3} roughness={0.2} />
      </mesh>
      {wheels.map((p, i) => (
        <mesh key={i} position={p} rotation={[0, 0, Math.PI / 2]} castShadow>
          <cylinderGeometry args={[0.35, 0.35, 0.3, 16]} />
          <meshStandardMaterial color="#111111" />
        </mesh>
      ))}
      <pointLight position={[0, 0.8, 1.6]} intensity={4} distance={12} color="#bfd0ff" />
    </group>
  );
}

function Portal({ data, active }) {
  const tex = useTexture(data.texture);
  useEffect(() => {
    if (tex) tex.colorSpace = THREE.SRGBColorSpace;
  }, [tex]);
  const ref = useRef();
  useFrame((_, delta) => {
    if (!ref.current) return;
    const target = active ? 1.12 : 1;
    const s = THREE.MathUtils.damp(ref.current.scale.x, target, 6, delta);
    ref.current.scale.set(s, s, s);
  });
  return (
    <group position={data.position}>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, 0]}>
        <circleGeometry args={[3.4, 40]} />
        <meshStandardMaterial
          color={active ? '#2a2350' : '#15132a'}
          emissive={active ? '#6d5bf0' : '#000000'}
          emissiveIntensity={active ? 0.5 : 0}
        />
      </mesh>
      <Billboard position={[0, 3.4, 0]}>
        <group ref={ref}>
          <mesh position={[0, 0, -0.02]}>
            <planeGeometry args={[5.5, 3.55]} />
            <meshBasicMaterial color={active ? '#8a7bff' : '#3a3550'} />
          </mesh>
          <mesh>
            <planeGeometry args={[5.2, 3.25]} />
            <meshBasicMaterial map={tex} toneMapped={false} />
          </mesh>
          <Text
            position={[0, 2.35, 0.02]}
            fontSize={0.42}
            color="#ffffff"
            anchorX="center"
            anchorY="middle"
            maxWidth={6}
            textAlign="center"
          >
            {data.short}
          </Text>
        </group>
      </Billboard>
    </group>
  );
}

function Scene({ onNearbyChange }) {
  const carRef = useRef();
  const [, getKeys] = useKeyboardControls();
  const state = useRef({ vel: 0, heading: 0, x: 0, z: 0, actionLatch: false, near: -1 });
  const [nearIdx, setNearIdx] = useState(-1);

  useFrame(({ camera }, delta) => {
    const s = state.current;
    const k = getKeys();
    const dt = Math.min(delta, 0.05); // guard against big frame gaps
    const accel = 26;

    if (k.forward) s.vel += accel * dt;
    if (k.back) s.vel -= accel * dt;
    s.vel *= 1 - Math.min(1, 1.6 * dt); // friction
    s.vel = THREE.MathUtils.clamp(s.vel, -8, 18);

    const steer = (k.left ? 1 : 0) - (k.right ? 1 : 0);
    if (Math.abs(s.vel) > 0.1) {
      s.heading += steer * 2.2 * dt * Math.sign(s.vel) * Math.min(1, Math.abs(s.vel) / 6 + 0.3);
    }

    const fx = -Math.sin(s.heading);
    const fz = -Math.cos(s.heading);
    s.x += fx * s.vel * dt;
    s.z += fz * s.vel * dt;

    const R = 40;
    const dist0 = Math.hypot(s.x, s.z);
    if (dist0 > R) {
      s.x = (s.x / dist0) * R;
      s.z = (s.z / dist0) * R;
      s.vel *= 0.4;
    }

    if (carRef.current) {
      carRef.current.position.set(s.x, 0, s.z);
      carRef.current.rotation.y = s.heading;
    }

    const camX = s.x - fx * 9;
    const camZ = s.z - fz * 9;
    camera.position.lerp(new THREE.Vector3(camX, 6.5, camZ), 1 - Math.pow(0.0015, dt));
    camera.lookAt(s.x, 1.2, s.z);

    let nearest = -1;
    let nd = NEAR_DIST;
    for (let i = 0; i < PORTALS.length; i++) {
      const d = Math.hypot(PORTALS[i].position[0] - s.x, PORTALS[i].position[2] - s.z);
      if (d < nd) {
        nd = d;
        nearest = i;
      }
    }
    if (nearest !== s.near) {
      s.near = nearest;
      setNearIdx(nearest);
      onNearbyChange(nearest);
    }

    if (k.action && nearest >= 0 && !s.actionLatch) {
      s.actionLatch = true;
      window.open(PORTALS[nearest].href, '_blank', 'noopener');
    }
    if (!k.action) s.actionLatch = false;
  });

  return (
    <>
      <hemisphereLight args={['#8899ff', '#20143a', 0.8]} />
      <directionalLight position={[15, 25, 10]} intensity={1.1} />
      <fog attach="fog" args={['#0b0a14', 34, 95]} />

      <Grid
        args={[120, 120]}
        cellSize={2}
        cellColor="#2a2745"
        sectionSize={10}
        sectionColor="#4b3fa0"
        fadeDistance={95}
        fadeStrength={1.5}
        infiniteGrid
      />

      <Car carRef={carRef} />
      {PORTALS.map((p, i) => (
        <Portal key={i} data={p} active={i === nearIdx} />
      ))}
    </>
  );
}

const ExploreWorld = ({ onExit }) => {
  const [nearby, setNearby] = useState(-1);

  // Prevent arrow/space from scrolling the page behind the overlay + ESC exits.
  useEffect(() => {
    const onKey = (e) => {
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
      if (e.code === 'Escape') onExit();
    };
    window.addEventListener('keydown', onKey, { passive: false });
    return () => window.removeEventListener('keydown', onKey);
  }, [onExit]);

  const nearProject = nearby >= 0 ? PORTALS[nearby] : null;

  return (
    <div className="fixed inset-0 z-[100] bg-[#0b0a14]">
      <KeyboardControls map={keyMap}>
        <Canvas camera={{ position: [0, 8, 16], fov: 55 }}>
          <Suspense fallback={null}>
            <Scene onNearbyChange={setNearby} />
          </Suspense>
        </Canvas>
      </KeyboardControls>

      <div className="pointer-events-none absolute inset-0 flex flex-col justify-between p-5">
        <div className="flex items-start justify-between gap-4">
          <button
            onClick={onExit}
            className="pointer-events-auto flex items-center gap-2 rounded-lg bg-black/60 backdrop-blur px-4 py-2 text-white text-sm border border-white/15 hover:bg-black/80 transition-colors"
          >
            ← Back to site
          </button>
          <div className="rounded-lg bg-black/50 backdrop-blur px-4 py-2 text-white/80 text-xs border border-white/10 text-right leading-relaxed">
            <p className="text-white font-semibold text-sm mb-0.5">Explore Mode 🎮</p>
            <p><span className="font-semibold text-white">W A S D</span> / arrows to drive</p>
            <p>Reach a project · <span className="font-semibold text-white">E</span> to open · <span className="font-semibold text-white">Esc</span> to exit</p>
          </div>
        </div>

        <div className="flex justify-center pb-4">
          {nearProject ? (
            <div className="rounded-full bg-white/95 text-black px-5 py-2.5 text-sm font-semibold shadow-lg animate-pulse">
              Press <span className="px-1.5 py-0.5 rounded bg-black text-white text-xs mx-1">E</span> to open {nearProject.short}
            </div>
          ) : (
            <div className="rounded-full bg-black/40 backdrop-blur text-white/70 px-5 py-2 text-xs border border-white/10">
              Drive toward a floating project to open it
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default ExploreWorld;
