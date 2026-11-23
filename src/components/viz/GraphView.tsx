"use client";
import { useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { AlertTriangle, Award, BarChart3, BookOpen, CheckCircle2, FileText, Flame, TrendingUp, XCircle } from "lucide-react";
import { projectPath, useApi } from "../api";
import { Badge, EmptyState, ErrorState, Loading, cx } from "../ui";
import { ShapeIcon } from "../categories";
import { canvasStore, useSession } from "../session/SessionContext";
import { useViewPrefs } from "../session/viewPrefs";
import { ATTENTION_STYLE, AttentionBadge } from "../canvas/node-bits";
import type { MapPoint } from "./paper-points";
import { evaluateTopicAttention, type CorpusImpactSummary, type TopicArticleStats } from "@/lib/shared/canvas";
import { IMPACT_TIERS, categoryVar, evidenceOf, scoreBandOf, sourceOf, studyGroupFromLabels, studyGroupOf, topicCategories, type ColorBy } from "@/lib/shared/categories";
import { paperImpactEvaluation, type ImpactTier } from "@/lib/shared/impact";
import { fmtInt } from "@/lib/shared/format";
import { nodeForStage } from "@/lib/canvas/graph";

const PaperMap = dynamic(() => import("./PaperMap").then((m) => m.PaperMap), { ssr: false, loading: () => <Loading label="Drawing the impact map…" /> });

export interface EnrichedPaperPoint {
  id: string;
  title: string;
  authors: string[];
  year: number | null;
  journal: string | null;
  citationCount: number | null;
  oaUrl: string | null;
  oaStatus: string | null;
  pmcid: string | null;
  publicationTypes: string[];
  sourceDatabases: string[];
  studyType: string | null;
  hasSummary: boolean;
  topicIds: string[];
  score: number | null;
  selected: boolean;
  appraised: boolean;
  filed: boolean;
  undecidedQuotes: number;
  textSource: string | null;
}

export interface EnrichedPointsData {
  topics: { id: string; name: string }[];
  topicStats: TopicArticleStats[];
  impact: CorpusImpactSummary;
  papers: EnrichedPaperPoint[];
}

type SortKey = "citations" | "velocity" | "impact" | "year";

/**
 * Full-screen Graph & Impact Explorer: evaluates every retrieved article by scholarly impact
 * (citations, citation velocity, h-index, composite impact index, open-access rate) and compares
 * every topic's Retrieved / Rendered / Filed pipeline with color-coded attention cues.
 */
export function GraphView() {
  const { projectId, states, openPaper, graph } = useSession();
  const running = states["4"] === "running" || states["5"] === "running" || states["6"] === "running" || states["7"] === "running";
  const { data, error, isLoading, mutate } = useApi<EnrichedPointsData>(projectPath(projectId, "papers-points"), { refreshInterval: running ? 3000 : 0 });
  const view = useViewPrefs();
  const [selectedTopic, setSelectedTopic] = useState<string>("all");
  const [topicLens, setTopicLens] = useState<"pipeline" | "impact">("pipeline");
  const [tierFilter, setTierFilter] = useState<ImpactTier | null>(null);
  const [sortBy, setSortBy] = useState<SortKey>("citations");

  const papers = useMemo(() => data?.papers ?? [], [data]);
  const topics = useMemo(() => data?.topics ?? [], [data]);
  const topicStats = useMemo(() => data?.topicStats ?? [], [data]);
  const topicCats = useMemo(() => topicCategories(topics), [topics]);

  const evaluated = useMemo(
    () =>
      papers.map((p) => {
        const evaln = paperImpactEvaluation(p);
        const stage: "filed" | "rendered" | "retrieved" = p.filed ? "filed" : p.hasSummary ? "rendered" : "retrieved";
        return { ...p, evaln, stage };
      }),
    [papers],
  );

  const filtered = useMemo(() => {
    return evaluated.filter((p) => {
      if (selectedTopic !== "all" && !p.topicIds.includes(selectedTopic)) return false;
      if (tierFilter && p.evaln.tier !== tierFilter) return false;
      return true;
    });
  }, [evaluated, selectedTopic, tierFilter]);

  const ranked = papers.some((p) => p.score !== null);
  const hasAppraisals = papers.some((p) => p.appraised);

  const mapPoints: MapPoint[] = useMemo(
    () =>
      filtered.map((p) => ({
        id: p.id,
        title: p.title,
        year: p.year,
        score: p.score,
        layer: Math.max(-1, topics.findIndex((t) => p.topicIds.includes(t.id))),
        cat:
          view.colorBy === "topic"
            ? p.topicIds[0] ?? ""
            : view.colorBy === "impact"
              ? p.evaln.tier
              : view.colorBy === "score"
                ? scoreBandOf(p.score)
                : view.colorBy === "source"
                  ? sourceOf(p.sourceDatabases)
                  : view.colorBy === "evidence"
                    ? evidenceOf(p.appraised ? { textSource: p.textSource, unverified: p.undecidedQuotes } : null)
                    : p.studyType
                      ? studyGroupOf(p.studyType)
                      : studyGroupFromLabels(p.publicationTypes),
        selected: p.selected,
        citations: p.citationCount,
        citationsPerYear: p.evaln.citationsPerYear,
        impactScore: p.evaln.score,
        impactTier: p.evaln.tier,
        openAccess: !!(p.oaUrl || p.pmcid),
        stage: p.stage,
      })),
    [filtered, topics, view.colorBy],
  );

  const tierCounts = useMemo(() => {
    const base = selectedTopic === "all" ? evaluated : evaluated.filter((p) => p.topicIds.includes(selectedTopic));
    const counts: Record<string, number> = {};
    for (const p of base) counts[p.evaln.tier] = (counts[p.evaln.tier] ?? 0) + 1;
    return { counts, total: base.length };
  }, [evaluated, selectedTopic]);

  const yearSeries = useMemo(() => {
    const byYear = new Map<number, { year: number; count: number; citations: number; filed: number; rendered: number }>();
    for (const p of filtered) {
      if (!p.year) continue;
      const cur = byYear.get(p.year) ?? { year: p.year, count: 0, citations: 0, filed: 0, rendered: 0 };
      cur.count++;
      if (typeof p.citationCount === "number") cur.citations += p.citationCount;
      if (p.filed) cur.filed++;
      if (p.hasSummary) cur.rendered++;
      byYear.set(p.year, cur);
    }
    return [...byYear.values()].sort((a, b) => a.year - b.year);
  }, [filtered]);

  const topPapers = useMemo(() => {
    return [...filtered]
      .sort((a, b) => {
        if (sortBy === "citations") return (b.citationCount ?? -1) - (a.citationCount ?? -1) || b.evaln.score - a.evaln.score;
        if (sortBy === "velocity") return (b.evaln.citationsPerYear ?? -1) - (a.evaln.citationsPerYear ?? -1);
        if (sortBy === "impact") return b.evaln.score - a.evaln.score || (b.citationCount ?? -1) - (a.citationCount ?? -1);
        return (b.year ?? 0) - (a.year ?? 0);
      })
      .slice(0, 12);
  }, [filtered, sortBy]);

  if (isLoading && !data) return <div className="p-8"><Loading label="Loading impact & topic graphs…" /></div>;
  if (error && !data) return <div className="p-8"><ErrorState error={error} onRetry={() => mutate()} /></div>;
  if (!papers.length) {
    return (
      <div className="mx-auto max-w-2xl p-8">
        <EmptyState title="No retrieved articles to visualise yet">
          Run your searches in step 4 to see per-topic article pipelines (retrieved, rendered, filed), citation metrics, h-index and interactive impact graphs here.
        </EmptyState>
      </div>
    );
  }

  const impact = data!.impact;
  const totalRetrieved = papers.length;
  const totalRendered = papers.filter((p) => p.hasSummary).length;
  const totalFiled = papers.filter((p) => p.filed).length;
  const totalSelected = papers.filter((p) => p.selected).length;
  const oaPct = totalRetrieved ? Math.round((impact.openAccessCount / totalRetrieved) * 100) : 0;
  const colorChoices: ColorBy[] = (["impact", "study", "topic", "source", "evidence", "score"] as ColorBy[]).filter(
    (c) => (c !== "score" || ranked) && (c !== "evidence" || hasAppraisals),
  );

  function jumpToStage(topicId: string, stage: number | null) {
    if (stage && stage >= 4) {
      const id = nodeForStage(graph, stage);
      if (id) {
        canvasStore.getState().setView(projectId, "canvas");
        canvasStore.getState().openPanel(id);
        return;
      }
    }
    const qId = `query:${topicId}`;
    const target = graph.nodes.some((n) => n.id === qId) ? qId : `topic:${topicId}`;
    canvasStore.getState().setView(projectId, "canvas");
    canvasStore.getState().openPanel(target);
  }

  return (
    <div className="absolute inset-0 overflow-y-auto bg-bg-0" data-graph-view="">
      <div className="mx-auto max-w-6xl space-y-5 px-4 py-5 pb-20">
        {/* Header & KPI metrics */}
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-12 font-medium text-fg-2">Corpus &amp; impact analytics</p>
            <h2 className="text-20 font-semibold text-fg-0">Article pipeline &amp; scholarly impact</h2>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-12 tabular-nums">
            <span className="inline-flex items-center gap-1.5 rounded-sm border border-line bg-bg-1 px-2.5 py-1 text-fg-1">
              Retrieved <strong className="text-fg-0">{fmtInt(totalRetrieved)}</strong>
            </span>
            <span className={cx("inline-flex items-center gap-1.5 rounded-sm border px-2.5 py-1", totalRendered < totalRetrieved && (states["5"] === "needs_review" || states["5"] === "approved") ? "border-warn-line bg-warn-soft text-warn" : "border-line bg-bg-1 text-fg-1")}>
              Rendered <strong className="text-fg-0">{fmtInt(totalRendered)}</strong>
            </span>
            <span className={cx("inline-flex items-center gap-1.5 rounded-sm border px-2.5 py-1", totalFiled > 0 && totalFiled >= totalSelected ? "border-ok-line bg-ok-soft text-ok" : "border-line bg-bg-1 text-fg-1")}>
              Filed <strong className="text-fg-0">{totalSelected > 0 ? `${fmtInt(totalFiled)}/${fmtInt(totalSelected)}` : fmtInt(totalFiled)}</strong>
            </span>
          </div>
        </div>

        {/* Impact KPI Cards */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          <KpiCard icon={TrendingUp} label="Total citations" value={fmtInt(impact.totalCitations)} sub={`Median ${impact.medianCitations} · Mean ${impact.meanCitations}`} />
          <KpiCard icon={Award} label="Corpus h-index" value={String(impact.hIndex)} sub={`${impact.citedPapers} of ${impact.withCitationData} cited`} />
          <KpiCard icon={Flame} label="Avg citations / yr" value={String(impact.avgCitationsPerYear)} sub={`${impact.highlyCitedCount} high-impact paper${impact.highlyCitedCount === 1 ? "" : "s"}`} />
          <KpiCard icon={BookOpen} label="Open full text" value={`${oaPct}%`} sub={`${fmtInt(impact.openAccessCount)} of ${fmtInt(totalRetrieved)} articles`} />
          <KpiCard
            icon={FileText}
            label="Top cited article"
            value={impact.topPaper ? fmtInt(impact.topPaper.citations) : "–"}
            sub={impact.topPaper ? impact.topPaper.title : "No citation counts"}
            onClick={impact.topPaper ? () => openPaper(impact.topPaper!.id) : undefined}
          />
        </div>

        {/* Topic filter pills */}
        {topics.length > 0 && (
          <div role="group" aria-label="Filter graphs by topic" className="flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              aria-pressed={selectedTopic === "all"}
              onClick={() => setSelectedTopic("all")}
              className={cx("inline-flex min-h-9 items-center gap-2 rounded-full border px-3 text-12", selectedTopic === "all" ? "border-fg-1 bg-bg-3 text-fg-0 font-medium" : "border-line bg-bg-1 text-fg-1 hover:text-fg-0")}
            >
              All topics <span className="tabular-nums text-fg-2">{fmtInt(totalRetrieved)}</span>
            </button>
            {topicStats.map((ts, i) => {
              const attn = evaluateTopicAttention(ts, states);
              const active = selectedTopic === ts.topicId;
              const ToneIcon = attn.tone === "err" ? XCircle : attn.tone === "warn" ? AlertTriangle : CheckCircle2;
              return (
                <button
                  key={ts.topicId}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setSelectedTopic(active ? "all" : ts.topicId)}
                  className={cx("inline-flex min-h-9 items-center gap-1.5 rounded-full border px-3 text-12", active ? "border-fg-1 bg-bg-3 text-fg-0 font-medium" : "border-line bg-bg-1 text-fg-1 hover:text-fg-0")}
                  title={`${ts.name}: ${ts.retrieved} retrieved, ${ts.rendered} rendered, ${ts.filed} filed · ${fmtInt(ts.totalCitations)} citations`}
                >
                  <ShapeIcon shape={topicCats[i]?.shape ?? "circle"} color={categoryVar("topic", ts.topicId, topics)} size={10} />
                  <span className="max-w-44 truncate">{ts.name}</span>
                  <span className="tabular-nums text-fg-2">{ts.retrieved}</span>
                  {(attn.tone === "err" || attn.tone === "warn" || attn.tone === "ok") && (
                    <ToneIcon className={cx("h-3 w-3 shrink-0", ATTENTION_STYLE[attn.tone].text)} strokeWidth={2} aria-hidden />
                  )}
                </button>
              );
            })}
          </div>
        )}

        {/* Main Interactive Multi-Axis Paper Impact Map */}
        <PaperMap
          points={mapPoints}
          of={selectedTopic === "all" ? papers.length : evaluated.filter((p) => p.topicIds.includes(selectedTopic)).length}
          colorBy={colorChoices.includes(view.colorBy) ? view.colorBy : "impact"}
          onColorBy={view.setColorBy}
          topics={topics}
          onOpen={openPaper}
          layers={topics.length}
          title={selectedTopic === "all" ? "Retrieved articles: year vs impact & score" : `${topics.find((t) => t.id === selectedTopic)?.name ?? "Topic"}: year vs impact`}
          dimUnselected={ranked}
          colorChoices={colorChoices}
          defaultY={ranked ? "score" : "citations"}
        />

        {/* Topic Comparison & Year / Impact Distribution Grid */}
        <div className="grid gap-5 lg:grid-cols-2">
          {/* Per-Topic Comparison Chart */}
          <section className="rounded-md border border-line bg-bg-1 p-4" aria-label="Per-topic pipeline and impact comparison">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 className="font-semibold text-fg-0">Per-topic breakdown</h3>
                <p className="text-12 text-fg-2">{topicLens === "pipeline" ? "Retrieved, rendered and filed counts with stage attention" : "Total citations, h-index and citation velocity per topic"}</p>
              </div>
              <div role="group" aria-label="Topic comparison lens" className="flex rounded-sm border border-line">
                <button type="button" aria-pressed={topicLens === "pipeline"} onClick={() => setTopicLens("pipeline")} className={cx("px-2.5 py-1 text-12", topicLens === "pipeline" ? "bg-bg-3 font-medium text-fg-0" : "text-fg-1 hover:text-fg-0")}>Pipeline</button>
                <button type="button" aria-pressed={topicLens === "impact"} onClick={() => setTopicLens("impact")} className={cx("px-2.5 py-1 text-12", topicLens === "impact" ? "bg-bg-3 font-medium text-fg-0" : "text-fg-1 hover:text-fg-0")}>Impact</button>
              </div>
            </div>

            <div className="mt-3 space-y-3">
              {topicStats.map((ts, i) => {
                const attn = evaluateTopicAttention(ts, states);
                const maxRet = Math.max(1, ...topicStats.map((x) => x.retrieved));
                const maxCites = Math.max(1, ...topicStats.map((x) => x.totalCitations));
                return (
                  <div key={ts.topicId} className="rounded-sm border border-line bg-bg-0/60 p-2.5">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <button
                        type="button"
                        onClick={() => jumpToStage(ts.topicId, attn.stage)}
                        className="flex min-w-0 items-center gap-2 text-left text-13 font-medium text-fg-0 hover:underline"
                        title={`Open ${ts.name} on the canvas`}
                      >
                        <ShapeIcon shape={topicCats[i]?.shape ?? "circle"} color={categoryVar("topic", ts.topicId, topics)} size={11} />
                        <span className="truncate">{ts.name}</span>
                      </button>
                      <AttentionBadge attention={attn} />
                    </div>

                    {topicLens === "pipeline" ? (
                      <div className="mt-2 space-y-1.5">
                        <BarRow label="Retrieved" value={ts.retrieved} max={maxRet} tone={attn.stageTones.retrieved} />
                        <BarRow label="Rendered" value={ts.rendered} max={maxRet} tone={attn.stageTones.rendered} />
                        <BarRow label="Filed" value={ts.filed} valueLabel={ts.selected > 0 && ts.filed < ts.selected ? `${ts.filed}/${ts.selected}` : String(ts.filed)} max={maxRet} tone={attn.stageTones.filed} />
                      </div>
                    ) : (
                      <div className="mt-2 space-y-1.5">
                        <div className="flex items-center gap-2 text-12">
                          <span className="w-20 shrink-0 text-fg-2">Citations</span>
                          <span className="h-2.5 flex-1 overflow-hidden rounded-sm bg-bg-2">
                            <span className="block h-full rounded-sm" style={{ width: `${Math.max(ts.totalCitations ? 4 : 0, Math.round((ts.totalCitations / maxCites) * 100))}%`, background: categoryVar("topic", ts.topicId, topics) }} />
                          </span>
                          <span className="w-14 text-right font-semibold tabular-nums text-fg-0">{fmtInt(ts.totalCitations)}</span>
                        </div>
                        <div className="flex flex-wrap gap-x-3 gap-y-1 text-12 tabular-nums text-fg-1">
                          <span>h-index <strong className="text-fg-0">{ts.hIndex}</strong></span>
                          <span>Avg <strong className="text-fg-0">{ts.avgCitationsPerYear}</strong>/yr</span>
                          <span>Peak <strong className="text-fg-0">{fmtInt(ts.maxCitations)}</strong></span>
                          <span>OA <strong className="text-fg-0">{ts.retrieved ? Math.round((ts.openAccessCount / ts.retrieved) * 100) : 0}%</strong></span>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </section>

          {/* Right column: Timeline & Impact Tiers */}
          <div className="space-y-5">
            <YearImpactChart series={yearSeries} />

            <section className="rounded-md border border-line bg-bg-1 p-4" aria-label="Citation impact tier distribution">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <h3 className="font-semibold text-fg-0">Impact tier distribution</h3>
                  <p className="text-12 text-fg-2">Click a tier to filter the map and top-articles list</p>
                </div>
                {tierFilter && (
                  <button type="button" className="btn-ghost btn-sm" onClick={() => setTierFilter(null)}>Show all</button>
                )}
              </div>
              <ul className="mt-3 space-y-1.5">
                {IMPACT_TIERS.map((tier) => {
                  const n = tierCounts.counts[tier.key] ?? 0;
                  const pct = tierCounts.total ? Math.round((n / tierCounts.total) * 100) : 0;
                  const active = tierFilter === tier.key;
                  return (
                    <li key={tier.key}>
                      <button
                        type="button"
                        aria-pressed={active}
                        onClick={() => setTierFilter(active ? null : (tier.key as ImpactTier))}
                        className={cx("grid w-full grid-cols-[minmax(0,11rem)_1fr_auto] items-center gap-2 rounded-sm px-2 py-1.5 text-left text-12", active ? "bg-bg-3 text-fg-0 font-medium" : "hover:bg-bg-2 text-fg-1")}
                        title={tier.hint}
                      >
                        <span className="flex min-w-0 items-center gap-2">
                          <ShapeIcon shape={tier.shape} color={categoryVar("impact", tier.key)} size={11} />
                          <span className="truncate">{tier.label}</span>
                        </span>
                        <span className="h-2.5 overflow-hidden rounded-sm bg-bg-2">
                          <span className="block h-full rounded-sm" style={{ width: `${n ? Math.max(3, pct) : 0}%`, background: categoryVar("impact", tier.key) }} />
                        </span>
                        <span className="w-16 text-right tabular-nums text-fg-0">{fmtInt(n)} <span className="text-fg-2">({pct}%)</span></span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>
          </div>
        </div>

        {/* Highest-Impact Retrieved Articles Table */}
        <section className="rounded-md border border-line bg-bg-1 p-4" aria-label="Highest-impact retrieved articles">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="font-semibold text-fg-0">Highest-impact retrieved articles</h3>
              <p className="text-12 text-fg-2">Evaluated by total citations, age-adjusted citations/year, study design, recency and open access</p>
            </div>
            <label className="flex items-center gap-2 text-12 text-fg-1">Sort by
              <select className="input h-8 min-h-8 w-auto py-0 text-12" value={sortBy} onChange={(e) => setSortBy(e.target.value as SortKey)}>
                <option value="citations">Total citations</option>
                <option value="velocity">Citations / year</option>
                <option value="impact">Impact index (0–100)</option>
                <option value="year">Most recent</option>
              </select>
            </label>
          </div>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[640px] text-12">
              <thead>
                <tr className="border-b border-line text-left text-fg-2">
                  <th className="py-2 pr-3 font-medium">Article</th>
                  <th className="py-2 pr-3 font-medium">Year</th>
                  <th className="py-2 pr-3 text-right font-medium">Citations</th>
                  <th className="py-2 pr-3 text-right font-medium">Cites / yr</th>
                  <th className="py-2 pr-3 text-right font-medium">Impact</th>
                  <th className="py-2 text-right font-medium">Stage</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {topPapers.map((p) => {
                  const stageTone = p.stage === "filed" ? "ok" : p.stage === "rendered" ? "run" : "neutral";
                  return (
                    <tr key={p.id} className="hover:bg-bg-2/60">
                      <td className="py-2 pr-3">
                        <button type="button" onClick={() => openPaper(p.id)} className="link text-left font-medium text-fg-0 no-underline hover:underline">
                          {p.title}
                        </button>
                        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-fg-2">
                          {p.journal && <span className="max-w-60 truncate">{p.journal}</span>}
                          {(p.oaUrl || p.pmcid) && <span className="text-ok">Open access</span>}
                          {p.topicIds[0] && (
                            <span className="inline-flex items-center gap-1">
                              <ShapeIcon shape={topicCats.find((c) => c.key === p.topicIds[0])?.shape ?? "circle"} color={categoryVar("topic", p.topicIds[0], topics)} size={9} />
                              {topics.find((t) => t.id === p.topicIds[0])?.name}
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="py-2 pr-3 tabular-nums text-fg-1">{p.year ?? "–"}</td>
                      <td className="py-2 pr-3 text-right font-semibold tabular-nums text-fg-0">{typeof p.citationCount === "number" ? fmtInt(p.citationCount) : "–"}</td>
                      <td className="py-2 pr-3 text-right tabular-nums text-fg-1">{p.evaln.citationsPerYear !== null ? p.evaln.citationsPerYear.toFixed(1) : "–"}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">
                        <span className="inline-flex items-center gap-1.5 font-medium text-fg-0">
                          <ShapeIcon shape={IMPACT_TIERS.find((x) => x.key === p.evaln.tier)?.shape ?? "ring"} color={categoryVar("impact", p.evaln.tier)} size={10} />
                          {p.evaln.score}
                        </span>
                      </td>
                      <td className="py-2 text-right">
                        <Badge tone={stageTone}>{p.stage === "filed" ? "Filed" : p.stage === "rendered" ? "Rendered" : "Retrieved"}</Badge>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  );
}

function KpiCard({ icon: Icon, label, value, sub, onClick }: { icon: typeof BarChart3; label: string; value: string; sub: string; onClick?: () => void }) {
  const inner = (
    <>
      <div className="flex items-center justify-between gap-2 text-12 text-fg-2">
        <span>{label}</span>
        <Icon className="h-4 w-4 shrink-0 text-fg-2" strokeWidth={1.5} aria-hidden />
      </div>
      <p className="mt-1 text-20 font-semibold tabular-nums text-fg-0">{value}</p>
      <p className="mt-0.5 truncate text-12 text-fg-1" title={sub}>{sub}</p>
    </>
  );
  if (onClick) {
    return (
      <button type="button" onClick={onClick} className="rounded-md border border-line bg-bg-1 p-3 text-left hover:border-line-strong hover:bg-bg-2">
        {inner}
      </button>
    );
  }
  return <div className="rounded-md border border-line bg-bg-1 p-3">{inner}</div>;
}

function BarRow({ label, value, valueLabel, max, tone }: { label: string; value: number; valueLabel?: string; max: number; tone: keyof typeof ATTENTION_STYLE }) {
  const pct = Math.min(100, Math.round((value / Math.max(1, max)) * 100));
  return (
    <div className="flex items-center gap-2 text-12">
      <span className="w-16 shrink-0 text-fg-2">{label}</span>
      <span className="h-2 flex-1 overflow-hidden rounded-full bg-bg-2">
        <span className={cx("block h-full rounded-full", ATTENTION_STYLE[tone].bar)} style={{ width: `${value > 0 ? Math.max(4, pct) : 0}%` }} />
      </span>
      <span className={cx("w-12 text-right font-semibold tabular-nums", ATTENTION_STYLE[tone].text)}>{valueLabel ?? fmtInt(value)}</span>
    </div>
  );
}

/** Dual-metric timeline: article counts per year (bars) + total citations per year (line + points). */
function YearImpactChart({ series }: { series: { year: number; count: number; citations: number; filed: number; rendered: number }[] }) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const W = 520;
  const H = 200;
  const padL = 34;
  const padR = 44;
  const padT = 18;
  const padB = 26;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;
  const maxCount = Math.max(1, ...series.map((s) => s.count));
  const maxCites = Math.max(1, ...series.map((s) => s.citations));

  if (!series.length) {
    return (
      <section className="rounded-md border border-line bg-bg-1 p-4">
        <h3 className="font-semibold text-fg-0">Publication year &amp; citation trend</h3>
        <p className="mt-2 text-12 text-fg-2">No publication years available yet.</p>
      </section>
    );
  }

  const slotW = plotW / Math.max(1, series.length);
  const barW = Math.max(6, Math.min(28, slotW * 0.62));
  const linePath = series
    .map((s, i) => {
      const x = padL + i * slotW + slotW / 2;
      const y = padT + (1 - s.citations / maxCites) * plotH;
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  const hovered = hoverIdx !== null ? series[hoverIdx] : null;

  return (
    <section className="rounded-md border border-line bg-bg-1 p-4" aria-label="Publication year and citation trend">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="font-semibold text-fg-0">Articles &amp; citations by year</h3>
          <p className="text-12 text-fg-2">Bars: articles retrieved · Line: total citations</p>
        </div>
        {hovered && (
          <span className="rounded-sm bg-bg-2 px-2 py-1 text-12 tabular-nums text-fg-0">
            <strong>{hovered.year}</strong>: {hovered.count} article{hovered.count === 1 ? "" : "s"} · {fmtInt(hovered.citations)} cites
          </span>
        )}
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="mt-2 h-[200px] w-full" role="img" aria-label="Articles and citations by publication year">
        <line x1={padL} x2={W - padR} y1={H - padB} y2={H - padB} stroke="var(--line-strong)" />
        <line x1={padL} x2={padL} y1={padT} y2={H - padB} stroke="var(--line-strong)" />
        <text x={padL - 5} y={padT + 4} textAnchor="end" fontSize="10" fill="var(--fg-2)">{maxCount}</text>
        <text x={padL - 5} y={H - padB} textAnchor="end" fontSize="10" fill="var(--fg-2)">0</text>
        <text x={W - padR + 5} y={padT + 4} textAnchor="start" fontSize="10" fill="var(--cat-2)">{fmtInt(maxCites)}</text>
        <text x={W - padR + 5} y={H - padB} textAnchor="start" fontSize="10" fill="var(--cat-2)">0</text>
        {series.map((s, i) => {
          const x = padL + i * slotW + (slotW - barW) / 2;
          const h = (s.count / maxCount) * plotH;
          const y = H - padB - h;
          const showYear = series.length <= 8 || i === 0 || i === series.length - 1 || i % Math.ceil(series.length / 6) === 0;
          return (
            <g
              key={s.year}
              onMouseEnter={() => setHoverIdx(i)}
              onMouseLeave={() => setHoverIdx(null)}
              className="cursor-pointer"
            >
              <rect x={x} y={y} width={barW} height={Math.max(2, h)} rx={2} fill="var(--cat-1)" opacity={hoverIdx === i ? 0.95 : 0.55}>
                <title>{`${s.year}: ${s.count} articles, ${fmtInt(s.citations)} total citations`}</title>
              </rect>
              {showYear && (
                <text x={x + barW / 2} y={H - 8} textAnchor="middle" fontSize="10" fill="var(--fg-2)">{s.year}</text>
              )}
            </g>
          );
        })}
        {series.length > 1 && <path d={linePath} fill="none" stroke="var(--cat-2)" strokeWidth={2} />}
        {series.map((s, i) => {
          const cx0 = padL + i * slotW + slotW / 2;
          const cy0 = padT + (1 - s.citations / maxCites) * plotH;
          return (
            <circle
              key={`pt-${s.year}`}
              cx={cx0}
              cy={cy0}
              r={hoverIdx === i ? 5 : 3.5}
              fill="var(--cat-2)"
              stroke="var(--bg-1)"
              strokeWidth={1.5}
              onMouseEnter={() => setHoverIdx(i)}
              onMouseLeave={() => setHoverIdx(null)}
            />
          );
        })}
      </svg>
    </section>
  );
}
