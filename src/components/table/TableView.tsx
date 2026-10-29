"use client";
import { Fragment, memo, useMemo, useRef, useState, type ReactNode } from "react";
import { createColumnHelper, flexRender, getCoreRowModel, getSortedRowModel, useReactTable, type ColumnDef, type OnChangeFn, type Row as TableRow, type SortingState, type VisibilityState } from "@tanstack/react-table";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Popover } from "radix-ui";
import { ArrowDown, ArrowUp, ArrowUpDown, CheckCircle2, ChevronDown, ChevronRight, LayoutList, Map as MapIcon, RotateCcw, SlidersHorizontal } from "lucide-react";
import dynamic from "next/dynamic";
import { api, projectPath, useApi } from "../api";
import { AbstractBadge, Badge, EmptyState, ErrorState, Loading, cx } from "../ui";
import { Disclosure } from "../disclosure";
import { canvasStore, useCanvas, useJobRefresh, useSession } from "../session/SessionContext";
import { JobStatus, StaleNotice } from "../panels/common";
import { useViewPrefs } from "../session/viewPrefs";
import { CategoryChip, ShapeIcon } from "../categories";
import { Checklist } from "../guide/Checklist";
import { WhatHappens } from "../guide/WhatHappens";
import { RUBRIC, STUDY_TYPES, STUDY_TYPE_LABEL, type StudyType } from "@/lib/shared/stages";
import { ARTICLE_TYPES, DIMENSIONS, hasHues, accessOf, articleTypeOf, categoriesFor, categoryVar, describeFilters, evidenceOf, periodOf, scoreBandOf, sourceOf, studyGroupOf, type ColorBy, type Dimension } from "@/lib/shared/categories";
import { sessionOf } from "@/lib/canvas/store";
import type { MapPoint } from "../viz/paper-points";

const PaperMap = dynamic(() => import("../viz/PaperMap").then((m) => m.PaperMap), { ssr: false, loading: () => <Loading label="Loading the map…" /> });

interface Paper {
  id: string; title: string; authors: string[]; year: number | null; journal: string | null; citationCount: number | null; oaUrl: string | null; pmcid?: string | null; sourceDatabases: string[]; publicationTypes?: string[]; doi: string | null; pmid: string | null; openalexId: string | null; hasAbstract: boolean;
  summary: { studyType: string; setting: string; keyFinding: string; edited: boolean } | null;
  topicIds: string[];
  appraisal?: { textSource: string; unverified: number } | null;
}
interface Score { id: string; paperId: string; topicId: string; total: number; selected: boolean; userChanged: boolean; rationale: string }
type SwapChoice = Score & { title: string };
interface RankingData { topics: { id: string; name: string; importanceRank: number | null; importanceJustification: string | null; scores: Score[] }[] }
interface PapersData { topics: { id: string; name: string }[]; papers: Paper[] }

export interface Row extends Paper {
  score: Score | null;
  rank: number | null;
  selectedIn: number;
  /** Category key per dimension (filters, grouping, colour). */
  cats: Record<Dimension, string[]>;
}

/** Every category a paper belongs to, per dimension (a paper can be in several topics). */
function categorize(p: Paper, selectedIn: number): Record<Dimension, string[]> {
  return {
    study: [studyGroupOf(p.summary?.studyType)],
    article: [articleTypeOf(p.publicationTypes)],
    topic: p.topicIds,
    source: [sourceOf(p.sourceDatabases)],
    period: [periodOf(p.year)],
    access: [accessOf(p)],
    selected: [selectedIn > 0 ? "selected" : "not_selected"],
    evidence: [evidenceOf(p.appraisal)],
  };
}

type Field = "setting" | "keyFinding" | "studyType";
const ch = createColumnHelper<Row>();
const DEFAULT_HIDDEN: VisibilityState = { authors: false, journal: false, setting: false, citationCount: false, access: false, source: false, article: false };
/** Fixed column widths: with table-layout fixed, a row's height depends only on its own content, which keeps
 *  the virtualizer's measurements stable (auto layout re-flows every column as rows scroll in and out). */
const COL_W: Record<string, string> = { expand: "48px", select: "48px", rank: "64px", score: "128px", authors: "160px", year: "72px", journal: "180px", studyType: "180px", article: "170px", setting: "220px", keyFinding: "32%", citationCount: "72px", access: "80px", source: "112px" };

