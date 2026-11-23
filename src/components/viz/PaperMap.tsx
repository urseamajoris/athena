"use client";
import { useMemo, useState, useSyncExternalStore } from "react";
import dynamic from "next/dynamic";
import { Box, Square } from "lucide-react";
import { Legend, shapePath } from "../categories";
import { cx } from "../ui";
import { useReducedMotion, useTheme, useVizMode } from "./support";
import { AXIS_NOTE, countBy, defaultYAxis, place, type MapPoint, type Placed, type YAxisMetric } from "./paper-points";
import { categoriesFor, categoryVar, COLOR_BY, type ColorBy } from "@/lib/shared/categories";
import { fmtInt } from "@/lib/shared/format";

/** Touch-only screens (no hover): the legend and chart hints say "tap" and "pinch", not "hover" and "scroll". */
const NO_HOVER = "(hover: none)";
function subHover(cb: () => void) {
  const mq = window.matchMedia(NO_HOVER);
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
}
const useTouchOnly = () => useSyncExternalStore(subHover, () => window.matchMedia(NO_HOVER).matches, () => false);

const PaperMap3D = dynamic(() => import("./PaperMap3D"), { ssr: false, loading: () => <div className="flex h-[380px] items-center justify-center text-12 text-fg-2">Loading the 3D map…</div> });

const Y_CHOICES: { key: YAxisMetric; label: string }[] = [
  { key: "citations", label: "Citations (log)" },
  { key: "velocity", label: "Citations / year" },
  { key: "impact", label: "Impact index" },
  { key: "score", label: "Ranking score" },
];

