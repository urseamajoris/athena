"use client";
// Base components on the design tokens (src/app/globals.css). The rules they keep are in docs/ux-intent.md:
// one primary button per screen, buttons that say what happens, status as an icon plus words.
import { type AnchorHTMLAttributes, type ButtonHTMLAttributes, type ReactNode, useEffect, useRef } from "react";
import Link from "next/link";
import { AlertTriangle, CheckCircle2, Circle, CircleDot, Coins, Loader2, Lock, PauseCircle, Sparkles, X, XCircle } from "lucide-react";
import { ApiError, useApi } from "./api";
import type { StageState } from "@/lib/shared/stages";
import { STATE_LABEL } from "@/lib/shared/stages";
import { STEP_STATUS_LABEL, type StepStatus } from "@/lib/shared/flow";

export function cx(...a: (string | false | null | undefined)[]) {
  return a.filter(Boolean).join(" ");
}

/** Busy indicator. Spins only when motion is allowed; otherwise a static icon. */
export function Spinner({ className = "", label = "Loading" }: { className?: string; label?: string }) {
  return <Loader2 role="status" aria-label={label} className={cx("inline-block h-4 w-4 shrink-0 motion-safe:animate-spin", className)} strokeWidth={2} />;
}

// ---------- buttons ----------
export type ButtonVariant = "primary" | "secondary" | "quiet" | "danger";
type ButtonSize = "sm" | "md" | "lg";
const VARIANT_CLASS: Record<ButtonVariant, string> = { primary: "btn-primary", secondary: "btn-secondary", quiet: "btn-ghost", danger: "btn-danger" };
const buttonClass = (variant: ButtonVariant, size: ButtonSize, className?: string) => cx(VARIANT_CLASS[variant], size === "sm" && "btn-sm", size === "lg" && "btn-lg", className);

interface ButtonOwnProps {
  /** `primary` is the screen's one filled button. Everything else is `secondary` (plain); `quiet` for Cancel/Undo. */
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** An icon before the label (decorative: the label carries the meaning). */
  icon?: ReactNode;
}

/**
 * A button whose label says what will happen, verb first: "Run 8 searches", "Download report".
 * `busy` shows a spinner and ignores clicks. `aria-disabled` (not `disabled`) keeps a blocked button focusable,
 * so the reason written next to it can be read. `awaitInput`: blocked only by an empty box; it stays filled and
 * takes the click, so the handler can say what is missing.
 */
export function Button({ variant = "secondary", size = "md", icon, busy, awaitInput, className, children, onClick, type = "button", ...rest }: ButtonOwnProps & { busy?: boolean; awaitInput?: boolean } & ButtonHTMLAttributes<HTMLButtonElement>) {
  const blocked = busy || rest["aria-disabled"] === true || rest["aria-disabled"] === "true";
  return (
    <button
      type={type}
      {...rest}
      aria-busy={busy || undefined}
      data-await-input={awaitInput ? "" : undefined}
      className={buttonClass(variant, size, className)}
      onClick={(e) => {
        // A blocked button swallows the click, unless it waits only for input: then the click says what is missing.
        if (blocked && !(awaitInput && !busy)) return e.preventDefault();
        onClick?.(e);
      }}
    >
      {busy ? <Spinner /> : icon}
      {children}
    </button>
  );
}

/** The same looks for a link. Internal paths use the router; `download`, `target` or a full URL give a plain link. */
export function ButtonLink({ variant = "secondary", size = "md", icon, className, children, href, ...rest }: ButtonOwnProps & { href: string } & AnchorHTMLAttributes<HTMLAnchorElement>) {
  const cls = buttonClass(variant, size, className);
  const plain = rest.download !== undefined || rest.target !== undefined || /^[a-z]+:/i.test(href) || href.startsWith("/api/");
  return plain ? (
    <a href={href} {...rest} className={cls}>{icon}{children}</a>
  ) : (
    <Link href={href} {...rest} className={cls}>{icon}{children}</Link>
  );
}

/** The only icon-only button: close (×). Its name is its label; the tooltip repeats it. */
export function CloseButton({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <button type="button" className="btn-ghost h-11 w-11 px-0" onClick={onClick} aria-label={label} title={label}>
      <X className="h-4 w-4" strokeWidth={2} aria-hidden />
    </button>
  );
}

// ---------- status: always an icon plus words ----------
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
const TONE_TEXT: Record<Tone, string> = { neutral: "text-fg-2", ok: "text-ok", warn: "text-warn", err: "text-err", run: "text-run" };
export const toneOf = (t: Tone | LegacyTone): Tone => (t in LEGACY ? LEGACY[t as LegacyTone] : (t as Tone));

