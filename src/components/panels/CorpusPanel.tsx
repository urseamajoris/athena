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
import type { MapPoint } from "../viz/paper-points";

const PaperMap = dynamic(() => import("../viz/PaperMap").then((m) => m.PaperMap), { ssr: false });

interface PointsData { topics: { id: string; name: string }[]; papers: { id: string; title: string; year: number | null; publicationTypes: string[]; sourceDatabases: string[]; studyType: string | null; topicIds: string[] }[] }

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

/** Corpus node: watch retrieval live (SSE), then review deduplication. */
export function CorpusPanel() {
  const { projectId, graph, input, states, openPaper } = useSession();
  const live = useLiveRetrieval();
  const running = states["4"] === "running";
  const view = useViewPrefs();
  const [articleOnly, setArticleOnly] = useState<string | null>(null);
  const { data: pts } = useApi<PointsData>(projectPath(projectId, "papers-points"), { refreshInterval: running ? 2500 : 0 });
  const { data: fetched, error, mutate } = useApi<RetrievalData>(projectPath(projectId, "retrieval"));
  useJobRefresh(4, mutate);
  const { data: status } = useApi<{ maxResultsPerQuery?: number }>("/api/status");
  const data = (live as RetrievalData | null) ?? fetched;
  if (error && !data) return <ErrorState error={error} onRetry={() => mutate()} />;
  const runs = data?.runs ?? [];
  const failed = runs.filter((r) => r.status === "failed");
  const fetchedTotal = runs.reduce((a, r) => a + r.fetchedCount, 0);
  const sources = [...new Set(runs.map((r) => r.database))];
  // Results collected per search: what the searches ran with, else the server's current setting.
  const cap = runs.find((r) => r.cap)?.cap ?? status?.maxResultsPerQuery ?? null;
  const capLine = cap ? `Athena collects the ${cap} most relevant results of each search; the rest are not looked at.` : null;
  const node = graph.nodes.find((n) => n.id === "corpus");
  const action = node ? nextAction(node, graph, input) : null;
  let cumulative = 0;
  const ps = pts?.papers ?? [];
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
  // Article type has no hue (only "Colour by" dimensions do), so it filters the chart from its mix bars instead.
  const chartPs = articleOnly ? ps.filter((p) => articleTypeOf(p.publicationTypes) === articleOnly) : ps;
  const points: MapPoint[] = chartPs.map((p) => ({
    id: p.id,
    title: p.title,
    year: p.year,
    score: null,
    layer: Math.max(-1, topicList.findIndex((t) => p.topicIds.includes(t.id))),
    cat: view.colorBy === "topic" ? p.topicIds[0] ?? "" : view.colorBy === "source" ? sourceOf(p.sourceDatabases) : p.studyType ? studyGroupOf(p.studyType) : studyGroupFromLabels(p.publicationTypes),
  }));
  return (
    <div className="space-y-4">
      <StaleNotice stage={4} />
      <JobStatus stage={4} />
      <WhatHappens stage={4} />
      {runs.length > 0 && (
        <p className="text-fg-0" aria-live="polite">
          {running ? "So far: " : ""}<span className="font-semibold tabular-nums">{fmtInt(fetchedTotal)}</span> results fetched, <span className="font-semibold tabular-nums">{fmtInt(dupes)}</span> were the same paper found twice, so <span className="font-semibold tabular-nums">{fmtInt(data?.uniquePapers ?? 0)}</span> different papers {running ? "so far" : "remain"}.
          {capLine && <span className="block text-12 text-fg-1">{capLine}</span>}
        </p>
      )}
      <div className="grid grid-cols-2 gap-2">
        <Stat label="Different papers" value={fmtInt(data?.uniquePapers ?? 0)} />
        <Stat label="Duplicates merged" value={fmtInt(dupes)} />
      </div>
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
        <PaperMap points={points} of={ps.length} colorBy={view.colorBy === "topic" || view.colorBy === "source" ? view.colorBy : "study"} onColorBy={view.setColorBy} topics={topicList} onOpen={openPaper} layers={topicList.length} title={running ? "Papers as they arrive" : "The papers found"} colorChoices={["study", "topic", "source"]} />
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
        <p className="mb-2 text-12 text-fg-2">“Hits” is how many papers match the search in the database; “Fetched” is how many Athena collected{cap ? ` (at most ${cap}, the most relevant first)` : ""}. “New” counts papers no earlier search had found. When it drops toward zero, more searches only return papers you already have.</p>
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
