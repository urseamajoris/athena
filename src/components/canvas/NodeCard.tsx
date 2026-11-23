"use client";
import { memo, useState } from "react";
import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import { m } from "motion/react";
import { AlertTriangle, Check, ChevronDown, ChevronRight, KeyRound, Plus, Trash2, X } from "lucide-react";
import { api } from "../api";
import { Spinner, cx } from "../ui";
import { canvasStore, useSession, useSessionActions } from "../session/SessionContext";
import { NodeStatusBadge, TrustBadges, ArticlePipelineStrip, AttentionBadge, ATTENTION_STYLE, nodeAriaLabel } from "./node-bits";
import { ActionButton } from "../panels/action-button";
import { KindIcon } from "./icons";
import { KIND_LABEL, type GNode, type NodeStatus } from "@/lib/canvas/graph";
import type { Action } from "@/lib/canvas/actions";
import type { AttentionTone } from "@/lib/shared/canvas";
import { AI_PROVIDERS, PROVIDER_META, type AiProvider } from "@/lib/shared/ai-providers";
import { fmtInt } from "@/lib/shared/format";
import { NODE_W, nodeHeight } from "@/lib/canvas/layout";

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

/** Interactive Admin AI Provider & Model box right on the Canvas. */
function AdminAiBody({ tabbable }: { tabbable: boolean }) {
  const { providerConfig, refreshStatus, announce } = useSession();
  const [busy, setBusy] = useState(false);

  if (!providerConfig) {
    return (
      <div className="mt-2 text-12 text-fg-2">
        Loading provider controls…
      </div>
    );
  }
  const active = providerConfig.activeProvider;
  const entry = providerConfig.providers[active];
  const meta = PROVIDER_META[active];
  const currentModel = entry.models.reasoning;

  async function switchProvider(p: AiProvider) {
    if (p === active || busy) return;
    setBusy(true);
    try {
      await api("/api/admin/provider", { method: "PUT", body: { provider: p } });
      await refreshStatus();
      announce(`Switched pipeline AI provider to ${PROVIDER_META[p].label}.`);
    } catch (e) {
      announce(`Could not switch provider: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  async function switchModel(modelId: string) {
    if (busy) return;
    setBusy(true);
    try {
      await api("/api/admin/provider", { method: "PUT", body: { provider: active, model: modelId } });
      await refreshStatus();
      announce(`Pipeline model switched to ${modelId}.`);
    } catch (e) {
      announce(`Could not switch model: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-2 flex flex-1 flex-col gap-2" onClick={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
      {/* Provider toggle pills: Anthropic | Gemini | xAI */}
      <div className="grid grid-cols-3 gap-1" role="group" aria-label="AI API provider">
        {AI_PROVIDERS.map((p) => {
          const isAct = p === active;
          const hasKey = providerConfig.providers[p].key.inUse !== "none";
          return (
            <button
              key={p}
              type="button"
              tabIndex={tabbable ? 0 : -1}
              aria-pressed={isAct}
              disabled={busy}
              onClick={() => void switchProvider(p)}
              className={cx(
                "flex items-center justify-center gap-1 rounded-sm border px-1.5 py-1 text-12 font-medium transition-colors",
                isAct ? "border-fg-0 bg-bg-3 text-fg-0" : "border-line bg-bg-0 text-fg-1 hover:bg-bg-2",
              )}
              title={`${PROVIDER_META[p].label} (${hasKey ? "API key set" : "no key"})`}
            >
              <span className={cx("h-1.5 w-1.5 rounded-full", hasKey ? "bg-ok" : "bg-warn")} aria-hidden />
              <span className="truncate">{PROVIDER_META[p].shortLabel}</span>
            </button>
          );
        })}
      </div>

      {/* Pipeline model toggle */}
      <label className="block text-12">
        <span className="sr-only">Pipeline AI model</span>
        <select
          tabIndex={tabbable ? 0 : -1}
          value={currentModel}
          disabled={busy}
          onChange={(e) => void switchModel(e.target.value)}
          className="w-full rounded-sm border border-line-control bg-bg-0 px-2 py-1 font-mono text-12 text-fg-0"
          aria-label={`Pipeline model for ${meta.shortLabel}`}
        >
          {meta.catalog.map((m) => (
            <option key={m.id} value={m.id}>
              {m.label}
            </option>
          ))}
          {!meta.catalog.some((m) => m.id === currentModel) && <option value={currentModel}>{currentModel}</option>}
        </select>
      </label>

      {/* Key status & API key workflow button */}
      <div className="mt-auto flex items-center justify-between gap-2 pt-0.5 text-12">
        <span className={cx("truncate font-mono", entry.key.inUse !== "none" ? "text-ok" : "text-warn")}>
          {busy ? <Spinner className="inline h-3 w-3" /> : entry.key.inUse !== "none" ? `Key ${entry.key.masked}` : "No key set"}
        </span>
        <button
          type="button"
          tabIndex={tabbable ? 0 : -1}
          onClick={() => canvasStore.getState().openPanel("admin:ai")}
          className="btn-secondary btn-sm shrink-0"
        >
          <KeyRound className="h-3 w-3" aria-hidden /> API keys
        </button>
      </div>
    </div>
  );
}

function NodeCardImpl({ id, data }: NodeProps<FlowNode>) {
  const { node, action, primary, selected, tabbable, readOnly, spawn } = data;
  const { run } = useSessionActions();
  const { states, summary, openPaper } = useSession();
  const quote = node.kind === "quote";
  const h = nodeHeight(node.kind);
  const tone = effectiveTone(node);
  const showAttention = !!node.attention && (node.attention.tone === "err" || node.attention.tone === "warn");
  const stats = node.articleStats;
  const pipe = node.pipelineCounts;
  const citations = stats ? stats.totalCitations : node.impactSummary?.totalCitations;
  const hIndex = stats ? stats.hIndex : node.impactSummary?.hIndex;
  const canAddTopic = !readOnly && states["1"] === "approved" && (summary?.topics.length ?? 0) < 8;
  const canAddQuery = !readOnly && !node.ghost && (states["2"] === "approved" || (summary?.queries.length ?? 0) > 0);

  return (
    <>
      {node.kind !== "ai_config" && node.kind !== "idea" && (
        <Handle type="target" position={Position.Left} isConnectable={false} className="athena-handle" />
      )}
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

        {/* Header row */}
        <div className="flex items-center gap-1.5 text-12 text-fg-2">
          <KindIcon kind={node.kind} className="h-3.5 w-3.5 shrink-0" />
          <span className="min-w-0 flex-1 truncate">{KIND_LABEL[node.kind]}</span>
          <NodeStatusBadge node={node} />
        </div>

        {/* Title */}
        <p className={cx("mt-1 text-14 font-medium leading-snug text-fg-0", quote ? "line-clamp-2 italic" : "line-clamp-1")}>{node.title}</p>

        {/* Key metric line */}
        <div className="mt-0.5 flex min-w-0 items-center gap-2" data-detail={node.trust && !quote ? undefined : ""}>
          <p className="min-w-0 flex-1 truncate text-12 tabular-nums text-fg-1">{node.key}</p>
          <TrustBadges node={node} />
        </div>

        {/* Specialized body: Admin AI Engine box */}
        {node.kind === "ai_config" && <AdminAiBody tabbable={tabbable} />}

        {/* Specialized body: Topic Corpus box (per-query retrieved & attention mini-bars) */}
        {node.kind === "topic_corpus" && node.topicQueryStats && node.topicQueryStats.length > 0 && (
          <div className="mt-2 space-y-1 overflow-hidden" data-detail="">
            {node.topicQueryStats.slice(0, 3).map((qs) => {
              const maxQ = Math.max(1, ...node.topicQueryStats!.map((x) => x.retrieved));
              const barPct = Math.round((qs.retrieved / maxQ) * 100);
              const attnPct = qs.retrieved > 0 ? Math.round((qs.needsAttention / qs.retrieved) * 100) : 0;
              return (
                <div key={qs.queryId} className="space-y-0.5">
                  <div className="flex items-center justify-between gap-1.5 text-12 tabular-nums">
                    <span className="min-w-0 truncate text-fg-1">{qs.label}</span>
                    <span className="flex shrink-0 items-center gap-1">
                      <span className="font-medium text-fg-0">{fmtInt(qs.retrieved)}</span>
                      {qs.runStatus === "failed" ? (
                        <span className="rounded-sm border border-err-line bg-err-soft px-1 text-err">err</span>
                      ) : qs.needsAttention > 0 ? (
                        <span className="rounded-sm border border-warn-line bg-warn-soft px-1 text-warn" title={`${qs.needsAttention} papers need attention`}>
                          {qs.needsAttention} attn
                        </span>
                      ) : qs.retrieved > 0 ? (
                        <span className="text-ok">ok</span>
                      ) : null}
                    </span>
                  </div>
                  <div className="relative h-1.5 w-full overflow-hidden rounded-full bg-bg-3" aria-hidden>
                    {qs.retrieved > 0 && (
                      <span className="absolute inset-y-0 left-0 rounded-full bg-ok/70" style={{ width: `${Math.max(5, barPct)}%` }} />
                    )}
                    {qs.needsAttention > 0 && (
                      <span
                        className={cx("absolute inset-y-0 left-0 rounded-full", qs.attentionBreakdown.failedAppraisal > 0 ? "bg-err" : "bg-warn")}
                        style={{ width: `${Math.max(5, Math.round((barPct * attnPct) / 100))}%` }}
                      />
                    )}
                  </div>
                </div>
              );
            })}
            {node.topicQueryStats.length > 3 && (
              <p className="text-12 text-fg-2">+{node.topicQueryStats.length - 3} more queries (expand to view)</p>
            )}
          </div>
        )}

        {/* Specialized body: Query Corpus sub-box (retrieved vs attention bar + breakdown pills) */}
        {node.kind === "query_corpus" && node.queryStats && (
          <div className="mt-2 space-y-1.5" data-detail="">
            {node.queryString && (
              <p className="truncate font-mono text-12 text-fg-2" title={node.queryString}>
                {node.queryString}
              </p>
            )}
            <div className="grid grid-cols-2 gap-1.5 text-12 tabular-nums">
              <div className="rounded-sm border border-line bg-bg-0 px-2 py-1">
                <span className="block text-fg-2">Retrieved</span>
                <span className="font-semibold text-fg-0">{fmtInt(node.queryStats.retrieved)}</span>
                <span className="ml-1 text-fg-2">({fmtInt(node.queryStats.newUnique)} new)</span>
              </div>
              <div
                className={cx(
                  "rounded-sm border px-2 py-1",
                  node.queryStats.needsAttention > 0 || node.queryStats.runStatus === "failed"
                    ? node.queryStats.attentionBreakdown.failedAppraisal > 0 || node.queryStats.runStatus === "failed"
                      ? "border-err-line bg-err-soft text-err"
                      : "border-warn-line bg-warn-soft text-warn"
                    : "border-ok-line bg-ok-soft text-ok",
                )}
              >
                <span className="block opacity-90">Needs attention</span>
                <span className="font-semibold">{fmtInt(node.queryStats.needsAttention)}</span>
                {node.queryStats.retrieved > 0 && (
                  <span className="ml-1 opacity-85">({Math.round((node.queryStats.needsAttention / node.queryStats.retrieved) * 100)}%)</span>
                )}
              </div>
            </div>
            {/* Visual split bar: attention vs cleared */}
            {node.queryStats.retrieved > 0 && (
              <div className="flex h-1.5 w-full overflow-hidden rounded-full bg-bg-3" aria-hidden>
                {node.queryStats.needsAttention > 0 && (
                  <span
                    className={node.queryStats.attentionBreakdown.failedAppraisal > 0 ? "bg-err" : "bg-warn"}
                    style={{ width: `${Math.max(4, Math.round((node.queryStats.needsAttention / node.queryStats.retrieved) * 100))}%` }}
                  />
                )}
                <span className="flex-1 bg-ok/70" />
              </div>
            )}
          </div>
        )}

        {/* Specialized body: Query Item sub-box */}
        {node.kind === "query_item" && (
          <div className="mt-1.5 space-y-1" data-detail="">
            {node.queryString && (
              <p className="line-clamp-2 rounded-sm bg-bg-0 px-2 py-1 font-mono text-12 text-fg-1" title={node.queryString}>
                {node.queryString}
              </p>
            )}
          </div>
        )}

        {/* Specialized body: Paper Group sub-box (clickable list of papers!) */}
        {node.kind === "paper_group" && (
          <div className="mt-1.5 flex-1 overflow-hidden" data-detail="" onClick={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
            <ul className="space-y-1">
              {(node.papers ?? []).slice(0, 4).map((p) => (
                <li key={p.id}>
                  <button
                    type="button"
                    tabIndex={tabbable ? 0 : -1}
                    onClick={() => openPaper(p.id)}
                    className="flex w-full items-center gap-1.5 rounded-sm bg-bg-0/80 px-1.5 py-1 text-left text-12 hover:bg-bg-2"
                    title={`${p.title}${p.attentionReason ? ` — ${p.attentionReason}` : ""}`}
                  >
                    {p.needsAttention && <AlertTriangle className="h-3 w-3 shrink-0 text-warn" aria-hidden />}
                    <span className="min-w-0 flex-1 truncate text-fg-0">{p.title}</span>
                    {p.attentionReason ? (
                      <span className="shrink-0 text-12 text-warn">{p.undecidedQuotes > 0 ? `${p.undecidedQuotes}q` : p.failedAppraisal ? "err" : "!"}</span>
                    ) : p.year ? (
                      <span className="shrink-0 tabular-nums text-fg-2">{p.year}</span>
                    ) : null}
                  </button>
                </li>
              ))}
            </ul>
            {(node.paperCount ?? 0) > 4 && (
              <button
                type="button"
                tabIndex={tabbable ? 0 : -1}
                onClick={() => canvasStore.getState().openPanel(id)}
                className="mt-1 text-12 text-fg-2 hover:text-fg-0"
              >
                +{(node.paperCount ?? 0) - 4} more — inspect all →
              </button>
            )}
          </div>
        )}

        {/* Standard pipeline strip for Topic / Query / Corpus / Table / Appraisal */}
        {node.kind !== "ai_config" && node.kind !== "topic_corpus" && node.kind !== "query_corpus" && node.kind !== "query_item" && node.kind !== "paper_group" && (
          stats && node.attention ? (
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
          ) : null
        )}

        {/* Bottom action row */}
        {node.kind === "ai_config" ? null : node.ghost ? (
          <div className="mt-auto flex gap-2 pt-1">
            <button tabIndex={tabbable ? 0 : -1} className="btn-secondary btn-sm flex-1" onClick={(e) => { e.stopPropagation(); run({ type: "acceptTopic", topicId: node.topicId! }); }}>
              <Check className="h-3 w-3" strokeWidth={2} aria-hidden /> Keep
            </button>
            <button tabIndex={tabbable ? 0 : -1} className="btn-ghost btn-sm" aria-label={`Delete topic: ${node.title}`} onClick={(e) => { e.stopPropagation(); run({ type: "dismissTopic", topicId: node.topicId! }); }}>
              <X className="h-3 w-3" strokeWidth={2} aria-hidden /> Delete
            </button>
          </div>
        ) : (
          <div className="mt-auto flex items-center gap-1.5 pt-1.5" onClick={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
            {/* Expand/collapse toggle for container boxes (query, topic_corpus, query_corpus) */}
            {node.expandable && (
              <button
                type="button"
                tabIndex={tabbable ? 0 : -1}
                aria-expanded={!!node.expanded}
                onClick={() => run({ type: "toggleExpand", nodeId: id })}
                className="btn-secondary btn-sm min-w-0"
                title={node.expanded ? "Collapse sub-boxes" : `Expand into ${node.expandLabel ?? "sub-boxes"}`}
              >
                {node.expanded ? <ChevronDown className="h-3 w-3 shrink-0" aria-hidden /> : <ChevronRight className="h-3 w-3 shrink-0" aria-hidden />}
                <span className="truncate">{node.expanded ? "Collapse" : node.expandLabel ?? "Expand"}</span>
              </button>
            )}

            {/* Direct + Topic on Idea card */}
            {node.kind === "idea" && canAddTopic && (
              <button
                type="button"
                tabIndex={tabbable ? 0 : -1}
                onClick={() => run({ type: "addTopic" })}
                className="btn-secondary btn-sm"
                title="Add a new search topic to this review"
              >
                <Plus className="h-3 w-3" aria-hidden /> Topic
              </button>
            )}

            {/* Direct + Query & Remove topic on Topic card */}
            {node.kind === "topic" && !readOnly && (
              <>
                {canAddQuery && (
                  <button
                    type="button"
                    tabIndex={tabbable ? 0 : -1}
                    onClick={() => run({ type: "addQuery", topicId: node.topicId! })}
                    className="btn-secondary btn-sm"
                    title="Add a search query to this topic"
                  >
                    <Plus className="h-3 w-3" aria-hidden /> Query
                  </button>
                )}
                <button
                  type="button"
                  tabIndex={tabbable ? 0 : -1}
                  onClick={() => run({ type: "dismissTopic", topicId: node.topicId! })}
                  className="btn-ghost btn-sm ml-auto text-fg-2 hover:text-err"
                  aria-label={`Remove topic: ${node.title}`}
                  title="Remove topic"
                >
                  <Trash2 className="h-3.5 w-3.5" aria-hidden />
                </button>
              </>
            )}

            {/* Direct + Query on Query hub card */}
            {node.kind === "query" && !readOnly && node.topicId && (
              <button
                type="button"
                tabIndex={tabbable ? 0 : -1}
                onClick={() => run({ type: "addQuery", topicId: node.topicId! })}
                className="btn-ghost btn-sm"
                title="Add another query to this topic"
              >
                <Plus className="h-3 w-3" aria-hidden /> Query
              </button>
            )}

            {/* Direct Delete on Query item sub-box */}
            {node.kind === "query_item" && !readOnly && node.queryId && node.topicId && (
              <>
                <button
                  type="button"
                  tabIndex={tabbable ? 0 : -1}
                  onClick={() => canvasStore.getState().openPanel(id)}
                  className="btn-secondary btn-sm"
                >
                  Edit
                </button>
                <button
                  type="button"
                  tabIndex={tabbable ? 0 : -1}
                  onClick={() => run({ type: "deleteQuery", queryId: node.queryId!, topicId: node.topicId! })}
                  className="btn-ghost btn-sm ml-auto text-fg-2 hover:text-err"
                  aria-label={`Delete query: ${node.title}`}
                  title="Delete query"
                >
                  <Trash2 className="h-3.5 w-3.5" aria-hidden />
                </button>
              </>
            )}

            {/* Frontier next action button or attention badge */}
            {action && !readOnly && !node.expandable ? (
              <div className="ml-auto" data-tabbable={tabbable} data-detail={primary || tabbable || selected ? undefined : ""}>
                <ActionButton action={action} primary={primary} size="sm" />
              </div>
            ) : showAttention && node.attention && node.kind !== "paper_group" && node.kind !== "query_corpus" ? (
              <div className="ml-auto min-w-0">
                <AttentionBadge attention={node.attention} compact />
              </div>
            ) : null}
          </div>
        )}
      </m.div>
      {/* Handles sit outside the animated card so React Flow measures them at their final place. */}
      {node.kind !== "ai_config" && (
        <Handle type="source" position={Position.Right} isConnectable={!readOnly && !quote && node.kind !== "export" && node.kind !== "paper_group"} className="athena-handle" />
      )}
    </>
  );
}

export const NodeCard = memo(NodeCardImpl);
