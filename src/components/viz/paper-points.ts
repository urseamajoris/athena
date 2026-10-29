// Layout and grouping for the papers-as-points views (shared by the 3D and 2D versions).
import { COLOR_BY, type ColorBy } from "@/lib/shared/categories";

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
}

/** Stable pseudo-random 0..1 from an id (so points do not jump between renders). */
export function hash01(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  return ((h >>> 0) % 10000) / 10000;
}

export interface Placed extends MapPoint { x: number; y: number; z: number }

/** x = publication year (older left), y = ranking score (higher up) or a stable spread before ranking, z = topic
 *  (the first topic at the front, where its axis label is). */
export function place(points: MapPoint[], layers: number): { placed: Placed[]; yearMin: number; yearMax: number; scored: boolean } {
  const years = points.map((p) => p.year).filter((y): y is number => !!y);
  const yearMin = years.length ? Math.min(...years) : 2015;
  const yearMax = years.length ? Math.max(...years) : 2026;
  const span = Math.max(1, yearMax - yearMin);
  const scored = points.some((p) => p.score !== null);
  const placed = points.map((p) => {
    const j = hash01(p.id);
    const x = p.year ? ((p.year - yearMin) / span) * 8 - 4 + (j - 0.5) * 0.35 : -4.8;
    const y = scored ? (p.score === null ? -2.8 : (p.score / 100) * 5 - 2.5) : (j - 0.5) * 4.6;
    const z = layers > 1 && p.layer >= 0 ? 2 - (p.layer / (layers - 1)) * 4 : (hash01(`${p.id}z`) - 0.5) * 2;
    return { ...p, x, y, z };
  });
  return { placed, yearMin, yearMax, scored };
}

export function countBy(points: MapPoint[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const p of points) out[p.cat] = (out[p.cat] ?? 0) + 1;
  return out;
}

/** Short topic tag on the depth axis (T1, T2, …), in the topics' order. */
export const topicTag = (i: number) => `T${i + 1}`;

/**
 * What each direction, the colour and the size mean, in words (the chart's caption and text alternative). Depth
 * exists only in 3D; there it names each topic's tag on the depth axis.
 */
export function axisNote(scored: boolean, colorBy: ColorBy, three: boolean, topics: { name: string }[] = []): string {
  const colour = (COLOR_BY.find((c) => c.key === colorBy)?.label ?? colorBy).toLowerCase();
  const depth = three && topics.length > 1 ? ` Front to back: topic (${topics.map((t, i) => `${topicTag(i)} ${t.name}`).join("; ")}).` : "";
  return `Left to right: publication year. ${scored ? "Bottom to top: ranking score." : "Up and down has no meaning yet: papers are spread out so each one can be seen."}${depth} Colour and shape: ${colour}. Every point is the same size.`;
}
