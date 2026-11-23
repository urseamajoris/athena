"use client";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import Scene3D, { Label } from "./Scene3D";
import { shapeTexture } from "./shapes3d";
import { slotHex, topicCategories } from "@/lib/shared/categories";

interface T { id: string; name: string; synonyms: string[]; controlledTerms: string[] }

function Orbit({ center, color, n, radius, speed, animate }: { center: THREE.Vector3; color: string; n: number; radius: number; speed: number; animate: boolean }) {
  const ref = useRef<THREE.Group>(null);
  useFrame((_, dt) => {
    if (animate && ref.current) ref.current.rotation.z += dt * speed;
  });
  return (
    <group ref={ref} position={center}>
      {Array.from({ length: n }, (_, i) => {
        const a = (i / Math.max(1, n)) * Math.PI * 2;
        return (
          <mesh key={i} position={[Math.cos(a) * radius, Math.sin(a) * radius, Math.sin(a * 2) * 0.15]}>
            <sphereGeometry args={[0.06, 10, 10]} />
            <meshStandardMaterial color={color} />
          </mesh>
        );
      })}
    </group>
  );
}

export default function TopicConstellation3D({ idea, topics, theme, animate, label }: { idea: string; topics: T[]; theme: "light" | "dark"; animate: boolean; label: string }) {
  const cats = topicCategories(topics);
  const ink = theme === "light" ? "#111113" : "#f5f5f7";
  const sub = theme === "light" ? "#5c5c67" : "#8a8a94";
  const pos = useMemo(() => topics.map((_, i) => {
    const a = (i / topics.length) * Math.PI * 2 - Math.PI / 2;
    return new THREE.Vector3(Math.cos(a) * 3.1, Math.sin(a) * 2.2, (i % 2 ? 0.6 : -0.6));
  }), [topics]);
  return (
    <Scene3D label={label} animate={animate} autoRotate={false} camera={[0, 0, 9]} className="h-[320px] w-full">
      <mesh>
        <sphereGeometry args={[0.32, 24, 24]} />
        <meshStandardMaterial color={ink} />
      </mesh>
      <Label position={[0, -0.6, 0]} center style={{ color: ink, fontSize: 12, width: 180, textAlign: "center", pointerEvents: "none" }}>Your idea</Label>
      {topics.map((t, i) => {
        const c = cats[i];
        const color = slotHex(c?.slot ?? null, theme);
        const line = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), pos[i]]);
        return (
          <group key={t.id}>
            <line>
              <primitive object={line} attach="geometry" />
              <lineBasicMaterial color={sub} />
            </line>
            <sprite position={pos[i]} scale={[0.5, 0.5, 0.5]}>
              <spriteMaterial map={shapeTexture(c?.shape ?? "circle")} color={color} />
            </sprite>
            <Orbit center={pos[i]} color={color} n={Math.min(10, t.synonyms.length + t.controlledTerms.length)} radius={0.55} speed={0.25 + i * 0.03} animate={animate} />
            <Label position={[pos[i].x, pos[i].y - 0.75, pos[i].z]} center style={{ color: ink, fontSize: 12, width: 150, textAlign: "center", pointerEvents: "none", lineHeight: "16px" }}>
              {t.name}
              <span style={{ display: "block", color: sub, fontSize: 12 }}>{t.synonyms.length} synonyms · {t.controlledTerms.length} MeSH</span>
            </Label>
          </group>
        );
      })}
    </Scene3D>
  );
}
