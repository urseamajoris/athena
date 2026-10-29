"use client";
import { useEffect, useState } from "react";
import { api, projectPath, useApi } from "../api";
import { Badge, ErrorState, Loading, Spinner, cx } from "../ui";
import { Disclosure } from "../disclosure";
import { useSession } from "../session/SessionContext";
import { ActionButton, PanelFooter, SectionTitle, StaleNotice } from "./common";
import { FIELD_LABEL, queryBlocks } from "@/lib/canvas/query-chips";
import { WhatHappens } from "../guide/WhatHappens";
import { nextAction } from "@/lib/canvas/actions";
import { fmtInt } from "@/lib/shared/format";

interface Query { id: string; database: string; queryString: string; aiQueryString: string; rationale: string; dryRunCount: number | null; dryRunAt: string | null; dryRunError: string | null; edited: boolean }
interface Criteria { yearFrom: number | null; yearTo: number | null; languages: string[]; studyTypes: string[]; inclusion: string[]; exclusion: string[]; hardFilter?: string[] }
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
  const fields = [...new Set(topic.queries.flatMap((q) => queryBlocks(q.queryString).flatMap((b) => b.terms.map((t) => t.field)).filter(Boolean)))] as string[];
  return (
    <div className="space-y-4">
      <StaleNotice stage={3} />
      <WhatHappens stage={3} />
      {data.databases.map((db) => {
        const q = topic.queries.find((x) => x.database === db.id);
        return q ? <QueryPreview key={q.id} q={q} label={db.label} onChange={(d) => mutate(d, { revalidate: false })} /> : <p key={db.id} className="text-fg-2">No {db.label} query.</p>;
      })}
      {fields.length > 0 && (
        <p className="text-12 text-fg-2">
          Small labels say where a word must appear: {fields.map((f, i) => <span key={f}>{i ? "; " : ""}<span className="font-medium text-fg-1">{FIELD_LABEL[f] ?? f}</span>{f === "mh" ? " (MeSH: PubMed's official keyword for a subject)" : f === "tiab" ? " (the word appears in the title or abstract)" : ""}</span>)}.
        </p>
      )}
      <Disclosure title="Edit the search text">
        <div className="space-y-4">
          {data.databases.map((db) => {
            const q = topic.queries.find((x) => x.database === db.id);
            return q ? <QueryEditor key={q.id} q={q} label={db.label} onChange={(d) => mutate(d, { revalidate: false })} /> : null;
          })}
        </div>
      </Disclosure>
      <Disclosure title="Keywords you can add" meta={`${topic.controlledTerms.length + topic.synonyms.length}`}>
        <p className="mb-2 text-12 text-fg-2">This topic's synonyms and MeSH terms (PubMed's official keywords), ready to paste into the search text. Click one to copy it.</p>
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
  const blocks = queryBlocks(q.queryString);
  const MAX = 40;
  return (
    <section aria-label={`${label} search`} className="rounded-md border border-line p-3">
      <SectionTitle right={q.edited ? <Badge>edited by you</Badge> : undefined}>{label}</SectionTitle>
      <ol className="space-y-2" aria-label={`${label} search: ${q.queryString}`}>
        {blocks.map((b, i) => (
          <li key={i}>
            {b.join && <p className="mb-1 text-12 font-semibold text-fg-1">{b.join === "AND" ? "AND also one of:" : "but NOT:"}</p>}
            {!b.join && <p className="mb-1 text-12 text-fg-2">Any of:</p>}
            <p className="flex flex-wrap gap-1">
              {b.terms.map((t, j) => (
                <span key={j} className="inline-flex items-center gap-1 rounded-sm border border-line-strong bg-bg-2 px-2 py-1 text-12 text-fg-0">
                  {t.text}
                  {t.field && <span className="text-fg-2" title={FIELD_LABEL[t.field] ?? t.field}>· {FIELD_LABEL[t.field] ?? t.field}</span>}
                </span>
              ))}
            </p>
          </li>
        ))}
      </ol>
      <p className="mt-2 text-12 text-fg-2">{q.rationale}</p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {res && !res.error && res.count !== null ? (
          <p className={cx("text-fg-0", res.count === 0 && "text-warn")}>
            <span className="font-semibold tabular-nums">{fmtInt(res.count)}</span> paper{res.count === 1 ? "" : "s"} match.{" "}
            <span className="text-fg-1">{res.count === 0 ? "Broaden it: remove an AND block or add synonyms." : res.count <= MAX ? "All of them will be collected." : `The ${MAX} most relevant will be collected.`}</span>
          </p>
        ) : res?.error ? (
          <p className="text-err">Could not count matches: {res.error}</p>
        ) : (
          <p className="text-fg-2">Not counted yet.</p>
        )}
        <button className="btn-secondary btn-sm" onClick={dry} disabled={busy} title="Ask the database how many papers match, without downloading them">{busy && <Spinner className="h-3 w-3" />} {res ? "Count again" : "Count matches"}</button>
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
      <p className="mt-2 text-12 text-fg-2">Years and languages are database filters. Study types and inclusion/exclusion guide ranking and appraisal and go in the report; they do not remove papers. These apply to every search.</p>
      <fieldset className="mt-4 rounded-md border border-warn-line p-3">
        <legend className="px-1 text-12 font-semibold text-fg-0">Hard filter on article type (optional)</legend>
        <p className="text-12 text-fg-1">Off by default. If you tick types here, <strong>only</strong> those are fetched. Databases label some papers wrongly or not at all, so this can silently leave out papers you would want. The usual way is to fetch everything and filter the table instead, which hides nothing for good.</p>
        <div className="mt-2 flex flex-wrap gap-3">
          {([["journal_article", "Original research articles"], ["review", "Reviews"], ["preprint", "Preprints"]] as const).map(([k, l]) => (
            <label key={k} className="flex min-h-11 items-center gap-2">
              <input type="checkbox" checked={c.hardFilter?.includes(k) ?? false} onChange={(e) => setC({ ...c, hardFilter: e.target.checked ? [...(c.hardFilter ?? []), k] : (c.hardFilter ?? []).filter((x) => x !== k) })} />
              {l}
            </label>
          ))}
        </div>
        {c.hardFilter?.length ? <p role="status" className="mt-1 text-12 text-warn">Hard filter on: only {c.hardFilter.length} of 3 article types will be fetched. This is logged and listed in your report.</p> : null}
      </fieldset>
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
