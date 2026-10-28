"use client";
import { Fragment, memo, useMemo, useRef, useState, type ReactNode } from "react";
import { createColumnHelper, flexRender, getCoreRowModel, getSortedRowModel, useReactTable, type ColumnDef, type OnChangeFn, type Row as TableRow, type SortingState, type VisibilityState } from "@tanstack/react-table";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Popover } from "radix-ui";
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronDown, ChevronRight, SlidersHorizontal } from "lucide-react";
import { api, projectPath, useApi } from "../api";
import { AbstractBadge, Badge, EmptyState, ErrorState, Loading, cx } from "../ui";
import { Disclosure } from "../disclosure";
import { useJobRefresh, useSession } from "../session/SessionContext";
import { JobStatus, StaleNotice } from "../panels/common";
import { RUBRIC, STUDY_TYPES, STUDY_TYPE_LABEL, type StudyType } from "@/lib/shared/stages";

interface Paper {
  id: string; title: string; authors: string[]; year: number | null; journal: string | null; citationCount: number | null; oaUrl: string | null; sourceDatabases: string[]; doi: string | null; pmid: string | null; openalexId: string | null; hasAbstract: boolean;
  summary: { studyType: string; setting: string; keyFinding: string; edited: boolean } | null;
  topicIds: string[];
}
interface Score { id: string; paperId: string; topicId: string; total: number; selected: boolean; userChanged: boolean; rationale: string; subScores: Record<string, number>; paper: { title: string } }
interface RankingData { topics: { id: string; name: string; importanceRank: number | null; importanceJustification: string | null; scores: Score[] }[] }
interface PapersData { topics: { id: string; name: string }[]; papers: Paper[] }

export interface Row extends Paper {
  score: Score | null;
  rank: number | null;
  selectedIn: number;
}

type Field = "setting" | "keyFinding" | "studyType";
const ch = createColumnHelper<Row>();
const DEFAULT_HIDDEN: VisibilityState = { authors: false, journal: false, setting: false, citationCount: false, access: false, source: false };
/** Fixed column widths: with table-layout fixed, a row's height depends only on its own content, which keeps
 *  the virtualizer's measurements stable (auto layout re-flows every column as rows scroll in and out). */
const COL_W: Record<string, string> = { expand: "48px", select: "48px", rank: "64px", score: "120px", authors: "160px", year: "72px", journal: "180px", studyType: "160px", setting: "220px", keyFinding: "30%", citationCount: "72px", access: "80px", source: "112px" };

