"use client";
import { type ReactNode } from "react";
import { Collapsible, Dialog, DropdownMenu, Tooltip as RTooltip } from "radix-ui";
import { AlertTriangle, CheckCircle2, ChevronRight, Circle, CircleDot, Loader2, MoreHorizontal, Sparkles, X, XCircle } from "lucide-react";
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
    <span className={cx("inline-flex h-5 items-center gap-1 rounded-full border px-2 text-12 font-medium", TONE_CLASS[STATE_TONE[state]])}>
      <StateIcon state={state} className="h-3 w-3" />
      {STATE_LABEL[state]}
    </span>
  );
}

export function Badge({ children, tone = "neutral", title, icon }: { children: ReactNode; tone?: Tone | LegacyTone; title?: string; icon?: ReactNode }) {
  return (
    <span title={title} className={cx("inline-flex h-5 items-center gap-1 whitespace-nowrap rounded-sm border px-2 text-12 font-medium", TONE_CLASS[toneOf(tone)])}>
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
    <Badge tone="ok" title="The appraisal was done on the open-access full text" icon={<CheckCircle2 className="h-3 w-3" strokeWidth={1.5} aria-hidden />}>Full text</Badge>
  ) : (
    <Badge tone="warn" title="Full text was not legally available; only the abstract was read" icon={<AlertTriangle className="h-3 w-3" strokeWidth={1.5} aria-hidden />}>Abstract only</Badge>
  );
}

export function ProgressBar({ value, max, label, tone = "teal" }: { value: number; max: number; label?: string; tone?: "teal" | "rose" | "gray" }) {
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
  return (
    <div role="progressbar" aria-valuenow={value} aria-valuemin={0} aria-valuemax={max} aria-label={label} className="h-2 w-full overflow-hidden rounded-full bg-bg-3">
      <div className={cx("h-full rounded-full transition-[width]", tone === "teal" ? "bg-run" : tone === "rose" ? "bg-err" : "bg-fg-2")} style={{ width: `${pct}%` }} />
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

export function ErrorState({ error, onRetry, title = "Something went wrong" }: { error: unknown; onRetry?: () => void; title?: string }) {
  const msg = error instanceof Error ? error.message : String(error);
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

/** Accessible modal (Radix Dialog: focus trap, Escape, focus return). */
export function Modal({ open, onClose, title, children, footer }: { open: boolean; onClose: () => void; title: string; children: ReactNode; footer?: ReactNode }) {
  return (
    <Dialog.Root open={open} onOpenChange={(o) => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-scrim" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-[min(92vw,520px)] -translate-x-1/2 -translate-y-1/2 rounded-md border border-line-strong bg-bg-1 p-0">
          <div className="p-6">
            <Dialog.Title className="text-16 font-semibold text-fg-0">{title}</Dialog.Title>
            <Dialog.Description asChild>
              <div className="mt-2 text-fg-1">{children}</div>
            </Dialog.Description>
          </div>
          {footer && <div className="flex flex-wrap justify-end gap-2 border-t border-line bg-bg-2 px-6 py-3">{footer}</div>}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export function Tooltip({ text, children }: { text: string; children: ReactNode }) {
  return (
    <RTooltip.Provider delayDuration={200}>
      <RTooltip.Root>
        <RTooltip.Trigger asChild>
          <span className="inline-flex" tabIndex={0}>{children}</span>
        </RTooltip.Trigger>
        <RTooltip.Portal>
          <RTooltip.Content sideOffset={4} className="z-50 max-w-72 whitespace-pre-line rounded-sm border border-line-strong bg-bg-3 px-2 py-1 text-12 text-fg-0">
            {text}
          </RTooltip.Content>
        </RTooltip.Portal>
      </RTooltip.Root>
    </RTooltip.Provider>
  );
}

/** A secondary section that starts collapsed (progressive disclosure). */
export function Disclosure({ title, children, defaultOpen = false, meta }: { title: ReactNode; children: ReactNode; defaultOpen?: boolean; meta?: ReactNode }) {
  return (
    <Collapsible.Root defaultOpen={defaultOpen} data-collapsible="" className="group/disc rounded-md border border-line">
      <Collapsible.Trigger className="flex min-h-11 w-full items-center gap-2 rounded-md px-3 py-2 text-left text-fg-1 hover:text-fg-0">
        <ChevronRight className="h-4 w-4 shrink-0 transition-transform group-data-[state=open]/disc:rotate-90" strokeWidth={1.5} aria-hidden />
        <span className="min-w-0 flex-1 font-medium">{title}</span>
        {meta && <span className="text-12 text-fg-2">{meta}</span>}
      </Collapsible.Trigger>
      <Collapsible.Content className="border-t border-line px-3 py-3">{children}</Collapsible.Content>
    </Collapsible.Root>
  );
}

export interface MenuItem { label: string; onSelect: () => void; danger?: boolean; disabled?: boolean; hint?: string }
/** The `⋯` menu for secondary actions. */
export function MoreMenu({ items, label = "More actions" }: { items: MenuItem[]; label?: string }) {
  if (!items.length) return null;
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger className="btn-ghost h-11 w-11 px-0" aria-label={label}>
        <MoreHorizontal className="h-4 w-4" strokeWidth={1.5} aria-hidden />
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content align="end" sideOffset={4} className="z-50 min-w-56 rounded-md border border-line-strong bg-bg-2 p-1">
          {items.map((it) => (
            <DropdownMenu.Item
              key={it.label}
              disabled={it.disabled}
              onSelect={it.onSelect}
              className={cx("flex min-h-11 cursor-default items-center justify-between gap-4 rounded-sm px-3 py-2 outline-none data-[disabled]:opacity-55 data-[highlighted]:bg-bg-3", it.danger ? "text-err" : "text-fg-0")}
            >
              {it.label}
              {it.hint && <span className="text-12 text-fg-2">{it.hint}</span>}
            </DropdownMenu.Item>
          ))}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
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
