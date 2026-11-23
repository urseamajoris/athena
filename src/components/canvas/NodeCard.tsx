"use client";
import { memo } from "react";
import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import { m } from "motion/react";
import { Check, X } from "lucide-react";
import { cx } from "../ui";
import { useSessionActions } from "../session/SessionContext";
import { NodeStatusBadge, TrustBadges, ArticlePipelineStrip, AttentionBadge, ATTENTION_STYLE, nodeAriaLabel } from "./node-bits";
import { ActionButton } from "../panels/action-button";
import { KindIcon } from "./icons";
import { KIND_LABEL, type GNode, type NodeStatus } from "@/lib/canvas/graph";
import type { Action } from "@/lib/canvas/actions";
import type { AttentionTone } from "@/lib/shared/canvas";
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

const STATUS_TO_TONE: Record<NodeStatus, AttentionTone> = {
  idle: "idle",
  running: "run",
  review: "warn",
  done: "ok",
  stale: "warn",
  error: "err",
};

const TONE_SURFACE: Record<AttentionTone, string> = {
  err: "border-err bg-bg-1",
  warn: "border-warn-line bg-bg-1",
  run: "border-run-line bg-bg-1",
  ok: "border-ok-line bg-bg-1",
  idle: "border-line-strong bg-bg-1",
};

function effectiveTone(node: GNode): AttentionTone {
  if (node.ghost) return "warn";
  if (node.status === "error" || node.attention?.tone === "err") return "err";
  if (node.status === "stale" || node.status === "review" || node.attention?.tone === "warn") return "warn";
  if (node.status === "running" || node.attention?.tone === "run") return "run";
  return STATUS_TO_TONE[node.status];
}

function NodeCardImpl({ id, data }: NodeProps<FlowNode>) {
  const { node, action, primary, selected, tabbable, readOnly, spawn } = data;
  const { run } = useSessionActions();
  const quote = node.kind === "quote";
  const h = quote ? QUOTE_H : NODE_H;
  const tone = effectiveTone(node);
  const showAttention = !!node.attention && (node.attention.tone === "err" || node.attention.tone === "warn");
  const stats = node.articleStats;
  const pipe = node.pipelineCounts;
  const citations = stats ? stats.totalCitations : node.impactSummary?.totalCitations;
  const hIndex = stats ? stats.hIndex : node.impactSummary?.hIndex;
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
      data-tone={tone}
      style={{ width: NODE_W, height: h }}
      className={cx(
        "relative flex flex-col overflow-hidden rounded-md border pl-4 pr-3 py-2.5 text-left",
        node.ghost ? "border-dashed border-line-control bg-bg-1" : TONE_SURFACE[tone],
        (tone === "err" || node.status === "stale") && !node.ghost && "border-2",
        selected && "ring-2 ring-fg-1 ring-offset-2 ring-offset-bg-0",
      )}
    >
      {/* Left colour-coded status rail for instant at-a-glance triage */}
      <span aria-hidden className={cx("absolute inset-y-0 left-0 w-1.5", node.ghost ? "bg-line-control" : ATTENTION_STYLE[tone].accent)} />
      <div className="flex items-center gap-2 text-12 text-fg-2">
        <KindIcon kind={node.kind} className="h-4 w-4 shrink-0" />
        <span className="min-w-0 flex-1 truncate">{KIND_LABEL[node.kind]}</span>
        <NodeStatusBadge node={node} />
      </div>
      <p className={cx("mt-1.5 text-14 font-medium leading-snug text-fg-0", quote ? "line-clamp-2 italic" : "line-clamp-2")}>{node.title}</p>
      <div className="mt-1 flex min-w-0 items-center gap-2" data-detail={node.trust && !quote ? undefined : ""}>
        <p className="min-w-0 flex-1 truncate text-12 tabular-nums text-fg-1">{node.key}</p>
        <TrustBadges node={node} />
      </div>
      {stats && node.attention ? (
        <div className="mt-2" data-detail="">
          <ArticlePipelineStrip
            retrieved={stats.retrieved}
            rendered={stats.rendered}
            filed={stats.filed}
            selected={stats.selected}
            stageTones={node.attention.stageTones}
            totalCitations={citations}
            hIndex={hIndex}
          />
        </div>
      ) : pipe ? (
        <div className="mt-2" data-detail="">
          <ArticlePipelineStrip
            retrieved={pipe.retrieved}
            rendered={pipe.rendered}
            filed={pipe.filed}
            selected={pipe.selected}
            stageTones={pipe.stageTones}
            totalCitations={citations}
            hIndex={hIndex}
          />
        </div>
      ) : null}
      {node.ghost ? (
        <div className="mt-auto flex gap-2 pt-1">
          <button tabIndex={tabbable ? 0 : -1} className="btn-secondary btn-sm flex-1" onClick={(e) => { e.stopPropagation(); run({ type: "acceptTopic", topicId: node.topicId! }); }}>
            <Check className="h-3 w-3" strokeWidth={2} aria-hidden /> Keep
          </button>
          <button tabIndex={tabbable ? 0 : -1} className="btn-ghost btn-sm" aria-label={`Delete topic: ${node.title}`} onClick={(e) => { e.stopPropagation(); run({ type: "dismissTopic", topicId: node.topicId! }); }}>
            <X className="h-3 w-3" strokeWidth={2} aria-hidden /> Delete
          </button>
        </div>
      ) : action && !readOnly ? (
        <div className="mt-auto pt-1" data-tabbable={tabbable} data-detail={primary || tabbable || selected ? undefined : ""}>
          <ActionButton action={action} primary={primary} size="sm" />
        </div>
      ) : showAttention && node.attention ? (
        <div className="mt-auto flex items-center justify-between gap-2 pt-1">
          <AttentionBadge attention={node.attention} />
        </div>
      ) : null}
    </m.div>
    {/* Handles sit outside the animated card so React Flow measures them at their final place. */}
    <Handle type="source" position={Position.Right} isConnectable={!readOnly && !quote && node.kind !== "export"} className="athena-handle" />
    </>
  );
}

export const NodeCard = memo(NodeCardImpl);