/** Full-screen summary + ranking table: rank and pick papers for appraisal. */
export function TableView() {
  const { projectId, states, confirmEdit, refresh, openPaper } = useSession();
  const papers = useApi<PapersData>(projectPath(projectId, "papers"));
  const ranking = useApi<RankingData>(projectPath(projectId, "ranking"));
  useJobRefresh(5, papers.mutate);
  useJobRefresh(6, ranking.mutate);
  const [topic, setTopic] = useState<string>("all");
  const [q, setQ] = useState("");
  const [studyType, setStudyType] = useState("");
  const [oaOnly, setOaOnly] = useState(false);
  const [sorting, setSorting] = useState<SortingState>([]);
  const [visibility, setVisibility] = useState<VisibilityState>(DEFAULT_HIDDEN);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<{ id: string; field: Field } | null>(null);
  const [err, setErr] = useState<unknown>(null);
  const ranked = (ranking.data?.topics ?? []).some((t) => t.scores.length);

  const rows: Row[] = useMemo(() => {
    const ps = papers.data?.papers ?? [];
    const rt = ranking.data?.topics ?? [];
    const scoresByPaper = new Map<string, Score[]>();
    for (const t of rt) for (const s of t.scores) scoresByPaper.set(s.paperId, [...(scoresByPaper.get(s.paperId) ?? []), s]);
    const rankOf = new Map<string, number>();
    for (const t of rt) t.scores.forEach((s, i) => rankOf.set(s.id, i + 1));
    const needle = q.trim().toLowerCase();
    return ps
      .filter((p) => (topic === "all" ? true : p.topicIds.includes(topic) || (scoresByPaper.get(p.id) ?? []).some((s) => s.topicId === topic)))
      .filter((p) => (!studyType || p.summary?.studyType === studyType) && (!oaOnly || !!p.oaUrl))
      .filter((p) => !needle || `${p.title} ${p.authors.join(" ")} ${p.journal ?? ""} ${p.summary?.setting ?? ""} ${p.summary?.keyFinding ?? ""}`.toLowerCase().includes(needle))
      .map((p) => {
        const all = scoresByPaper.get(p.id) ?? [];
        const score = topic === "all" ? [...all].sort((a, b) => b.total - a.total)[0] ?? null : all.find((s) => s.topicId === topic) ?? null;
        return { ...p, score, rank: score && topic !== "all" ? rankOf.get(score.id) ?? null : null, selectedIn: all.filter((s) => s.selected).length };
      });
  }, [papers.data, ranking.data, topic, q, studyType, oaOnly]);

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
          <button className="btn-ghost h-11 w-11 px-0 md:h-8 md:w-8" aria-expanded={expanded.has(c.row.original.id)} aria-label={`${expanded.has(c.row.original.id) ? "Hide" : "Show"} details for ${c.row.original.title}`} onClick={() => setExpanded((e) => { const n = new Set(e); if (n.has(c.row.original.id)) n.delete(c.row.original.id); else n.add(c.row.original.id); return n; })}>
            {expanded.has(c.row.original.id) ? <ChevronDown className="h-4 w-4" strokeWidth={1.5} aria-hidden /> : <ChevronRight className="h-4 w-4" strokeWidth={1.5} aria-hidden />}
          </button>
        ),
      }),
      ...(ranked && topic !== "all"
        ? [
            ch.display({
              id: "select",
              header: () => <span className="sr-only">Selected for appraisal</span>,
              cell: (c) => c.row.original.score && <label className="inline-flex h-11 w-11 items-center justify-center md:h-8 md:w-8"><input type="checkbox" checked={c.row.original.score.selected} onChange={() => toggle(c.row.original.score!)} aria-label={`${c.row.original.score.selected ? "Deselect" : "Select"} ${c.row.original.title}`} /></label>,
            }),
            // Papers not scored for this topic have no rank: undefined (not null) so they sort after rank 1, 2, …
            ch.accessor((r) => r.rank ?? undefined, { id: "rank", header: "Rank", sortUndefined: "last", cell: (c) => <span className="tabular-nums text-fg-1">{c.getValue() ?? "–"}</span> }),
          ]
        : []),
      ...(ranked ? [ch.accessor((r) => r.score?.total ?? -1, { id: "score", header: topic === "all" ? "Best score" : "Score", cell: (c) => <ScoreCell row={c.row.original} all={topic === "all"} /> })] : []),
      ch.accessor("title", { header: "Title", cell: (c) => <button className="link min-h-11 text-left font-medium md:min-h-0" onClick={() => openPaper(c.row.original.id)}>{c.getValue()}</button> }),
      ch.accessor((r) => r.authors[0] ?? "", { id: "authors", header: "Authors", cell: (c) => <span className="text-12 text-fg-1">{c.getValue() || "–"}{c.row.original.authors.length > 1 ? " et al." : ""}</span> }),
      ch.accessor((r) => r.year ?? 0, { id: "year", header: "Year", cell: (c) => <span className="tabular-nums">{c.row.original.year ?? "–"}</span> }),
      ch.accessor((r) => r.journal ?? "", { id: "journal", header: "Journal", cell: (c) => <span className="text-12 text-fg-1">{c.getValue() || "–"}</span> }),
      aiCell("studyType", "Study type"),
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
  const columnChoices = columns.map((c) => ({ id: (c.id ?? (c as { accessorKey?: string }).accessorKey)!, header: c.header })).filter((c) => !["expand", "select", "title"].includes(c.id));

  if (states["4"] !== "approved" && (states["5"] ?? "not_started") === "not_started") return <EmptyState title="The table is built after retrieval">Approve the retrieved papers first.</EmptyState>;
  // Wait for both, so the topic filter and weights do not push the table down when the ranking arrives.
  if ((!papers.data && !papers.error) || (!ranking.data && !ranking.error)) return <Loading />;
  if (papers.error && !papers.data) return <ErrorState error={papers.error} onRetry={() => papers.mutate()} />;
  const all = papers.data?.papers ?? [];
  const missing = all.filter((p) => !p.summary).length;
  const rt = ranking.data?.topics ?? [];
  const selectedTotal = rt.reduce((a, t) => a + t.scores.filter((s) => s.selected).length, 0);

  return (
    <div className="flex h-full flex-col">
      <div className="space-y-3 px-4 pt-3">
        <StaleNotice stage={5} also={[6]} />
        {(states["5"] === "running" || states["6"] === "running") && <JobStatus stage={states["6"] === "running" ? 6 : 5} />}
        {err ? <ErrorState error={err} /> : null}
        <div className="flex flex-wrap items-center gap-3">
          {ranked && (
            <div role="group" aria-label="Topic" className="flex flex-wrap gap-1">
              {[{ id: "all", name: "All topics", n: null as number | null }, ...rt.map((t) => ({ id: t.id, name: t.name, n: t.scores.filter((s) => s.selected).length }))].map((t) => (
                <button
                  key={t.id}
                  aria-pressed={topic === t.id}
                  onClick={() => { setSorting([]); setTopic(t.id); }}
                  className={cx("min-h-11 rounded-sm border px-3", topic === t.id ? "border-fg-1 bg-bg-2 text-fg-0" : "border-line text-fg-1 hover:text-fg-0")}
                >
                  {t.name}{t.n !== null && <span className="ml-2 text-12 tabular-nums text-fg-2">{t.n} selected</span>}
                </button>
              ))}
            </div>
          )}
          <label className="min-w-56 flex-1">
            <span className="sr-only">Search papers</span>
            <input className="input" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search title, author, setting, finding…" />
          </label>
          <Popover.Root>
            <Popover.Trigger className="btn-secondary min-h-11" data-collapsible="">
              <SlidersHorizontal className="h-4 w-4" strokeWidth={1.5} aria-hidden /> Filters and columns
            </Popover.Trigger>
            <Popover.Portal>
              <Popover.Content align="end" sideOffset={4} className="z-50 w-72 space-y-3 rounded-md border border-line-strong bg-bg-2 p-3">
                <label className="block text-12 text-fg-1">Study type
                  <select className="input mt-1" value={studyType} onChange={(e) => setStudyType(e.target.value)}>
                    <option value="">All</option>
                    {STUDY_TYPES.map((s) => <option key={s} value={s}>{STUDY_TYPE_LABEL[s]}</option>)}
                  </select>
                </label>
                <label className="flex min-h-11 items-center gap-2"><input type="checkbox" checked={oaOnly} onChange={(e) => setOaOnly(e.target.checked)} /> Open access only</label>
                <fieldset>
                  <legend className="label">Columns</legend>
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
        <p className="flex flex-wrap items-center gap-2 text-12 text-fg-2">
          <span className="tabular-nums">{rows.length} of {all.length} papers{missing ? ` · ${missing} not yet summarised` : ""}{ranked ? ` · ${selectedTotal} selected` : ""}</span>
          <span className="inline-flex items-center gap-1"><AbstractBadge /> cells: press Enter or double-click to correct.</span>
        </p>
        {ranked && (
          <Disclosure title="Ranking weights">
            <ul className="grid gap-1 sm:grid-cols-2">
              {RUBRIC.map((r) => <li key={r.key}><strong className="font-medium">{r.label}</strong> <span className="tabular-nums text-fg-2">{Math.round(r.weight * 100)}%</span> · {r.by === "AI" ? "AI, from title and abstract" : "fixed formula"}</li>)}
            </ul>
            <p className="mt-2 text-12 text-fg-2">Total = weighted sum out of 100. The top 4 per topic are pre-selected; aim for 3–5.</p>
          </Disclosure>
        )}
      </div>
      {all.length === 0 ? (
        <div className="p-4"><EmptyState title="No papers were retrieved">Go back to the queries and broaden them.</EmptyState></div>
      ) : (
        <PapersTable rows={rows} columns={columns} sorting={effectiveSorting} onSortingChange={setSorting} visibility={visibility} expanded={expanded} topicScores={topic === "all" ? [] : rt.find((t) => t.id === topic)?.scores ?? []} onSwap={swap}>
          {!rows.length && <p className="p-4 text-fg-2">No papers match these filters.</p>}
        </PapersTable>
      )}
    </div>
  );
}

