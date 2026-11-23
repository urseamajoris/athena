// Layout and grouping for the papers-as-points views (shared by the 3D and 2D versions).
import type { ColorBy } from "@/lib/shared/categories";
import { fmtInt } from "@/lib/shared/format";

export type YAxisMetric = "score" | "citations" | "velocity" | "impact";

export interface MapPoint {
  id: string;
  title: string;
  year: number | null;
  /** 0–100 ranking score, or null before ranking. */
  score: number | null;
  /** Topic index (0-based) for depth; -1 = none. */
  layer: number;
  /** Category key in the current "Color by" dimension. */
  cat: string;
  selected?: boolean;
  /** Scholarly impact metrics (optional for backward compatibility). */
  citations?: number | null;
  citationsPerYear?: number | null;
  impactScore?: number | null;
  impactTier?: string;
  openAccess?: boolean;
  stage?: "retrieved" | "rendered" | "filed";
}

/** Stable pseudo-random 0..1 from an id (so points do not jump between renders). */
export function hash01(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  return ((h >>> 0) % 10000) / 10000;
}

export interface Placed extends MapPoint {
  x: number;
  y: number;
  z: number;
  /** Normalized 0..1 vertical position for 2D/3D axes. */
  yNorm: number;
  /** Relative marker scale (0.75..1.7) based on citation volume. */
  sizeScale: number;
}

export interface YAxisInfo {
  metric: YAxisMetric | "spread";
  label: string;
  ticks: { norm: number; label: string }[];
  maxValue: number;
}

/** Log-scaled marker radius multiplier from citation count so highly-cited articles stand out cleanly. */
export function citationSizeScale(citations: number | null | undefined, maxCitations: number): number {
  if (citations === null || citations === undefined || citations <= 0 || maxCitations <= 0) return 0.8;
  const ratio = Math.log10(citations + 1) / Math.max(1, Math.log10(maxCitations + 1));
  return Math.round((0.8 + ratio * 0.9) * 100) / 100;
}

export function defaultYAxis(points: MapPoint[]): YAxisMetric {
  if (points.some((p) => p.score !== null)) return "score";
  if (points.some((p) => typeof p.citations === "number")) return "citations";
  if (points.some((p) => typeof p.impactScore === "number")) return "impact";
  return "score";
}

/**
 * x = publication year (older left), y = chosen metric (ranking score, log citations, citations/yr,
 * composite impact index, or stable spread when no metric exists yet), z = topic layer.
 */
