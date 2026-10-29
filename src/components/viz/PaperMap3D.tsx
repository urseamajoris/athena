"use client";
import { useMemo, useState } from "react";
import * as THREE from "three";
import { Html } from "@react-three/drei";
import Scene3D from "./Scene3D";
import { shapeTexture } from "./shapes3d";
import { place, type MapPoint, type Placed } from "./paper-points";
import { categoriesFor, categoryHex, type ColorBy } from "@/lib/shared/categories";

function Cloud({ pts, color, shape, faded, onHover, onOpen, size }: { pts: Placed[]; color: string; shape: Parameters<typeof shapeTexture>[0]; faded: boolean; onHover: (p: Placed | null) => void; onOpen: (id: string) => void; size: number }) {
  const geo = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pts.flatMap((p) => [p.x, p.y, p.z]), 3));
    return g;
  }, [pts]);
  const mat = useMemo(() => new THREE.PointsMaterial({ map: shapeTexture(shape), color: new THREE.Color(color), size, sizeAttenuation: true, transparent: true, alphaTest: 0.4, opacity: faded ? 0.12 : 1, depthWrite: !faded }), [shape, color, faded, size]);
  return (
    <points
      geometry={geo}
      material={mat}
      onPointerMove={(e) => { e.stopPropagation(); if (e.index !== undefined) onHover(pts[e.index]); }}
      onPointerOut={() => onHover(null)}
      onClick={(e) => { e.stopPropagation(); if (e.index !== undefined) onOpen(pts[e.index].id); }}
    />
  );
}

export default function PaperMap3D({ points, colorBy, topics, theme, isolated, highlight, animate, onOpen, layers, label, dimUnselected }: { points: MapPoint[]; colorBy: ColorBy; topics: { id: string; name: string }[]; theme: "light" | "dark"; isolated: string | null; highlight: string | null; animate: boolean; onOpen: (id: string) => void; layers: number; label: string; dimUnselected: boolean }) {
  const [hover, setHover] = useState<Placed | null>(null);
  const { placed, yearMin, yearMax, scored } = useMemo(() => place(points, layers), [points, layers]);
  const cats = categoriesFor(colorBy, topics);
  const groups = useMemo(() => {
    const m = new Map<string, Placed[]>();
    for (const p of placed) {
      const key = `${p.cat}|${dimUnselected && !p.selected ? "dim" : "on"}`;
      m.set(key, [...(m.get(key) ?? []), p]);
    }
    return [...m.entries()];
  }, [placed, dimUnselected]);
  const axis = theme === "light" ? "#7a7a86" : "#70707a";
  const ink = theme === "light" ? "#3e3e47" : "#b4b4bd";
  return (
    <div className="relative">
      <Scene3D label={label} animate={animate} camera={[0, 0.6, 8.2]} className="h-[380px] w-full" pointThreshold={0.18}>
        <group rotation={[0, -0.22, 0]}>
          <lineSegments>
            <bufferGeometry attach="geometry">
              <bufferAttribute attach="attributes-position" args={[new Float32Array([-4.9, -3, -2.4, 4.4, -3, -2.4, -4.9, -3, -2.4, -4.9, 2.8, -2.4]), 3]} />
            </bufferGeometry>
            <lineBasicMaterial color={axis} />
          </lineSegments>
          <Html position={[-4.9, -3.35, -2.4]} style={{ color: ink, fontSize: 12, whiteSpace: "nowrap", pointerEvents: "none" }}>{yearMin}</Html>
          <Html position={[4.1, -3.35, -2.4]} style={{ color: ink, fontSize: 12, whiteSpace: "nowrap", pointerEvents: "none" }}>{yearMax}</Html>
          <Html position={[-0.6, -3.35, -2.4]} style={{ color: ink, fontSize: 12, whiteSpace: "nowrap", pointerEvents: "none" }}>Year →</Html>
          {scored && <Html position={[-6.1, 2.8, -2.4]} style={{ color: ink, fontSize: 12, whiteSpace: "nowrap", pointerEvents: "none" }}>Score 100 ↑</Html>}
          {scored && <Html position={[-5.7, -2.6, -2.4]} style={{ color: ink, fontSize: 12, whiteSpace: "nowrap", pointerEvents: "none" }}>0</Html>}
          {groups.map(([key, pts]) => {
            const [cat, dim] = key.split("|");
            const c = cats.find((x) => x.key === cat);
            const faded = dim === "dim" || (!!isolated && isolated !== cat) || (!!highlight && highlight !== cat);
            return <Cloud key={key} pts={pts} color={categoryHex(colorBy, cat, theme, topics)} shape={c?.shape ?? "circle"} faded={faded} size={0.5} onHover={setHover} onOpen={onOpen} />;
          })}
        </group>
      </Scene3D>
      {hover && (
        <div role="tooltip" className="pointer-events-none absolute left-3 top-3 max-w-[80%] rounded-sm border border-line-strong bg-bg-2 px-2 py-1 text-12">
          <span className="block font-medium text-fg-0">{hover.title}</span>
          <span className="text-fg-2">{hover.year ?? "year unknown"}{hover.score !== null ? ` · score ${Math.round(hover.score)}` : ""} · click to open</span>
        </div>
      )}
    </div>
  );
}
