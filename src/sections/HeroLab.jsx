import { Suspense, useMemo, useRef } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { Float, Sparkles, MeshDistortMaterial } from '@react-three/drei';
import * as THREE from 'three';

// Flowing aurora gradient behind everything (cheap, GPU-friendly sin field).
function AuroraBackground() {
  const matRef = useRef();
  const uniforms = useMemo(() => ({ uTime: { value: 0 } }), []);
  useFrame((_, delta) => {
    if (matRef.current) matRef.current.uniforms.uTime.value += delta;
  });
  return (
    <mesh position={[0, 0, -6]} scale={[44, 26, 1]}>
      <planeGeometry args={[1, 1]} />
      <shaderMaterial
        ref={matRef}
        uniforms={uniforms}
        vertexShader={`
          varying vec2 vUv;
          void main() {
            vUv = uv;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `}
        fragmentShader={`
          varying vec2 vUv;
          uniform float uTime;
          void main() {
            vec2 p = vUv;
            float t = uTime * 0.12;
            float a = sin(p.x * 3.0 + t) * 0.5 + 0.5;
            float b = sin(p.y * 4.0 - t * 1.3 + p.x * 2.5) * 0.5 + 0.5;
            float c = sin((p.x + p.y) * 2.2 + t * 0.7) * 0.5 + 0.5;
            vec3 deep = vec3(0.03, 0.02, 0.08);
            vec3 purple = vec3(0.36, 0.16, 0.72);
            vec3 blue = vec3(0.08, 0.28, 0.78);
            vec3 col = mix(deep, mix(purple, blue, b), a * 0.75);
            col += c * 0.06;
            float v = smoothstep(1.25, 0.25, length(p - 0.5));
            col *= 0.45 + v * 0.8;
            gl_FragColor = vec4(col, 1.0);
          }
        `}
      />
    </mesh>
  );
}

// Central distorted, iridescent blob that tilts toward the mouse.
function Blob({ mouse }) {
  const ref = useRef();
  useFrame((_, delta) => {
    if (!ref.current) return;
    ref.current.rotation.y += delta * 0.12;
    ref.current.rotation.x = THREE.MathUtils.damp(ref.current.rotation.x, mouse.current.y * 0.35, 4, delta);
    ref.current.rotation.z = THREE.MathUtils.damp(ref.current.rotation.z, -mouse.current.x * 0.35, 4, delta);
  });
  return (
    <Float speed={1.4} rotationIntensity={0.35} floatIntensity={0.9}>
      <mesh ref={ref}>
        <icosahedronGeometry args={[1.7, 16]} />
        <MeshDistortMaterial
          color="#7c5cf6"
          emissive="#3a1d7a"
          emissiveIntensity={0.45}
          roughness={0.12}
          metalness={0.92}
          distort={0.42}
          speed={2.2}
        />
      </mesh>
    </Float>
  );
}

// Subtle camera parallax with the mouse.
function Rig({ mouse }) {
  useFrame((state, delta) => {
    state.camera.position.x = THREE.MathUtils.damp(state.camera.position.x, mouse.current.x * 0.8, 3, delta);
    state.camera.position.y = THREE.MathUtils.damp(state.camera.position.y, mouse.current.y * 0.5, 3, delta);
    state.camera.lookAt(0, 0, 0);
  });
  return null;
}

function Scene({ mouse }) {
  return (
    <>
      <ambientLight intensity={0.5} />
      <directionalLight position={[5, 5, 5]} intensity={1.6} />
      <pointLight position={[-5, -3, 3]} intensity={40} color="#6d5bf0" />
      <pointLight position={[5, 3, 2]} intensity={20} color="#3aa0ff" />
      <AuroraBackground />
      <Blob mouse={mouse} />
      <Sparkles count={140} scale={[16, 9, 7]} size={2.6} speed={0.35} color="#c3b4ff" opacity={0.7} />
      <Rig mouse={mouse} />
    </>
  );
}

const HeroLab = ({ onExit }) => {
  const mouse = useRef({ x: 0, y: 0 });
  const onMove = (e) => {
    mouse.current.x = (e.clientX / window.innerWidth) * 2 - 1;
    mouse.current.y = -((e.clientY / window.innerHeight) * 2 - 1);
  };

  return (
    <div className="fixed inset-0 z-[100] bg-[#07060f] overflow-hidden" onMouseMove={onMove}>
      <Canvas camera={{ position: [0, 0, 6], fov: 50 }} dpr={[1, 2]}>
        <Suspense fallback={null}>
          <Scene mouse={mouse} />
        </Suspense>
      </Canvas>

      {/* Text overlay */}
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center px-6">
        <p className="text-white/85 text-lg sm:text-2xl font-medium mb-3 drop-shadow-lg">Hi, I am Anirudh 👋</p>
        <h1 className="text-white text-4xl sm:text-7xl font-bold tracking-tight leading-[1.05] max-w-4xl drop-shadow-[0_2px_20px_rgba(0,0,0,0.7)]">
          Full-Stack &amp;{' '}
          <span className="bg-gradient-to-r from-blue-300 to-purple-300 bg-clip-text text-transparent">AI Engineer</span>
        </h1>
        <p className="text-white/70 mt-5 max-w-xl text-sm sm:text-base drop-shadow-lg">
          Building production AI agents, MCP systems, and interactive web experiences.
        </p>
      </div>

      <button
        onClick={onExit}
        className="absolute top-5 left-5 z-10 rounded-lg bg-black/50 backdrop-blur border border-white/15 px-4 py-2 text-white text-sm hover:bg-black/70 transition-colors"
      >
        ← Back to site
      </button>
      <div className="absolute bottom-5 left-0 right-0 text-center text-white/40 text-xs">
        Hero concept preview · move your mouse
      </div>
    </div>
  );
};

export default HeroLab;
