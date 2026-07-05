import { Suspense, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { KeyboardControls, useKeyboardControls, Text, useTexture, Sky } from '@react-three/drei';
import * as THREE from 'three';

import { myProjects } from '../constants/index.js';
import {
  ROADS,
  DASHES,
  BUILDINGS,
  TREES,
  LAMPS,
  CONES,
  CRATES,
  ROCKS,
  BENCHES,
  FIELD,
  GOALS,
  BALL_SPAWN,
  BILLBOARD_SPOTS,
  COINS,
  CLOUDS,
  COLLIDER_BOXES,
  COLLIDER_CIRCLES,
  SPAWN,
  WORLD_EDGE,
} from '../game/world.js';
import { collideCircleWithBoxes, collideCircleWithCircles } from '../game/physics.js';

// Projects mapped onto the boulevard billboard spots.
const STATIONS = BILLBOARD_SPOTS.slice(0, myProjects.length).map((spot, i) => ({
  ...spot,
  short: myProjects[i].title.split('—')[0].trim(),
  href: myProjects[i].href,
  texture: (myProjects[i].textures && myProjects[i].textures[0]) || '/textures/project/lark-1.jpg',
}));

const keyMap = [
  { name: 'forward', keys: ['ArrowUp', 'KeyW'] },
  { name: 'back', keys: ['ArrowDown', 'KeyS'] },
  { name: 'left', keys: ['ArrowLeft', 'KeyA'] },
  { name: 'right', keys: ['ArrowRight', 'KeyD'] },
  { name: 'action', keys: ['KeyE', 'Space'] },
  { name: 'reset', keys: ['KeyR'] },
];

const CAR_RADIUS = 1.4;
const NEAR_DIST = 13;
const COIN_DIST = 3.2;

/* ================================ vehicle ================================ */

function Car({ carRef, wheelRefs }) {
  const wheels = [
    [-0.95, 0.38, 1.05],
    [0.95, 0.38, 1.05],
    [-0.95, 0.38, -1.05],
    [0.95, 0.38, -1.05],
  ];
  return (
    <group ref={carRef}>
      {/* body */}
      <mesh position={[0, 0.55, 0]}>
        <boxGeometry args={[1.7, 0.55, 3.1]} />
        <meshStandardMaterial color="#7c5cf6" metalness={0.55} roughness={0.35} />
      </mesh>
      <mesh position={[0, 1.02, -0.15]}>
        <boxGeometry args={[1.4, 0.5, 1.5]} />
        <meshStandardMaterial color="#d9d4ff" metalness={0.2} roughness={0.15} />
      </mesh>
      {/* headlights / taillights */}
      <mesh position={[0, 0.55, -1.58]}>
        <boxGeometry args={[1.2, 0.18, 0.06]} />
        <meshStandardMaterial color="#fff7cf" emissive="#fff2ae" emissiveIntensity={1.4} />
      </mesh>
      <mesh position={[0, 0.55, 1.58]}>
        <boxGeometry args={[1.2, 0.16, 0.06]} />
        <meshStandardMaterial color="#5c0f14" emissive="#ff3040" emissiveIntensity={0.9} />
      </mesh>
      {/* wheels (group spins on X = wheel axle) */}
      {wheels.map((p, i) => (
        <group key={i} position={p} ref={(el) => (wheelRefs.current[i] = el)}>
          <mesh rotation={[0, 0, Math.PI / 2]}>
            <cylinderGeometry args={[0.38, 0.38, 0.32, 14]} />
            <meshStandardMaterial color="#15151a" roughness={0.9} />
          </mesh>
        </group>
      ))}
      {/* soft blob shadow */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, 0]}>
        <circleGeometry args={[1.7, 24]} />
        <meshBasicMaterial color="#000000" transparent opacity={0.28} />
      </mesh>
    </group>
  );
}

/* ============================ player / physics ============================ */