export function place(
  points: MapPoint[],
  layers: number,
  requestedY?: YAxisMetric,
): { placed: Placed[]; yearMin: number; yearMax: number; scored: boolean; yAxis: YAxisInfo } {
  const years = points.map((p) => p.year).filter((y): y is number => !!y);
  const yearMin = years.length ? Math.min(...years) : 2015;
  const yearMax = years.length ? Math.max(...years) : 2026;
  const span = Math.max(1, yearMax - yearMin);
  const scored = points.some((p) => p.score !== null);
  const hasCites = points.some((p) => typeof p.citations === "number");
  const hasVelocity = points.some((p) => typeof p.citationsPerYear === "number");
  const hasImpact = points.some((p) => typeof p.impactScore === "number");
  const maxCitations = Math.max(1, ...points.map((p) => (typeof p.citations === "number" ? p.citations : 0)));
  const maxVelocity = Math.max(1, ...points.map((p) => (typeof p.citationsPerYear === "number" ? p.citationsPerYear : 0)));

  let metric: YAxisMetric | "spread" = requestedY ?? defaultYAxis(points);
  if (metric === "score" && !scored) metric = hasCites ? "citations" : hasImpact ? "impact" : "spread";
  if (metric === "citations" && !hasCites) metric = hasImpact ? "impact" : "spread";
  if (metric === "velocity" && !hasVelocity) metric = hasCites ? "citations" : "spread";
  if (metric === "impact" && !hasImpact) metric = hasCites ? "citations" : "spread";

  const yNormFor = (p: MapPoint, j: number): number => {
    if (metric === "score") return p.score === null ? 0 : Math.max(0, Math.min(1, p.score / 100));
    if (metric === "impact") return p.impactScore == null ? 0 : Math.max(0, Math.min(1, p.impactScore / 100));
    if (metric === "citations") {
      if (typeof p.citations !== "number") return 0;
      return Math.max(0, Math.min(1, Math.log10(p.citations + 1) / Math.max(0.3, Math.log10(maxCitations + 1))));
    }
    if (metric === "velocity") {
      if (typeof p.citationsPerYear !== "number") return 0;
      return Math.max(0, Math.min(1, Math.log10(p.citationsPerYear + 1) / Math.max(0.3, Math.log10(maxVelocity + 1))));
    }
    return j;
  };

  const placed: Placed[] = points.map((p) => {
    const j = hash01(p.id);
    const x = p.year ? ((p.year - yearMin) / span) * 8 - 4 + (j - 0.5) * 0.35 : -4.8;
    const yNorm = yNormFor(p, j);
    const y = metric === "spread" ? (j - 0.5) * 4.6 : yNorm * 5 - 2.5;
    const z = layers > 1 && p.layer >= 0 ? (p.layer / (layers - 1)) * 4 - 2 : (hash01(`${p.id}z`) - 0.5) * 2;
    return { ...p, x, y, z, yNorm, sizeScale: citationSizeScale(p.citations, maxCitations) };
  });

  const yAxis: YAxisInfo = (() => {
    if (metric === "score") {
      return {
        metric,
        label: "Ranking score",
        maxValue: 100,
        ticks: [0, 25, 50, 75, 100].map((v) => ({ norm: v / 100, label: String(v) })),
      };
    }
    if (metric === "impact") {
      return {
        metric,
        label: "Impact index",
        maxValue: 100,
        ticks: [0, 25, 50, 75, 100].map((v) => ({ norm: v / 100, label: String(v) })),
      };
    }
    if (metric === "citations") {
      const logMax = Math.max(0.3, Math.log10(maxCitations + 1));
      const candidates = [0, 1, 5, 10, 25, 50, 100, 250, 500, 1000, 5000, 10000].filter((v) => v <= maxCitations);
      if (!candidates.includes(maxCitations)) candidates.push(maxCitations);
      const picked = candidates.length <= 5 ? candidates : [0, candidates[Math.floor(candidates.length * 0.33)], candidates[Math.floor(candidates.length * 0.66)], maxCitations];
      const unique = [...new Set(picked)];
      return {
        metric,
        label: "Citations (log)",
        maxValue: maxCitations,
        ticks: unique.map((v) => ({ norm: Math.log10(v + 1) / logMax, label: fmtInt(v) })),
      };
    }
    if (metric === "velocity") {
      const logMax = Math.max(0.3, Math.log10(maxVelocity + 1));
      const candidates = [0, 1, 5, 12, 30, 100, 300].filter((v) => v <= maxVelocity);
      if (!candidates.includes(Math.round(maxVelocity))) candidates.push(Math.round(maxVelocity));
      const picked = candidates.length <= 5 ? candidates : [0, candidates[Math.floor(candidates.length * 0.4)], candidates[Math.floor(candidates.length * 0.7)], Math.round(maxVelocity)];
      const unique = [...new Set(picked)];
      return {
        metric,
        label: "Citations / year (log)",
        maxValue: maxVelocity,
        ticks: unique.map((v) => ({ norm: Math.log10(v + 1) / logMax, label: `${v}/y` })),
      };
    }
    return { metric: "spread", label: "", maxValue: 0, ticks: [] };
  })();

  return { placed, yearMin, yearMax, scored, yAxis };
}

export function countBy(points: MapPoint[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const p of points) out[p.cat] = (out[p.cat] ?? 0) + 1;
  return out;
}

export const AXIS_NOTE = (yMetric: YAxisInfo["metric"] | boolean, colorBy: ColorBy, sizeByCitations = false) => {
  const yText =
    yMetric === true || yMetric === "score"
      ? "Bottom to top: ranking score (0–100)."
      : yMetric === "citations"
        ? "Bottom to top: total citations (log scale)."
        : yMetric === "velocity"
          ? "Bottom to top: citations per year since publication (log scale)."
          : yMetric === "impact"
            ? "Bottom to top: composite impact index (0–100)."
            : "Height has no meaning yet (papers are spread out to be visible).";
  const colorName = colorBy === "study" ? "study type" : colorBy === "impact" ? "citation impact tier" : colorBy;
  return `Left to right: publication year. ${yText} Depth: topic. Colour and shape: ${colorName}.${sizeByCitations ? " Dot size: citation volume." : ""}`;
};
