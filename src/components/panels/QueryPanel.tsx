"use client";
import { useEffect, useState } from "react";
import { api, projectPath, useApi } from "../api";
import { Badge, Disclosure, ErrorState, Loading, Spinner, cx } from "../ui";
import { useSession } from "../session/SessionContext";
import { ActionButton, PanelFooter, SectionTitle, StaleNotice } from "./common";
import { queryChips } from "@/lib/canvas/query-chips";
import { nextAction } from "@/lib/canvas/actions";

interface Query { id: string; database: string; queryString: string; aiQueryString: string; rationale: string; dryRunCount: number | null; dryRunAt: string | null; dryRunError: string | null; edited: boolean }
interface Criteria { yearFrom: number | null; yearTo: number | null; languages: string[]; studyTypes: string[]; inclusion: string[]; exclusion: string[] }
export interface SearchData { criteria: Criteria | null; databases: { id: string; label: string }[]; topics: { id: string; name: string; synonyms: string[]; controlledTerms: string[]; queries: Query[] }[] }

export function useSearchData() {
  const { projectId } = useSession();
  return useApi<SearchData>(projectPath(projectId, "search"));
}

/** Query node: one topic's PubMed and OpenAlex queries, readable as chips; run the search. */
export function QueryPanel({ topicId }: { topicId: string }) {
  const { graph, input } = useSession();
  const { data, error, isLoading, mutate } = useSearchData();
  if (isLoading) return <Loading />;
  if (error) return <ErrorState error={error} onRetry={() => mutate()} />;
  const topic = data?.topics.find((t) => t.id === topicId);
  if (!data || !topic) return <p className="text-fg-2">No queries for this topic yet.</p>;
  const node = graph.nodes.find((n) => n.id === `query:${topicId}`);
  const action = node ? nextAction(node, graph, input) : null;
  return (
    <div className="space-y-4">
      <StaleNotice stage={3} />
      {data.databases.map((db) => {
        const q = topic.queries.find((x) => x.database === db.id);
        return q ? <QueryPreview key={q.id} q={q} label={db.label} onChange={(d) => mutate(d, { revalidate: false })} /> : <p key={db.id} className="text-fg-2">No {db.label} query.</p>;
      })}
      <Disclosure title="Boolean editor">
        <div className="space-y-4">
          {data.databases.map((db) => {
            const q = topic.queries.find((x) => x.database === db.id);
            return q ? <QueryEditor key={q.id} q={q} label={db.label} onChange={(d) => mutate(d, { revalidate: false })} /> : null;
          })}
        </div>
      </Disclosure>
      <Disclosure title="MeSH helper" meta={`${topic.controlledTerms.length} terms`}>
        <p className="mb-2 text-12 text-fg-2">Controlled vocabulary and synonyms for this topic. Copy a term into the Boolean editor.</p>
        <ul className="flex flex-wrap gap-2">
          {topic.controlledTerms.map((t) => <li key={t}><CopyChip text={`"${t}"[mh]`} /></li>)}
          {topic.synonyms.map((t) => <li key={t}><CopyChip text={`"${t}"[tiab]`} /></li>)}
        </ul>
      </Disclosure>
      {data.criteria && <CriteriaCard criteria={data.criteria} onSaved={(d) => mutate(d, { revalidate: false })} />}
      {action && (
        <PanelFooter note="Retrieval runs every topic's queries against both databases and removes duplicates.">
          <ActionButton action={action} primary showReason />
        </PanelFooter>
      )}
    </div>
  );
}

function CopyChip({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      className="inline-flex min-h-8 items-center rounded-sm border border-line-strong bg-bg-2 px-2 font-mono text-12 text-fg-1 hover:text-fg-0"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setDone(true);
          setTimeout(() => setDone(false), 1200);
        } catch {}
      }}
      aria-label={`Copy ${text}`}
    >
      {done ? "copied" : text}
    </button>
  );
}