function Player({ input, carShared, collectedRef, onNearbyChange, onCoin, onHud }) {
  const carRef = useRef();
  const wheelRefs = useRef([]);
  const [, getKeys] = useKeyboardControls();
  const s = useRef({
    x: SPAWN.x,
    z: SPAWN.z,
    heading: SPAWN.heading,
    vel: 0,
    near: -1,
    actionLatch: false,
    lastHud: 0,
    lastSpeed: -1,
  });
  const pos = useMemo(() => ({ x: 0, z: 0 }), []);
  const vv = useMemo(() => ({ x: 0, z: 0 }), []);
  const camTarget = useMemo(() => new THREE.Vector3(), []);

  useFrame(({ camera, clock }, delta) => {
    const st = s.current;
    const dt = Math.min(delta, 0.05);
    const k = getKeys();

    // Merge keyboard + touch input (touch is analog).
    let throttle = (k.forward ? 1 : 0) - (k.back ? 1 : 0);
    let steer = (k.left ? 1 : 0) - (k.right ? 1 : 0);
    const ti = input.current;
    if (ti.throttle !== 0 || ti.steer !== 0) {
      throttle = ti.throttle;
      steer = ti.steer;
    }
    const action = k.action || ti.action;

    if (k.reset || ti.reset) {
      st.x = SPAWN.x;
      st.z = SPAWN.z;
      st.heading = SPAWN.heading;
      st.vel = 0;
      ti.reset = false;
    }

    // Longitudinal physics.
    st.vel += throttle * 30 * dt;
    const drag = Math.abs(throttle) < 0.1 ? 2.4 : 0.55;
    st.vel *= 1 - Math.min(1, drag * dt);
    st.vel = THREE.MathUtils.clamp(st.vel, -13, 36);

    // Steering scaled by speed (no turning on the spot).
    if (Math.abs(st.vel) > 0.15) {
      const speedFactor = Math.min(1, Math.abs(st.vel) / 9 + 0.25);
      st.heading += steer * 2.3 * dt * Math.sign(st.vel) * speedFactor;
    }

    const fx = -Math.sin(st.heading);
    const fz = -Math.cos(st.heading);

    // Integrate as a velocity vector so collisions can slide along walls.
    pos.x = st.x + fx * st.vel * dt;
    pos.z = st.z + fz * st.vel * dt;
    vv.x = fx * st.vel;
    vv.z = fz * st.vel;

    collideCircleWithBoxes(pos, vv, CAR_RADIUS, COLLIDER_BOXES, 0.25);
    collideCircleWithCircles(pos, vv, CAR_RADIUS, COLLIDER_CIRCLES, 0.25);

    st.x = pos.x;
    st.z = pos.z;
    st.vel = vv.x * fx + vv.z * fz; // project back onto heading

    // Share state with the ball + HUD.
    carShared.current.x = st.x;
    carShared.current.z = st.z;
    carShared.current.vx = vv.x;
    carShared.current.vz = vv.z;

    if (carRef.current) {
      carRef.current.position.set(st.x, 0, st.z);
      carRef.current.rotation.y = st.heading;
    }
    for (const w of wheelRefs.current) {
      if (w) w.rotation.x -= (st.vel * dt) / 0.38;
    }

    // Chase camera.
    camTarget.set(st.x - fx * 10.5, 6.6, st.z - fz * 10.5);
    camera.position.lerp(camTarget, 1 - Math.pow(0.0016, dt));
    camera.lookAt(st.x + fx * 2, 1.4, st.z + fz * 2);

    // Coins.
    for (let i = 0; i < COINS.length; i++) {
      if (collectedRef.current.has(i)) continue;
      const d = Math.hypot(COINS[i].x - st.x, COINS[i].z - st.z);
      if (d < COIN_DIST) onCoin(i);
    }

    // Nearest project billboard.
    let nearest = -1;
    let nd = NEAR_DIST;
    for (let i = 0; i < STATIONS.length; i++) {
      const d = Math.hypot(STATIONS[i].x - st.x, STATIONS[i].z - st.z);
      if (d < nd) {
        nd = d;
        nearest = i;
      }
    }
    if (nearest !== st.near) {
      st.near = nearest;
      onNearbyChange(nearest);
    }
    if (action && nearest >= 0 && !st.actionLatch) {
      st.actionLatch = true;
      window.open(STATIONS[nearest].href, '_blank', 'noopener');
    }
    if (!action) st.actionLatch = false;

    // Speed readout (throttled).
    const t = clock.elapsedTime;
    if (t - st.lastHud > 0.15) {
      st.lastHud = t;
      const kmh = Math.round(Math.abs(st.vel) * 3.6);
      if (kmh !== st.lastSpeed) {
        st.lastSpeed = kmh;
        onHud(kmh);
      }
    }
  });

  return <Car carRef={carRef} wheelRefs={wheelRefs} />;
}