const STEP_TONE: Record<StepStatus, Tone> = { locked: "neutral", todo: "neutral", working: "run", review: "neutral", stale: "warn", failed: "err", done: "ok" };

/** The icon for a screen's status. Never shown without its words (StepStatusLabel, or the row it sits in). */
export function StepStatusIcon({ status, className = "h-4 w-4" }: { status: StepStatus; className?: string }) {
  const p = { className: cx("shrink-0", TONE_TEXT[STEP_TONE[status]], className), strokeWidth: 2, "aria-hidden": true } as const;
  switch (status) {
    case "locked": return <Lock {...p} />;
    case "working": return <Loader2 {...p} className={cx(p.className, "motion-safe:animate-spin")} />;
    case "review": return <CircleDot {...p} className={cx("shrink-0 text-fg-0", className)} />;
    case "stale": return <AlertTriangle {...p} />;
    case "failed": return <XCircle {...p} />;
    case "done": return <CheckCircle2 {...p} />;
    default: return <Circle {...p} />;
  }
}

/** A screen's status in words with its icon: "✓ Done", "● Your turn", "🔒 Locked". */
export function StepStatusLabel({ status, className }: { status: StepStatus; className?: string }) {
  return (
    <span data-status={status} className={cx("inline-flex items-center gap-1.5 text-small text-fg-1", className)}>
      <StepStatusIcon status={status} />
      {STEP_STATUS_LABEL[status]}
    </span>
  );
}

/** Engine-stage status (older screens). */
export const STATE_TONE: Record<StageState, Tone> = { not_started: "neutral", running: "run", needs_review: "neutral", approved: "ok", stale: "warn", failed: "err" };
export function StateIcon({ state, className = "h-4 w-4" }: { state: StageState; className?: string }) {
  const p = { className: cx("shrink-0", className), strokeWidth: 2, "aria-hidden": true } as const;
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
    <span data-state-badge="" className={cx("inline-flex h-6 items-center gap-1 rounded-full border px-2 text-small font-medium", TONE_CLASS[STATE_TONE[state]])}>
      <StateIcon state={state} className="h-3.5 w-3.5" />
      {STATE_LABEL[state]}
    </span>
  );
}

/** A short label on a thing (a count, a kind, a flag). Not a control: it has no hover and no pointer. */
export function Badge({ children, tone = "neutral", title, icon, state }: { children: ReactNode; tone?: Tone | LegacyTone; title?: string; icon?: ReactNode; state?: boolean }) {
  return (
    <span data-state-badge={state ? "" : undefined} title={title} className={cx("inline-flex h-6 items-center gap-1 whitespace-nowrap rounded-full border px-2 text-small font-medium", TONE_CLASS[toneOf(tone)])}>
      {icon}
      {children}
    </span>
  );
}

/** Marks a value produced by the AI from the abstract only. */
export function AbstractBadge() {
  return (
    <Badge title="Written by the AI from the abstract only. Check it against the paper before relying on it." icon={<Sparkles className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />}>
      AI · abstract
    </Badge>
  );
}

export function TextSourceBadge({ source }: { source: string }) {
  return source === "full_text" ? (
    <Badge state tone="ok" title="The analysis was done on the open-access full text" icon={<CheckCircle2 className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />}>Full text</Badge>
  ) : (
    <Badge state tone="warn" title="Full text was not legally available; only the abstract was read" icon={<AlertTriangle className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />}>Abstract only</Badge>
  );
}

/** How far something has got. The fill is ink, not the accent; say the numbers in words next to it. */
export function ProgressBar({ value, max, label, tone = "teal" }: { value: number; max: number; label?: string; tone?: "teal" | "rose" | "gray" }) {
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
  return (
    <div role="progressbar" aria-valuenow={value} aria-valuemin={0} aria-valuemax={max} aria-label={label} className="h-2 w-full overflow-hidden rounded-full bg-bg-3">
      <div className={cx("h-full rounded-full transition-[width]", tone === "rose" ? "bg-err" : tone === "gray" ? "bg-line-control" : "bg-fg-0")} style={{ width: `${pct}%` }} />
    </div>
  );
}

// ---------- surfaces and messages ----------
/** A white surface with a hairline border, for one thing (a review, a pack, a paper). */
export function Card({ children, className, as: As = "div" }: { children: ReactNode; className?: string; as?: "div" | "section" | "li" | "article" }) {
  return <As className={cx("card p-5", className)}>{children}</As>;
}

