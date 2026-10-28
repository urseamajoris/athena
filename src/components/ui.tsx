"use client";
import { useEffect, useRef, type ReactNode } from "react";
import type { StageState } from "@/lib/shared/stages";
import { STATE_LABEL } from "@/lib/shared/stages";

export function cx(...a: (string | false | null | undefined)[]) {
  return a.filter(Boolean).join(" ");
}

export function Spinner({ className = "" }: { className?: string }) {
  return <span role="status" aria-label="Loading" className={cx("inline-block h-4 w-4 animate-spin rounded-full border-2 border-current border-r-transparent align-[-2px]", className)} />;
}

const STATE_STYLE: Record<StageState, string> = {
  not_started: "bg-gray-100 text-gray-600",
  running: "bg-sky-100 text-sky-800",
  needs_review: "bg-amber-100 text-amber-900",
  approved: "bg-emerald-100 text-emerald-800",
  stale: "bg-orange-100 text-orange-900",
  failed: "bg-rose-100 text-rose-800",
};
export function StateBadge({ state }: { state: StageState }) {
  return (
    <span className={cx("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold", STATE_STYLE[state])}>
      {state === "running" && <Spinner className="h-2.5 w-2.5 border" />}
      {STATE_LABEL[state]}
    </span>
  );
}

export function Badge({ children, tone = "gray", title }: { children: ReactNode; tone?: "gray" | "teal" | "amber" | "rose" | "sky" | "violet" | "emerald"; title?: string }) {
  const t = {
    gray: "bg-gray-100 text-gray-700 border-gray-200",
    teal: "bg-teal-50 text-teal-800 border-teal-200",
    amber: "bg-amber-50 text-amber-900 border-amber-200",
    rose: "bg-rose-50 text-rose-800 border-rose-200",
    sky: "bg-sky-50 text-sky-800 border-sky-200",
    violet: "bg-violet-50 text-violet-800 border-violet-200",
    emerald: "bg-emerald-50 text-emerald-800 border-emerald-200",
  }[tone];
  return (
    <span title={title} className={cx("inline-flex items-center whitespace-nowrap rounded border px-1.5 py-px text-[11px] font-medium", t)}>
      {children}
    </span>
  );
}

/** Marks a value produced by the AI from the abstract only. */
export function AbstractBadge() {
  return (
    <Badge tone="violet" title="AI-derived from the abstract only — check against the paper before relying on it">
      AI · abstract
    </Badge>
  );
}

export function TextSourceBadge({ source }: { source: string }) {
  return source === "full_text" ? (
    <Badge tone="emerald" title="The appraisal was done on the open-access full text">Full text</Badge>
  ) : (
    <Badge tone="amber" title="Full text was not legally available; only the abstract was read">Abstract only</Badge>
  );
}

export function ProgressBar({ value, max, label, tone = "teal" }: { value: number; max: number; label?: string; tone?: "teal" | "rose" | "gray" }) {
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
  return (
    <div role="progressbar" aria-valuenow={value} aria-valuemin={0} aria-valuemax={max} aria-label={label} className="h-2 w-full overflow-hidden rounded-full bg-gray-100">
      <div className={cx("h-full rounded-full transition-all", tone === "teal" ? "bg-teal-600" : tone === "rose" ? "bg-rose-500" : "bg-gray-400")} style={{ width: `${pct}%` }} />
    </div>
  );
}

export function EmptyState({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="card flex flex-col items-center gap-2 px-6 py-10 text-center">
      <p className="font-medium text-gray-800">{title}</p>
      {children && <div className="max-w-prose text-sm text-gray-500">{children}</div>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

export function ErrorState({ error, onRetry, title = "Something went wrong" }: { error: unknown; onRetry?: () => void; title?: string }) {
  const msg = error instanceof Error ? error.message : String(error);
  return (
    <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-900">
      <p className="font-semibold">{title}</p>
      <p className="mt-1 whitespace-pre-wrap break-words">{msg}</p>
      {onRetry && (
        <button className="btn-secondary mt-2" onClick={onRetry}>
          Try again
        </button>
      )}
    </div>
  );
}

export function Loading({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 px-1 py-6 text-sm text-gray-500">
      <Spinner /> {label}
    </div>
  );
}

/** Accessible modal built on <dialog> (focus trap + Escape handled by the browser). */
export function Modal({ open, onClose, title, children, footer }: { open: boolean; onClose: () => void; title: string; children: ReactNode; footer?: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog ref={ref} onClose={onClose} className="m-auto w-[min(92vw,520px)] rounded-xl border border-gray-200 p-0 shadow-xl backdrop:bg-black/30" aria-labelledby="modal-title">
      <div className="p-5">
        <h2 id="modal-title" className="text-base font-semibold text-gray-900">{title}</h2>
        <div className="mt-2 text-sm text-gray-700">{children}</div>
      </div>
      {footer && <div className="flex justify-end gap-2 border-t border-gray-100 bg-gray-50 px-5 py-3">{footer}</div>}
    </dialog>
  );
}

export function Tooltip({ text, children }: { text: string; children: ReactNode }) {
  return (
    <span className="group relative inline-flex" tabIndex={0}>
      {children}
      <span role="tooltip" className="pointer-events-none absolute bottom-full left-1/2 z-40 mb-1 hidden w-72 -translate-x-1/2 whitespace-pre-line rounded-md bg-gray-900 px-2 py-1.5 text-xs leading-snug text-white shadow-lg group-hover:block group-focus:block">
        {text}
      </span>
    </span>
  );
}
