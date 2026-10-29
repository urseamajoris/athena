"use client";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useEffect } from "react";
import { PALETTE } from "@/lib/shared/categories";

/** A slowly turning field of papers (points in the category colours) joined by faint citation lines. Decorative. */
function Field({ theme, animate }: { theme: "light" | "dark"; animate: boolean }) {
  const ref = useRef<THREE.Group>(null);
  const { points, colors, lines } = useMemo(() => {
    const n = 520;
    const pos: number[] = [];
    const col: number[] = [];
    const pal = PALETTE[theme].map((h) => new THREE.Color(h));
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < n; i++) {
      const arm = i % 3;
      const r = 1.2 + rnd() * 5.5;
      const a = r * 0.55 + (arm * Math.PI * 2) / 3 + (rnd() - 0.5) * 0.6;
      pos.push(Math.cos(a) * r, (rnd() - 0.5) * 1.6 * (1 - r / 8), Math.sin(a) * r);
      const c = pal[Math.floor(rnd() * 6)];
      col.push(c.r, c.g, c.b);
    }
    const ln: number[] = [];
    for (let i = 0; i < 140; i++) {
      const a = Math.floor(rnd() * n);
      const b = Math.floor(rnd() * n);
      const d = Math.hypot(pos[a * 3] - pos[b * 3], pos[a * 3 + 2] - pos[b * 3 + 2]);
      if (d < 2.2) ln.push(pos[a * 3], pos[a * 3 + 1], pos[a * 3 + 2], pos[b * 3], pos[b * 3 + 1], pos[b * 3 + 2]);
    }
    return { points: new Float32Array(pos), colors: new Float32Array(col), lines: new Float32Array(ln) };
  }, [theme]);
  useFrame((_, dt) => {
    if (animate && ref.current) ref.current.rotation.y += dt * 0.04;
  });
  return (
    <group ref={ref} rotation={[0.45, 0, 0.1]}>
      <points>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[points, 3]} />
          <bufferAttribute attach="attributes-color" args={[colors, 3]} />
        </bufferGeometry>
        <pointsMaterial size={0.07} vertexColors transparent opacity={theme === "light" ? 0.75 : 0.9} sizeAttenuation />
      </points>
      <lineSegments>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[lines, 3]} />
        </bufferGeometry>
        <lineBasicMaterial color={theme === "light" ? "#cdcdd5" : "#2a2a30"} transparent opacity={0.8} />
      </lineSegments>
    </group>
  );
}

function Cap({ animate }: { animate: boolean }) {
  const invalidate = useThree((s) => s.invalidate);
  useEffect(() => {
    if (!animate) return;
    let on = !document.hidden;
    const vis = () => (on = !document.hidden);
    document.addEventListener("visibilitychange", vis);
    const t = setInterval(() => on && invalidate(), 1000 / 30);
    return () => {
      clearInterval(t);
      document.removeEventListener("visibilitychange", vis);
    };
  }, [animate, invalidate]);
  return null;
}

export default function HeroField3D({ theme, animate }: { theme: "light" | "dark"; animate: boolean }) {
  return (
    <Canvas frameloop="demand" dpr={[1, 1.5]} camera={{ position: [0, 1.4, 9], fov: 50 }} gl={{ antialias: true, alpha: true, powerPreference: "low-power" }}>
      <Cap animate={animate} />
      <Field theme={theme} animate={animate} />
    </Canvas>
  );
}
