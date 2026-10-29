"use client";
import { type ReactNode, useEffect, useRef } from "react";
import { AlertTriangle, CheckCircle2, Circle, CircleDot, Loader2, PauseCircle, Sparkles, X, XCircle } from "lucide-react";
import { ApiError, useApi } from "./api";
import type { StageState } from "@/lib/shared/stages";
import { STATE_LABEL } from "@/lib/shared/stages";

export function cx(...a: (string | false | null | undefined)[]) {
  return a.filter(Boolean).join(" ");
}

/** Busy indicator. Spins only when motion is allowed; otherwise a static icon. */
export function Spinner({ className = "", label = "Loading" }: { className?: string; label?: string }) {
  return <Loader2 role="status" aria-label={label} className={cx("inline-block h-4 w-4 shrink-0 motion-safe:animate-spin", className)} strokeWidth={1.5} />;
}

export type Tone = "neutral" | "ok" | "warn" | "err" | "run";
type LegacyTone = "gray" | "teal" | "amber" | "rose" | "sky" | "violet" | "emerald";
const LEGACY: Record<LegacyTone, Tone> = { gray: "neutral", teal: "neutral", violet: "neutral", amber: "warn", rose: "err", sky: "run", emerald: "ok" };
const TONE_CLASS: Record<Tone, string> = {
  neutral: "text-fg-1 border-line-strong",
  ok: "text-ok border-ok-line",
  warn: "text-warn border-warn-line",
  err: "text-err border-err-line",
  run: "text-run border-run-line",
};
export const toneOf = (t: Tone | LegacyTone): Tone => (t in LEGACY ? LEGACY[t as LegacyTone] : (t as Tone));

/** Status shapes so state never relies on colour alone (icon + text). */
export const STATE_TONE: Record<StageState, Tone> = { not_started: "neutral", running: "run", needs_review: "warn", approved: "ok", stale: "warn", failed: "err" };
export function StateIcon({ state, className = "h-4 w-4" }: { state: StageState; className?: string }) {
  const p = { className: cx("shrink-0", className), strokeWidth: 1.5, "aria-hidden": true } as const;
  switch (state) {
    case "running": return <Loader2 {...p} className={cx(p.className, "motion-safe:animate-spin")} />;
    case "needs_review": return <CircleDot {...p} />;
    case "approved": return <CheckCircle2 {...p} />;
    case "stale": return <AlertTriangle {...p} />;
    case "failed": return <XCircle {...p} />;
    default: return <Circle {...p} />;
  }
}

export function StateBadge({ state }: { state: StageState }) {
  return (
    <span data-state-badge="" className={cx("inline-flex h-5 items-center gap-1 rounded-full border px-2 text-12 font-medium", TONE_CLASS[STATE_TONE[state]])}>
      <StateIcon state={state} className="h-3 w-3" />
      {STATE_LABEL[state]}
    </span>
  );
}

export function Badge({ children, tone = "neutral", title, icon, state }: { children: ReactNode; tone?: Tone | LegacyTone; title?: string; icon?: ReactNode; state?: boolean }) {
  return (
    <span data-state-badge={state ? "" : undefined} title={title} className={cx("inline-flex h-5 items-center gap-1 whitespace-nowrap rounded-sm border px-2 text-12 font-medium", TONE_CLASS[toneOf(tone)])}>
      {icon}
      {children}
    </span>
  );
}

/** Marks a value produced by the AI from the abstract only. */
export function AbstractBadge() {
  return (
    <Badge title="AI-derived from the abstract only — check against the paper before relying on it" icon={<Sparkles className="h-3 w-3" strokeWidth={1.5} aria-hidden />}>
      AI · abstract
    </Badge>
  );
}

export function TextSourceBadge({ source }: { source: string }) {
  return source === "full_text" ? (
    <Badge state tone="ok" title="The appraisal was done on the open-access full text" icon={<CheckCircle2 className="h-3 w-3" strokeWidth={1.5} aria-hidden />}>Full text</Badge>
  ) : (
    <Badge state tone="warn" title="Full text was not legally available; only the abstract was read" icon={<AlertTriangle className="h-3 w-3" strokeWidth={1.5} aria-hidden />}>Abstract only</Badge>
  );
}

