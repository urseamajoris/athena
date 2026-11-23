"use client";
import { CheckCircle2, Circle } from "lucide-react";
import { cx } from "../ui";

export interface CheckItem {
  label: string;
  done: boolean;
  /** Why or how, shown under the label while it is not done. */
  hint?: string;
}

/** "Do these 2–3 things": a short guided checklist that ticks off as the user acts. */
export function Checklist({ title = "Do these things", items, className }: { title?: string; items: CheckItem[]; className?: string }) {
  const done = items.filter((i) => i.done).length;
  return (
    <section aria-label={title} className={cx("rounded-md border border-line bg-bg-1 px-3 py-3", className)}>
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-12 font-medium text-fg-1">{title}</h3>
        <span className="text-12 tabular-nums text-fg-2" aria-live="polite">{done} of {items.length} done</span>
      </div>
      <ol className="mt-2 space-y-2">
        {items.map((it) => (
          <li key={it.label} className="flex items-start gap-2">
            {it.done ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-ok" strokeWidth={2} aria-hidden /> : <Circle className="mt-0.5 h-4 w-4 shrink-0 text-fg-2" strokeWidth={2} aria-hidden />}
            <span className={cx(it.done ? "text-fg-2 line-through decoration-fg-2/50" : "text-fg-0")}>
              <span className="sr-only">{it.done ? "Done: " : "To do: "}</span>
              {it.label}
              {!it.done && it.hint && <span className="block text-12 text-fg-2 no-underline">{it.hint}</span>}
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}