/** Full-screen summary + ranking table: rank and pick papers for appraisal. */
export function TableView() {
  const { projectId, states, confirmEdit, refresh, openPaper } = useSession();
  const papers = useApi<PapersData>(projectPath(projectId, "papers"));
  const ranking = useApi<RankingData>(projectPath(projectId, "ranking"));
  useJobRefresh(5, papers.mutate);
  useJobRefresh(6, ranking.mutate);
  const [topic, setTopic] = useState<string>("all");
  const [q, setQ] = useState("");
  const view = useViewPrefs();
  const [mode, setMode] = useState<"table" | "map">("table");
  const seen = useCanvas((s) => sessionOf(s, projectId).seen);
  const mark = (f: string) => canvasStore.getState().markSeen(projectId, f);
  const [sorting, setSorting] = useState<SortingState>([]);
  const [visibility, setVisibility] = useState<VisibilityState>(DEFAULT_HIDDEN);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<{ id: string; field: Field } | null>(null);
  const [err, setErr] = useState<unknown>(null);
  const ranked = (ranking.data?.topics ?? []).some((t) => t.scores.length);

  // Every paper with its categories (before any filter), then the filters as a non-destructive view.
  const allRows: Row[] = useMemo(() => {
    const ps = papers.data?.papers ?? [];
    const rt = ranking.data?.topics ?? [];
    const scoresByPaper = new Map<string, Score[]>();
    for (const t of rt) for (const s of t.scores) scoresByPaper.set(s.paperId, [...(scoresByPaper.get(s.paperId) ?? []), s]);
    const rankOf = new Map<string, number>();
    for (const t of rt) t.scores.forEach((s, i) => rankOf.set(s.id, i + 1));
    return ps
      .filter((p) => (topic === "all" ? true : p.topicIds.includes(topic) || (scoresByPaper.get(p.id) ?? []).some((s) => s.topicId === topic)))
      .map((p) => {
        const all = scoresByPaper.get(p.id) ?? [];
        const score = topic === "all" ? [...all].sort((a, b) => b.total - a.total)[0] ?? null : all.find((s) => s.topicId === topic) ?? null;
        const selectedIn = all.filter((s) => s.selected).length;
        return { ...p, score, rank: score && topic !== "all" ? rankOf.get(score.id) ?? null : null, selectedIn, cats: categorize(p, selectedIn) };
      });
  }, [papers.data, ranking.data, topic]);
  const activeFilters = (Object.entries(view.filters) as [Dimension, string[]][]).filter(([, k]) => k?.length);
  const rows: Row[] = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return allRows
      .filter((r) => activeFilters.every(([dim, keys]) => r.cats[dim].some((k) => keys.includes(k))))
      .filter((p) => !needle || `${p.title} ${p.authors.join(" ")} ${p.journal ?? ""} ${p.summary?.setting ?? ""} ${p.summary?.keyFinding ?? ""}`.toLowerCase().includes(needle));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allRows, q, JSON.stringify(view.filters)]);

  async function toggle(s: Score) {
    if (!(await confirmEdit(6))) return;
    setErr(null);
    try {
      await ranking.mutate(await api<RankingData>(projectPath(projectId, "ranking/select"), { body: { scoreId: s.id, selected: !s.selected } }), { revalidate: false });
      await refresh();
    } catch (e) {
      setErr(e);
    }
  }
  async function swap(outId: string, inId: string) {
    if (!(await confirmEdit(6))) return;
    try {
      await ranking.mutate(await api<RankingData>(projectPath(projectId, "ranking/swap"), { body: { outId, inId } }), { revalidate: false });
      await refresh();
    } catch (e) {
      setErr(e);
    }
  }
  async function saveCell(id: string, field: Field, value: string) {
    setEditing(null);
    try {
      await api(projectPath(projectId, `papers/${id}/summary`), { method: "PATCH", body: { [field]: value } });
      await papers.mutate();
      await refresh();
    } catch (e) {
      setErr(e);
    }
  }

  const aiCell = (field: Field, label: string) =>
    ch.accessor((r) => (field === "studyType" ? r.summary?.studyType : r.summary?.[field]) ?? "", {
      id: field,
      header: label,
      cell: (c) => <AiCell row={c.row.original} field={field} editing={editing} setEditing={setEditing} onSave={saveCell} />,
    });

  const columns = useMemo(
    () => [
      ch.display({
        id: "expand",
        header: () => <span className="sr-only">Details</span>,
        cell: (c) => (
          <button className="btn-ghost h-11 w-11 px-0 md:h-8 md:w-8" aria-expanded={expanded.has(c.row.original.id)} aria-label={`${expanded.has(c.row.original.id) ? "Hide" : "Show"} details for ${c.row.original.title}`} onClick={() => { mark(ranked ? "opened-score" : "opened-paper"); setExpanded((e) => { const n = new Set(e); if (n.has(c.row.original.id)) n.delete(c.row.original.id); else n.add(c.row.original.id); return n; }); }}>
            {expanded.has(c.row.original.id) ? <ChevronDown className="h-4 w-4" strokeWidth={1.5} aria-hidden /> : <ChevronRight className="h-4 w-4" strokeWidth={1.5} aria-hidden />}
          </button>
        ),
      }),
      ...(ranked && topic !== "all"
        ? [
            ch.display({
              id: "select",
              header: () => <span title="Selected for appraisal">Keep</span>,
              cell: (c) => c.row.original.score && <label className="inline-flex h-11 w-11 items-center justify-center md:h-8 md:w-8"><input type="checkbox" checked={c.row.original.score.selected} onChange={() => toggle(c.row.original.score!)} aria-label={`${c.row.original.score.selected ? "Deselect" : "Select"} ${c.row.original.title}`} /></label>,
            }),
            // Papers not scored for this topic have no rank: undefined (not null) so they sort after rank 1, 2, …
            ch.accessor((r) => r.rank ?? undefined, { id: "rank", header: "Rank", sortUndefined: "last", cell: (c) => <span className="tabular-nums text-fg-1">{c.getValue() ?? "–"}</span> }),
          ]
        : []),
      ...(ranked ? [ch.accessor((r) => r.score?.total ?? -1, { id: "score", header: topic === "all" ? "Best score" : "Score", cell: (c) => <ScoreCell row={c.row.original} all={topic === "all"} /> })] : []),
      ch.accessor("title", { header: "Title", cell: (c) => <button className="link min-h-11 text-left font-medium no-underline hover:underline md:min-h-0" onClick={() => { mark("opened-paper"); openPaper(c.row.original.id); }}>{c.getValue()}</button> }),
      ch.accessor((r) => r.authors[0] ?? "", { id: "authors", header: "Authors", cell: (c) => <span className="text-12 text-fg-1">{c.getValue() || "–"}{c.row.original.authors.length > 1 ? " et al." : ""}</span> }),
      ch.accessor((r) => r.year ?? 0, { id: "year", header: "Year", cell: (c) => <span className="tabular-nums">{c.row.original.year ?? "–"}</span> }),
      ch.accessor((r) => r.journal ?? "", { id: "journal", header: "Journal", cell: (c) => <span className="text-12 text-fg-1">{c.getValue() || "–"}</span> }),
      aiCell("studyType", "Study type"),
      ch.accessor((r) => r.cats.article[0], { id: "article", header: "Article type", cell: (c) => <CategoryChip dim="article" value={c.getValue()} /> }),
      aiCell("setting", "Setting / population"),
      aiCell("keyFinding", "Key finding"),
      ch.accessor((r) => r.citationCount ?? -1, { id: "citationCount", header: "Cites", cell: (c) => <span className="tabular-nums">{c.row.original.citationCount ?? "–"}</span> }),
      ch.display({ id: "access", header: "Access", cell: (c) => (c.row.original.oaUrl ? <a href={c.row.original.oaUrl} target="_blank" rel="noreferrer" className="link text-12">open</a> : <span className="text-12 text-fg-2">–</span>) }),
      ch.display({ id: "source", header: "Source", cell: (c) => <span className="flex flex-col gap-1">{c.row.original.sourceDatabases.map((d) => <Badge key={d}>{d}</Badge>)}</span> }),
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [ranked, topic, expanded, editing],
  );

  // A stable sorting value: a new array each render makes TanStack recompute and re-render in a loop.
  const effectiveSorting = useMemo<SortingState>(
    () => (sorting.length ? sorting : ranked ? [{ id: topic === "all" ? "score" : "rank", desc: topic === "all" }] : [{ id: "year", desc: true }]),
    [sorting, ranked, topic],
  );
  // The open row's swap menu: this topic's scored papers, with titles from the papers list.
  const swapChoices = useMemo<SwapChoice[]>(() => {
    if (topic === "all") return [];
    const title = new Map((papers.data?.papers ?? []).map((p) => [p.id, p.title]));
    return (ranking.data?.topics.find((t) => t.id === topic)?.scores ?? []).map((sc) => ({ ...sc, title: title.get(sc.paperId) ?? "" }));
  }, [topic, papers.data, ranking.data]);
  const columnChoices = columns.map((c) => ({ id: (c.id ?? (c as { accessorKey?: string }).accessorKey)!, header: c.header })).filter((c) => !["expand", "select", "title"].includes(c.id));

  if (states["4"] !== "approved" && (states["5"] ?? "not_started") === "not_started") return <EmptyState title="The table is built after retrieval">Approve the retrieved papers first.</EmptyState>;
  // Wait for both, so the topic filter and weights do not push the table down when the ranking arrives.
  if ((!papers.data && !papers.error) || (!ranking.data && !ranking.error)) return <Loading />;
  if (papers.error && !papers.data) return <ErrorState error={papers.error} onRetry={() => papers.mutate()} />;
  const all = papers.data?.papers ?? [];
  const missing = all.filter((p) => !p.summary).length;
  const rt = ranking.data?.topics ?? [];
  const selectedTotal = rt.reduce((a, t) => a + t.scores.filter((s) => s.selected).length, 0);
  const stage = states["5"] === "approved" ? 6 : 5;
  const topicList = (papers.data?.topics ?? []).map((t) => ({ id: t.id, name: t.name }));
  const hidden = allRows.length - rows.length;
  const summaryLine = describeFilters(rows.length, allRows.length, activeFilters.map(([dim, keys]) => ({ dim, keys })), topicList);
  const perTopicOk = rt.length > 0 && rt.every((t) => { const n = t.scores.filter((s) => s.selected).length; return n >= 3 && n <= 5; });
  const checklist =
    stage === 5
      ? [
          { label: "See what kinds of studies you found", done: seen.includes("explored") || activeFilters.length > 0, hint: "Click a study type below to show only those papers, or open the map." },
          { label: "Open one paper and compare its row with the abstract", done: seen.includes("opened-paper"), hint: "Click a title, or the arrow at the start of a row." },
          { label: "Correct any cell the AI got wrong", done: all.some((p) => p.summary?.edited), hint: "Optional. Double-click a study type, setting or key finding cell (or press Enter on it). On a phone or tablet, open the paper and use “Correct the summary”." },
        ]
      : [
          { label: "Pick a topic to see its ranked papers", done: topic !== "all", hint: "The buttons above the table: one per topic." },
          { label: "Open a selected paper to see why it scored high", done: seen.includes("opened-score"), hint: "Click the arrow at the start of its row." },
          { label: "Keep 3–5 papers per topic", done: perTopicOk, hint: "Tick or untick papers in a topic's view, or swap one from its details." },
        ];
  const points: MapPoint[] = rows.map((r) => ({
    id: r.id,
    title: r.title,
    year: r.year,
    score: r.score?.total ?? null,
    layer: Math.max(-1, topicList.findIndex((t) => r.topicIds.includes(t.id))),
    cat: view.colorBy === "topic" ? r.topicIds[0] ?? "" : view.colorBy === "score" ? scoreBandOf(r.score?.total) : view.colorBy === "evidence" ? r.cats.evidence[0] : view.colorBy === "source" ? r.cats.source[0] : r.cats.study[0],
    selected: r.selectedIn > 0,
  }));

  // One page scroll: the task and filters first, then the table (which scrolls its own rows, header kept in view).
  return (
    <div className="flex h-full flex-col overflow-y-auto">
      <div className="shrink-0 space-y-3 px-4 pb-1 pt-3">
        <StaleNotice stage={5} also={[6]} />
        {(states["5"] === "running" || states["6"] === "running") && <JobStatus stage={states["6"] === "running" ? 6 : 5} />}
        {err ? <ErrorState error={err} /> : null}
        <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_320px]">
          <div className="min-w-0">
            <p className="text-12 font-medium text-fg-1">Step {stage} of 9 · {stage === 5 ? "Summary table" : "Ranking"}</p>
            <h2 className="text-20 font-semibold">{stage === 5 ? "Skim the papers and fix any wrong cells" : "Check which papers go forward"}</h2>
            <p className="mt-1 max-w-3xl text-fg-1">
              {stage === 5
                ? <>One row per paper. The study type, setting and key finding were drafted by the AI from the abstract only <AbstractBadge />. Correct anything wrong, then rank the papers.</>
                : <>Every paper was scored from 0 to 100 against each topic. The top 3–5 per topic are <strong className="font-semibold">selected</strong> for a closer read. Change the selection if you disagree, then appraise them.</>}
            </p>
            <div className="mt-2 max-w-xl"><WhatHappens stage={stage} /></div>
          </div>
          <Checklist title={stage === 5 ? "Do these 3 things" : "Before you continue"} items={checklist} />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div role="group" aria-label="View" className="flex rounded-md border border-line">
            <button className={cx("inline-flex min-h-11 items-center gap-2 rounded-l-md px-3", mode === "table" ? "bg-bg-3 text-fg-0" : "text-fg-1")} aria-pressed={mode === "table"} onClick={() => setMode("table")}><LayoutList className="h-4 w-4" strokeWidth={1.5} aria-hidden /> Table</button>
            <button className={cx("inline-flex min-h-11 items-center gap-2 rounded-r-md px-3", mode === "map" ? "bg-bg-3 text-fg-0" : "text-fg-1")} aria-pressed={mode === "map"} onClick={() => { setMode("map"); mark("explored"); }}><MapIcon className="h-4 w-4" strokeWidth={1.5} aria-hidden /> Map</button>
          </div>
          <label className="min-w-48 flex-1">
            <span className="sr-only">Search papers</span>
            <input className="input min-h-11" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search title, author, setting, finding…" />
          </label>
          <label className="flex items-center gap-2 text-12 text-fg-1">Group by
            <select className="input min-h-11 w-auto" value={view.groupBy ?? ""} onChange={(e) => { view.setGroupBy((e.target.value || null) as Dimension | null); mark("explored"); }}>
              <option value="">No grouping</option>
              {DIMENSIONS.filter((d) => (d.key !== "selected" || ranked) && (d.key !== "evidence" || all.some((p) => p.appraisal))).map((d) => <option key={d.key} value={d.key}>{d.label}</option>)}
            </select>
          </label>
          <Popover.Root>
            <Popover.Trigger className="btn-secondary min-h-11" data-collapsible="">
              <SlidersHorizontal className="h-4 w-4" strokeWidth={1.5} aria-hidden /> Columns
            </Popover.Trigger>
            <Popover.Portal>
              <Popover.Content align="end" sideOffset={4} className="z-50 w-72 space-y-3 rounded-md border border-line-strong bg-bg-2 p-3">
                <fieldset>
                  <legend className="label">Columns to show</legend>
                  {columnChoices.map((c) => (
                    <label key={c.id} className="flex min-h-8 items-center gap-2">
                      <input type="checkbox" checked={visibility[c.id] !== false} onChange={() => setVisibility((v) => ({ ...v, [c.id]: v[c.id] === false }))} />
                      {typeof c.header === "string" ? c.header : c.id}
                    </label>
                  ))}
                </fieldset>
              </Popover.Content>
            </Popover.Portal>
          </Popover.Root>
        </div>

        {ranked && (
          <div role="group" aria-label="Topic" className="flex flex-wrap gap-1 pb-1">
            {[{ id: "all", name: "All topics", n: null as number | null }, ...rt.map((t) => ({ id: t.id, name: t.name, n: t.scores.filter((s) => s.selected).length }))].map((t) => (
              <button
                key={t.id}
                aria-pressed={topic === t.id}
                onClick={() => { setSorting([]); setTopic(t.id); }}
                className={cx("min-h-11 shrink-0 rounded-sm border px-3 text-left", topic === t.id ? "border-fg-1 bg-bg-2 text-fg-0" : "border-line text-fg-1 hover:text-fg-0")}
              >
                {t.name}{t.n !== null && <span className={cx("ml-2 text-12 tabular-nums", t.n < 3 || t.n > 5 ? "text-warn" : "text-fg-2")}>{t.n} selected</span>}
              </button>
            ))}
          </div>
        )}

        {ranked && topic === "all" && <p className="text-12 text-fg-2">To change which papers go forward, pick a topic: each of its papers then has a “Keep” checkbox.</p>}

        {mode === "map" ? (
          <Disclosure title="Filters" meta={activeFilters.length ? `${activeFilters.length} active` : "study type, article type, year…"}>
            <Facets rows={allRows} filters={view.filters} toggle={(d, k) => { view.toggle(d, k); mark("explored"); }} topics={topicList} ranked={ranked} />
          </Disclosure>
        ) : (
          <Facets rows={allRows} filters={view.filters} toggle={(d, k) => { view.toggle(d, k); mark("explored"); }} topics={topicList} ranked={ranked} />
        )}

        <div className="flex flex-wrap items-center gap-x-3 gap-y-1" aria-live="polite">
          <p className="text-fg-0"><span className="font-medium">{summaryLine}</span>{q.trim() ? ` matching “${q.trim()}”` : ""}.</p>
          {hidden > 0 && <p className="text-12 text-warn">{hidden} paper{hidden === 1 ? " is" : "s are"} hidden by your filters (still in the review).</p>}
          <button className="btn-ghost btn-sm" disabled={!activeFilters.length && !q.trim()} onClick={() => { view.reset(); setQ(""); }}><RotateCcw className="h-3 w-3" aria-hidden /> Reset filters</button>
          <span className="text-12 text-fg-2">{all.length} papers in total{missing ? ` · ${missing} not yet summarised` : ""}{ranked ? ` · ${selectedTotal} selected` : ""}</span>
        </div>
        {ranked && mode !== "map" && (
          <Disclosure title="How papers are scored" meta="5 criteria, 0–100">
            <ul className="grid gap-1 sm:grid-cols-2">
              {RUBRIC.map((r) => <li key={r.key}><strong className="font-medium">{r.label}</strong> <span className="tabular-nums text-fg-2">{Math.round(r.weight * 100)}%</span> · {r.by === "AI" ? "rated by the AI from the title and abstract" : "a fixed formula"}</li>)}
            </ul>
            <p className="mt-2 text-12 text-fg-2">Score = weighted sum, out of 100. The top 4 per topic are pre-selected; aim for 3–5.</p>
          </Disclosure>
        )}
      </div>
      {all.length === 0 ? (
        <div className="p-4"><EmptyState title="No papers were retrieved">Go back to the searches and broaden them.</EmptyState></div>
      ) : mode === "map" ? (
        <div className="mx-auto w-full max-w-4xl shrink-0 px-4 pb-4 pt-3">
          <PaperMap points={points} colorBy={view.colorBy} onColorBy={view.setColorBy} topics={topicList} onOpen={(id) => { mark("opened-paper"); openPaper(id); }} layers={topicList.length} title={stage === 5 ? "Papers by year and kind" : "Papers by year and score"} dimUnselected={ranked} colorChoices={(["study", "topic", "source", "evidence", "score"] as ColorBy[]).filter((c) => (c !== "score" || ranked) && (c !== "evidence" || all.some((p) => p.appraisal)))} />
        </div>
      ) : (
        <>
          <div className="shrink-0 lg:hidden">
            <PaperCards rows={rows} groupBy={view.groupBy} topics={topicList} onOpen={(id) => { mark("opened-paper"); openPaper(id); }} onToggle={ranked && topic !== "all" ? toggle : undefined} />
          </div>
          <div className="hidden h-[78vh] min-h-[420px] shrink-0 lg:flex">
            <PapersTable rows={rows} groupBy={view.groupBy} topics={topicList} columns={columns} sorting={effectiveSorting} onSortingChange={setSorting} visibility={visibility} expanded={expanded} topicScores={swapChoices} onSwap={swap}>
              {!rows.length && <p className="p-4 text-fg-2">No papers match these filters. <button className="link" onClick={() => { view.reset(); setQ(""); }}>Reset filters</button></p>}
            </PapersTable>
          </div>
        </>
      )}
    </div>
  );
}

