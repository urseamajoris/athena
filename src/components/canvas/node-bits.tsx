"use client";
// Node status pieces shared by the canvas cards, the List view and the Focus panel (no React Flow here,
// so the List view and mobile never load it).
import { AlertTriangle, Check, CheckCircle2, Circle, CircleDot, Loader2, PauseCircle, Quote, X, XCircle } from "lucide-react";
import { ProgressRing, cx } from "../ui";
import { KIND_LABEL, STATUS_LABEL, type GNode, type NodeStatus } from "@/lib/canvas/graph";
import type { AttentionTone, TopicAttention } from "@/lib/shared/canvas";
import { fmtInt } from "@/lib/shared/format";

export const STATUS_TONE: Record<NodeStatus, string> = { idle: "text-fg-2", running: "text-run", review: "text-warn", done: "text-ok", stale: "text-warn", error: "text-err" };

export const ATTENTION_STYLE: Record<AttentionTone, { text: string; pill: string; bar: string; border: string; accent: string }> = {
  err: {
    text: "text-err",
    pill: "border-err-line bg-err-soft text-err",
    bar: "bg-err",
    border: "border-err",
    accent: "bg-err",
  },
  warn: {
    text: "text-warn",
    pill: "border-warn-line bg-warn-soft text-warn",
    bar: "bg-warn",
    border: "border-warn-line",
    accent: "bg-warn",
  },
  run: {
    text: "text-run",
    pill: "border-run-line bg-run-soft text-run",
    bar: "bg-run",
    border: "border-run-line",
    accent: "bg-run",
  },
  ok: {
    text: "text-ok",
    pill: "border-ok-line bg-ok-soft text-ok",
    bar: "bg-ok",
    border: "border-ok-line",
    accent: "bg-ok",
  },
  idle: {
    text: "text-fg-2",
    pill: "border-line bg-bg-2 text-fg-2",
    bar: "bg-fg-2",
    border: "border-line-strong",
    accent: "bg-line-strong",
  },
};

export function statusText(n: GNode) {
  if (n.ghost) return "Suggested";
  if (n.paused) return "Paused";
  // A kept topic is done, but step 2 may not be: "Kept" says which.
  if (n.kind === "topic" && n.status === "done") return "Kept";
  return STATUS_LABEL[n.status];
}

/** Status as icon + text (never colour alone); running shows a progress ring with the live count. */
export function NodeStatusBadge({ node }: { node: GNode }) {
  const p = { className: "h-3 w-3 shrink-0", strokeWidth: 2, "aria-hidden": true } as const;
  const icon = node.ghost ? <CircleDot {...p} /> : { idle: <Circle {...p} />, running: null, review: <CircleDot {...p} />, done: <CheckCircle2 {...p} />, stale: <AlertTriangle {...p} />, error: <XCircle {...p} /> }[node.status];
  return (
    <span data-state-badge="" className={cx("inline-flex h-5 items-center gap-1 whitespace-nowrap text-12 font-medium", node.ghost ? "text-fg-1" : node.paused ? "text-warn" : STATUS_TONE[node.status])} data-status={node.ghost ? "ghost" : node.status}>
      {node.paused ? (
        <PauseCircle {...p} />
      ) : node.status === "running" && !node.ghost ? (
        <ProgressRing value={node.progress?.done ?? 0} max={node.progress?.total ?? 0} size={14} label={node.progress?.total ? `${node.progress.done} of ${node.progress.total}` : "Running"} />
      ) : (
        icon
      )}
      {statusText(node)}
      {node.status === "running" && !node.paused && node.progress?.total ? <span className="tabular-nums text-fg-1">{node.progress.done}/{node.progress.total}</span> : null}
    </span>
  );
}

/** Compact color-coded attention badge (icon + stage + reason, never colour alone). */
export function AttentionBadge({ attention, compact = false }: { attention: TopicAttention; compact?: boolean }) {
  const st = ATTENTION_STYLE[attention.tone];
  const Icon = attention.tone === "err" ? XCircle : attention.tone === "warn" ? AlertTriangle : attention.tone === "run" ? Loader2 : attention.tone === "ok" ? CheckCircle2 : Circle;
  return (
    <span
      className={cx("inline-flex items-center gap-1 rounded-sm border px-1.5 py-0.5 text-12 font-medium leading-none", st.pill)}
      title={attention.detail}
      data-attention={attention.tone}
    >
      <Icon className={cx("h-3 w-3 shrink-0", attention.tone === "run" && "motion-safe:animate-spin")} strokeWidth={2} aria-hidden />
      <span className="truncate">{attention.stage && !compact ? `S${attention.stage}: ` : ""}{attention.label}</span>
    </span>
  );
}

/**
 * Compact 3-stage article counter (Retrieved · Rendered · Filed) with individual color coding
 * per stage + a proportional stacked mini-bar and optional citation impact summary.
 */