/** 2D version (no WebGL, weak devices, or chosen): gridlines, labelled axes, citation sizing and rich hover card. */
function PaperMap2D({
  points,
  colorBy,
  topics,
  isolated,
  highlight,
  onOpen,
  label,
  dimUnselected,
  yMetric,
  sizeByCitations,
}: {
  points: MapPoint[];
  colorBy: ColorBy;
  topics: { id: string; name: string }[];
  isolated: string | null;
  highlight: string | null;
  onOpen: (id: string) => void;
  label: string;
  dimUnselected: boolean;
  yMetric: YAxisMetric;
  sizeByCitations: boolean;
}) {
  const { placed, yearMin, yearMax, yAxis } = useMemo(() => place(points, 1, yMetric), [points, yMetric]);
  const [hover, setHover] = useState<Placed | null>(null);
  const cats = categoriesFor(colorBy, topics);
  const W = 640;
  const H = 330;
  const padL = 52;
  const padR = 16;
  const padT = 18;
  const padB = 30;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;
  const sx = (x: number) => ((x + 5) / 10) * plotW + padL;
  const sy = (yNorm: number) => padT + (1 - yNorm) * plotH;
  const midYear = Math.round((yearMin + yearMax) / 2);

  return (
    <div className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} className="h-[330px] w-full" role="img" aria-label={label}>
        {/* Subtle horizontal gridlines & Y ticks */}
        {yAxis.ticks.map((t) => {
          const yy = sy(t.norm);
          return (
            <g key={t.label}>
              <line x1={padL} x2={W - padR} y1={yy} y2={yy} stroke="var(--line)" strokeDasharray={t.norm === 0 ? undefined : "3 3"} />
              <text x={padL - 6} y={yy + 4} textAnchor="end" fontSize="11" fill="var(--fg-2)">{t.label}</text>
            </g>
          );
        })}
        {/* Axes */}
        <line x1={padL} x2={W - padR} y1={H - padB} y2={H - padB} stroke="var(--line-strong)" />
        <line x1={padL} x2={padL} y1={padT} y2={H - padB} stroke="var(--line-strong)" />
        {/* X ticks */}
        <text x={padL} y={H - 10} fontSize="11" fill="var(--fg-2)">{yearMin}</text>
        {midYear > yearMin && midYear < yearMax && (
          <text x={padL + plotW / 2} y={H - 10} textAnchor="middle" fontSize="11" fill="var(--fg-2)">{midYear}</text>
        )}
        <text x={W - padR} y={H - 10} textAnchor="end" fontSize="11" fill="var(--fg-2)">{yearMax}</text>
        {yAxis.label && (
          <text x={padL + 6} y={padT + 10} fontSize="11" fontWeight={500} fill="var(--fg-1)">↑ {yAxis.label}</text>
        )}
        {placed.map((p) => {
          const c = cats.find((x) => x.key === p.cat);
          const faded = (dimUnselected && !p.selected) || (!!isolated && isolated !== p.cat) || (!!highlight && highlight !== p.cat);
          const scale = sizeByCitations ? 0.65 * p.sizeScale : 0.78;
          const cx0 = sx(p.x);
          const cy0 = sy(p.yNorm);
          const isHover = hover?.id === p.id;
          return (
            <g
              key={p.id}
              transform={`translate(${cx0} ${cy0})`}
              opacity={faded ? 0.16 : 1}
              className="cursor-pointer"
              onMouseEnter={() => setHover(p)}
              onMouseLeave={() => setHover((h) => (h?.id === p.id ? null : h))}
              onClick={() => onOpen(p.id)}
            >
              {isHover && <circle r={12 * scale} fill="none" stroke="var(--fg-0)" strokeWidth={1.5} />}
              <path
                d={shapePath(c?.shape ?? "circle")}
                transform={`translate(${-8 * scale} ${-8 * scale}) scale(${scale})`}
                fill={categoryVar(colorBy, p.cat, topics)}
                fillRule="evenodd"
              >
                <title>{`${p.title} (${p.year ?? "year unknown"}${typeof p.citations === "number" ? `, ${fmtInt(p.citations)} citations` : ""}${p.score !== null ? `, score ${Math.round(p.score)}` : ""})`}</title>
              </path>
            </g>
          );
        })}
      </svg>
      {hover && (
        <div role="tooltip" className="pointer-events-none absolute right-3 top-2 max-w-[75%] rounded-sm border border-line-strong bg-bg-2 px-2.5 py-1.5 text-12">
          <span className="line-clamp-2 block font-medium text-fg-0">{hover.title}</span>
          <span className="mt-0.5 block tabular-nums text-fg-1">
            {hover.year ?? "Year n/a"}
            {typeof hover.citations === "number" ? ` · ${fmtInt(hover.citations)} cites` : ""}
            {typeof hover.citationsPerYear === "number" ? ` (${hover.citationsPerYear}/yr)` : ""}
            {typeof hover.impactScore === "number" ? ` · impact ${hover.impactScore}/100` : ""}
            {hover.score !== null ? ` · score ${Math.round(hover.score)}` : ""}
          </span>
          <span className="text-fg-2">Click to open paper details</span>
        </div>
      )}
    </div>
  );
}

/**
 * Papers as points, coloured and shaped by category, with a legend that highlights (hover) and isolates (click)
 * a category, Y-axis impact/score switch, citation bubble sizing, and 2D/3D toggle.
 */