/** Filter chips with counts. Study type and article type first (the questions people ask); the rest folded. */
function Facets({ rows, filters, toggle, topics, ranked }: { rows: Row[]; filters: Partial<Record<Dimension, string[]>>; toggle: (d: Dimension, k: string) => void; topics: { id: string; name: string }[]; ranked: boolean }) {
  const counts = (dim: Dimension) => {
    const out: Record<string, number> = {};
    for (const r of rows) for (const k of r.cats[dim]) out[k] = (out[k] ?? 0) + 1;
    return out;
  };
  const group = (dim: Dimension, label: string) => {
    const c = counts(dim);
    const cats = categoriesFor(dim, topics).filter((x) => (c[x.key] ?? 0) > 0 || filters[dim]?.includes(x.key));
    if (!cats.length) return null;
    return (
      <div key={dim} role="group" aria-label={`Filter by ${label.toLowerCase()}`} className="flex flex-wrap items-center gap-1">
        <span className="mr-1 w-24 shrink-0 text-12 text-fg-2">{label}</span>
        {cats.map((x) => {
          const on = filters[dim]?.includes(x.key) ?? false;
          return (
            <button key={x.key} aria-pressed={on} title={x.hint} onClick={() => toggle(dim, x.key)} className={cx("inline-flex min-h-9 items-center gap-1.5 rounded-full border px-3 text-12", on ? "border-fg-1 bg-bg-3 text-fg-0" : "border-line text-fg-1 hover:border-line-strong hover:text-fg-0")}>
              {on && <CheckCircle2 className="h-3 w-3" strokeWidth={2} aria-hidden />}
              {hasHues(dim) && <ShapeIcon shape={x.shape} color={categoryVar(dim, x.key, topics)} />}
              {x.label}
              <span className="tabular-nums text-fg-2">{c[x.key] ?? 0}</span>
            </button>
          );
        })}
      </div>
    );
  };
  const more = (["period", "source", "access", ...(ranked ? (["selected"] as const) : []), "evidence"] as Dimension[]).filter((d) => d !== "evidence" || rows.some((r) => r.appraisal));
  const moreActive = more.reduce((a, d) => a + (filters[d]?.length ?? 0), 0);
  return (
    <div className="space-y-2">
      {group("study", "Study type")}
      {group("article", "Article type")}
      <Disclosure title="More filters" meta={moreActive ? `${moreActive} on` : "year, source, full text…"}>
        <div className="space-y-2">{more.map((d) => group(d, DIMENSIONS.find((x) => x.key === d)!.label))}</div>
        <p className="mt-2 text-12 text-fg-2">Filters only change what you see here. Every paper stays in your review, and later steps use all of them.</p>
      </Disclosure>
    </div>
  );
}

