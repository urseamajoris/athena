"use client";
// Node status pieces shared by the canvas cards, the List view and the Focus panel (no React Flow here,
// so the List view and mobile never load it).
import { AlertTriangle, Check, CheckCircle2, Circle, CircleDot, X, XCircle } from "lucide-react";
import { ProgressRing, cx } from "../ui";
import { KIND_LABEL, STATUS_LABEL, type GNode, type NodeStatus } from "@/lib/canvas/graph";

export const STATUS_TONE: Record<NodeStatus, string> = { idle: "text-fg-2", running: "text-run", review: "text-warn", done: "text-ok", stale: "text-warn", error: "text-err" };

export function statusText(n: GNode) {
  if (n.ghost) return "Suggested";
  return STATUS_LABEL[n.status];
}

/** Status as icon + text (never colour alone); running shows a progress ring with the live count. */
export function NodeStatusBadge({ node }: { node: GNode }) {
  const p = { className: "h-3 w-3 shrink-0", strokeWidth: 2, "aria-hidden": true } as const;
  const icon = node.ghost ? <CircleDot {...p} /> : { idle: <Circle {...p} />, running: null, review: <CircleDot {...p} />, done: <CheckCircle2 {...p} />, stale: <AlertTriangle {...p} />, error: <XCircle {...p} /> }[node.status];
  return (
    <span data-state-badge="" className={cx("inline-flex h-5 items-center gap-1 whitespace-nowrap text-12 font-medium", node.ghost ? "text-fg-1" : STATUS_TONE[node.status])} data-status={node.ghost ? "ghost" : node.status}>
      {node.status === "running" && !node.ghost ? (
        <ProgressRing value={node.progress?.done ?? 0} max={node.progress?.total ?? 0} size={14} label={node.progress?.total ? `${node.progress.done} of ${node.progress.total}` : "Running"} />
      ) : (
        icon
      )}
      {statusText(node)}
      {node.status === "running" && node.progress?.total ? <span className="tabular-nums text-fg-1">{node.progress.done}/{node.progress.total}</span> : null}
    </span>
  );
}

/** Verification counts, always visible on Appraisal, Synthesis and Quote cards. */
export function TrustBadges({ node }: { node: GNode }) {
  const t = node.trust;
  if (!t) return null;
  const I = { className: "h-3 w-3", strokeWidth: 2, "aria-hidden": true } as const;
  if (node.kind === "quote") return null;
  return (
    <span className="inline-flex items-center gap-2 text-12 tabular-nums" aria-label={`${t.verified} quotes verified, ${t.unverified} unverified, ${t.accepted} accepted${t.stale ? ", stale" : ""}`}>
      <span className="inline-flex items-center gap-1 text-ok"><Check {...I} />{t.verified}</span>
      {t.unverified > 0 && <span className="inline-flex items-center gap-1 text-err"><X {...I} />{t.unverified}</span>}
      {t.stale && <span className="inline-flex items-center gap-1 text-warn"><AlertTriangle {...I} />stale</span>}
    </span>
  );
}

export function nodeAriaLabel(n: GNode) {
  return `${KIND_LABEL[n.kind]}: ${n.title.slice(0, 120)}. ${statusText(n)}. ${n.key}${n.staleReason ? `. ${n.staleReason}` : ""}`;
}