/** The table itself, in its own component so building rows (above) and the TanStack row model (here) are
 *  separate units of work that React can yield between while hydrating. */
function PapersTable({ rows, columns, sorting, onSortingChange, visibility, expanded, topicScores, onSwap, children }: { rows: Row[]; columns: ColumnDef<Row, any>[]; sorting: SortingState; onSortingChange: OnChangeFn<SortingState>; visibility: VisibilityState; expanded: Set<string>; topicScores: Score[]; onSwap: (outId: string, inId: string) => void; children?: ReactNode }) { // eslint-disable-line @typescript-eslint/no-explicit-any
  const table = useReactTable({ data: rows, columns, state: { sorting, columnVisibility: visibility }, onSortingChange, getCoreRowModel: getCoreRowModel(), getSortedRowModel: getSortedRowModel(), getRowId: (r) => r.id, autoResetPageIndex: false, autoResetExpanded: false });
  const tableRows = table.getRowModel().rows;
  const scroller = useRef<HTMLDivElement>(null);
  // initialRect: the server (and the hydrating client) render the first rows before anything is measured; the
  // rest render after hydration. No flushSync: measuring rows re-renders in its own task, not inside the commit.
  const virtual = useVirtualizer({ count: tableRows.length, getScrollElement: () => scroller.current, estimateSize: () => 64, overscan: 6, initialRect: { width: 1280, height: 480 }, useFlushSync: false });
  const items = virtual.getVirtualItems();
  const padTop = items[0]?.start ?? 0;
  const padBottom = virtual.getTotalSize() - (items[items.length - 1]?.end ?? 0);
  const visibleCols = table.getVisibleLeafColumns().length;
  return (
    <div ref={scroller} className="mt-3 min-h-0 flex-1 overflow-auto border-t border-line" tabIndex={-1}>
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
const RowBody = memo(function RowBody({ row, index, visibleCols, measure, topicScores, onSwap }: { row: TableRow<Row>; index: number; columns: unknown; visibility: VisibilityState; visibleCols: number; measure: (el: Element | null) => void; topicScores?: Score[]; onSwap?: (outId: string, inId: string) => void }) {
  return (
    <tbody ref={measure} data-index={index}>
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
      <span className={cx(value.startsWith("not reported") && "italic text-fg-2")}>{value}</span>
      {s.edited && <span className="mt-1 block"><Badge>edited by you</Badge></span>}
    </td>
  );
}

function RowDetail({ row, topicScores, onSwap }: { row: Row; topicScores: Score[]; onSwap: (outId: string, inId: string) => void }) {
  const { projectId } = useSession();
  const { data } = useApi<{ paper: { abstract: string | null } }>(projectPath(projectId, `papers/${row.id}`));
  const s = row.score;
  const why = useApi<{ rationales: Record<string, string> }>(s ? projectPath(projectId, `ranking/scores/${s.id}`) : null);
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
            {RUBRIC.map((r) => <li key={r.key}><strong className="font-medium">{r.label} {s.subScores[r.key]}/5:</strong> {why.data ? why.data.rationales[r.key as keyof typeof why.data.rationales] : "…"}</li>)}
          </ul>
          {s.selected && rest.length > 0 && (
            <label className="mt-3 block text-12 text-fg-1">Swap for another paper in this topic
              <select className="input mt-1" value="" onChange={(e) => e.target.value && onSwap(s.id, e.target.value)}>
                <option value="">choose a paper…</option>
                {rest.slice(0, 40).map((o) => <option key={o.id} value={o.id}>{o.total} · {o.paper.title.slice(0, 70)}</option>)}
              </select>
            </label>
          )}
        </section>
      )}
    </div>
  );
}