function QueryPreview({ q, label, onChange }: { q: Query; label: string; onChange: (d: SearchData) => void }) {
  const { projectId } = useSession();
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<{ count: number | null; error: string | null } | null>(q.dryRunAt ? { count: q.dryRunCount, error: q.dryRunError } : null);
  useEffect(() => setRes(q.dryRunAt ? { count: q.dryRunCount, error: q.dryRunError } : null), [q.dryRunAt, q.dryRunCount, q.dryRunError]);
  const chips = queryChips(q.queryString);
  async function dry() {
    setBusy(true);
    try {
      setRes(await api(projectPath(projectId, `queries/${q.id}/dryrun`), { body: {} }));
      onChange(await api<SearchData>(projectPath(projectId, "search")));
    } catch (e) {
      setRes({ count: null, error: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }
  return (
    <section aria-label={`${label} query`} className="rounded-md border border-line p-3">
      <SectionTitle
        right={
          <span className="flex items-center gap-2">
            {q.edited && <Badge>edited by you</Badge>}
            {res ? (res.error ? <Badge tone="err" title={res.error}>dry run failed</Badge> : <Badge tone={res.count === 0 ? "warn" : "neutral"}><span className="tabular-nums">{res.count?.toLocaleString()}</span> records</Badge>) : <Badge>not dry-run</Badge>}
          </span>
        }
      >
        {label}
      </SectionTitle>
      <p className="flex flex-wrap items-center gap-1 font-mono text-12" aria-label={`${label} query: ${q.queryString}`}>
        {chips.map((c, i) =>
          c.type === "op" ? (
            <span key={i} className="px-1 text-fg-2">{c.text.toLowerCase()}</span>
          ) : (
            <span key={i} className={cx("inline-flex items-center gap-1 rounded-sm border border-line-strong bg-bg-2 px-2 py-1 text-fg-0")}>
              {c.text}
              {c.field && <span className="text-fg-2">{c.field}</span>}
            </span>
          ),
        )}
      </p>
      <p className="mt-2 text-12 text-fg-2">{q.rationale}</p>
      {res?.count === 0 && <p className="mt-1 text-12 text-warn">No records match. Try broadening: remove an AND block or add synonyms.</p>}
      <div className="mt-2">
        <button className="btn-secondary btn-sm" onClick={dry} disabled={busy}>{busy && <Spinner className="h-3 w-3" />} Dry run</button>
      </div>
    </section>
  );
}

function QueryEditor({ q, label, onChange }: { q: Query; label: string; onChange: (d: SearchData) => void }) {
  const { projectId, confirmEdit, refresh } = useSession();
  const [text, setText] = useState(q.queryString);
  useEffect(() => setText(q.queryString), [q.queryString]);
  const dirty = text.trim() !== q.queryString;
  async function save(value = text) {
    if (value.trim() === q.queryString) return;
    if (!(await confirmEdit(3))) return setText(q.queryString);
    onChange(await api<SearchData>(projectPath(projectId, `queries/${q.id}`), { method: "PATCH", body: { queryString: value.trim() } }));
    await refresh();
  }
  const id = `q-${q.id}`;
  return (
    <div>
      <label htmlFor={id} className="label">{label}</label>
      <textarea id={id} className="input min-h-28 font-mono text-12 leading-relaxed" value={text} onChange={(e) => setText(e.target.value)} onBlur={() => dirty && save()} spellCheck={false} />
      <div className="mt-2 flex gap-2">
        {q.edited && <button className="btn-ghost btn-sm" onClick={async () => { setText(q.aiQueryString); await save(q.aiQueryString); }}>Reset to AI version</button>}
      </div>
    </div>
  );
}

function CriteriaCard({ criteria, onSaved }: { criteria: Criteria; onSaved: (d: SearchData) => void }) {
  const { projectId, confirmEdit, refresh } = useSession();
  const [c, setC] = useState(criteria);
  const [err, setErr] = useState<unknown>(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => setC(criteria), [criteria]);
  const dirty = JSON.stringify(c) !== JSON.stringify(criteria);
  const list = (s: string) => s.split(/\n|;/).map((x) => x.trim()).filter(Boolean);
  async function save() {
    if (!(await confirmEdit(3))) return setC(criteria);
    setSaving(true);
    setErr(null);
    try {
      onSaved(await api(projectPath(projectId, "criteria"), { method: "PUT", body: c }));
      await refresh();
    } catch (e) {
      setErr(e);
    } finally {
      setSaving(false);
    }
  }
  return (
    <Disclosure title="Dates, languages and criteria" meta={`${c.yearFrom ?? "any"}–${c.yearTo ?? "now"} · ${c.languages.join(", ") || "any language"}`}>
      <div className="grid grid-cols-2 gap-3">
        <label className="text-12 text-fg-1">From year
          <input type="number" className="input mt-1" value={c.yearFrom ?? ""} onChange={(e) => setC({ ...c, yearFrom: e.target.value ? Number(e.target.value) : null })} />
        </label>
        <label className="text-12 text-fg-1">To year
          <input type="number" className="input mt-1" value={c.yearTo ?? ""} placeholder="present" onChange={(e) => setC({ ...c, yearTo: e.target.value ? Number(e.target.value) : null })} />
        </label>
        <label className="text-12 text-fg-1">Languages (ISO codes)
          <input className="input mt-1" value={c.languages.join(", ")} onChange={(e) => setC({ ...c, languages: e.target.value.split(",").map((x) => x.trim()).filter(Boolean) })} />
        </label>
        <label className="text-12 text-fg-1">Preferred study types
          <input className="input mt-1" value={c.studyTypes.join(", ")} onChange={(e) => setC({ ...c, studyTypes: e.target.value.split(",").map((x) => x.trim()).filter(Boolean) })} />
        </label>
        <label className="col-span-2 text-12 text-fg-1">Inclusion (one per line)
          <textarea className="input mt-1 min-h-20" value={c.inclusion.join("\n")} onChange={(e) => setC({ ...c, inclusion: list(e.target.value) })} />
        </label>
        <label className="col-span-2 text-12 text-fg-1">Exclusion (one per line)
          <textarea className="input mt-1 min-h-20" value={c.exclusion.join("\n")} onChange={(e) => setC({ ...c, exclusion: list(e.target.value) })} />
        </label>
      </div>
      <p className="mt-2 text-12 text-fg-2">Years and languages are database filters. Study types and inclusion/exclusion guide ranking and appraisal and go in the report; they are not hard filters. These apply to every query.</p>
      {err ? <div className="mt-2"><ErrorState error={err} /></div> : null}
      {dirty && (
        <div className="mt-3 flex justify-end gap-2">
          <button className="btn-ghost" onClick={() => setC(criteria)}>Undo</button>
          <button className="btn-secondary" onClick={save} disabled={saving}>{saving && <Spinner />} Save criteria</button>
        </div>
      )}
    </Disclosure>
  );
}