/** Nothing here yet: say what will appear, and offer the one way to make it appear. */
export function EmptyState({ title, children, action, icon }: { title: string; children?: ReactNode; action?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-md border border-dashed border-line-strong px-6 py-10 text-center">
      {icon && <span className="mb-1 text-fg-2" aria-hidden>{icon}</span>}
      <p className="font-semibold text-fg-0">{title}</p>
      {children && <div className="max-w-prose text-fg-1">{children}</div>}
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}

const NOTICE_CLASS: Record<Tone, string> = {
  neutral: "border-line-strong bg-bg-1",
  ok: "border-ok-line bg-ok-soft",
  warn: "border-warn-line bg-warn-soft",
  err: "border-err-line bg-err-soft",
  run: "border-run-line bg-run-soft",
};

/**
 * A message about the state of what is on screen: a title in plain words, one or two sentences, and at most one
 * action (a plain button; the screen's primary button stays where it is).
 */
export function Notice({ tone = "neutral", icon, title, children, action, role = tone === "err" ? "alert" : "status", className }: { tone?: Tone; icon: ReactNode; title: string; children?: ReactNode; action?: ReactNode; role?: "status" | "alert"; className?: string }) {
  return (
    <div role={role} data-notice={tone} className={cx("flex flex-wrap items-start gap-x-4 gap-y-3 rounded-md border px-4 py-3", NOTICE_CLASS[tone], className)}>
      <span className={cx("mt-0.5 shrink-0", TONE_TEXT[tone])} aria-hidden>{icon}</span>
      <div className="min-w-0 flex-1 basis-64">
        <p className="font-semibold text-fg-0">{title}</p>
        {children && <div className="mt-0.5 text-fg-1">{children}</div>}
      </div>
      {action && <div className="flex shrink-0 flex-wrap items-center gap-2">{action}</div>}
    </div>
  );
}

/** Did this request stop because the account has no credits left? (The server's message says so.) */
export function isOutOfCredits(error: unknown): boolean {
  if (error instanceof ApiError && error.kind === "credits") return true;
  const msg = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  return /out of credits/i.test(msg);
}

/** "ai_paused" (switched off by the admin, or no API key) or "budget" when a request was refused because AI cannot run, else null. */
export function aiStopKind(error: unknown): "ai_paused" | "budget" | null {
  return error instanceof ApiError && (error.kind === "ai_paused" || error.kind === "budget") ? error.kind : null;
}

/**
 * AI is off, not set up (no key) or the server's budget is used up: a paused state, not a failure. Nothing was
 * lost, so no red and no "Try again": the step retries by itself once the server says AI can run again.
 */
function AiStopped({ kind, message, onRetry }: { kind: "ai_paused" | "budget"; message: string; onRetry?: () => void }) {
  const { data } = useApi<{ ai?: { enabled: boolean; budgetReached: boolean; keyMissing: boolean } }>("/api/status", onRetry ? { refreshInterval: 10_000 } : undefined);
  const available = !!data?.ai && data.ai.enabled && !data.ai.budgetReached && !data.ai.keyMissing;
  // No key: the refusal itself is the authority (the cached status can be older than it).
  const notSetUp = kind === "ai_paused" && (/not set up/i.test(message) || !!data?.ai?.keyMissing);
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
    <Notice tone="warn" icon={<PauseCircle className="h-5 w-5" strokeWidth={2} />} title={kind === "budget" ? "The server's AI budget is used up" : notSetUp ? "AI is not set up yet" : "AI is paused by the administrator"}>
      {notSetUp ? "An administrator needs to add an API key. " : ""}Your work is saved. {onRetry ? "This continues by itself when AI is available again." : "Try this again when AI is available."}
    </Notice>
  );
}

/** Something did not work: what went wrong in the server's words, and "Try again" when trying again can help. */
export function ErrorState({ error, onRetry, title = "Something went wrong" }: { error: unknown; onRetry?: () => void; title?: string }) {
  const msg = error instanceof Error ? error.message : String(error);
  if (isOutOfCredits(error)) {
    return (
      <Notice tone="warn" icon={<Coins className="h-5 w-5" strokeWidth={2} />} title="You are out of credits" action={<ButtonLink href="/credits">Buy credits</ButtonLink>}>
        Your work is saved. AI steps continue when you have credits.
      </Notice>
    );
  }
  const stop = aiStopKind(error);
  if (stop) return <AiStopped kind={stop} message={msg} onRetry={onRetry} />;
  return (
    <Notice tone="err" icon={<XCircle className="h-5 w-5" strokeWidth={2} />} title={title} action={onRetry && <Button onClick={onRetry}>Try again</Button>}>
      <span className="whitespace-pre-wrap break-words">{msg}</span>
    </Notice>
  );
}

export function Loading({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 px-1 py-6 text-fg-2">
      <Spinner /> {label}
    </div>
  );
}
