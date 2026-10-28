"use client";
import { memo } from "react";
import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import { m } from "motion/react";
import { AlertTriangle, Check, CheckCircle2, Circle, CircleDot, X, XCircle } from "lucide-react";
import { ProgressRing, cx } from "../ui";
import { useSession } from "../session/SessionContext";
import { ActionButton } from "../panels/common";
import { KindIcon } from "./icons";
import { KIND_LABEL, STATUS_LABEL, type GNode, type NodeStatus } from "@/lib/canvas/graph";
import type { Action } from "@/lib/canvas/actions";
import { NODE_H, NODE_W, QUOTE_H } from "@/lib/canvas/layout";

export interface NodeData extends Record<string, unknown> {
  node: GNode;
  action: Action | null;
  /** The view's one accent-filled button lives on this card (no panel open, frontier node). */
  primary: boolean;
  selected: boolean;
  tabbable: boolean;
  readOnly: boolean;
  /** Offset to the parent, for the spawn animation; null = no animation (present at first render). */
  spawn: { dx: number; dy: number } | null;
}
export type FlowNode = Node<NodeData, "athena">;

const STATUS_TONE: Record<NodeStatus, string> = { idle: "text-fg-2", running: "text-run", review: "text-warn", done: "text-ok", stale: "text-warn", error: "text-err" };
const STATUS_BORDER: Record<NodeStatus, string> = { idle: "border-line-strong", running: "border-run-line", review: "border-line-control", done: "border-line-strong", stale: "border-warn", error: "border-err" };

export function statusText(n: GNode) {
  if (n.ghost) return "Suggested";
  return STATUS_LABEL[n.status];
}

/** Status as icon + text (never colour alone); running shows a progress ring with the live count. */
export function NodeStatusBadge({ node }: { node: GNode }) {
  const p = { className: "h-3 w-3 shrink-0", strokeWidth: 2, "aria-hidden": true } as const;
  const icon = node.ghost ? <CircleDot {...p} /> : { idle: <Circle {...p} />, running: null, review: <CircleDot {...p} />, done: <CheckCircle2 {...p} />, stale: <AlertTriangle {...p} />, error: <XCircle {...p} /> }[node.status];
  return (
    <span className={cx("inline-flex h-5 items-center gap-1 whitespace-nowrap text-12 font-medium", node.ghost ? "text-fg-1" : STATUS_TONE[node.status])} data-status={node.ghost ? "ghost" : node.status}>
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

function NodeCardImpl({ id, data }: NodeProps<FlowNode>) {
  const { node, action, primary, selected, tabbable, readOnly, spawn } = data;
  const { run } = useSession();
  const quote = node.kind === "quote";
  const h = quote ? QUOTE_H : NODE_H;
  return (
    <>
    <Handle type="target" position={Position.Left} isConnectable={false} className="athena-handle" />
    <m.div
      initial={spawn ? { opacity: 0, x: spawn.dx, y: spawn.dy, scale: 0.9 } : false}
      animate={{ opacity: 1, x: 0, y: 0, scale: 1 }}
      transition={{ type: "spring", stiffness: 400, damping: 30 }}
      role="group"
      aria-roledescription="node"
      aria-label={nodeAriaLabel(node)}
      aria-current={selected ? "true" : undefined}
      tabIndex={tabbable ? 0 : -1}
      data-node-id={id}
      data-kind={node.kind}
      data-status={node.ghost ? "ghost" : node.status}
      style={{ width: NODE_W, height: h }}
      className={cx(
        "flex flex-col rounded-md border bg-bg-1 p-3 text-left",
        node.ghost ? "border-dashed border-line-control" : STATUS_BORDER[node.status],
        node.status === "stale" && !node.ghost && "border-2",
        selected && "ring-2 ring-fg-1 ring-offset-2 ring-offset-bg-0",
      )}
    >
      <div className="flex items-center gap-2 text-12 text-fg-2">
        <KindIcon kind={node.kind} className="h-4 w-4 shrink-0" />
        <span className="min-w-0 flex-1 truncate">{KIND_LABEL[node.kind]}</span>
        <NodeStatusBadge node={node} />
      </div>
      <p className={cx("mt-2 text-14 font-medium text-fg-0", quote ? "line-clamp-2 italic" : "line-clamp-2")}>{node.title}</p>
      <div className="mt-1 flex min-w-0 items-center gap-2">
        <p className="min-w-0 flex-1 truncate text-12 tabular-nums text-fg-1">{node.key}</p>
        <TrustBadges node={node} />
      </div>
      {node.ghost ? (
        <div className="mt-auto flex gap-2">
          <button tabIndex={tabbable ? 0 : -1} className="btn-secondary btn-sm flex-1" onClick={(e) => { e.stopPropagation(); run({ type: "acceptTopic", topicId: node.topicId! }); }}>
            <Check className="h-3 w-3" strokeWidth={2} aria-hidden /> Accept
          </button>
          <button tabIndex={tabbable ? 0 : -1} className="btn-ghost btn-sm" aria-label={`Dismiss ${node.title}`} onClick={(e) => { e.stopPropagation(); run({ type: "dismissTopic", topicId: node.topicId! }); }}>
            <X className="h-3 w-3" strokeWidth={2} aria-hidden /> Dismiss
          </button>
        </div>
      ) : action && !readOnly ? (
        <div className="mt-auto" data-tabbable={tabbable}>
          <ActionButton action={action} primary={primary} size="sm" />
        </div>
      ) : null}
    </m.div>
    {/* Handles sit outside the animated card so React Flow measures them at their final place. */}
    <Handle type="source" position={Position.Right} isConnectable={!readOnly && !quote && node.kind !== "export"} className="athena-handle" />
    </>
  );
}

export const NodeCard = memo(NodeCardImpl);