export function ArticlePipelineStrip({
  retrieved,
  rendered,
  filed,
  selected,
  stageTones,
  totalCitations,
  hIndex,
  compact = false,
}: {
  retrieved: number;
  rendered: number;
  filed: number;
  selected?: number;
  stageTones: { retrieved: AttentionTone; rendered: AttentionTone; filed: AttentionTone };
  totalCitations?: number;
  hIndex?: number;
  compact?: boolean;
}) {
  const base = Math.max(1, retrieved);
  const renPct = Math.min(100, Math.round((rendered / base) * 100));
  const filPct = Math.min(100, Math.round((filed / base) * 100));
  const cell = (label: string, shortLabel: string, value: string, tone: AttentionTone, tip: string) => (
    <span
      className={cx("inline-flex min-w-0 items-center justify-between gap-1 rounded-sm border px-1.5 py-0.5 text-12 tabular-nums leading-tight", ATTENTION_STYLE[tone].pill)}
      title={tip}
    >
      <span className="truncate font-normal opacity-90">{compact ? shortLabel : label}</span>
      <span className="font-semibold">{value}</span>
    </span>
  );
  const filedText = selected && selected > 0 && filed < selected ? `${fmtInt(filed)}/${fmtInt(selected)}` : fmtInt(filed);
  return (
    <div className="space-y-1.5" data-pipeline-strip="">
      <div className={cx("grid gap-1", compact ? "grid-cols-3" : "grid-cols-3")}>
        {cell("Ret", "Ret", fmtInt(retrieved), stageTones.retrieved, `Retrieved: ${fmtInt(retrieved)} unique articles`)}
        {cell("Ren", "Ren", fmtInt(rendered), stageTones.rendered, `Rendered: ${fmtInt(rendered)} of ${fmtInt(retrieved)} articles summarised into table rows`)}
        {cell("Fil", "Fil", filedText, stageTones.filed, selected ? `Filed: ${fmtInt(filed)} of ${fmtInt(selected)} selected articles cleanly appraised & filed` : `Filed: ${fmtInt(filed)} articles filed into evidence`)}
      </div>
      {!compact && (
        <div className="flex items-center gap-2">
          <div className="relative h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-bg-3" aria-hidden>
            {retrieved > 0 && <span className={cx("absolute inset-y-0 left-0 rounded-full opacity-35", ATTENTION_STYLE[stageTones.retrieved].bar)} style={{ width: "100%" }} />}
            {rendered > 0 && <span className={cx("absolute inset-y-0 left-0 rounded-full opacity-65", ATTENTION_STYLE[stageTones.rendered].bar)} style={{ width: `${Math.max(4, renPct)}%` }} />}
            {filed > 0 && <span className={cx("absolute inset-y-0 left-0 rounded-full", ATTENTION_STYLE[stageTones.filed].bar)} style={{ width: `${Math.max(6, filPct)}%` }} />}
          </div>
          {totalCitations !== undefined && totalCitations > 0 && (
            <span className="inline-flex shrink-0 items-center gap-1 text-12 tabular-nums text-fg-1" title={`${fmtInt(totalCitations)} total citations${hIndex ? `, h-index ${hIndex}` : ""}`}>
              <Quote className="h-3 w-3 text-fg-2" strokeWidth={1.75} aria-hidden />
              {fmtInt(totalCitations)}{hIndex ? ` · h${hIndex}` : ""}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

/** Quote-check counts (found word for word; not found and undecided), always visible on Appraisal and Synthesis cards. */
export function TrustBadges({ node, verbose = false }: { node: GNode; verbose?: boolean }) {
  const t = node.trust;
  if (!t) return null;
  const I = { className: "h-3 w-3", strokeWidth: 2, "aria-hidden": true } as const;
  if (node.kind === "quote") return null;
  return (
    <span
      className="inline-flex items-center gap-2 text-12 tabular-nums"
      title={`Quotes: ${t.verified} found word for word in the paper, ${t.unverified} not found and still for you to decide. Found means the words are in the paper, not that they prove the answer.`}
      aria-label={`${t.verified} quotes found word for word, ${t.unverified} not found and still to decide, ${t.accepted} accepted by you${t.stale ? ", stale" : ""}`}
    >
      <span className="inline-flex items-center gap-1 text-ok"><Check {...I} />{t.verified}{verbose && " found"}</span>
      {t.unverified > 0 && <span className="inline-flex items-center gap-1 text-err"><X {...I} />{t.unverified}{verbose && " to decide"}</span>}
      {t.stale && <span className="inline-flex items-center gap-1 text-warn"><AlertTriangle {...I} />stale</span>}
    </span>
  );
}

export function nodeAriaLabel(n: GNode) {
  const stats = n.articleStats
    ? `. ${n.articleStats.retrieved} retrieved, ${n.articleStats.rendered} rendered, ${n.articleStats.filed} filed${n.articleStats.totalCitations ? `, ${n.articleStats.totalCitations} citations` : ""}`
    : n.pipelineCounts
      ? `. ${n.pipelineCounts.retrieved} retrieved, ${n.pipelineCounts.rendered} rendered, ${n.pipelineCounts.filed} filed`
      : "";
  const attn = n.attention && (n.attention.tone === "err" || n.attention.tone === "warn") ? `. Needs attention: ${n.attention.detail}` : "";
  return `${KIND_LABEL[n.kind]}: ${n.title.slice(0, 120)}. ${statusText(n)}. ${n.key}${stats}${attn}${n.staleReason ? `. ${n.staleReason}` : ""}`;
}

