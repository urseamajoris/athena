"use client";
import { useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { Box, Square } from "lucide-react";
import { Legend } from "../categories";
import { shapePath } from "../categories";
import { cx } from "../ui";
import { useReducedMotion, useTheme, useVizMode } from "./support";
import { AXIS_NOTE, countBy, place, type MapPoint } from "./paper-points";
import { categoriesFor, categoryVar, COLOR_BY, type ColorBy } from "@/lib/shared/categories";

const PaperMap3D = dynamic(() => import("./PaperMap3D"), { ssr: false, loading: () => <div className="flex h-[380px] items-center justify-center text-12 text-fg-2">Loading the 3D map…</div> });

/** 2D version (no WebGL, weak devices, or chosen): the same positions, colours, shapes and legend. */
function PaperMap2D({ points, colorBy, topics, isolated, highlight, onOpen, label, dimUnselected }: { points: MapPoint[]; colorBy: ColorBy; topics: { id: string; name: string }[]; isolated: string | null; highlight: string | null; onOpen: (id: string) => void; label: string; dimUnselected: boolean }) {
  const { placed, yearMin, yearMax, scored } = useMemo(() => place(points, 1), [points]);
  const cats = categoriesFor(colorBy, topics);
  const W = 600;
  const H = 300;
  const sx = (x: number) => ((x + 5) / 10) * (W - 40) + 30;
  const sy = (y: number) => H - 24 - ((y + 3) / 6) * (H - 40);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-[300px] w-full" role="img" aria-label={label}>
      <line x1={30} x2={W - 10} y1={H - 22} y2={H - 22} stroke="var(--line-strong)" />
      <line x1={30} x2={30} y1={10} y2={H - 22} stroke="var(--line-strong)" />
      <text x={30} y={H - 6} fontSize="11" fill="var(--fg-2)">{yearMin}</text>
      <text x={W - 40} y={H - 6} fontSize="11" fill="var(--fg-2)">{yearMax}</text>
      {scored && <text x={34} y={20} fontSize="11" fill="var(--fg-2)">score 100</text>}
      {placed.map((p) => {
        const c = cats.find((x) => x.key === p.cat);
        const faded = (dimUnselected && !p.selected) || (!!isolated && isolated !== p.cat) || (!!highlight && highlight !== p.cat);
        return (
          <path key={p.id} d={shapePath(c?.shape ?? "circle")} transform={`translate(${sx(p.x) - 6} ${sy(p.y) - 6}) scale(0.75)`} fill={categoryVar(colorBy, p.cat, topics)} fillRule="evenodd" opacity={faded ? 0.15 : 1} className="cursor-pointer" onClick={() => onOpen(p.id)}>
            <title>{`${p.title} (${p.year ?? "year unknown"}${p.score !== null ? `, score ${Math.round(p.score)}` : ""})`}</title>
          </path>
        );
      })}
    </svg>
  );
}

/**
 * Papers as points, coloured and shaped by category, with a legend that highlights (hover) and isolates (click)
 * a category, and a "Color by" switch. 3D when WebGL is available, 2D otherwise or on request. Decorative to the
 * task: every number it shows is also in the legend counts and the caption.
 */
export function PaperMap({ points, colorBy, onColorBy, topics, onOpen, layers, title, dimUnselected = false, colorChoices }: { points: MapPoint[]; colorBy: ColorBy; onColorBy: (c: ColorBy) => void; topics: { id: string; name: string }[]; onOpen: (id: string) => void; layers: number; title: string; dimUnselected?: boolean; colorChoices?: ColorBy[] }) {
  const [pref, setPref] = useState<"auto" | "2d">("auto");
  const mode = useVizMode(pref);
  const reduced = useReducedMotion();
  const theme = useTheme();
  const [isolated, setIsolated] = useState<string | null>(null);
  const [highlight, setHighlight] = useState<string | null>(null);
  const counts = useMemo(() => countBy(points), [points]);
  const scored = points.some((p) => p.score !== null);
  const caption = `${points.length} papers. ${AXIS_NOTE(scored, colorBy)}${dimUnselected ? " Faded: not selected for appraisal." : ""}`;
  const shown = isolated ? points.filter((p) => p.cat === isolated) : points;
  return (
    <figure className="rounded-md border border-line bg-bg-1 p-3">
      <figcaption className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-medium">{title}</span>
        <span className="flex items-center gap-2">
          <label className="flex items-center gap-2 text-12 text-fg-1">Colour by
            <select className="input h-8 min-h-8 w-auto py-0 text-12" value={colorBy} onChange={(e) => { setIsolated(null); onColorBy(e.target.value as ColorBy); }}>
              {COLOR_BY.filter((c) => !colorChoices || colorChoices.includes(c.key)).map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
            </select>
          </label>
          {mode && (
            <button className="btn-secondary btn-sm" onClick={() => setPref(pref === "2d" ? "auto" : "2d")} title={mode === "3d" ? "Show a flat chart instead" : "Show the 3D view"}>
              {mode === "3d" ? <Square className="h-3 w-3" aria-hidden /> : <Box className="h-3 w-3" aria-hidden />}
              {mode === "3d" ? "Flat view" : "3D view"}
            </button>
          )}
        </span>
      </figcaption>
      <div className={cx("mt-2", !mode && "h-[300px]")}>
        {mode === "3d" ? (
          <PaperMap3D points={shown} colorBy={colorBy} topics={topics} theme={theme} isolated={null} highlight={highlight} animate={!reduced} onOpen={onOpen} layers={layers} label={caption} dimUnselected={dimUnselected} />
        ) : mode === "2d" ? (
          <PaperMap2D points={shown} colorBy={colorBy} topics={topics} isolated={null} highlight={highlight} onOpen={onOpen} label={caption} dimUnselected={dimUnselected} />
        ) : null}
      </div>
      <Legend dim={colorBy} topics={topics} counts={counts} highlight={highlight} isolated={isolated} onHighlight={setHighlight} onIsolate={setIsolated} className="mt-2" title={isolated ? `Showing only one category (${counts[isolated] ?? 0} papers). Click it again to show all.` : "Hover to highlight, click to show only that category"} />
      <p className="mt-2 text-12 text-fg-2">{caption}{mode === "3d" ? " Drag to turn, scroll to zoom." : ""}</p>
    </figure>
  );
}
