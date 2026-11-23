"use client";
import { useState } from "react";
import { AlertTriangle, Check } from "lucide-react";
import { projectPath, useApi } from "../api";
import { Badge, ErrorState, ProgressBar, cx } from "../ui";
import { Disclosure } from "../disclosure";
import { useJobRefresh, useLiveRetrieval, useSession } from "../session/SessionContext";
import { ActionButton, JobLog, JobStatus, PanelFooter, Stat, StaleNotice } from "./common";
import { nextAction } from "@/lib/canvas/actions";
import { fmtInt } from "@/lib/shared/format";
import dynamic from "next/dynamic";
import { WhatHappens } from "../guide/WhatHappens";
import { ShapeIcon } from "../categories";
import { useViewPrefs } from "../session/viewPrefs";
import { ARTICLE_TYPES, STUDY_GROUPS, hasHues, articleTypeOf, categoryVar, sourceOf, studyGroupFromLabels, studyGroupOf, type Category, type Dimension } from "@/lib/shared/categories";
import { paperImpactEvaluation } from "@/lib/shared/impact";
import { evaluateQueryAttention, evaluateTopicAttention, type CorpusImpactSummary, type QueryPaperStats, type TopicArticleStats } from "@/lib/shared/canvas";
import { ArticlePipelineStrip, AttentionBadge } from "../canvas/node-bits";
import type { MapPoint } from "../viz/paper-points";

const PaperMap = dynamic(() => import("../viz/PaperMap").then((m) => m.PaperMap), { ssr: false });

interface PointsData {
  topics: { id: string; name: string }[];
  topicStats?: TopicArticleStats[];
  impact?: CorpusImpactSummary;
  papers: {
    id: string;
    title: string;
    year: number | null;
    citationCount?: number | null;
    oaUrl?: string | null;
    pmcid?: string | null;
    publicationTypes: string[];
    sourceDatabases: string[];
    studyType: string | null;
    topicIds: string[];
  }[];
}

/**
 * The mix of a category among the papers so far (bars with shape, colour and count: never colour alone). With
 * `onPick`, each row is a toggle that shows only that category in the chart (pressed: tick and bold, not colour).
 */
function Mix({ title, cats, dim, counts, total, note, picked, onPick }: { title: string; cats: Category[]; dim: Dimension; counts: Record<string, number>; total: number; note?: string; picked?: string | null; onPick?: (key: string | null) => void }) {
  const row = (c: Category) => (
    <>
      <span className="flex min-w-0 items-center gap-2 text-fg-1">
        {onPick && (picked === c.key ? <Check className="h-3 w-3 shrink-0 text-fg-0" strokeWidth={2} aria-hidden /> : <span className="w-3 shrink-0" aria-hidden />)}
        {hasHues(dim) && <ShapeIcon shape={c.shape} color={categoryVar(dim, c.key)} />}
        <span className={cx("min-w-0 break-words leading-tight", picked === c.key && "font-semibold text-fg-0")}>{c.label}</span>
      </span>
      <span className="h-2.5 rounded-sm bg-bg-2" aria-hidden><span className="block h-2.5 rounded-r-[4px]" style={{ width: `${Math.max(3, (counts[c.key] / Math.max(1, total)) * 100)}%`, background: categoryVar(dim, c.key) }} /></span>
      <span className="tabular-nums text-fg-0">{counts[c.key]}</span>
    </>
  );
  const grid = "grid w-full grid-cols-[minmax(0,12rem)_1fr_auto] items-center gap-2 text-12";
  return (
    <section aria-label={title}>
      <p className="text-12 font-medium text-fg-1">{title}</p>
      <ul className="mt-1 space-y-1">
        {cats.filter((c) => counts[c.key]).map((c) => (
          <li key={c.key} className={onPick ? undefined : grid}>
            {onPick ? (
              <button type="button" className={cx(grid, "min-h-11 rounded-sm px-1 text-left hover:bg-bg-2 md:min-h-8")} aria-pressed={picked === c.key} onClick={() => onPick(picked === c.key ? null : c.key)}>
                {row(c)}
              </button>
            ) : row(c)}
          </li>
        ))}
      </ul>
      {note && <p className="mt-1 text-12 text-fg-2">{note}</p>}
    </section>
  );
}