export function PaperMap({
  points,
  colorBy,
  onColorBy,
  topics,
  onOpen,
  layers,
  title,
  dimUnselected = false,
  colorChoices,
  of,
  defaultY,
}: {
  points: MapPoint[];
  colorBy: ColorBy;
  onColorBy: (c: ColorBy) => void;
  topics: { id: string; name: string }[];
  onOpen: (id: string) => void;
  layers: number;
  title: string;
  dimUnselected?: boolean;
  colorChoices?: ColorBy[];
  of?: number;
  defaultY?: YAxisMetric;
}) {
  const [pref, setPref] = useState<"auto" | "2d">("auto");
  const mode = useVizMode(pref);
  const reduced = useReducedMotion();
  const theme = useTheme();
  const [isolated, setIsolated] = useState<string | null>(null);
  const [highlight, setHighlight] = useState<string | null>(null);
  const scored = points.some((p) => p.score !== null);
  const hasCites = points.some((p) => typeof p.citations === "number");
  const hasImpact = points.some((p) => typeof p.impactScore === "number");
  const [yChoice, setYChoice] = useState<YAxisMetric | null>(defaultY ?? null);
  const [sizeByCitations, setSizeByCitations] = useState(hasCites);

  const availableY = Y_CHOICES.filter((c) => {
    if (c.key === "score") return scored;
    if (c.key === "citations" || c.key === "velocity") return hasCites;
    if (c.key === "impact") return hasImpact;
    return false;
  });
  const activeY: YAxisMetric = yChoice && availableY.some((c) => c.key === yChoice) ? yChoice : (availableY[0]?.key ?? defaultYAxis(points));
  const counts = useMemo(() => countBy(points), [points]);
  const touch = useTouchOnly();
  const shown = isolated ? points.filter((p) => p.cat === isolated) : points;
  const total = of ?? points.length;
  const caption = `${shown.length < total ? `Showing ${shown.length} of ${total} papers` : `${total} papers`}. ${AXIS_NOTE(availableY.length ? activeY : "spread", colorBy, sizeByCitations && hasCites)}${dimUnselected ? " Faded: not selected for appraisal." : ""}`;
  const dimLabel = (COLOR_BY.find((c) => c.key === colorBy)?.label ?? colorBy).toLowerCase();

  return (
    <figure className="rounded-md border border-line bg-bg-1 p-3">
      <figcaption className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-medium text-fg-0">{title}</span>
        <span className="flex flex-wrap items-center gap-2">
          {availableY.length > 1 && (
            <label className="flex items-center gap-1.5 text-12 text-fg-1">Y-axis
              <select className="input h-8 min-h-8 w-auto py-0 text-12" value={activeY} onChange={(e) => setYChoice(e.target.value as YAxisMetric)}>
                {availableY.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
              </select>
            </label>
          )}
          <label className="flex items-center gap-1.5 text-12 text-fg-1">Colour by
            <select className="input h-8 min-h-8 w-auto py-0 text-12" value={colorBy} onChange={(e) => { setIsolated(null); onColorBy(e.target.value as ColorBy); }}>
              {COLOR_BY.filter((c) => !colorChoices || colorChoices.includes(c.key)).map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
            </select>
          </label>
          {hasCites && (
            <label className="inline-flex min-h-8 cursor-pointer items-center gap-1.5 rounded-sm border border-line px-2 text-12 text-fg-1 hover:bg-bg-2">
              <input type="checkbox" checked={sizeByCitations} onChange={(e) => setSizeByCitations(e.target.checked)} className="h-3.5 w-3.5" />
              Size by cites
            </label>
          )}
          {mode && (
            <button className="btn-secondary btn-sm" onClick={() => setPref(pref === "2d" ? "auto" : "2d")} title={mode === "3d" ? "Show a flat chart instead" : "Show the 3D view"}>
              {mode === "3d" ? <Square className="h-3 w-3" aria-hidden /> : <Box className="h-3 w-3" aria-hidden />}
              {mode === "3d" ? "2D" : "3D"}
            </button>
          )}
        </span>
      </figcaption>
      <Legend dim={colorBy} topics={topics} counts={counts} highlight={highlight} isolated={isolated} onHighlight={setHighlight} onIsolate={setIsolated} className="mt-2" title={isolated ? `Showing only one category (${counts[isolated] ?? 0} papers). ${touch ? "Tap" : "Click"} it again to show all.` : touch ? `Key (${dimLabel}): tap a category to show only that one` : `Key (${dimLabel}): hover or focus to highlight, click to show only that category`} />
      <div className={cx("mt-2", !mode && "h-[330px]")}>
        {mode === "3d" ? (
          <PaperMap3D points={shown} colorBy={colorBy} topics={topics} theme={theme} isolated={null} highlight={highlight} animate={!reduced} onOpen={onOpen} layers={layers} label={caption} dimUnselected={dimUnselected} yMetric={activeY} />
        ) : mode === "2d" ? (
          <PaperMap2D points={shown} colorBy={colorBy} topics={topics} isolated={null} highlight={highlight} onOpen={onOpen} label={caption} dimUnselected={dimUnselected} yMetric={activeY} sizeByCitations={sizeByCitations && hasCites} />
        ) : null}
      </div>
      <p className="mt-2 text-12 text-fg-2">{caption}{mode === "3d" ? (touch ? " Drag to turn, pinch to zoom." : " Drag to turn, scroll to zoom.") : ""}</p>
    </figure>
  );
}
