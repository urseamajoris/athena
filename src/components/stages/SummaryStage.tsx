"use client";
import { useMemo, useState } from "react";
import { api, projectPath, useApi } from "../api";
import { AbstractBadge, Badge, EmptyState, ErrorState, Loading, Spinner, cx } from "../ui";
import { JobPanel, useJobRefresh, useWizard } from "../wizard/Wizard";
import { STUDY_TYPES, STUDY_TYPE_LABEL, type StudyType } from "@/lib/shared/stages";
import type { PaperFlag } from "@/lib/shared/criteria";

interface Row {
  id: string; title: string; authors: string[]; year: number | null; journal: string | null; citationCount: number | null; oaUrl: string | null; sourceDatabases: string[]; doi: string | null; pmid: string | null; openalexId: string | null; hasAbstract: boolean;
  publicationTypes?: string[];
  excluded?: boolean;
  excludedReason?: string | null;
  flags?: PaperFlag[];
  summary: { studyType: string; setting: string; keyFinding: string; edited: boolean } | null;
  topicIds: string[];
}
interface PapersData { topics: { id: string; name: string }[]; papers: Row[] }
const PAGE = 15;
type SortKey = "title" | "year" | "journal" | "studyType" | "citationCount" | "authors";

export function SummaryStage() {
  const { projectId, states, openPaper, confirmEdit, refresh, jobs } = useWizard();
  const { data, error, isLoading, mutate } = useApi<PapersData>(projectPath(projectId, "papers"));
  useJobRefresh(5, mutate);
  const [q, setQ] = useState("");
  const [studyType, setStudyType] = useState("");
  const [topic, setTopic] = useState("");
  const [oaOnly, setOaOnly] = useState(false);
  const [flaggedOnly, setFlaggedOnly] = useState(false);
  const [group, setGroup] = useState(true);
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "year", dir: -1 });
  const [editing, setEditing] = useState<{ id: string; field: "setting" | "keyFinding" | "studyType" } | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [retrying, setRetrying] = useState(false);
  const [err, setErr] = useState<unknown>(null);

  const rows = useMemo(() => {
    if (!data) return [];
    const needle = q.trim().toLowerCase();
    const r = data.papers.filter((p) => {
      if (studyType && p.summary?.studyType !== studyType) return false;
      if (topic && !p.topicIds.includes(topic)) return false;
      if (oaOnly && !p.oaUrl) return false;
      if (flaggedOnly && !(p.flags?.length || p.excluded)) return false;
      if (needle && !`${p.title} ${p.authors.join(" ")} ${p.journal ?? ""} ${p.summary?.setting ?? ""} ${p.summary?.keyFinding ?? ""}`.toLowerCase().includes(needle)) return false;
      return true;
    });
    const val = (p: Row): string | number => {
      switch (sort.key) {
        case "year": return p.year ?? 0;
        case "citationCount": return p.citationCount ?? -1;
        case "studyType": return p.summary?.studyType ?? "";
        case "authors": return p.authors[0] ?? "";
        case "journal": return p.journal ?? "";
        default: return p.title.toLowerCase();
      }
    };
    return [...r].sort((a, b) => (val(a) > val(b) ? 1 : val(a) < val(b) ? -1 : 0) * sort.dir);
  }, [data, q, studyType, topic, oaOnly, flaggedOnly, sort]);

  if (states["4"] !== "approved" && (states["5"] ?? "not_started") === "not_started") return <EmptyState title="Approve retrieval first">The summary table is built from the papers retrieved in step 4.</EmptyState>;
  if (isLoading) return <Loading />;
  if (error) return <ErrorState error={error} onRetry={() => mutate()} />;
  if (!data) return null;

  const groups = group ? data.topics.map((t) => ({ id: t.id, name: t.name, rows: rows.filter((r) => r.topicIds.includes(t.id)) })).filter((g) => g.rows.length) : [{ id: "all", name: "", rows }];
  const missing = data.papers.filter((p) => !p.summary).length;
  const flaggedCount = data.papers.filter((p) => (p.flags?.length ?? 0) > 0).length;
  const excludedCount = data.papers.filter((p) => p.excluded).length;

  /** Save a corrected cell. Unchanged values are not edits; changed ones go through the same stale warning as any edit. */
  async function saveCell(id: string, field: "setting" | "keyFinding" | "studyType", value: string) {
    setEditing(null);
    const row = data!.papers.find((p) => p.id === id);
    if (!row?.summary || row.summary[field] === value) return;
    if (!(await confirmEdit(5))) return;
    setErr(null);
    try {
      await api(projectPath(projectId, `papers/${id}/summary`), { method: "PATCH", body: { [field]: value } });
      await mutate();
      await refresh();
    } catch (e) {
      setErr(e);
    }
  }
  /** Summarise only the papers that have no row yet (a failed batch). Existing rows, including your corrections, are kept. */
  async function retryMissing() {
    setRetrying(true);
    setErr(null);
    try {
      await api(projectPath(projectId, "stages/5/run"), { body: {} });
      await refresh();
    } catch (e) {
      setErr(e);
    } finally {
      setRetrying(false);
    }
  }
  const job = jobs["5"];
  const jobRunning = job && (job.status === "running" || job.status === "queued");

  async function toggleExclude(p: Row) {
    if (!(await confirmEdit(5))) return;
    const next = !p.excluded;
    const reason = next ? p.flags?.map((f) => f.reason).join("; ") || "Excluded by researcher" : null;
    await api(projectPath(projectId, `papers/${p.id}/exclude`), { method: "PATCH", body: { excluded: next, reason, stage: 5 } });
    await mutate();
    await refresh();
  }

  const th = (key: SortKey, label: string, cls = "") => (
    <th scope="col" aria-sort={sort.key === key ? (sort.dir === 1 ? "ascending" : "descending") : "none"} className={cx("whitespace-nowrap px-2 py-2", cls)}>
      <button className="inline-flex items-center gap-1 font-semibold hover:text-gray-900" onClick={() => setSort((s) => ({ key, dir: s.key === key ? (s.dir === 1 ? -1 : 1) : key === "year" || key === "citationCount" ? -1 : 1 }))}>
        {label} <span aria-hidden className="text-gray-400">{sort.key === key ? (sort.dir === 1 ? "▲" : "▼") : "↕"}</span>
      </button>
    </th>
  );

  return (
    <div className="space-y-4">
      <JobPanel stage={5} runLabel="Summarise papers" />
      {missing > 0 && !jobRunning && job && (
        <div role="alert" className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-900">
          <span><strong>{missing} paper{missing === 1 ? " has" : "s have"} no summary</strong> because a summarising batch failed. The table below is incomplete; retry before approving.</span>
          <button className="btn-secondary" onClick={retryMissing} disabled={retrying}>{retrying && <Spinner />} Retry missing summaries</button>
        </div>
      )}
      {err ? <ErrorState error={err} /> : null}
      <div className="card flex flex-wrap items-end gap-3 p-3">
        <label className="min-w-48 flex-1 text-xs text-gray-600">Search papers
          <input className="input mt-0.5" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Title, author, setting, finding…" />
        </label>
        <label className="text-xs text-gray-600">Study type
          <select className="input mt-0.5" value={studyType} onChange={(e) => setStudyType(e.target.value)}>
            <option value="">All</option>
            {STUDY_TYPES.map((s) => <option key={s} value={s}>{STUDY_TYPE_LABEL[s]}</option>)}
          </select>
        </label>
        <label className="text-xs text-gray-600">Topic
          <select className="input mt-0.5" value={topic} onChange={(e) => setTopic(e.target.value)}>
            <option value="">All</option>
            {data.topics.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </label>
        <label className="flex items-center gap-1.5 pb-2 text-sm text-gray-700"><input type="checkbox" className="accent-teal-700" checked={oaOnly} onChange={(e) => setOaOnly(e.target.checked)} /> Open access only</label>
        <label className="flex items-center gap-1.5 pb-2 text-sm text-gray-700"><input type="checkbox" className="accent-teal-700" checked={flaggedOnly} onChange={(e) => setFlaggedOnly(e.target.checked)} /> Flagged / excluded ({flaggedCount + excludedCount})</label>
        <label className="flex items-center gap-1.5 pb-2 text-sm text-gray-700"><input type="checkbox" className="accent-teal-700" checked={group} onChange={(e) => setGroup(e.target.checked)} /> Group by topic</label>
        <p className="pb-2 text-xs text-gray-500">
          {rows.length} of {data.papers.length} papers
          {flaggedCount ? ` · ${flaggedCount} flagged by criteria/type` : ""}
          {excludedCount ? ` · ${excludedCount} excluded` : ""}
          {missing ? ` · ${missing} not yet summarised` : ""}
        </p>
      </div>
      <p className="flex flex-wrap items-center gap-2 text-xs text-gray-500"><AbstractBadge /> cells were filled by the AI from the abstract only. Double-click a cell (or press Enter on it) to correct it. Flagged records (non-study publication types or criteria exclusions) are kept visible so you can exclude them before appraisal.</p>
      {data.papers.length === 0 ? (
        <EmptyState title="No papers were retrieved">Go back to the search builder and broaden the queries.</EmptyState>
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full min-w-[1100px] text-left text-sm">
            <thead className="sticky top-0 z-10 bg-gray-50 text-xs text-gray-600">
              <tr>
                {th("title", "Title", "w-[22%]")}{th("authors", "Authors")}{th("year", "Year")}{th("journal", "Journal")}{th("studyType", "Study type")}
                <th className="px-2 py-2 font-semibold">Setting / population</th><th className="w-[22%] px-2 py-2 font-semibold">Key finding</th>
                {th("citationCount", "Cites")}<th className="px-2 py-2 font-semibold">Access</th><th className="px-2 py-2 font-semibold">Source</th>
              </tr>
            </thead>
            {groups.map((g) => (
              <tbody key={g.id}>
                {group && (
                  <tr><th colSpan={10} scope="rowgroup" className="bg-teal-50/60 px-2 py-1.5 text-xs font-semibold text-teal-900">{g.name} · {g.rows.length}</th></tr>
                )}
                {(expanded.has(g.id) ? g.rows : g.rows.slice(0, PAGE)).map((p) => (
                  <tr key={`${g.id}-${p.id}`} className={cx("border-t border-gray-100 align-top hover:bg-gray-50", p.excluded && "bg-gray-50/70 opacity-65")}>
                    <td className="px-2 py-2">
                      <button className={cx("text-left font-medium text-gray-900 hover:underline", p.excluded && "line-through text-gray-500")} onClick={() => openPaper(p.id)}>{p.title}</button>
                      <div className="mt-1 flex flex-wrap items-center gap-1">
                        {p.excluded && <Badge tone="gray" title={p.excludedReason ?? "Excluded by researcher"}>Excluded</Badge>}
                        {(p.flags ?? []).map((f, idx) => (
                          <Badge key={idx} tone={f.kind === "publication_type" ? "rose" : "amber"} title={f.reason}>
                            ⚠ {f.label}
                          </Badge>
                        ))}
                        <button
                          type="button"
                          className={cx("text-[11px] underline", p.excluded ? "text-teal-800" : "text-gray-500 hover:text-rose-700")}
                          onClick={() => toggleExclude(p)}
                        >
                          {p.excluded ? "Restore" : "Exclude"}
                        </button>
                      </div>
                    </td>
                    <td className="px-2 py-2 text-xs text-gray-600">{p.authors[0] ?? "–"}{p.authors.length > 1 ? " et al." : ""}</td>
                    <td className="px-2 py-2 tabular-nums">{p.year ?? "–"}</td>
                    <td className="px-2 py-2 text-xs text-gray-600">{p.journal ?? "–"}</td>
                    <AiCell p={p} field="studyType" editing={editing} setEditing={setEditing} onSave={saveCell} />
                    <AiCell p={p} field="setting" editing={editing} setEditing={setEditing} onSave={saveCell} />
                    <AiCell p={p} field="keyFinding" editing={editing} setEditing={setEditing} onSave={saveCell} />
                    <td className="px-2 py-2 tabular-nums">{p.citationCount ?? "–"}</td>
                    <td className="px-2 py-2">{p.oaUrl ? <a href={p.oaUrl} target="_blank" rel="noreferrer" className="text-xs text-teal-800 underline">open</a> : <span className="text-xs text-gray-400">–</span>}</td>
                    <td className="px-2 py-2"><div className="flex flex-col gap-0.5">{p.sourceDatabases.map((d) => <Badge key={d} tone="sky">{d}</Badge>)}</div></td>
                  </tr>
                ))}
                {g.rows.length > PAGE && (
                  <tr>
                    <td colSpan={10} className="px-2 py-2">
                      <button className="btn-ghost text-xs" onClick={() => setExpanded((e) => { const n = new Set(e); if (n.has(g.id)) n.delete(g.id); else n.add(g.id); return n; })}>
                        {expanded.has(g.id) ? "Show fewer" : `Show all ${g.rows.length} papers${group ? " in this topic" : ""}`}
                      </button>
                    </td>
                  </tr>
                )}
              </tbody>
            ))}
          </table>
          {!rows.length && <p className="p-4 text-sm text-gray-500">No papers match these filters.</p>}
        </div>
      )}
    </div>
  );
}

