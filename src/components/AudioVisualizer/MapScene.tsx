import { useFrame, extend, useThree, ThreeEvent } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import { useRef, useMemo, useState, useLayoutEffect, useEffect } from 'react';
import { MapShaderMaterial } from './CustomShaderMaterial';
import { engine } from '../../lib/AudioEngine';
import { themes } from '../../lib/themes';

extend({ MapShaderMaterial });

export function MapScene({ theme = 'nocturnal' }: { theme?: string }) {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const materialRef = useRef<any>(null);
  const { clock } = useThree();

  // Visibility / lifecycle refs
  const isVisibleRef = useRef(document.visibilityState === 'visible');
  const meteorColorRef = useRef(new THREE.Color());
  const whiteColorRef = useRef(new THREE.Color(0xffffff));
  const ripplesDirtyRef = useRef(true);

  const gridSize = 160;
  const spacing = 1.05;
  const count = gridSize * gridSize;

  useLayoutEffect(() => {
    if (!meshRef.current) return;
    const tempMatrix = new THREE.Matrix4();
    const offset = (gridSize * spacing) / 2;

    let i = 0;
    for (let x = 0; x < gridSize; x++) {
      for (let z = 0; z < gridSize; z++) {
        const px = x * spacing - offset;
        const pz = z * spacing - offset;
        tempMatrix.makeTranslation(px, 0.5, pz);
        meshRef.current.setMatrixAt(i, tempMatrix);
        i++;
      }
    }
    meshRef.current.instanceMatrix.needsUpdate = true;
  }, [gridSize, spacing]);

  // Ripples logic
  // We keep a ring buffer of 10 ripples
  const ripplesRef = useRef(new Array(10).fill(null).map(() => ({
    pos: new THREE.Vector2(),
    time: -100,
    strength: 0,
    isActive: 0
  })));
  const rippleIndex = useRef(0);

  const addRipple = (x: number, y: number, strength: number, isWhite: boolean = false) => {
    const idx = rippleIndex.current;
    const ripple = ripplesRef.current[idx];
    ripple.pos.set(x, y);
    ripple.time = clock.getElapsedTime();
    ripple.strength = strength;
    ripple.isActive = 1;
    (ripple as any).rippleType = isWhite ? 1 : 0;
    rippleIndex.current = (idx + 1) % 10;
    ripplesDirtyRef.current = true;
  };

  const fogRef = useRef<THREE.Fog>(null);
  
  // Meteors logic
  const MAX_METEORS = 20;
  const meteorMeshRef = useRef<THREE.InstancedMesh>(null);
  const meteorMatRef = useRef<THREE.MeshBasicMaterial>(null);
  
  // Particles for meteor trails
  const MAX_PARTICLES = 200;
  const particleMeshRef = useRef<THREE.InstancedMesh>(null);
  const particleMatRef = useRef<THREE.MeshBasicMaterial>(null);
  const particlesRef = useRef(new Array(MAX_PARTICLES).fill(null).map(() => ({
    active: false,
    x: 0, y: -1000, z: 0,
    vx: 0, vy: 0, vz: 0,
    life: 0, maxLife: 1, scale: 1
  })));
  const particleIndex = useRef(0);
  const spawnParticle = (x: number, y: number, z: number, speedMultiplier: number) => {
     const idx = particleIndex.current;
     const p = particlesRef.current[idx];
     p.active = true;
     p.x = x + (Math.random() - 0.5) * 1.5;
     p.y = y + (Math.random() - 0.5) * 1.5;
     p.z = z + (Math.random() - 0.5) * 1.5;
     p.vx = (Math.random() - 0.5) * 2.0;
     p.vy = Math.random() * 2.0 + speedMultiplier * 10.0;
     p.vz = (Math.random() - 0.5) * 2.0;
     p.life = 0;
     p.maxLife = 0.5 + Math.random() * 0.5;
     p.scale = Math.random() * 0.6 + 0.2;
     particleIndex.current = (idx + 1) % MAX_PARTICLES;
  };
  
  const dummyMatrix = useMemo(() => new THREE.Matrix4(), []);
  const dummyPosition = useMemo(() => new THREE.Vector3(), []);
  const dummyRotation = useMemo(() => new THREE.Quaternion(), []);
  const dummyScale = useMemo(() => new THREE.Vector3(), []);
  
  const meteorsRef = useRef(new Array(MAX_METEORS).fill(null).map(() => ({
    active: false,
    x: 0,
    y: -1000,
    z: 0,
    speed: 0,
    strength: 0,
  })));
  const meteorIndex = useRef(0);
  const lastMeteorSpawnTime = useRef(-Infinity);

  const addMeteor = (strength: number) => {
     const now = clock.getElapsedTime();
     const cooldownSeconds = engine.meteorTrigger.cooldown / 60;
     if (now - lastMeteorSpawnTime.current < cooldownSeconds) return;
     lastMeteorSpawnTime.current = now;

     const idx = meteorIndex.current;
     const angle = Math.random() * Math.PI * 2;
     const dist = Math.random() * 25;
     
     const m = meteorsRef.current[idx];
     m.active = true;
     m.x = Math.cos(angle) * dist;
     m.z = Math.sin(angle) * dist;
     m.y = 30 + Math.random() * 10;
     m.speed = 1.0 + Math.random() * 0.5 + (strength * 1.5);
     m.strength = strength;
     
     meteorIndex.current = (idx + 1) % MAX_METEORS;
  };
  
  // Pause rendering when the tab/window is hidden to save GPU/CPU.
  useEffect(() => {
    const handleVisibility = () => {
      isVisibleRef.current = document.visibilityState === 'visible';
    };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, []);

  // Wire up audio engine beat detection
  useEffect(() => {
    engine.onFreqTrigger = (strength, mode, action) => {
       if (action === 'Meteor') {
          addMeteor(strength);
       } else {
          const angle = Math.random() * Math.PI * 2;
          if (mode === 'Kick') {
             const dist = Math.random() * 25; // Random position, can be near center or further out
             const rx = Math.cos(angle) * dist;
             const rz = Math.sin(angle) * dist;
             addRipple(rx, rz, Math.min(strength * 3.0, 4.0));
          } 
          else {
             const dist = 10 + Math.random() * 25; 
             const rx = Math.cos(angle) * dist;
             const rz = Math.sin(angle) * dist;
             addRipple(rx, rz, Math.min(strength * 3.0, 3.0));
          }
       }
    };
  }, [theme]);

  const hasActiveVisuals = () => {
    const hasRipples = ripplesRef.current.some((r) => r.isActive > 0);
    const hasMeteors = meteorsRef.current.some((m) => m.active);
    const hasParticles = particlesRef.current.some((p) => p.active);
    return hasRipples || hasMeteors || hasParticles;
  };

  // Epsilon helpers to avoid uploading uniforms that haven't meaningfully changed.
  const EPS = 0.0001;
  const setFloat = (mat: any, key: string, value: number) => {
    if (Math.abs(mat[key] - value) > EPS) mat[key] = value;
  };
  const setColor = (mat: any, key: string, target: THREE.Color, speed: number) => {
    if (mat[key].getHex() !== target.getHex()) {
      mat[key].lerp(target, speed);
    }
  };

  useFrame((state, delta) => {
    if (!materialRef.current) return;
    if (!isVisibleRef.current) return;

    const mat = materialRef.current;
    const t = themes[theme] || themes['nocturnal'];

    // Skip the heavy audio-driven updates when nothing is playing and no
    // visual effects (ripples, meteors, particles) are active.
    const shouldRenderScene = engine.isPlaying || engine.isVisualReleasing() || hasActiveVisuals();
    if (!shouldRenderScene) return;

    const data = engine.getAudioData();

    // Smoothly transition colors
    const lerpSpeed = 3.0 * delta;
    setColor(mat, 'uBaseColor1', t.uBaseColor1, lerpSpeed);
    setColor(mat, 'uBaseColor2', t.uBaseColor2, lerpSpeed);
    setColor(mat, 'uCoolCore', t.uCoolCore, lerpSpeed);
    setColor(mat, 'uCoolEdge', t.uCoolEdge, lerpSpeed);
    setColor(mat, 'uWarmCore', t.uWarmCore, lerpSpeed);
    setColor(mat, 'uWarmEdge', t.uWarmEdge, lerpSpeed);
    setColor(mat, 'uRippleColor', t.uRippleColor, lerpSpeed);
    setFloat(mat, 'uGlowIntensity', THREE.MathUtils.lerp(mat.uGlowIntensity, t.uGlowIntensity, lerpSpeed));

    if (fogRef.current) {
      fogRef.current.color.lerp(t.uBaseColor1, lerpSpeed);
    }

    mat.uTime = state.clock.getElapsedTime();
    setFloat(mat, 'uBass', data.bass);
    setFloat(mat, 'uMid', data.mid);
    setFloat(mat, 'uTreble', data.treble);
    setFloat(mat, 'uEnergy', data.energy);

    setFloat(mat, 'uSubBass', data.subBass);
    setFloat(mat, 'uLowMid', data.lowMid);
    setFloat(mat, 'uHighMid', data.highMid);
    setFloat(mat, 'uPresence', data.presence);
    setFloat(mat, 'uBrilliance', data.brilliance);
    setFloat(mat, 'uAir', data.air);

    setFloat(mat, 'uWarmth', data.warmth);
    setFloat(mat, 'uBrightness', data.brightness);
    setFloat(mat, 'uSharpness', data.sharpness);
    setFloat(mat, 'uSmoothness', data.smoothness);
    setFloat(mat, 'uDensity', data.density);
    setFloat(mat, 'uSpectralCentroid', data.spectralCentroid);

    // Pass ripples only when the buffer has changed.
    if (ripplesDirtyRef.current) {
      mat.uRipples = ripplesRef.current;
      ripplesDirtyRef.current = false;
    }

    // Update meteors
    if (meteorMeshRef.current) {
      if (meteorMatRef.current) {
        const mColor = meteorColorRef.current.copy(t.uWarmCore).lerp(whiteColorRef.current, 0.7);
        meteorMatRef.current.color.lerp(mColor, lerpSpeed);
      }

      for (let i = 0; i < MAX_METEORS; i++) {
        const m = meteorsRef.current[i];
        if (!m.active) {
          dummyPosition.set(0, -1000, 0);
          dummyScale.set(0, 0, 0);
          dummyMatrix.compose(dummyPosition, dummyRotation, dummyScale);
          meteorMeshRef.current.setMatrixAt(i, dummyMatrix);
        } else {
          m.y -= m.speed * 60 * delta; // falling translation (faster)
          if (m.y <= 0) {
            m.active = false;
            addRipple(m.x, m.z, Math.min(m.strength * 1.0, 1.2), true); // miniature white wave impact
            // Impact particles
            for (let pIndex = 0; pIndex < 10; pIndex++) spawnParticle(m.x, 0.5, m.z, m.speed * 1.5);
          }
          dummyPosition.set(m.x, Math.max(0, m.y), m.z);
          dummyScale.set(1.5, 1.5, 1.5);
          dummyMatrix.compose(dummyPosition, dummyRotation, dummyScale);
          meteorMeshRef.current.setMatrixAt(i, dummyMatrix);

          if (m.y > 0 && Math.random() > 0.3) {
            spawnParticle(m.x, m.y, m.z, m.speed * 0.2); // trail
          }
        }
      }
      meteorMeshRef.current.instanceMatrix.needsUpdate = true;
    }

    // Update particles
    if (particleMeshRef.current) {
      if (particleMatRef.current) {
        if (meteorMatRef.current) {
          particleMatRef.current.color.copy(meteorMatRef.current.color);
        } else {
          particleMatRef.current.color.copy(whiteColorRef.current);
        }
      }

      for (let i = 0; i < MAX_PARTICLES; i++) {
        const p = particlesRef.current[i];
        if (!p.active) {
          dummyPosition.set(0, -1000, 0);
          dummyScale.set(0, 0, 0);
          dummyMatrix.compose(dummyPosition, dummyRotation, dummyScale);
          particleMeshRef.current.setMatrixAt(i, dummyMatrix);
        } else {
          p.life += delta;
          if (p.life >= p.maxLife) {
            p.active = false;
            dummyScale.set(0, 0, 0);
          } else {
            p.x += p.vx * delta * 10;
            p.y += p.vy * delta * 10;
            p.z += p.vz * delta * 10;
            const s = p.scale * (1.0 - (p.life / p.maxLife));
            dummyPosition.set(p.x, p.y, p.z);
            dummyScale.set(s, s, s);
          }
          dummyMatrix.compose(dummyPosition, dummyRotation, dummyScale);
          particleMeshRef.current.setMatrixAt(i, dummyMatrix);
        }
      }
      particleMeshRef.current.instanceMatrix.needsUpdate = true;
    }
  });

  // Interaction
  const [pressTime, setPressTime] = useState(0);

  const handlePointerDown = (e: ThreeEvent<PointerEvent>) => {
    if (e.button !== 0) return; // Only left click
    setPressTime(performance.now());
  };

  const handlePointerUp = (e: ThreeEvent<PointerEvent>) => {
    if (e.button !== 0) return;
    const duration = performance.now() - pressTime;
    // Short click gets a very small strength (~0.2 - 0.4)
    // Long press (1s+) scales up to the max strength of 3.0
    const strength = Math.min(0.2 + (duration / 1000) * 2.8, 3.0);
    addRipple(e.point.x, e.point.z, strength);
  };

  const t = themes[theme] || themes['nocturnal'];

  return (
    <>
      <fog ref={fogRef} attach="fog" args={[`#${t.uBaseColor1.getHexString()}`, 30, 95]} />
      <ambientLight intensity={0.5} />
      <directionalLight position={[10, 20, 10]} intensity={1} />
      
      <OrbitControls 
        makeDefault 
        autoRotate 
        autoRotateSpeed={0.5}
        enablePan={false}
        minDistance={5}
        maxDistance={120}
        maxPolarAngle={Math.PI / 2 - 0.1}
      />

      <instancedMesh
        ref={meshRef}
        args={[undefined, undefined, count]}
        onPointerDown={handlePointerDown}
        onPointerUp={handlePointerUp}
      >
        <boxGeometry args={[0.9, 1, 0.9]} />
        {/* @ts-ignore */}
        <mapShaderMaterial ref={materialRef} transparent={true} />
      </instancedMesh>

      <instancedMesh ref={meteorMeshRef} args={[undefined as any, undefined as any, MAX_METEORS]} frustumCulled={false}>
         <boxGeometry args={[0.4, 1.2, 0.4]} />
         <meshBasicMaterial ref={meteorMatRef} color="#ffffff" toneMapped={false} /> 
      </instancedMesh>

      <instancedMesh ref={particleMeshRef} args={[undefined as any, undefined as any, MAX_PARTICLES]} frustumCulled={false}>
         <boxGeometry args={[0.8, 0.8, 0.8]} />
         <meshBasicMaterial ref={particleMatRef} color="#ffffff" toneMapped={false} transparent={true} opacity={0.6} /> 
      </instancedMesh>
    </>
  );
}