export function ProgressBar({ value, max, label, tone = "teal" }: { value: number; max: number; label?: string; tone?: "teal" | "rose" | "gray" }) {
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
  return (
    <div role="progressbar" aria-valuenow={value} aria-valuemin={0} aria-valuemax={max} aria-label={label} className="h-2 w-full overflow-hidden rounded-full bg-bg-3">
      <div className={cx("h-full rounded-full transition-[width]", tone === "rose" ? "bg-err" : tone === "gray" || pct >= 100 ? "bg-line-control" : "bg-run")} style={{ width: `${pct}%` }} />
    </div>
  );
}

/** Circular progress for node cards; indeterminate (no total yet) shows a static quarter ring. */
export function ProgressRing({ value, max, size = 20, label }: { value: number; max: number; size?: number; label: string }) {
  const r = (size - 3) / 2;
  const c = 2 * Math.PI * r;
  const frac = max > 0 ? Math.min(1, value / max) : 0.25;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={max || undefined} aria-valuenow={max ? value : undefined} className="shrink-0 -rotate-90">
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--bg-3)" strokeWidth={3} />
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--run)" strokeWidth={3} strokeLinecap="round" strokeDasharray={`${c * frac} ${c}`} />
    </svg>
  );
}

export function EmptyState({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="card flex flex-col items-center gap-2 px-6 py-8 text-center">
      <p className="font-medium text-fg-0">{title}</p>
      {children && <div className="max-w-prose text-fg-2">{children}</div>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

/** "ai_paused" (switched off by the admin, or no xAI key) or "budget" when an API call was refused because AI cannot run, else null. */
export function aiStopKind(error: unknown): "ai_paused" | "budget" | null {
  return error instanceof ApiError && (error.kind === "ai_paused" || error.kind === "budget") ? error.kind : null;
}

/**
 * AI is off, not set up (no key) or out of budget: a paused state, not a failure. Nothing was lost, so no red and
 * no pointless "Try again": the step retries by itself once the server says AI can run again.
 */
function AiStopped({ kind, message, onRetry }: { kind: "ai_paused" | "budget"; message: string; onRetry?: () => void }) {
  const { data } = useApi<{ ai?: { enabled: boolean; budgetReached: boolean; keyMissing: boolean } }>("/api/status", onRetry ? { refreshInterval: 10_000 } : undefined);
  const available = !!data?.ai && data.ai.enabled && !data.ai.budgetReached && !data.ai.keyMissing;
  // No key: the server's own message says so, and who can add one.
  const notSetUp = kind === "ai_paused" && !!data?.ai?.keyMissing;
  const sawStopped = useRef(false);
  useEffect(() => {
    // Only on the change from stopped to available: a cached "available" from before the refusal is not news.
    if (!available) sawStopped.current = true;
    else if (sawStopped.current && onRetry) {
      sawStopped.current = false;
      onRetry();
    }
  }, [available, onRetry]);
  return (
    <div role="status" className="rounded-md border border-warn-line bg-warn-soft px-4 py-3">
      <p className="flex items-center gap-2 font-semibold text-fg-0"><PauseCircle className="h-4 w-4 text-warn" strokeWidth={2} aria-hidden /> {kind === "budget" ? "AI budget reached" : notSetUp ? "AI is not set up yet" : "AI is paused by the administrator"}</p>
      <p className="mt-1 text-fg-1">{notSetUp ? message : "Your work is saved."} {onRetry ? "This continues by itself when AI is available again." : "Try this again when AI is available again."}</p>
    </div>
  );
}

export function ErrorState({ error, onRetry, title = "Something went wrong" }: { error: unknown; onRetry?: () => void; title?: string }) {
  const stop = aiStopKind(error);
  const msg = error instanceof Error ? error.message : String(error);
  if (stop) return <AiStopped kind={stop} message={msg} onRetry={onRetry} />;
  return (
    <div role="alert" className="rounded-md border border-err-line bg-bg-1 px-4 py-3">
      <p className="flex items-center gap-2 font-semibold text-err"><XCircle className="h-4 w-4" strokeWidth={1.5} aria-hidden /> {title}</p>
      <p className="mt-1 whitespace-pre-wrap break-words text-fg-1">{msg}</p>
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
    <div className="flex items-center gap-2 px-1 py-6 text-fg-2">
      <Spinner /> {label}
    </div>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="inline-flex h-5 min-w-5 items-center justify-center rounded-sm border border-line-strong bg-bg-2 px-1 font-mono text-12 text-fg-1">{children}</kbd>;
}

export function CloseButton({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <button className="btn-ghost h-11 w-11 px-0" onClick={onClick} aria-label={label}>
      <X className="h-4 w-4" strokeWidth={1.5} aria-hidden />
    </button>
  );
}