/* ============================== soccer ball ============================== */

function Ball({ carShared, onGoal }) {
  const meshRef = useRef();
  const shadowRef = useRef();
  const b = useRef({ x: BALL_SPAWN.x, z: BALL_SPAWN.z, vx: 0, vz: 0, cooldown: 0 });
  const pos = useMemo(() => ({ x: 0, z: 0 }), []);
  const vv = useMemo(() => ({ x: 0, z: 0 }), []);
  const R = 0.75;

  useFrame((_, delta) => {
    const dt = Math.min(delta, 0.05);
    const s = b.current;
    if (s.cooldown > 0) s.cooldown -= dt;

    // Rolling friction.
    const f = 1 - Math.min(1, 0.9 * dt);
    s.vx *= f;
    s.vz *= f;

    pos.x = s.x + s.vx * dt;
    pos.z = s.z + s.vz * dt;
    vv.x = s.vx;
    vv.z = s.vz;

    collideCircleWithBoxes(pos, vv, R, COLLIDER_BOXES, 0.6);
    collideCircleWithCircles(pos, vv, R, COLLIDER_CIRCLES, 0.6);

    // Kick by the car.
    const car = carShared.current;
    const dx = pos.x - car.x;
    const dz = pos.z - car.z;
    const d = Math.hypot(dx, dz);
    const minD = R + CAR_RADIUS;
    if (d < minD && d > 1e-4) {
      const nx = dx / d;
      const nz = dz / d;
      pos.x = car.x + nx * minD;
      pos.z = car.z + nz * minD;
      const rel = Math.max(0, (car.vx - vv.x) * nx + (car.vz - vv.z) * nz);
      vv.x += nx * (rel * 1.35 + 2.5);
      vv.z += nz * (rel * 1.35 + 2.5);
      // Clamp ball speed so it can never tunnel through thin colliders
      // (hedges / goal back) on a slow frame: 26 u/s * 0.05 s < collision band.
      const sp = Math.hypot(vv.x, vv.z);
      if (sp > 26) {
        vv.x = (vv.x / sp) * 26;
        vv.z = (vv.z / sp) * 26;
      }
    }

    // Goal detection.
    if (s.cooldown <= 0) {
      for (const g of GOALS) {
        if (Math.abs(pos.x - g.sensor.x) < g.sensor.hw && Math.abs(pos.z - g.sensor.z) < g.sensor.hd) {
          onGoal();
          pos.x = BALL_SPAWN.x;
          pos.z = BALL_SPAWN.z;
          vv.x = 0;
          vv.z = 0;
          s.cooldown = 2;
          break;
        }
      }
    }

    s.x = pos.x;
    s.z = pos.z;
    s.vx = vv.x;
    s.vz = vv.z;

    if (meshRef.current) {
      meshRef.current.position.set(s.x, R, s.z);
      meshRef.current.rotation.x += (s.vz * dt) / R;
      meshRef.current.rotation.z -= (s.vx * dt) / R;
    }
    if (shadowRef.current) shadowRef.current.position.set(s.x, 0.02, s.z);
  });

  return (
    <>
      <mesh ref={meshRef}>
        <icosahedronGeometry args={[R, 1]} />
        <meshStandardMaterial color="#f2f2f2" flatShading roughness={0.4} />
      </mesh>
      <mesh ref={shadowRef} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[R * 1.1, 18]} />
        <meshBasicMaterial color="#000000" transparent opacity={0.25} />
      </mesh>
    </>
  );
}

/* ============================ world visuals ============================ */

function Ground() {
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]}>
      <planeGeometry args={[WORLD_EDGE * 2 + 140, WORLD_EDGE * 2 + 140]} />
      <meshStandardMaterial color="#4f8747" roughness={1} />
    </mesh>
  );
}

