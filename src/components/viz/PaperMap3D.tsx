"use client";
import { useMemo, useState } from "react";
import * as THREE from "three";
import Scene3D, { Label, type Fit } from "./Scene3D";
import { shapeTexture } from "./shapes3d";
import { place, topicTag, type MapPoint, type Placed } from "./paper-points";
import { categoriesFor, categoryHex, type ColorBy } from "@/lib/shared/categories";

/** On-screen size of every point, in CSS pixels: the same near and far, so size carries no meaning. */
const POINT_PX = 11;
/** The axes, their labels and the points (see the axis lines below), so a narrow canvas never cuts them off. */
const FIT: Fit = { halfWidth: 5.7, halfHeight: 3.5, depth: 1.5, target: [-0.6, -0.2, 0] };

function Cloud({ pts, color, shape, faded, onHover, onOpen }: { pts: Placed[]; color: string; shape: Parameters<typeof shapeTexture>[0]; faded: boolean; onHover: (p: Placed | null) => void; onOpen: (id: string) => void }) {
  const geo = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pts.flatMap((p) => [p.x, p.y, p.z]), 3));
    return g;
  }, [pts]);
  // sizeAttenuation off: perspective would draw near points bigger than far ones, which reads as a size code.
  const mat = useMemo(() => new THREE.PointsMaterial({ map: shapeTexture(shape), color: new THREE.Color(color), size: POINT_PX, sizeAttenuation: false, transparent: true, alphaTest: 0.4, opacity: faded ? 0.12 : 1, depthWrite: !faded }), [shape, color, faded]);
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
  const text = { color: ink, fontSize: 12, whiteSpace: "nowrap", pointerEvents: "none" } as const;
  // Depth: one tick per topic on the floor's right edge (T1 at the front, as `place` puts it); the caption names them.
  const depthTicks = layers > 1 ? Array.from({ length: Math.min(layers, 8) }, (_, i) => ({ tag: topicTag(i), z: 2 - (i / (layers - 1)) * 4 })) : [];
  return (
    <div className="relative">
      <Scene3D label={label} animate={animate} camera={[0, 0.6, 8.2]} className="h-[380px] w-full" pointThreshold={0.18} fit={FIT}>
        <group rotation={[0, -0.22, 0]}>
          <lineSegments>
            <bufferGeometry attach="geometry">
              <bufferAttribute attach="attributes-position" args={[new Float32Array([-4.9, -3, -2.4, 4.4, -3, -2.4, -4.9, -3, -2.4, -4.9, 2.8, -2.4, ...(depthTicks.length ? [4.4, -3, -2.4, 4.4, -3, 2.4] : [])]), 3]} />
            </bufferGeometry>
            <lineBasicMaterial color={axis} />
          </lineSegments>
          <Label position={[-4.9, -3.35, -2.4]} style={text}>{yearMin}</Label>
          <Label position={[3.6, -3.35, -2.4]} style={text}>{yearMax}</Label>
          <Label position={[-0.6, -3.35, -2.4]} style={text}>Year →</Label>
          {scored ? (
            <>
              <Label position={[-6.1, 2.8, -2.4]} style={text}>Score 100 ↑</Label>
              <Label position={[-5.7, -2.6, -2.4]} style={text}>0</Label>
            </>
          ) : (
            <Label position={[-4.9, 3.25, -2.4]} style={text}>↑ Height: no meaning yet</Label>
          )}
          {depthTicks.map((t) => <Label key={t.tag} position={[4.6, -3, t.z]} style={{ ...text, fontSize: 11 }}>{t.tag}</Label>)}
          {depthTicks.length > 0 && <Label position={[4.6, -3.45, 2.4]} style={text}>Topic</Label>}
          {groups.map(([key, pts]) => {
            const [cat, dim] = key.split("|");
            const c = cats.find((x) => x.key === cat);
            const faded = dim === "dim" || (!!isolated && isolated !== cat) || (!!highlight && highlight !== cat);
            return <Cloud key={key} pts={pts} color={categoryHex(colorBy, cat, theme, topics)} shape={c?.shape ?? "circle"} faded={faded} onHover={setHover} onOpen={onOpen} />;
          })}
        </group>
      </Scene3D>
      {hover && (
        <div role="tooltip" className="pointer-events-none absolute left-3 top-3 max-w-[80%] rounded-sm border border-line-strong bg-bg-2 px-2 py-1 text-12">
          <span className="block font-medium text-fg-0">{hover.title}</span>
          <span className="text-fg-2">{hover.year ?? "year unknown"}{hover.score !== null ? ` · score ${Math.round(hover.score)}` : ""}{hover.layer >= 0 && topics[hover.layer] ? ` · ${topicTag(hover.layer)} ${topics[hover.layer].name}` : ""} · click to open</span>
        </div>
      )}
    </div>
  );
}
