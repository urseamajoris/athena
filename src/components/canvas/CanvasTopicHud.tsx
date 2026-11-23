"use client";
import { AlertTriangle, BarChart3, CheckCircle2, ChevronDown, ChevronUp, Loader2, XCircle } from "lucide-react";
import { canvasStore, useSession } from "../session/SessionContext";
import { ShapeIcon } from "../categories";
import { cx } from "../ui";
import { ATTENTION_STYLE, AttentionBadge } from "./node-bits";
import { evaluateTopicAttention, type AttentionTone, type TopicArticleStats } from "@/lib/shared/canvas";
import { nodeForStage } from "@/lib/canvas/graph";
import { categoryVar, topicCategories } from "@/lib/shared/categories";
import { fmtInt } from "@/lib/shared/format";

/**
 * Collapsible Canvas HUD showing every topic's Retrieved / Rendered / Filed counts,
 * proportional bars, citation impact, and color-coded stage attention at a glance.
 */
export function CanvasTopicHud({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  const { summary, states, graph, projectId } = useSession();
  const stats = summary?.topicStats ?? [];
  const impact = summary?.impact;
  const started = (states["4"] ?? "not_started") !== "not_started" || stats.some((t) => t.retrieved > 0);
  if (!stats.length || !started) return null;

  const topics = stats.map((t) => ({ id: t.topicId, name: t.name }));
  const cats = topicCategories(topics);
  const rows = stats.map((t, i) => ({
    stat: t,
    cat: cats[i],
    attention: evaluateTopicAttention(t, states),
  }));

  const countBy = (tone: AttentionTone) => rows.filter((r) => r.attention.tone === tone).length;
  const errCount = countBy("err");
  const warnCount = countBy("warn");
  const runCount = countBy("run");
  const okCount = countBy("ok");
  const maxRet = Math.max(1, ...stats.map((s) => s.retrieved));

  function focusTopicStage(stat: TopicArticleStats, stage: number | null) {
    if (stage && stage >= 4) {
      const id = nodeForStage(graph, stage);
      if (id) {
        canvasStore.getState().openPanel(id);
        return;
      }
    }
    const qId = `query:${stat.topicId}`;
    const target = graph.nodes.some((n) => n.id === qId) ? qId : `topic:${stat.topicId}`;
    canvasStore.getState().openPanel(target);
  }

  return (
    <section
      aria-label="Topic article pipeline and attention overview"
      className="pointer-events-auto absolute bottom-4 right-4 z-10 w-[min(500px,calc(100%-32px))] rounded-md border border-line-strong bg-bg-1"
    >
      <div className="flex items-center gap-2 border-b border-line px-3 py-2">
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          className="flex min-w-0 flex-1 items-center gap-2 text-left text-12 font-semibold text-fg-0"
        >
          <span className="truncate">Topic pipeline</span>
          <span className="flex flex-wrap items-center gap-1.5 font-medium tabular-nums">
            {errCount > 0 && (
              <span className="inline-flex items-center gap-0.5 rounded-sm border border-err-line bg-err-soft px-1.5 py-0.5 text-err">
                <XCircle className="h-3 w-3" aria-hidden /> {errCount}
              </span>
            )}
            {warnCount > 0 && (
              <span className="inline-flex items-center gap-0.5 rounded-sm border border-warn-line bg-warn-soft px-1.5 py-0.5 text-warn">
                <AlertTriangle className="h-3 w-3" aria-hidden /> {warnCount}
              </span>
            )}
            {runCount > 0 && (
              <span className="inline-flex items-center gap-0.5 rounded-sm border border-run-line bg-run-soft px-1.5 py-0.5 text-run">
                <Loader2 className="h-3 w-3 motion-safe:animate-spin" aria-hidden /> {runCount}
              </span>
            )}
            {okCount > 0 && (
              <span className="inline-flex items-center gap-0.5 rounded-sm border border-ok-line bg-ok-soft px-1.5 py-0.5 text-ok">
                <CheckCircle2 className="h-3 w-3" aria-hidden /> {okCount}
              </span>
            )}
          </span>
          <span className="ml-auto text-fg-2">{open ? <ChevronDown className="h-4 w-4" aria-hidden /> : <ChevronUp className="h-4 w-4" aria-hidden />}</span>
        </button>
        <button
          type="button"
          onClick={() => canvasStore.getState().setView(projectId, "graph")}
          className="btn-ghost btn-sm shrink-0"
          title="Open the Impact & Topic Graph view (G)"
        >
          <BarChart3 className="h-3.5 w-3.5" aria-hidden /> Graph
        </button>
      </div>

      {open && (
        <div className="max-h-[42vh] overflow-y-auto p-3">
          {impact && (
            <div className="mb-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-sm bg-bg-2 px-2.5 py-1.5 text-12 tabular-nums text-fg-1">
              <span><strong className="text-fg-0">{fmtInt(summary?.retrieval.unique ?? 0)}</strong> retrieved</span>
              <span><strong className="text-fg-0">{fmtInt(summary?.table.summarised ?? 0)}</strong> rendered</span>
              <span><strong className="text-fg-0">{fmtInt(summary?.appraisal.done ?? 0)}</strong> appraised</span>
              <span className="ml-auto"><strong className="text-fg-0">{fmtInt(impact.totalCitations)}</strong> cites · h-index <strong className="text-fg-0">{impact.hIndex}</strong></span>
            </div>
          )}

          <div className="grid grid-cols-[minmax(0,1fr)_44px_44px_48px_auto] items-center gap-x-2 pb-1 text-12 text-fg-2">
            <span>Topic</span>
            <span className="text-right" title="Unique retrieved articles">Ret</span>
            <span className="text-right" title="Articles rendered into summaries">Ren</span>
            <span className="text-right" title="Selected articles cleanly appraised & filed">Fil</span>
            <span className="text-right">Status</span>
          </div>

          <ul className="divide-y divide-line">
            {rows.map(({ stat, cat, attention }) => {
              const retW = Math.round((stat.retrieved / maxRet) * 100);
              const renW = Math.round((stat.rendered / maxRet) * 100);
              const filW = Math.round((stat.filed / maxRet) * 100);
              const filText = stat.selected > 0 && stat.filed < stat.selected ? `${stat.filed}/${stat.selected}` : fmtInt(stat.filed);
              return (
                <li key={stat.topicId} className="py-1.5">
                  <button
                    type="button"
                    onClick={() => focusTopicStage(stat, attention.stage)}
                    className="grid w-full grid-cols-[minmax(0,1fr)_44px_44px_48px_auto] items-center gap-x-2 rounded-sm px-1 py-0.5 text-left hover:bg-bg-2"
                    title={`${stat.name}: ${attention.detail}. ${fmtInt(stat.totalCitations)} citations, h-index ${stat.hIndex}. Click to inspect.`}
                  >
                    <span className="min-w-0">
                      <span className="flex items-center gap-1.5 text-12 font-medium text-fg-0">
                        <ShapeIcon shape={cat?.shape ?? "circle"} color={categoryVar("topic", stat.topicId, topics)} size={10} />
                        <span className="truncate">{stat.name}</span>
                      </span>
                      <span className="mt-1 flex items-center gap-2">
                        <span className="relative block h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-bg-3" aria-hidden>
                          {stat.retrieved > 0 && <span className={cx("absolute inset-y-0 left-0 rounded-full opacity-35", ATTENTION_STYLE[attention.stageTones.retrieved].bar)} style={{ width: `${Math.max(4, retW)}%` }} />}
                          {stat.rendered > 0 && <span className={cx("absolute inset-y-0 left-0 rounded-full opacity-65", ATTENTION_STYLE[attention.stageTones.rendered].bar)} style={{ width: `${Math.max(4, renW)}%` }} />}
                          {stat.filed > 0 && <span className={cx("absolute inset-y-0 left-0 rounded-full", ATTENTION_STYLE[attention.stageTones.filed].bar)} style={{ width: `${Math.max(5, filW)}%` }} />}
                        </span>
                        {stat.totalCitations > 0 && (
                          <span className="shrink-0 text-12 tabular-nums text-fg-2">{fmtInt(stat.totalCitations)} cites</span>
                        )}
                      </span>
                    </span>
                    <span className={cx("text-right text-12 font-semibold tabular-nums", ATTENTION_STYLE[attention.stageTones.retrieved].text)}>{fmtInt(stat.retrieved)}</span>
                    <span className={cx("text-right text-12 font-semibold tabular-nums", ATTENTION_STYLE[attention.stageTones.rendered].text)}>{fmtInt(stat.rendered)}</span>
                    <span className={cx("text-right text-12 font-semibold tabular-nums", ATTENTION_STYLE[attention.stageTones.filed].text)}>{filText}</span>
                    <span className="flex justify-end"><AttentionBadge attention={attention} /></span>
                  </button>
                </li>
              );
            })}
          </ul>
          <p className="mt-2 text-12 text-fg-2">Click any topic to jump to the stage needing attention. Colours: <span className="text-err">red = failed/blocked</span>, <span className="text-warn">amber = needs attention</span>, <span className="text-ok">green = healthy</span>.</p>
        </div>
      )}
    </section>
  );
}