function Roads() {
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const dashRef = useRef();
  useLayoutEffect(() => {
    if (!dashRef.current) return;
    DASHES.forEach((d, i) => {
      dummy.position.set(d.x, 0.03, d.z);
      dummy.rotation.set(0, d.horizontal ? Math.PI / 2 : 0, 0);
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      dashRef.current.setMatrixAt(i, dummy.matrix);
    });
    dashRef.current.instanceMatrix.needsUpdate = true;
  }, [dummy]);

  return (
    <group>
      {ROADS.map((r, i) => (
        <mesh key={i} rotation={[-Math.PI / 2, 0, 0]} position={[r.x, 0.015, r.z]}>
          <planeGeometry args={r.horizontal ? [r.l, r.w] : [r.w, r.l]} />
          <meshStandardMaterial color="#3d4045" roughness={0.95} />
        </mesh>
      ))}
      <instancedMesh ref={dashRef} args={[undefined, undefined, DASHES.length]}>
        <boxGeometry args={[0.35, 0.02, 2.4]} />
        <meshBasicMaterial color="#e8e8e8" />
      </instancedMesh>
    </group>
  );
}

function Buildings() {
  return (
    <group>
      {BUILDINGS.map((b, i) => (
        <group key={i} position={[b.x, 0, b.z]}>
          <mesh position={[0, b.h / 2, 0]}>
            <boxGeometry args={[b.w, b.h, b.d]} />
            <meshStandardMaterial color={b.color} roughness={0.85} />
          </mesh>
          {/* roof cap for silhouette */}
          <mesh position={[0, b.h + 0.35, 0]}>
            <boxGeometry args={[b.w * 0.86, 0.7, b.d * 0.86]} />
            <meshStandardMaterial color="#3a3f46" roughness={0.9} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

function Trees() {
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const trunkRef = useRef();
  const leafRef = useRef();
  useLayoutEffect(() => {
    TREES.forEach((t, i) => {
      dummy.position.set(t.x, 1.3 * t.s, t.z);
      dummy.scale.set(t.s, t.s, t.s);
      dummy.rotation.set(0, 0, 0);
      dummy.updateMatrix();
      trunkRef.current.setMatrixAt(i, dummy.matrix);
      dummy.position.set(t.x, 3.1 * t.s, t.z);
      dummy.updateMatrix();
      leafRef.current.setMatrixAt(i, dummy.matrix);
    });
    trunkRef.current.instanceMatrix.needsUpdate = true;
    leafRef.current.instanceMatrix.needsUpdate = true;
  }, [dummy]);

  return (
    <group>
      <instancedMesh ref={trunkRef} args={[undefined, undefined, TREES.length]}>
        <cylinderGeometry args={[0.24, 0.4, 2.6, 6]} />
        <meshStandardMaterial color="#6b4a2f" roughness={1} />
      </instancedMesh>
      <instancedMesh ref={leafRef} args={[undefined, undefined, TREES.length]}>
        <icosahedronGeometry args={[1.8, 1]} />
        <meshStandardMaterial color="#3e7d3b" roughness={1} flatShading />
      </instancedMesh>
    </group>
  );
}

function StreetProps() {
  return (
    <group>
      {LAMPS.map((l, i) => (
        <group key={`lamp-${i}`} position={[l.x, 0, l.z]}>
          <mesh position={[0, 2.1, 0]}>
            <cylinderGeometry args={[0.09, 0.12, 4.2, 8]} />
            <meshStandardMaterial color="#4b4f56" metalness={0.6} roughness={0.5} />
          </mesh>
          <mesh position={[0, 4.25, 0]}>
            <sphereGeometry args={[0.32, 12, 10]} />
            <meshStandardMaterial color="#fff2c4" emissive="#ffe9a8" emissiveIntensity={1.4} />
          </mesh>
        </group>
      ))}
      {CONES.map((c, i) => (
        <mesh key={`cone-${i}`} position={[c.x, 0.55, c.z]}>
          <cylinderGeometry args={[0.06, 0.5, 1.1, 10]} />
          <meshStandardMaterial color="#ff7a30" roughness={0.7} />
        </mesh>
      ))}
      {CRATES.map((c, i) => (
        <mesh key={`crate-${i}`} position={[c.x, c.s / 2, c.z]} rotation={[0, c.rot, 0]}>
          <boxGeometry args={[c.s, c.s, c.s]} />
          <meshStandardMaterial color="#a97c50" roughness={0.95} />
        </mesh>
      ))}
      {ROCKS.map((r, i) => (
        <mesh key={`rock-${i}`} position={[r.x, r.r * 0.45, r.z]} scale={[1, 0.7, 1]}>
          <dodecahedronGeometry args={[r.r, 0]} />
          <meshStandardMaterial color="#8b8d90" roughness={1} flatShading />
        </mesh>
      ))}
      {BENCHES.map((b, i) => (
        <group key={`bench-${i}`} position={[b.x, 0, b.z]} rotation={[0, b.rot, 0]}>
          <mesh position={[0, 0.5, 0]}>
            <boxGeometry args={[2.6, 0.12, 0.9]} />
            <meshStandardMaterial color="#7a5a3a" roughness={0.9} />
          </mesh>
          <mesh position={[0, 0.95, -0.38]} rotation={[-0.25, 0, 0]}>
            <boxGeometry args={[2.6, 0.7, 0.1]} />
            <meshStandardMaterial color="#7a5a3a" roughness={0.9} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

function Hedges() {
  const sides = [
    { x: 0, z: -WORLD_EDGE, w: WORLD_EDGE * 2 + 4, d: 2.4 },
    { x: 0, z: WORLD_EDGE, w: WORLD_EDGE * 2 + 4, d: 2.4 },
    { x: -WORLD_EDGE, z: 0, w: 2.4, d: WORLD_EDGE * 2 + 4 },
    { x: WORLD_EDGE, z: 0, w: 2.4, d: WORLD_EDGE * 2 + 4 },
  ];
  return (
    <group>
      {sides.map((s, i) => (
        <mesh key={i} position={[s.x, 0.9, s.z]}>
          <boxGeometry args={[s.w, 1.8, s.d]} />
          <meshStandardMaterial color="#2f5d2c" roughness={1} />
        </mesh>
      ))}
    </group>
  );
}

function SoccerField() {
  return (
    <group position={[FIELD.x, 0, FIELD.z]}>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, 0]}>
        <planeGeometry args={[FIELD.w, FIELD.d]} />
        <meshStandardMaterial color="#54a04b" roughness={1} />
      </mesh>
      {/* boundary lines */}
      {[
        [0, -FIELD.d / 2, FIELD.w, 0.35],
        [0, FIELD.d / 2, FIELD.w, 0.35],
        [-FIELD.w / 2, 0, 0.35, FIELD.d],
        [FIELD.w / 2, 0, 0.35, FIELD.d],
        [0, 0, 0.35, FIELD.d],
      ].map(([x, z, w, d], i) => (
        <mesh key={i} rotation={[-Math.PI / 2, 0, 0]} position={[x, 0.035, z]}>
          <planeGeometry args={[w, d]} />
          <meshBasicMaterial color="#eef2ee" />
        </mesh>
      ))}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.035, 0]}>
        <ringGeometry args={[3.7, 4.05, 40]} />
        <meshBasicMaterial color="#eef2ee" />
      </mesh>
      {/* goals */}
      {GOALS.map((g, i) => (
        <group key={`goal-${i}`} position={[g.x - FIELD.x, 0, 0]}>
          <mesh position={[0, 1.1, -4]}>
            <boxGeometry args={[0.45, 2.2, 0.45]} />
            <meshStandardMaterial color="#f4f4f4" />
          </mesh>
          <mesh position={[0, 1.1, 4]}>
            <boxGeometry args={[0.45, 2.2, 0.45]} />
            <meshStandardMaterial color="#f4f4f4" />
          </mesh>
          <mesh position={[0, 2.2, 0]}>
            <boxGeometry args={[0.45, 0.45, 8.4]} />
            <meshStandardMaterial color="#f4f4f4" />
          </mesh>
        </group>
      ))}
    </group>
  );
}

function ProjectStation({ data, active }) {
  const tex = useTexture(data.texture);
  useEffect(() => {
    if (tex) tex.colorSpace = THREE.SRGBColorSpace;
  }, [tex]);
  return (
    <group position={[data.x, 0, data.z]} rotation={[0, data.rotY, 0]}>
      {/* glow pad on the road side */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.04, 3.4]}>
        <circleGeometry args={[2.6, 32]} />
        <meshBasicMaterial color={active ? '#8a7bff' : '#20242c'} transparent opacity={active ? 0.85 : 0.5} />
      </mesh>
      {/* posts */}
      <mesh position={[-2.6, 1.9, 0]}>
        <cylinderGeometry args={[0.14, 0.14, 3.8, 8]} />
        <meshStandardMaterial color="#3c4048" metalness={0.5} roughness={0.5} />
      </mesh>
      <mesh position={[2.6, 1.9, 0]}>
        <cylinderGeometry args={[0.14, 0.14, 3.8, 8]} />
        <meshStandardMaterial color="#3c4048" metalness={0.5} roughness={0.5} />
      </mesh>
      {/* panel */}
      <mesh position={[0, 4.6, 0]}>
        <boxGeometry args={[7, 4.4, 0.25]} />
        <meshStandardMaterial
          color={active ? '#7c6cf0' : '#2c2f38'}
          emissive={active ? '#5b48d8' : '#000000'}
          emissiveIntensity={active ? 0.55 : 0}
        />
      </mesh>
      <mesh position={[0, 4.6, 0.14]}>
        <planeGeometry args={[6.5, 3.9]} />
        <meshBasicMaterial map={tex} toneMapped={false} />
      </mesh>
      <Text
        position={[0, 7.25, 0.15]}
        fontSize={0.55}
        color="#ffffff"
        outlineWidth={0.03}
        outlineColor="#1a1530"
        anchorX="center"
        anchorY="middle"
        maxWidth={8}
        textAlign="center"
      >
        {data.short}
      </Text>
    </group>
  );
}

function Coins({ collected }) {
  const refs = useRef([]);
  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    refs.current.forEach((g, i) => {
      if (!g) return;
      g.rotation.y = t * 2 + i;
      g.position.y = 1.15 + Math.sin(t * 2.2 + i) * 0.15;
    });
  });
  return (
    <group>
      {COINS.map((c, i) =>
        collected.has(i) ? null : (
          <group key={i} position={[c.x, 1.15, c.z]} ref={(el) => (refs.current[i] = el)}>
            <mesh rotation={[0, 0, Math.PI / 2]}>
              <cylinderGeometry args={[0.85, 0.85, 0.16, 24]} />
              <meshStandardMaterial color="#ffce3d" metalness={0.85} roughness={0.25} emissive="#8a6a10" emissiveIntensity={0.25} />
            </mesh>
          </group>
        ),
      )}
    </group>
  );
}

function Clouds() {
  const group = useRef();
  useFrame((_, delta) => {
    if (!group.current) return;
    group.current.position.x += delta * 1.2;
    if (group.current.position.x > 220) group.current.position.x = -220;
  });
  return (
    <group ref={group}>
      {CLOUDS.map((c, i) => (
        <mesh key={i} position={[c.x, c.y, c.z]} scale={[7 * c.s, 1.7 * c.s, 3.6 * c.s]}>
          <sphereGeometry args={[1, 10, 8]} />
          <meshStandardMaterial color="#ffffff" roughness={1} transparent opacity={0.92} />
        </mesh>
      ))}
    </group>
  );
}

/* ============================== scene root ============================== */

function Scene({ input, collectedRef, onNearbyChange, onCoin, onGoal, onHud }) {
  const carShared = useRef({ x: SPAWN.x, z: SPAWN.z, vx: 0, vz: 0 });
  const [nearIdx, setNearIdx] = useState(-1);
  const [collected, setCollected] = useState(() => new Set());

  const handleNear = (i) => {
    setNearIdx(i);
    onNearbyChange(i);
  };
  const handleCoin = (i) => {
    collectedRef.current.add(i);
    setCollected(new Set(collectedRef.current));
    onCoin(collectedRef.current.size);
  };

  return (
    <>
      <Sky distance={450000} sunPosition={[120, 90, -60]} turbidity={5} rayleigh={1.6} />
      <hemisphereLight args={['#cfe8ff', '#5d8a4f', 0.85]} />
      <directionalLight position={[120, 140, -60]} intensity={1.5} color="#fff4de" />
      <fog attach="fog" args={['#cfe3f2', 150, 430]} />

      <Ground />
      <Roads />
      <Buildings />
      <Trees />
      <StreetProps />
      <Hedges />
      <SoccerField />
      <Clouds />
      <Coins collected={collected} />

      {STATIONS.map((p, i) => (
        <ProjectStation key={i} data={p} active={i === nearIdx} />
      ))}

      <Player
        input={input}
        carShared={carShared}
        collectedRef={collectedRef}
        onNearbyChange={handleNear}
        onCoin={handleCoin}
        onHud={onHud}
      />
      <Ball carShared={carShared} onGoal={onGoal} />
    </>
  );
}

/* ============================ touch controls ============================ */

const JOY_R = 52;

function Joystick({ input }) {
  const [knob, setKnob] = useState({ x: 0, y: 0 });
  const origin = useRef(null);

  const move = (e) => {
    if (!origin.current || e.pointerId !== origin.current.id) return;
    let dx = e.clientX - origin.current.x;
    let dy = e.clientY - origin.current.y;
    const m = Math.hypot(dx, dy);
    if (m > JOY_R) {
      dx = (dx / m) * JOY_R;
      dy = (dy / m) * JOY_R;
    }
    setKnob({ x: dx, y: dy });
    input.current.steer = -(dx / JOY_R);
    input.current.throttle = -(dy / JOY_R);
  };
  const end = (e) => {
    // Explicitly release the capture — some mobile browsers are unreliable
    // about implicit release, which would leave the joystick "stuck".
    if (origin.current && e && e.currentTarget) {
      try {
        e.currentTarget.releasePointerCapture(origin.current.id);
      } catch {
        /* already released */
      }
    }
    origin.current = null;
    setKnob({ x: 0, y: 0 });
    input.current.steer = 0;
    input.current.throttle = 0;
  };

  return (
    <div
      className="pointer-events-auto relative h-32 w-32 rounded-full border border-white/25 bg-white/10 backdrop-blur-sm"
      style={{ touchAction: 'none' }}
      onPointerDown={(e) => {
        origin.current = { x: e.clientX, y: e.clientY, id: e.pointerId };
        e.currentTarget.setPointerCapture(e.pointerId);
        move(e);
      }}
      onPointerMove={move}
      onPointerUp={end}
      onPointerCancel={end}
    >
      <div
        className="absolute left-1/2 top-1/2 h-14 w-14 rounded-full bg-white/70 shadow-lg"
        style={{ transform: `translate(calc(-50% + ${knob.x}px), calc(-50% + ${knob.y}px))` }}
      />
    </div>
  );
}

/* ================================ overlay ================================ */

const ExploreWorld = ({ onExit }) => {
  const [nearby, setNearby] = useState(-1);
  const [coins, setCoins] = useState(0);
  const [goals, setGoals] = useState(0);
  const [speed, setSpeed] = useState(0);
  const [toast, setToast] = useState(false);
  const input = useRef({ throttle: 0, steer: 0, action: false, reset: false });
  const collectedRef = useRef(new Set());
  const toastTimer = useRef(null);

  const isTouch = useMemo(
    () => typeof window !== 'undefined' && (navigator.maxTouchPoints > 0 || 'ontouchstart' in window),
    [],
  );

  // Prevent arrow/space scrolling behind the overlay + ESC exits.
  useEffect(() => {
    const onKey = (e) => {
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
      if (e.code === 'Escape') onExit();
    };
    window.addEventListener('keydown', onKey, { passive: false });
    return () => {
      window.removeEventListener('keydown', onKey);
      if (toastTimer.current) clearTimeout(toastTimer.current);
    };
  }, [onExit]);

  const handleGoal = () => {
    setGoals((g) => g + 1);
    setToast(true);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(false), 1800);
  };

  const nearProject = nearby >= 0 ? STATIONS[nearby] : null;

  return (
    <div className="fixed inset-0 z-[100] bg-[#cfe3f2]" style={{ touchAction: 'none' }}>
      <KeyboardControls map={keyMap}>
        <Canvas camera={{ position: [0, 9, 44], fov: 55 }} dpr={[1, isTouch ? 1.5 : 2]}>
          <Suspense fallback={null}>
            <Scene
              input={input}
              collectedRef={collectedRef}
              onNearbyChange={setNearby}
              onCoin={setCoins}
              onGoal={handleGoal}
              onHud={setSpeed}
            />
          </Suspense>
        </Canvas>
      </KeyboardControls>

      {/* HUD */}
      <div className="pointer-events-none absolute inset-0 flex flex-col justify-between p-4 sm:p-5">
        {/* top row */}
        <div className="flex items-start justify-between gap-3">
          <button
            onClick={onExit}
            className="pointer-events-auto flex items-center gap-2 rounded-lg bg-black/60 backdrop-blur px-4 py-2 text-white text-sm border border-white/15 hover:bg-black/80 transition-colors"
          >
            ← Back to site
          </button>

          <div className="flex items-center gap-2 rounded-full bg-black/55 backdrop-blur px-4 py-2 text-white text-sm border border-white/15">
            <span>🪙 {coins}/{COINS.length}</span>
            <span className="text-white/30">|</span>
            <span>⚽ {goals}</span>
            <span className="text-white/30">|</span>
            <span className="tabular-nums">{speed} km/h</span>
          </div>

          {!isTouch ? (
            <div className="rounded-lg bg-black/50 backdrop-blur px-4 py-2 text-white/80 text-xs border border-white/10 text-right leading-relaxed hidden sm:block">
              <p className="text-white font-semibold text-sm mb-0.5">Explore the city 🚗</p>
              <p><span className="font-semibold text-white">W A S D</span> drive · <span className="font-semibold text-white">E</span> open</p>
              <p><span className="font-semibold text-white">R</span> reset · <span className="font-semibold text-white">Esc</span> exit</p>
              <p className="text-white/60 mt-1">Collect coins · score goals on the field</p>
            </div>
          ) : (
            <button
              onClick={() => (input.current.reset = true)}
              className="pointer-events-auto rounded-lg bg-black/60 backdrop-blur px-3.5 py-2 text-white text-sm border border-white/15"
            >
              ↺
            </button>
          )}
        </div>

        {/* goal toast */}
        {toast && (
          <div className="absolute left-1/2 top-24 -translate-x-1/2">
            <div className="rounded-2xl bg-white text-black px-8 py-3 text-2xl font-bold shadow-2xl animate-bounce">
              ⚽ GOAL!
            </div>
          </div>
        )}

        {/* bottom row */}
        <div className="flex items-end justify-between gap-3">
          {isTouch ? <Joystick input={input} /> : <div />}

          <div className="flex flex-col items-center gap-2">
            {nearProject ? (
              <div className="rounded-full bg-white/95 text-black px-5 py-2.5 text-sm font-semibold shadow-lg">
                {isTouch ? (
                  <>Open {nearProject.short}?</>
                ) : (
                  <>
                    Press <span className="px-1.5 py-0.5 rounded bg-black text-white text-xs mx-1">E</span> to open{' '}
                    {nearProject.short}
                  </>
                )}
              </div>
            ) : (
              <div className="rounded-full bg-black/40 backdrop-blur text-white/80 px-5 py-2 text-xs border border-white/10">
                Drive down the boulevard — billboards open my projects
              </div>
            )}
          </div>

          {isTouch ? (
            <button
              onClick={() => {
                if (nearby >= 0) window.open(STATIONS[nearby].href, '_blank', 'noopener');
              }}
              className={`pointer-events-auto h-20 w-20 rounded-full border text-sm font-bold shadow-lg transition-colors ${
                nearProject
                  ? 'bg-white text-black border-white'
                  : 'bg-white/15 text-white/60 border-white/25 backdrop-blur'
              }`}
            >
              OPEN
            </button>
          ) : (
            <div />
          )}
        </div>
      </div>
    </div>
  );
};

export default ExploreWorld;