function AiCell({ p, field, editing, setEditing, onSave }: { p: Row; field: "setting" | "keyFinding" | "studyType"; editing: { id: string; field: string } | null; setEditing: (e: { id: string; field: "setting" | "keyFinding" | "studyType" } | null) => void; onSave: (id: string, field: "setting" | "keyFinding" | "studyType", v: string) => void }) {
  const s = p.summary;
  const isEditing = editing?.id === p.id && editing.field === field;
  if (!s) return <td className="px-2 py-2 text-xs italic text-gray-400">pending</td>;
  const value = field === "studyType" ? STUDY_TYPE_LABEL[s.studyType as StudyType] ?? s.studyType : s[field];
  if (isEditing) {
    return (
      <td className="px-2 py-2">
        {field === "studyType" ? (
          <select autoFocus className="input text-xs" defaultValue={s.studyType} onChange={(e) => e.target.value !== s.studyType && onSave(p.id, field, e.target.value)} onBlur={() => setEditing(null)} onKeyDown={(e) => e.key === "Escape" && setEditing(null)}>
            {STUDY_TYPES.map((x) => <option key={x} value={x}>{STUDY_TYPE_LABEL[x]}</option>)}
          </select>
        ) : (
          <textarea autoFocus className="input min-h-20 text-xs" defaultValue={s[field]} onBlur={(e) => (e.target.value.trim() && e.target.value !== s[field] ? onSave(p.id, field, e.target.value) : setEditing(null))} onKeyDown={(e) => e.key === "Escape" && setEditing(null)} />
        )}
      </td>
    );
  }
  return (
    <td
      tabIndex={0}
      className="cursor-text px-2 py-2 text-xs text-gray-700"
      onDoubleClick={() => setEditing({ id: p.id, field })}
      onKeyDown={(e) => e.key === "Enter" && setEditing({ id: p.id, field })}
      aria-label={`${field}: ${value}. Press Enter to edit.`}
    >
      <span className={cx(value.startsWith("not reported") && "italic text-gray-400")}>{value}</span>
      <span className="mt-1 block">{s.edited ? <Badge tone="teal">edited by you</Badge> : <AbstractBadge />}</span>
    </td>
  );
}
