"use client";
import type { CSSProperties } from "react";
import { categoriesFor, categoryVar, hasHues, type Category, type ColorBy, type Dimension, type Shape } from "@/lib/shared/categories";
import { cx } from "./ui";

/** SVG path for each category shape in a 16×16 box (the second cue besides colour and label). */
export function shapePath(shape: Shape): string {
  switch (shape) {
    case "circle": return "M8 2.5a5.5 5.5 0 1 1 0 11a5.5 5.5 0 1 1 0-11z";
    case "square": return "M3 3h10v10H3z";
    case "triangle": return "M8 2l6.5 11.5h-13z";
    case "diamond": return "M8 1.5l6.5 6.5L8 14.5L1.5 8z";
    case "star": return "M8 1.5l1.9 4.1 4.5.5-3.4 3 1 4.4L8 11.2 4 13.5l1-4.4-3.4-3 4.5-.5z";
    case "cross": return "M6 2h4v4h4v4h-4v4H6v-4H2V6h4z";
    case "hexagon": return "M4.5 2h7L15 8l-3.5 6h-7L1 8z";
    case "ring": return "M8 2.5a5.5 5.5 0 1 1 0 11a5.5 5.5 0 1 1 0-11zm0 2.5a3 3 0 1 0 0 6a3 3 0 1 0 0-6z";
  }
}

export function ShapeIcon({ shape, color, size = 12, className, title }: { shape: Shape; color: string; size?: number; className?: string; title?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" className={cx("shrink-0", className)} aria-hidden={title ? undefined : true} role={title ? "img" : undefined}>
      {title && <title>{title}</title>}
      <path d={shapePath(shape)} fill={color} fillRule="evenodd" />
    </svg>
  );
}

/** Shape + colour + text: a category is never shown by colour alone. */
export function CategoryChip({ dim, value, topics = [], className, style }: { dim: Dimension | ColorBy; value: string; topics?: { id: string; name: string }[]; className?: string; style?: CSSProperties }) {
  const cat = categoriesFor(dim, topics).find((c) => c.key === value);
  if (!cat) return null;
  return (
    <span className={cx("inline-flex items-center gap-2 text-12 text-fg-1", className)} style={style} title={cat.hint}>
      {hasHues(dim) && <ShapeIcon shape={cat.shape} color={categoryVar(dim, value, topics)} />}
      {cat.label}
    </span>
  );
}

/**
 * Legend for a "Color by" dimension. Hover or focus highlights a category, click isolates it (click again
 * to show all). Counts are shown when given; categories with no items are listed last, dimmed.
 */
export function Legend({
  dim,
  topics = [],
  counts,
  highlight,
  isolated,
  onHighlight,
  onIsolate,
  className,
  title,
}: {
  dim: Dimension | ColorBy;
  topics?: { id: string; name: string }[];
  counts?: Record<string, number>;
  highlight?: string | null;
  isolated?: string | null;
  onHighlight?: (k: string | null) => void;
  onIsolate?: (k: string | null) => void;
  className?: string;
  title?: string;
}) {
  const cats: Category[] = categoriesFor(dim, topics);
  const sorted = counts ? [...cats].sort((a, b) => Number((counts[b.key] ?? 0) > 0) - Number((counts[a.key] ?? 0) > 0)) : cats;
  return (
    <div className={className}>
      {title && <p className="mb-1 text-12 font-medium text-fg-2">{title}</p>}
      <ul className="flex flex-wrap gap-x-1 gap-y-1" aria-label={title ?? "Legend"}>
        {sorted.map((c) => {
          const n = counts?.[c.key];
          const dim0 = counts && !n;
          const active = isolated === c.key;
          return (
            <li key={c.key}>
              <button
                type="button"
                disabled={!onIsolate}
                aria-pressed={onIsolate ? active : undefined}
                title={c.hint ? `${c.label}: ${c.hint}` : c.label}
                onMouseEnter={() => onHighlight?.(c.key)}
                onMouseLeave={() => onHighlight?.(null)}
                onFocus={() => onHighlight?.(c.key)}
                onBlur={() => onHighlight?.(null)}
                onClick={() => onIsolate?.(active ? null : c.key)}
                className={cx(
                  "inline-flex min-h-8 items-center gap-2 rounded-sm border px-2 text-12 disabled:cursor-default",
                  active ? "border-fg-1 bg-bg-3 text-fg-0" : "border-transparent text-fg-1 enabled:hover:bg-bg-2",
                  (dim0 || (isolated && !active) || (highlight && highlight !== c.key)) && "opacity-55",
                )}
              >
                {hasHues(dim) && <ShapeIcon shape={c.shape} color={categoryVar(dim, c.key, topics)} />}
                <span>{c.label}</span>
                {n !== undefined && <span className="tabular-nums text-fg-2">{n}</span>}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