/** Group key and label for a row in a dimension (rows in several topics are listed under their first). */
function groupOf(r: Row, dim: Dimension, topics: { id: string; name: string }[]) {
  const key = r.cats[dim][0] ?? "none";
  const cat = categoriesFor(dim, topics).find((c) => c.key === key);
  return { key, label: cat?.label ?? "None", shape: cat?.shape ?? "ring", color: categoryVar(dim, key, topics), order: Math.max(0, categoriesFor(dim, topics).findIndex((c) => c.key === key)) };
}

/** Phones and tablets (below 1024 px): one card per paper (title, year, study type, key finding), grouped like the table. */
function PaperCards({ rows, groupBy, topics, onOpen, onToggle }: { rows: Row[]; groupBy: Dimension | null; topics: { id: string; name: string }[]; onOpen: (id: string) => void; onToggle?: (s: Score) => void }) {
  const sorted = groupBy ? [...rows].sort((a, b) => groupOf(a, groupBy, topics).order - groupOf(b, groupBy, topics).order) : rows;
  let last = "";
  return (
    <ul className="divide-y divide-line border-t border-line" aria-label="Papers">
      {sorted.map((r) => {
        const g = groupBy ? groupOf(r, groupBy, topics) : null;
        const header = g && g.key !== last ? ((last = g.key), g) : null;
        return (
          <li key={r.id}>
            {header && <p className="flex items-center gap-2 bg-bg-1 px-4 py-2 text-12 font-medium text-fg-1"><ShapeIcon shape={header.shape} color={header.color} />{header.label} <span className="tabular-nums text-fg-2">{sorted.filter((x) => groupOf(x, groupBy!, topics).key === header.key).length}</span></p>}
            <button className="block w-full px-4 py-3 text-left" onClick={() => onOpen(r.id)}>
              <span className="block font-medium text-fg-0">{r.title}</span>
              <span className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-12 text-fg-1">
                <span className="tabular-nums">{r.year ?? "year unknown"}</span>
                <CategoryChip dim="study" value={r.cats.study[0]} />
                {r.score && <span className="tabular-nums">score {r.score.total}</span>}
                {r.selectedIn > 0 && <span className="inline-flex items-center gap-1 text-ok"><CheckCircle2 className="h-3 w-3" aria-hidden />selected</span>}
              </span>
              {r.summary && <span className="mt-1 line-clamp-2 block text-12 text-fg-2">{r.summary.keyFinding}</span>}
            </button>
            {onToggle && r.score && (
              <label className="flex min-h-11 items-center gap-2 px-4 pb-2 text-fg-1">
                <input type="checkbox" checked={r.score.selected} onChange={() => onToggle(r.score!)} /> Selected for appraisal in this topic
              </label>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/** The table itself, in its own component so building rows (above) and the TanStack row model (here) are
 *  separate units of work that React can yield between while hydrating. */
function PapersTable({ rows, groupBy, topics, columns, sorting, onSortingChange, visibility, expanded, topicScores, onSwap, children }: { rows: Row[]; groupBy: Dimension | null; topics: { id: string; name: string }[]; columns: ColumnDef<Row, any>[]; sorting: SortingState; onSortingChange: OnChangeFn<SortingState>; visibility: VisibilityState; expanded: Set<string>; topicScores: SwapChoice[]; onSwap: (outId: string, inId: string) => void; children?: ReactNode }) { // eslint-disable-line @typescript-eslint/no-explicit-any
  const table = useReactTable({ data: rows, columns, state: { sorting, columnVisibility: visibility }, onSortingChange, getCoreRowModel: getCoreRowModel(), getSortedRowModel: getSortedRowModel(), getRowId: (r) => r.id, autoResetPageIndex: false, autoResetExpanded: false });
  const sortedRows = table.getRowModel().rows;
  // Group by a category: groups in the category order, rows sorted within each group by the column sort.
  const { tableRows, headers } = useMemo(() => {
    if (!groupBy) return { tableRows: sortedRows, headers: new Map<number, ReturnType<typeof groupOf> & { n: number }>() };
    const keyed = sortedRows.map((r, i) => ({ r, i, g: groupOf(r.original, groupBy, topics) }));
    keyed.sort((a, b) => a.g.order - b.g.order || a.i - b.i);
    const h = new Map<number, ReturnType<typeof groupOf> & { n: number }>();
    keyed.forEach((k, idx) => {
      if (idx === 0 || keyed[idx - 1].g.key !== k.g.key) h.set(idx, { ...k.g, n: keyed.filter((x) => x.g.key === k.g.key).length });
    });
    return { tableRows: keyed.map((k) => k.r), headers: h };
  }, [sortedRows, groupBy, topics]);
  const scroller = useRef<HTMLDivElement>(null);
  // initialRect: the server (and the hydrating client) render the first rows before anything is measured; the
  // rest render after hydration. No flushSync: measuring rows re-renders in its own task, not inside the commit.
  const virtual = useVirtualizer({ count: tableRows.length, getScrollElement: () => scroller.current, estimateSize: () => 64, overscan: 6, initialRect: { width: 1280, height: 480 }, useFlushSync: false });
  const items = virtual.getVirtualItems();
  const padTop = items[0]?.start ?? 0;
  const padBottom = virtual.getTotalSize() - (items[items.length - 1]?.end ?? 0);
  const visibleCols = table.getVisibleLeafColumns().length;
  return (
    <div ref={scroller} className="mt-3 min-h-0 w-full flex-1 overflow-auto border-t border-line" tabIndex={-1}>
      <table className="w-full min-w-[960px] table-fixed border-collapse text-left" aria-rowcount={rows.length + 1}>
        <colgroup>
          {table.getVisibleLeafColumns().map((c) => <col key={c.id} style={{ width: COL_W[c.id] }} />)}
        </colgroup>
        <thead className="sticky top-0 z-10 bg-bg-1">
          {table.getHeaderGroups().map((hg) => (
            <tr key={hg.id} className="border-b border-line-strong">
              {hg.headers.map((h) => {
                const sorted = h.column.getIsSorted();
                const can = h.column.getCanSort() && h.column.id !== "expand" && h.column.id !== "select";
                return (
                  <th key={h.id} scope="col" aria-sort={sorted === "asc" ? "ascending" : sorted === "desc" ? "descending" : can ? "none" : undefined} className="whitespace-nowrap px-2 py-2 text-12 font-medium text-fg-1">
                    {can ? (
                      <button className="inline-flex min-h-11 items-center gap-1 rounded-sm px-1 hover:text-fg-0 md:min-h-8" onClick={h.column.getToggleSortingHandler()}>
                        {flexRender(h.column.columnDef.header, h.getContext())}
                        {sorted === "asc" ? <ArrowUp className="h-3 w-3" aria-hidden /> : sorted === "desc" ? <ArrowDown className="h-3 w-3" aria-hidden /> : <ArrowUpDown className="h-3 w-3 text-fg-2" aria-hidden />}
                      </button>
                    ) : (
                      flexRender(h.column.columnDef.header, h.getContext())
                    )}
                  </th>
                );
              })}
            </tr>
          ))}
        </thead>
        {padTop > 0 && <tbody aria-hidden><tr><td colSpan={visibleCols} style={{ height: padTop }} /></tr></tbody>}
        {items.map((vi) => {
          const r = tableRows[vi.index];
          const open = expanded.has(r.id);
          return (
            <RowBody
              key={r.id}
              row={r}
              index={vi.index}
              group={headers.get(vi.index) ?? null}
              columns={columns}
              visibility={visibility}
              visibleCols={visibleCols}
              measure={virtual.measureElement}
              topicScores={open ? topicScores : undefined}
              onSwap={open ? onSwap : undefined}
            />
          );
        })}
        {padBottom > 0 && <tbody aria-hidden><tr><td colSpan={visibleCols} style={{ height: padBottom }} /></tr></tbody>}
      </table>
      {children}
    </div>
  );
}

/** One row and, when open, its detail. Memoised: measuring and scrolling re-render the table, and only rows whose
 *  data, columns or open state changed re-render with it (`columns` changes whenever a cell's rendering does). */
const RowBody = memo(function RowBody({ row, index, group, visibleCols, measure, topicScores, onSwap }: { row: TableRow<Row>; index: number; group: (ReturnType<typeof groupOf> & { n: number }) | null; columns: unknown; visibility: VisibilityState; visibleCols: number; measure: (el: Element | null) => void; topicScores?: SwapChoice[]; onSwap?: (outId: string, inId: string) => void }) {
  return (
    <tbody ref={measure} data-index={index}>
      {group && (
        <tr className="border-b border-line-strong bg-bg-1">
          <th scope="rowgroup" colSpan={visibleCols} className="px-3 py-2 text-left text-12 font-medium text-fg-1">
            <span className="inline-flex items-center gap-2"><ShapeIcon shape={group.shape} color={group.color} />{group.label} <span className="tabular-nums text-fg-2">{group.n} paper{group.n === 1 ? "" : "s"}</span></span>
          </th>
        </tr>
      )}
      <tr className="border-b border-line align-top hover:bg-bg-1">
        {row.getVisibleCells().map((c) => <Fragment key={c.id}>{c.column.id.match(/^(studyType|setting|keyFinding)$/) ? flexRender(c.column.columnDef.cell, c.getContext()) : <td className="px-2 py-2">{flexRender(c.column.columnDef.cell, c.getContext())}</td>}</Fragment>)}
      </tr>
      {topicScores && onSwap && (
        <tr className="border-b border-line bg-bg-1">
          <td colSpan={visibleCols} className="px-4 py-3">
            <RowDetail row={row.original} topicScores={topicScores} onSwap={onSwap} />
          </td>
        </tr>
      )}
    </tbody>
  );
});

function ScoreCell({ row, all }: { row: Row; all: boolean }) {
  const s = row.score;
  if (!s) return <span className="text-12 text-fg-2">not scored</span>;
  return (
    <span className="inline-flex flex-col gap-1">
      <span className="inline-flex items-center gap-2">
        <span className="h-2 w-16 overflow-hidden rounded-full bg-bg-3" aria-hidden><span className="block h-full bg-line-control" style={{ width: `${s.total}%` }} /></span>
        <span className="tabular-nums" aria-label={`Score ${s.total} out of 100`}>{s.total}</span>
      </span>
      {all && row.selectedIn > 0 && <span className="text-12 text-ok">selected{row.selectedIn > 1 ? ` in ${row.selectedIn} topics` : ""}</span>}
      {s.userChanged && <span className="text-12 text-fg-2">changed by you</span>}
    </span>
  );
}

function AiCell({ row, field, editing, setEditing, onSave }: { row: Row; field: Field; editing: { id: string; field: Field } | null; setEditing: (e: { id: string; field: Field } | null) => void; onSave: (id: string, f: Field, v: string) => void }) {
  const s = row.summary;
  if (!s) return <td className="px-2 py-2 text-12 italic text-fg-2">pending</td>;
  const value = field === "studyType" ? STUDY_TYPE_LABEL[s.studyType as StudyType] ?? s.studyType : s[field];
  const group = field === "studyType" ? categoriesFor("study").find((c) => c.key === studyGroupOf(s.studyType)) : null;
  if (editing?.id === row.id && editing.field === field) {
    return (
      <td className="px-2 py-2">
        {field === "studyType" ? (
          <select autoFocus aria-label="Study type" className="input text-12" defaultValue={s.studyType} onBlur={(e) => onSave(row.id, field, e.target.value)} onKeyDown={(e) => e.key === "Escape" && setEditing(null)}>
            {STUDY_TYPES.map((x) => <option key={x} value={x}>{STUDY_TYPE_LABEL[x]}</option>)}
          </select>
        ) : (
          <textarea autoFocus aria-label={field === "setting" ? "Setting" : "Key finding"} className="input min-h-20 text-12" defaultValue={s[field]} onBlur={(e) => (e.target.value.trim() && e.target.value !== s[field] ? onSave(row.id, field, e.target.value) : setEditing(null))} onKeyDown={(e) => e.key === "Escape" && setEditing(null)} />
        )}
      </td>
    );
  }
  return (
    <td tabIndex={0} className="h-11 cursor-text px-2 py-2 text-12 text-fg-1" onDoubleClick={() => setEditing({ id: row.id, field })} onKeyDown={(e) => e.key === "Enter" && setEditing({ id: row.id, field })} aria-label={`${field === "studyType" ? "Study type" : field === "setting" ? "Setting" : "Key finding"}: ${value}. ${s.edited ? "Edited by you." : "AI, from the abstract."} Press Enter to edit.`}>
      <span className={cx("inline-flex items-start gap-1.5", field === "keyFinding" && "line-clamp-3", value.startsWith("not reported") && "italic text-fg-2")}>
        {group && <ShapeIcon shape={group.shape} color={categoryVar("study", group.key)} className="mt-0.5" />}
        {group && group.label.toLowerCase() !== value.toLowerCase() && !value.startsWith("not reported") ? (
          <span><span className="text-fg-0">{group.label}</span><span className="block text-fg-2">{value}</span></span>
        ) : (
          value
        )}
      </span>
      {s.edited && <span className="mt-1 block"><Badge>edited by you</Badge></span>}
    </td>
  );
}

function RowDetail({ row, topicScores, onSwap }: { row: Row; topicScores: SwapChoice[]; onSwap: (outId: string, inId: string) => void }) {
  const { projectId } = useSession();
  const { data } = useApi<{ paper: { abstract: string | null } }>(projectPath(projectId, `papers/${row.id}`));
  const s = row.score;
  const why = useApi<{ subScores: Record<string, number>; rationales: Record<string, string> }>(s ? projectPath(projectId, `ranking/scores/${s.id}`) : null);
  const rest = topicScores.filter((x) => !x.selected);
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <section>
        <h3 className="label">Abstract</h3>
        <p className="whitespace-pre-line leading-relaxed text-fg-1">{data ? data.paper.abstract ?? "No abstract available from the databases." : "Loading…"}</p>
      </section>
      {s && (
        <section>
          <h3 className="label">Why this score</h3>
          <p className="text-fg-1">{s.rationale}</p>
          <ul className="mt-2 space-y-1 text-12 text-fg-1">
            {RUBRIC.map((r) => <li key={r.key}><strong className="font-medium">{r.label} {why.data ? `${why.data.subScores[r.key]}/5` : "…"}:</strong> {why.data?.rationales[r.key] ?? ""}</li>)}
          </ul>
          {s.selected && rest.length > 0 && (
            <label className="mt-3 block text-12 text-fg-1">Swap for another paper in this topic
              <select className="input mt-1" value="" onChange={(e) => e.target.value && onSwap(s.id, e.target.value)}>
                <option value="">choose a paper…</option>
                {rest.slice(0, 40).map((o) => <option key={o.id} value={o.id}>{o.total} · {o.title.slice(0, 70)}</option>)}
              </select>
            </label>
          )}
        </section>
      )}
    </div>
  );
}
