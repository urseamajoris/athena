"use client";
import { useEffect, useRef, useState } from "react";
import { api, projectPath, useApi } from "../api";
import { Badge, EmptyState, ErrorState, Loading, Spinner } from "../ui";
import { SectionTitle, useWizard } from "../wizard/Wizard";

interface Query { id: string; database: string; queryString: string; aiQueryString: string; rationale: string; dryRunCount: number | null; dryRunAt: string | null; dryRunError: string | null; edited: boolean }
interface Criteria { yearFrom: number | null; yearTo: number | null; languages: string[]; studyTypes: string[]; inclusion: string[]; exclusion: string[] }
interface SearchData { criteria: Criteria | null; databases: { id: string; label: string }[]; topics: { id: string; name: string; synonyms: string[]; queries: Query[] }[] }

export function SearchStage() {
  const { projectId, states, refresh, confirmEdit } = useWizard();
  const { data, error, isLoading, mutate } = useApi<SearchData>(projectPath(projectId, "search"));
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<unknown>(null);
  const autoBuilt = useRef(false);
  const upstreamOk = states["1"] === "approved" && states["2"] === "approved";

  async function build() {
    if (data?.topics.some((t) => t.queries.length) && !(await confirmEdit(3))) return;
    setBusy("build");
    setErr(null);
    try {
      await mutate(await api<SearchData>(projectPath(projectId, "search/build"), { body: {} }), { revalidate: false });
      await refresh();
    } catch (e) {
      setErr(e);
    } finally {
      setBusy(null);
    }
  }
  async function dryAll() {
    setBusy("dry");
    setErr(null);
    try {
      const r = await api<{ state: SearchData }>(projectPath(projectId, "search/dryrun-all"), { body: {} });
      await mutate(r.state, { revalidate: false });
    } catch (e) {
      setErr(e);
    } finally {
      setBusy(null);
    }
  }
  useEffect(() => {
    if (data && upstreamOk && !autoBuilt.current && data.topics.length && data.topics.every((t) => !t.queries.length)) {
      autoBuilt.current = true;
      build();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, upstreamOk]);

  if (!upstreamOk && !data?.topics.some((t) => t.queries.length)) return <EmptyState title="Approve your topics first">The search builder writes queries for each approved topic.</EmptyState>;
  if (isLoading) return <Loading />;
  if (error) return <ErrorState error={error} onRetry={() => mutate()} />;
  if (!data) return null;
  const hasQueries = data.topics.some((t) => t.queries.length);

  return (
    <div className="space-y-5">
      {err ? <ErrorState error={err} title="The AI step failed" onRetry={build} /> : null}
      {busy === "build" && <div className="card flex items-center gap-2 p-4 text-14 text-fg-1"><Spinner /> Writing one query per database for each topic…</div>}
      {!hasQueries && busy !== "build" && !err && <EmptyState title="No queries yet" action={<button className="btn-primary" onClick={build}>Build queries</button>} />}
      {hasQueries && (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-14 text-fg-1">
              Edit any query. <strong>Dry run</strong> asks the database how many records match, without fetching them. Up to the per-query cap are fetched in the next step.
            </p>
            <div className="flex gap-2">
              <button className="btn-secondary" onClick={build} disabled={!!busy}>{busy === "build" && <Spinner />} Regenerate all</button>
              <button className="btn-primary" onClick={dryAll} disabled={!!busy}>{busy === "dry" && <Spinner />} Dry-run all</button>
            </div>
          </div>
          {data.criteria && <CriteriaCard criteria={data.criteria} onSaved={(d) => mutate(d, { revalidate: false })} />}
          {data.topics.map((t) => (
            <section key={t.id} className="card p-4" aria-label={`Queries for ${t.name}`}>
              <h3 className="mb-3 font-semibold text-fg-0">{t.name}</h3>
              <div className="grid gap-4 xl:grid-cols-2">
                {data.databases.map((db) => {
                  const q = t.queries.find((x) => x.database === db.id);
                  return q ? <QueryEditor key={q.id} q={q} label={db.label} onChange={(d) => mutate(d, { revalidate: false })} /> : <p key={db.id} className="text-14 text-fg-2">No {db.label} query.</p>;
                })}
              </div>
            </section>
          ))}
        </>
      )}
    </div>
  );
}

function QueryEditor({ q, label, onChange }: { q: Query; label: string; onChange: (d: SearchData) => void }) {
  const { projectId, confirmEdit, refresh } = useWizard();
  const [text, setText] = useState(q.queryString);
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<{ count: number | null; error: string | null } | null>(q.dryRunAt ? { count: q.dryRunCount, error: q.dryRunError } : null);
  useEffect(() => {
    setText(q.queryString);
    setRes(q.dryRunAt ? { count: q.dryRunCount, error: q.dryRunError } : null);
  }, [q.queryString, q.dryRunAt, q.dryRunCount, q.dryRunError]);
  const dirty = text.trim() !== q.queryString;

  async function save(value = text) {
    if (value.trim() === q.queryString) return true;
    if (!(await confirmEdit(3))) {
      setText(q.queryString);
      return false;
    }
    onChange(await api<SearchData>(projectPath(projectId, `queries/${q.id}`), { method: "PATCH", body: { queryString: value.trim() } }));
    await refresh();
    return true;
  }
  async function dry() {
    setBusy(true);
    try {
      if (!(await save())) return;
      setRes(await api(projectPath(projectId, `queries/${q.id}/dryrun`), { body: {} }));
    } catch (e) {
      setRes({ count: null, error: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }
  const id = `q-${q.id}`;
  return (
    <div>
      <div className="mb-1 flex items-center justify-between gap-2">
        <label htmlFor={id} className="text-14 font-medium text-fg-0">{label}</label>
        <div className="flex items-center gap-2">
          {q.edited && <Badge tone="teal">edited by you</Badge>}
          {res && (res.error ? <Badge tone="rose" title={res.error}>dry run failed</Badge> : <Badge tone={res.count === 0 ? "amber" : "sky"}>{res.count?.toLocaleString()} records</Badge>)}
        </div>
      </div>
      <textarea id={id} className="input min-h-28 font-mono text-12 leading-relaxed" value={text} onChange={(e) => setText(e.target.value)} onBlur={() => dirty && save()} spellCheck={false} />
      <p className="mt-1 text-12 text-fg-2">{q.rationale}</p>
      {res?.error && <p className="mt-1 text-12 text-err">{res.error}</p>}
      {res?.count === 0 && <p className="mt-1 text-12 text-warn">No records match. Try broadening: remove an AND block or add synonyms.</p>}
      <div className="mt-2 flex gap-2">
        <button className="btn-secondary text-12" onClick={dry} disabled={busy}>{busy && <Spinner />} Dry run</button>
        {q.edited && <button className="btn-ghost text-12" onClick={async () => { setText(q.aiQueryString); await save(q.aiQueryString); }}>Reset to AI version</button>}
      </div>
    </div>
  );
}

function CriteriaCard({ criteria, onSaved }: { criteria: Criteria; onSaved: (d: SearchData) => void }) {
  const { projectId, confirmEdit, refresh } = useWizard();
  const [c, setC] = useState(criteria);
  const [err, setErr] = useState<unknown>(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    setC(criteria);
  }, [criteria]);
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
    <section className="card p-4" aria-label="Shared inclusion and exclusion criteria">
      <SectionTitle>Shared criteria (all queries)</SectionTitle>
      <div className="grid gap-3 md:grid-cols-4">
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
        <label className="text-12 text-fg-1 md:col-span-2">Inclusion (one per line)
          <textarea className="input mt-1 min-h-20" value={c.inclusion.join("\n")} onChange={(e) => setC({ ...c, inclusion: list(e.target.value) })} />
        </label>
        <label className="text-12 text-fg-1 md:col-span-2">Exclusion (one per line)
          <textarea className="input mt-1 min-h-20" value={c.exclusion.join("\n")} onChange={(e) => setC({ ...c, exclusion: list(e.target.value) })} />
        </label>
      </div>
      <p className="mt-2 text-12 text-fg-2">Years and languages are applied as database filters. Study types and inclusion/exclusion statements guide ranking and appraisal and are recorded in the report; they are not hard filters.</p>
      {err ? <div className="mt-2"><ErrorState error={err} /></div> : null}
      {dirty && (
        <div className="mt-3 flex justify-end gap-2">
          <button className="btn-ghost" onClick={() => setC(criteria)}>Undo</button>
          <button className="btn-primary" onClick={save} disabled={saving}>{saving && <Spinner />} Save criteria</button>
        </div>
      )}
    </section>
  );
}
