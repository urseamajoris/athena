"use client";
import { useId, useState } from "react";
import { cx } from "../ui";
import { ShapeIcon } from "../categories";
import type { Shape } from "@/lib/shared/categories";

const fmtDay = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" });

/**
 * Daily bars (one series, so no legend: the title names it). 4px rounded tops anchored to the baseline,
 * 2px gaps, recessive axis. Hover or focus a bar for its value; "Table" shows the same numbers as text.
 */
export function DailyBars({ title, data, format = (v) => String(v), height = 96 }: { title: string; data: { day: string; value: number }[]; format?: (v: number) => string; height?: number }) {
  const [hover, setHover] = useState<number | null>(null);
  const [table, setTable] = useState(false);
  const id = useId();
  const max = Math.max(...data.map((d) => d.value), 0);
  const total = data.reduce((a, d) => a + d.value, 0);
  const w = 100 / Math.max(1, data.length);
  return (
    <figure className="min-w-0">
      <figcaption className="flex items-baseline justify-between gap-2">
        <span id={id} className="text-12 font-medium text-fg-1">{title}</span>
        <button className="text-12 text-fg-2 underline-offset-2 hover:underline" onClick={() => setTable(!table)} aria-expanded={table}>{table ? "Chart" : "Table"}</button>
      </figcaption>
      {table ? (
        <table className="mt-2 w-full text-12">
          <caption className="sr-only">{title}</caption>
          <tbody>{data.map((d) => <tr key={d.day} className="border-t border-line"><th scope="row" className="py-1 text-left font-normal text-fg-2">{fmtDay(d.day)}</th><td className="py-1 text-right tabular-nums">{format(d.value)}</td></tr>)}</tbody>
        </table>
      ) : (
        <div className="relative mt-2">
          <svg viewBox={`0 0 100 ${height}`} preserveAspectRatio="none" className="block h-24 w-full" role="img" aria-labelledby={id} aria-describedby={`${id}-sum`}>
            <line x1="0" x2="100" y1={height - 0.5} y2={height - 0.5} stroke="var(--line-strong)" strokeWidth="1" vectorEffect="non-scaling-stroke" />
            {data.map((d, i) => {
              const h = max ? (d.value / max) * (height - 4) : 0;
              return (
                <g key={d.day}>
                  <rect x={i * w} y={0} width={w} height={height} fill="transparent" onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} />
                  {h > 0 && <rect x={i * w + 0.6} y={height - h} width={Math.max(0.5, w - 1.2)} height={h} rx="0.8" fill={hover === i ? "var(--accent-hover)" : "var(--cat-1)"} pointerEvents="none" />}
                </g>
              );
            })}
          </svg>
          {hover !== null && (
            <div role="tooltip" className="pointer-events-none absolute -top-2 z-10 -translate-x-1/2 -translate-y-full whitespace-nowrap rounded-sm border border-line-strong bg-bg-2 px-2 py-1 text-12" style={{ left: `${(hover + 0.5) * w}%` }}>
              <span className="text-fg-2">{fmtDay(data[hover].day)}</span> <span className="tabular-nums text-fg-0">{format(data[hover].value)}</span>
            </div>
          )}
          <div className="mt-1 flex justify-between text-12 text-fg-2" aria-hidden><span>{data[0] && fmtDay(data[0].day)}</span><span>{data.at(-1) && fmtDay(data.at(-1)!.day)}</span></div>
          <p id={`${id}-sum`} className="sr-only">{`${data.length} days, total ${format(total)}, highest ${format(max)}.`}</p>
        </div>
      )}
    </figure>
  );
}

/** Horizontal bars with direct labels (values in text ink, never the bar colour). */
export function HBars({ title, rows, format = (v) => String(v), note }: { title: string; rows: { key: string; label: string; value: number; color?: string; shape?: Shape; sub?: string }[]; format?: (v: number) => string; note?: string }) {
  const max = Math.max(...rows.map((r) => r.value), 0);
  return (
    <figure className="min-w-0">
      <figcaption className="text-12 font-medium text-fg-1">{title}</figcaption>
      <ul className="mt-2 space-y-1.5">
        {rows.map((r) => (
          <li key={r.key} className="grid grid-cols-[minmax(0,10rem)_1fr_auto] items-center gap-2 text-12">
            <span className="flex min-w-0 items-center gap-1.5 text-fg-1">
              {r.shape && <ShapeIcon shape={r.shape} color={r.color ?? "var(--cat-1)"} />}
              <span className="truncate" title={r.label}>{r.label}</span>
            </span>
            <span className="h-3 rounded-sm bg-bg-2" aria-hidden>
              {r.value > 0 && <span className="block h-3 rounded-r-[4px]" style={{ width: `${Math.max(2, (r.value / (max || 1)) * 100)}%`, background: r.color ?? "var(--cat-1)" }} />}
            </span>
            <span className="tabular-nums text-fg-0">{format(r.value)}{r.sub && <span className="ml-1 text-fg-2">{r.sub}</span>}</span>
          </li>
        ))}
      </ul>
      {note && <p className="mt-2 text-12 text-fg-2">{note}</p>}
    </figure>
  );
}

export function Stat({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: "ok" | "warn" | "err" }) {
  return (
    <div className="min-w-0 rounded-md border border-line bg-bg-1 px-3 py-2">
      <p className="truncate text-12 text-fg-2">{label}</p>
      <p className={cx("text-20 font-semibold", tone === "ok" ? "text-ok" : tone === "warn" ? "text-warn" : tone === "err" ? "text-err" : "text-fg-0")}>{value}</p>
      {sub && <p className="break-words text-12 text-fg-2">{sub}</p>}
    </div>
  );
}

/** Spend against the limit, with the 80% warning mark labelled on the bar. */
export function BudgetBar({ spent, limit }: { spent: number; limit: number }) {
  const pct = limit > 0 ? Math.min(1, spent / limit) : 0;
  const tone = pct >= 1 ? "var(--err)" : pct >= 0.8 ? "var(--warn)" : "var(--ok)";
  return (
    <div>
      <div className="relative h-3 rounded-sm bg-bg-3" role="meter" aria-valuemin={0} aria-valuemax={limit} aria-valuenow={spent} aria-label={`AI spend: $${spent.toFixed(2)} of $${limit.toFixed(2)}`}>
        <div className="h-3 rounded-sm" style={{ width: `${pct * 100}%`, background: tone }} />
        <div className="absolute inset-y-[-3px] w-px bg-fg-2" style={{ left: "80%" }} aria-hidden />
      </div>
      <div className="mt-1 flex justify-between text-12 text-fg-2"><span>$0</span><span style={{ marginLeft: "62%" }}>80%</span><span>${limit.toFixed(2)}</span></div>
    </div>
  );
}