interface Run { id: string; database: string; topicName: string; queryString: string; status: string; resultCount: number | null; fetchedCount: number; newUniqueCount: number; cap: number; error: string | null }
interface RetrievalData { uniquePapers: number; runs: Run[] }
const DB: Record<string, string> = { pubmed: "PubMed", openalex: "OpenAlex" };

/** Corpus node: watch retrieval live (SSE), inspect per-topic and per-query retrieved papers & attention. */
export function CorpusPanel({ topicId, queryId, attentionOnly = false }: { topicId?: string; queryId?: string; attentionOnly?: boolean } = {}) {
  const { projectId, graph, input, states, openPaper, summary } = useSession();
  const [showAll, setShowAll] = useState(false);
  const [onlyAttn, setOnlyAttn] = useState(attentionOnly);
  const live = useLiveRetrieval();
  const running = states["4"] === "running";
  const view = useViewPrefs();
  const [articleOnly, setArticleOnly] = useState<string | null>(null);
  const { data: pts } = useApi<PointsData>(projectPath(projectId, "papers-points"), { refreshInterval: running ? 2500 : 0 });
  const { data: fetched, error, mutate } = useApi<RetrievalData>(projectPath(projectId, "retrieval"));
  useJobRefresh(4, mutate);
  const data = (live as RetrievalData | null) ?? fetched;
  if (error && !data) return <ErrorState error={error} onRetry={() => mutate()} />;
  const runs = data?.runs ?? [];
  const failed = runs.filter((r) => r.status === "failed");
  const fetchedTotal = runs.reduce((a, r) => a + r.fetchedCount, 0);
  const sources = [...new Set(runs.map((r) => r.database))];
  const node = graph.nodes.find((n) => (topicId ? n.id === `corpus:topic:${topicId}` : n.id === "corpus")) ?? graph.nodes.find((n) => n.kind === "topic_corpus" || n.id === "corpus");
  const action = node ? nextAction(node, graph, input) : null;
  let cumulative = 0;
  const activeTopicId = showAll ? undefined : topicId;
  const activeQueryId = showAll ? undefined : queryId;
  const allQueryStats: QueryPaperStats[] = summary?.queryStats ?? [];
  const scopedQueries = activeQueryId
    ? allQueryStats.filter((q) => q.queryId === activeQueryId)
    : activeTopicId
      ? allQueryStats.filter((q) => q.topicId === activeTopicId)
      : allQueryStats;
  const scopedTopicName = activeTopicId ? summary?.topics.find((t) => t.id === activeTopicId)?.name : undefined;
  const psAll = pts?.papers ?? [];
  const ps = activeTopicId ? psAll.filter((p) => p.topicIds.includes(activeTopicId)) : psAll;
  const summarised = ps.some((p) => p.studyType);
  const studyCounts: Record<string, number> = {};
  const articleCounts: Record<string, number> = {};
  for (const p of ps) {
    const g = p.studyType ? studyGroupOf(p.studyType) : studyGroupFromLabels(p.publicationTypes);
    studyCounts[g] = (studyCounts[g] ?? 0) + 1;
    const a = articleTypeOf(p.publicationTypes);
    articleCounts[a] = (articleCounts[a] ?? 0) + 1;
  }
  const dupes = Math.max(0, fetchedTotal - (data?.uniquePapers ?? 0));
  const topicList = pts?.topics ?? [];
  const topicStats = pts?.topicStats ?? [];
  const impact = pts?.impact;
  // Article type has no hue (only "Colour by" dimensions do), so it filters the chart from its mix bars instead.
  const chartPs = articleOnly ? ps.filter((p) => articleTypeOf(p.publicationTypes) === articleOnly) : ps;
  const points: MapPoint[] = chartPs.map((p) => {
    const evaln = paperImpactEvaluation({ ...p, citationCount: p.citationCount ?? null });
    return {
      id: p.id,
      title: p.title,
      year: p.year,
      score: null,
      layer: Math.max(-1, topicList.findIndex((t) => p.topicIds.includes(t.id))),
      cat:
        view.colorBy === "topic"
          ? p.topicIds[0] ?? ""
          : view.colorBy === "impact"
            ? evaln.tier
            : view.colorBy === "source"
              ? sourceOf(p.sourceDatabases)
              : p.studyType
                ? studyGroupOf(p.studyType)
                : studyGroupFromLabels(p.publicationTypes),
      citations: p.citationCount ?? null,
      citationsPerYear: evaln.citationsPerYear,
      impactScore: evaln.score,
      impactTier: evaln.tier,
      openAccess: !!(p.oaUrl || p.pmcid),
    };
  });
  return (
    <div className="space-y-4">
      <StaleNotice stage={4} />
      <JobStatus stage={4} />
      <WhatHappens stage={4} />
      {(activeTopicId || activeQueryId) && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-line-strong bg-bg-2 px-3 py-2 text-12">
          <span className="text-fg-0">
            Filtered to <strong>{scopedQueries.length === 1 && activeQueryId ? `${scopedQueries[0].label} (${scopedTopicName ?? "Topic"})` : scopedTopicName ?? "this topic"}</strong>
          </span>
          <button type="button" className="btn-ghost btn-sm" onClick={() => setShowAll(true)}>
            Show all topics
          </button>
        </div>
      )}
      {scopedQueries.length > 0 && (
        <section aria-label="Per-query retrieval and attention" className="space-y-3 rounded-md border border-line bg-bg-0/60 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="font-medium text-fg-0">Papers by query &amp; user attention</p>
            <div className="flex items-center gap-1 text-12">
              <button
                type="button"
                aria-pressed={!onlyAttn}
                onClick={() => setOnlyAttn(false)}
                className={cx("rounded-sm px-2 py-0.5", !onlyAttn ? "bg-bg-3 font-medium text-fg-0" : "text-fg-2 hover:text-fg-0")}
              >
                All
              </button>
              <button
                type="button"
                aria-pressed={onlyAttn}
                onClick={() => setOnlyAttn(true)}
                className={cx("rounded-sm px-2 py-0.5", onlyAttn ? "bg-warn-soft font-medium text-warn" : "text-fg-2 hover:text-fg-0")}
              >
                Needs attention
              </button>
            </div>
          </div>
          <ul className="space-y-3">
            {scopedQueries.map((qs) => {
              const qAttn = evaluateQueryAttention(qs, states);
              const list = (qs.papers ?? []).filter((p) => !onlyAttn || p.needsAttention);
              return (
                <li key={qs.queryId} className="space-y-2 rounded-sm border border-line bg-bg-1 p-2.5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-medium text-fg-0">{qs.label}</span>
                    <AttentionBadge attention={qAttn} compact />
                  </div>
                  <div className="flex flex-wrap gap-x-3 gap-y-1 text-12 tabular-nums text-fg-1">
                    <span><strong className="text-fg-0">{fmtInt(qs.retrieved)}</strong> retrieved</span>
                    <span><strong className="text-fg-0">{fmtInt(qs.newUnique)}</strong> new unique</span>
                    <span className={qs.needsAttention > 0 ? "text-warn" : "text-ok"}>
                      <strong>{fmtInt(qs.needsAttention)}</strong> need attention
                    </span>
                  </div>
                  {qs.needsAttention > 0 && (
                    <p className="text-12 text-fg-2">{qAttn.detail}</p>
                  )}
                  {list.length > 0 ? (
                    <ul className="divide-y divide-line border-t border-line pt-1">
                      {list.slice(0, 8).map((p) => (
                        <li key={p.id}>
                          <button
                            type="button"
                            onClick={() => openPaper(p.id)}
                            className="flex w-full items-center gap-2 py-1.5 text-left text-12 hover:bg-bg-2"
                          >
                            {p.needsAttention && <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-warn" aria-hidden />}
                            <span className="min-w-0 flex-1 truncate text-fg-0">{p.title}</span>
                            {p.attentionReason ? (
                              <Badge tone={p.failedAppraisal ? "err" : "warn"}>{p.attentionReason}</Badge>
                            ) : p.year ? (
                              <span className="shrink-0 tabular-nums text-fg-2">{p.year}</span>
                            ) : null}
                          </button>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-12 text-fg-2">{onlyAttn ? "No papers needing attention in this query." : "No papers retrieved for this query yet."}</p>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}
      {runs.length > 0 && (
        <p className="text-fg-0" aria-live="polite">
          {running ? "So far: " : ""}<span className="font-semibold tabular-nums">{fmtInt(fetchedTotal)}</span> results fetched, <span className="font-semibold tabular-nums">{fmtInt(dupes)}</span> were the same paper found twice, so <span className="font-semibold tabular-nums">{fmtInt(data?.uniquePapers ?? 0)}</span> different papers {running ? "so far" : "remain"}.
        </p>
      )}
      <div className="grid grid-cols-2 gap-2">
        <Stat label="Different papers" value={fmtInt(data?.uniquePapers ?? 0)} />
        <Stat label="Duplicates merged" value={fmtInt(dupes)} />
        {impact && impact.withCitationData > 0 && (
          <>
            <Stat label="Total citations" value={fmtInt(impact.totalCitations)} />
            <Stat label="Corpus h-index · cites/yr" value={`h-${impact.hIndex} · ${impact.avgCitationsPerYear}/y`} />
          </>
        )}
      </div>
      {topicStats.length > 0 && (
        <section aria-label="Per-topic article status" className="space-y-2 rounded-md border border-line bg-bg-1 p-3">
          <p className="font-medium">Articles by topic (retrieved · rendered · filed)</p>
          <ul className="space-y-2.5">
            {topicStats.map((ts) => {
              const attn = evaluateTopicAttention(ts, states);
              return (
                <li key={ts.topicId} className="space-y-1">
                  <div className="flex items-center justify-between gap-2 text-12">
                    <span className="min-w-0 flex-1 truncate font-medium text-fg-0">{ts.name}</span>
                    <AttentionBadge attention={attn} compact />
                  </div>
                  <ArticlePipelineStrip
                    retrieved={ts.retrieved}
                    rendered={ts.rendered}
                    filed={ts.filed}
                    selected={ts.selected}
                    stageTones={attn.stageTones}
                    totalCitations={ts.totalCitations}
                    hIndex={ts.hIndex}
                  />
                </li>
              );
            })}
          </ul>
        </section>
      )}
      {ps.length > 0 && (
        <div className="space-y-3 rounded-md border border-line bg-bg-1 p-3">
          <p className="font-medium">What kinds of papers you are getting</p>
          <Mix
            title="Article type (from the databases)"
            cats={ARTICLE_TYPES}
            dim="article"
            counts={articleCounts}
            total={ps.length}
            picked={articleOnly}
            onPick={setArticleOnly}
            note="Click or tap an article type to show only those papers in the chart below. The summary table in the next step filters by article type and study type too."
          />
          {articleOnly && (
            <p role="status" className="text-12 text-fg-1">
              Chart: showing {chartPs.length} of {ps.length}: {(ARTICLE_TYPES.find((a) => a.key === articleOnly)?.label ?? articleOnly).toLowerCase()}. {ps.length - chartPs.length} papers are hidden from the chart (still in the review).{" "}
              <button type="button" className="btn-ghost btn-sm min-h-8" onClick={() => setArticleOnly(null)}>Show all</button>
            </p>
          )}
          <Mix
            title={summarised ? "Study type (AI-derived from the abstracts)" : "Study type (only where the database labels it)"}
            cats={STUDY_GROUPS}
            dim="study"
            counts={studyCounts}
            total={ps.length}
            note={summarised ? undefined : "Most papers have no design label yet; the AI reads every abstract in the next step."}
          />
        </div>
      )}
      {ps.length > 0 && (
        <PaperMap points={points} of={ps.length} colorBy={view.colorBy === "topic" || view.colorBy === "source" || view.colorBy === "impact" ? view.colorBy : "study"} onColorBy={view.setColorBy} topics={topicList} onOpen={openPaper} layers={topicList.length} title={running ? "Papers as they arrive" : "The papers found (year vs impact)"} colorChoices={["study", "topic", "impact", "source"]} defaultY="citations" />
      )}
      <section aria-label="Per source">
        <ul className="space-y-3">
          {sources.map((db) => {
            const rs = runs.filter((r) => r.database === db);
            const done = rs.filter((r) => r.status === "done" || r.status === "failed").length;
            const f = rs.reduce((a, r) => a + r.fetchedCount, 0);
            const nu = rs.reduce((a, r) => a + r.newUniqueCount, 0);
            return (
              <li key={db}>
                <div className="mb-1 flex items-center justify-between gap-2">
                  <span className="font-medium">{DB[db] ?? db}</span>
                  <span className="text-12 tabular-nums text-fg-1">{fmtInt(f)} fetched · {fmtInt(nu)} new · {done} of {rs.length} searches done</span>
                </div>
                <ProgressBar value={done} max={rs.length} label={`${DB[db] ?? db} queries finished`} />
              </li>
            );
          })}
        </ul>
        {!runs.length && <p className="text-fg-2">No queries have run yet.</p>}
      </section>
      {failed.length > 0 && (
        <div role="alert" className="flex items-start gap-2 rounded-md border border-err-line px-3 py-2">
          <AlertTriangle className="mt-1 h-4 w-4 shrink-0 text-err" strokeWidth={1.5} aria-hidden />
          <p><strong className="text-err">{failed.length} quer{failed.length === 1 ? "y" : "ies"} failed</strong> ({[...new Set(failed.map((r) => DB[r.database] ?? r.database))].join(", ")}). The other sources continued, so you can go on with the papers that were found, or re-run later from ⋯.</p>
        </div>
      )}
      <Disclosure title="Search by search" meta={`${runs.length} searches`}>
        <p className="mb-2 text-12 text-fg-2">“New” counts papers no earlier search had found. When it drops toward zero, more searches only return papers you already have.</p>
        <table className="w-full text-12">
          <thead>
            <tr className="border-b border-line text-left text-fg-2">
              <th className="py-1 pr-2 font-medium">Query</th>
              <th className="pr-2 text-right font-medium">Hits</th>
              <th className="pr-2 text-right font-medium">Fetched</th>
              <th className="pr-2 text-right font-medium">New</th>
              <th className="text-right font-medium">Total</th>
            </tr>
          </thead>
          <tbody>
            {runs.map((r) => {
              cumulative += r.newUniqueCount;
              return (
                <tr key={r.id} className="border-b border-line align-top">
                  <td className="py-2 pr-2">
                    <span className="block text-fg-0">{r.topicName}</span>
                    <span className="text-fg-2">{DB[r.database] ?? r.database}{r.status !== "done" ? ` · ${r.status}` : ""}</span>
                  </td>
                  <td className="pr-2 text-right tabular-nums">{r.resultCount == null ? "–" : fmtInt(r.resultCount)}</td>
                  <td className="pr-2 text-right tabular-nums">{r.fetchedCount}</td>
                  <td className="pr-2 text-right tabular-nums">{r.newUniqueCount}</td>
                  <td className="text-right tabular-nums text-fg-1">{cumulative}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Disclosure>
      {failed.length > 0 && (
        <Disclosure title="Failed queries" meta={`${failed.length}`}>
          <ul className="space-y-2">
            {failed.map((r) => (
              <li key={r.id}>
                <Badge tone="err">failed</Badge> <span className="font-medium">{r.topicName}</span> · {DB[r.database] ?? r.database}
                <code className="mt-1 block break-words font-mono text-12 text-fg-1">{r.queryString}</code>
                <p className="text-12 text-err">{r.error}</p>
              </li>
            ))}
          </ul>
        </Disclosure>
      )}
      <JobLog stage={4} />
      {action && (
        <PanelFooter>
          <ActionButton action={action} primary showReason />
        </PanelFooter>
      )}
    </div>
  );
}
