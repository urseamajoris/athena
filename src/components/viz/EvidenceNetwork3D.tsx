"use client";
import { useMemo, useState } from "react";
import * as THREE from "three";
import { Html } from "@react-three/drei";
import Scene3D from "./Scene3D";
import { shapeTexture } from "./shapes3d";
import type { EvGraph } from "./evidence-graph";
import { STUDY_GROUPS, slotHex } from "@/lib/shared/categories";

const KIND_HEX = { light: { known: "#0a7446", contested: "#6250d6", unknown: "#5c5c67" }, dark: { known: "#3dd68c", contested: "#9085e9", unknown: "#8a8a94" } } as const;

export default function EvidenceNetwork3D({ g, theme, animate, label, isolated, onOpenPaper }: { g: EvGraph; theme: "light" | "dark"; animate: boolean; label: string; isolated: string | null; onOpenPaper: (id: string) => void }) {
  const [hover, setHover] = useState<string | null>(null);
  const lines = useMemo(() => {
    const pts: number[] = [];
    for (const l of g.links) {
      const s = g.statements[l.s];
      const p = g.papers[l.p];
      if (isolated && p.group !== isolated) continue;
      pts.push(s.x, s.y, s.z, p.x, p.y, p.z);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
    return geo;
  }, [g, isolated]);
  const ink = theme === "light" ? "#3e3e47" : "#b4b4bd";
  return (
    <div className="relative">
      <Scene3D label={label} animate={animate} autoRotate camera={[0, 0, 10]} className="h-[360px] w-full">
        <group rotation={[0, -0.25, 0]}>
          <lineSegments geometry={lines}>
            <lineBasicMaterial color={theme === "light" ? "#cdcdd5" : "#3a3a42"} />
          </lineSegments>
          {g.statements.map((s) => (
            <mesh key={s.id} position={[s.x, s.y, s.z]} onPointerOver={() => setHover(s.text)} onPointerOut={() => setHover(null)}>
              {s.kind === "known" ? <boxGeometry args={[0.32, 0.32, 0.32]} /> : s.kind === "contested" ? <octahedronGeometry args={[0.26]} /> : <torusGeometry args={[0.14, 0.05, 8, 20]} />}
              <meshStandardMaterial color={KIND_HEX[theme][s.kind]} />
            </mesh>
          ))}
          {g.papers.map((p) => {
            const c = STUDY_GROUPS.find((x) => x.key === p.group);
            const faded = !!isolated && isolated !== p.group;
            return (
              <sprite key={p.id} position={[p.x, p.y, p.z]} scale={[0.42, 0.42, 0.42]} onPointerOver={() => setHover(`${p.label} · ${c?.label ?? ""}`)} onPointerOut={() => setHover(null)} onClick={() => onOpenPaper(p.id)}>
                <spriteMaterial map={shapeTexture(c?.shape ?? "ring")} color={slotHex(c?.slot ?? null, theme)} transparent opacity={faded ? 0.12 : 1} />
              </sprite>
            );
          })}
          <Html position={[-3, 3.3, 0]} center style={{ color: ink, fontSize: 12, whiteSpace: "nowrap", pointerEvents: "none" }}>Statements</Html>
          <Html position={[3, 3.3, 0]} center style={{ color: ink, fontSize: 12, whiteSpace: "nowrap", pointerEvents: "none" }}>Papers</Html>
        </group>
      </Scene3D>
      {hover && <div role="tooltip" className="pointer-events-none absolute left-3 top-3 max-w-[85%] rounded-sm border border-line-strong bg-bg-2 px-2 py-1 text-12 text-fg-0">{hover}</div>}
    </div>
  );
}
