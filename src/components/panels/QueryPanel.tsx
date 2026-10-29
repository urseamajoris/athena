"use client";
import { useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2 } from "lucide-react";
import { api, projectPath, useApi } from "../api";
import { Badge, ErrorState, Loading, Spinner, cx } from "../ui";
import { Disclosure } from "../disclosure";
import { useLiveRetrieval, useSession } from "../session/SessionContext";
import { criteriaDrafts } from "./criteria-draft";
import { ActionButton, PanelFooter, SectionTitle, StaleNotice } from "./common";
import { FIELD_LABEL, queryBlocks } from "@/lib/canvas/query-chips";
import { WhatHappens } from "../guide/WhatHappens";
import { nextAction, stageAction } from "@/lib/canvas/actions";
import { frontierStage } from "@/lib/canvas/graph";
import { fmtInt } from "@/lib/shared/format";

interface Query { id: string; database: string; queryString: string; aiQueryString: string; rationale: string; dryRunCount: number | null; dryRunAt: string | null; dryRunError: string | null; edited: boolean }
interface Criteria { yearFrom: number | null; yearTo: number | null; languages: string[]; studyTypes: string[]; inclusion: string[]; exclusion: string[]; hardFilter?: string[] }
export interface SearchData { criteria: Criteria | null; databases: { id: string; label: string }[]; topics: { id: string; name: string; synonyms: string[]; controlledTerms: string[]; queries: Query[] }[] }
/** One query as it ran in retrieval (step 4): the snapshot it ran with and what the database returned. */
interface Run { queryId: string; queryString: string; criteria: Criteria | null; status: string; resultCount: number | null; fetchedCount: number; cap: number; error: string | null }

export function useSearchData() {
  const { projectId } = useSession();
  return useApi<SearchData>(projectPath(projectId, "search"));
}

/** The parts of the criteria that change what a database returns (inclusion/exclusion only guide ranking). */
const countInputs = (c: Criteria | null) => ({ years: [c?.yearFrom ?? null, c?.yearTo ?? null], languages: c?.languages ?? [], hardFilter: c?.hardFilter ?? [] });

/** Query node: one topic's PubMed and OpenAlex queries, readable as chips; run the search. */
export function QueryPanel({ topicId }: { topicId: string }) {
  const { projectId, graph, input, states } = useSession();
  const { data, error, isLoading, mutate } = useSearchData();
  const { data: status } = useApi<{ maxResultsPerQuery?: number }>("/api/status");
  const live = useLiveRetrieval() as { runs: Run[] } | null;
  const { data: fetched } = useApi<{ runs: Run[] }>(states["4"] && states["4"] !== "not_started" ? projectPath(projectId, "retrieval") : null);
  const crit = useCriteriaDraft(data?.criteria ?? null, (d) => mutate(d, { revalidate: false }));
  if (isLoading) return <Loading />;
  if (error) return <ErrorState error={error} onRetry={() => mutate()} />;
  const topic = data?.topics.find((t) => t.id === topicId);
  if (!data || !topic) return <p className="text-fg-2">No queries for this topic yet.</p>;
  const node = graph.nodes.find((n) => n.id === `query:${topicId}`);
  // Every topic's searches offer step 3's action while step 3 is current, not only the first topic's
  // (which is the frontier node): checking the second topic must not turn the footer into "Go to step 3".
  const action = node ? nextAction(node, graph, input) ?? (frontierStage(states) === 3 ? stageAction(3, input) : null) : null;
  const runs = (live ?? fetched)?.runs ?? [];
  const fields = [...new Set(topic.queries.flatMap((q) => queryBlocks(q.queryString).flatMap((b) => b.terms.map((t) => t.field)).filter(Boolean)))] as string[];
  return (
    <div className="space-y-4">
      <StaleNotice stage={3} />
      <WhatHappens stage={3} />
      {data.databases.map((db) => {
        const q = topic.queries.find((x) => x.database === db.id);
        return q ? <QueryPreview key={q.id} q={q} label={db.label} criteria={data.criteria} run={runs.find((r) => r.queryId === q.id) ?? null} cap={status?.maxResultsPerQuery ?? 40} beforeCount={crit.dirty ? crit.save : null} onChange={(d) => mutate(d, { revalidate: false })} /> : <p key={db.id} className="text-fg-2">No {db.label} query.</p>;
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
      {crit.draft && <CriteriaCard crit={crit} />}
      {(action || crit.dirty) && (
        <PanelFooter note={crit.dirty ? undefined : "Retrieval runs every topic's queries against both databases and removes duplicates."}>
          {crit.dirty && (
            <div className="flex w-full flex-wrap items-center justify-end gap-2">
              <p role="status" className="mr-auto flex items-center gap-2 text-12 text-fg-0"><AlertTriangle className="h-4 w-4 shrink-0 text-warn" strokeWidth={1.5} aria-hidden /> Your changes to dates and criteria are not saved yet.</p>
              <button className="btn-ghost" onClick={crit.undo} disabled={crit.saving}>Undo</button>
              <button className="btn-secondary" onClick={() => crit.save()} disabled={crit.saving}>{crit.saving && <Spinner />} Save criteria</button>
            </div>
          )}
          {action && <ActionButton action={crit.dirty ? { ...action, disabledReason: "Save or undo your changes to dates and criteria first." } : action} primary showReason />}
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

/** What changed between two sets of count inputs, in plain words ("the years and the search text"). */
function changedParts(a: string, b: string) {
  const x = JSON.parse(a);
  const y = JSON.parse(b);
  const parts = [x.q !== y.q && "the search text", JSON.stringify(x.years) !== JSON.stringify(y.years) && "the years", JSON.stringify(x.languages) !== JSON.stringify(y.languages) && "the languages", JSON.stringify(x.hardFilter) !== JSON.stringify(y.hardFilter) && "the article-type filter"].filter(Boolean);
  return parts.join(" and ") || "the search";
}

function QueryPreview({ q, label, criteria, run, cap: MAX, beforeCount, onChange }: { q: Query; label: string; criteria: Criteria | null; run: Run | null; cap: number; beforeCount: (() => Promise<boolean>) | null; onChange: (d: SearchData) => void }) {
  const { projectId } = useSession();
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<{ count: number | null; error: string | null } | null>(q.dryRunAt ? { count: q.dryRunCount, error: q.dryRunError } : null);
  useEffect(() => setRes(q.dryRunAt ? { count: q.dryRunCount, error: q.dryRunError } : null), [q.dryRunAt, q.dryRunCount, q.dryRunError]);
  // Remember the last count and what it was counted with, so a count that changes (or is cleared) after an edit
  // says why, instead of looking arbitrary.
  const inputs = JSON.stringify({ q: q.queryString, ...countInputs(criteria) });
  const [track, setTrack] = useState<{ inputs: string; count: number; before: { inputs: string; count: number } | null } | null>(null);
  useEffect(() => {
    if (!q.dryRunAt || q.dryRunCount === null) return;
    const count = q.dryRunCount;
    setTrack((t) => (t && t.inputs === inputs ? { ...t, count } : { inputs, count, before: t && { inputs: t.inputs, count: t.count } }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q.dryRunAt]);
  async function dry() {
    // Unsaved dates or criteria are saved first, so the count uses what the user sees (and the edits are not lost).
    if (beforeCount && !(await beforeCount())) return;
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
  const verdict = res && !res.error && res.count !== null
    ? res.count === 0 ? { tone: "text-warn", text: "Too narrow: nothing matches. Remove an AND group or add synonyms." }
    : res.count < 10 ? { tone: "text-warn", text: "Narrow: all will be collected, but you may miss papers. Consider adding synonyms." }
    : res.count <= MAX ? { tone: "text-fg-1", text: "Good size: all of them will be collected." }
    : res.count <= 500 ? { tone: "text-fg-1", text: `Only the ${MAX} most relevant will be collected.` }
    : { tone: "text-warn", text: `Broad: only the ${MAX} most relevant will be collected, so most matching papers are left out. Add a term to focus it.` }
    : null;
  const ranDone = run?.status === "done" || run?.status === "failed";
  const ranCurrent = !!run && run.queryString === q.queryString && JSON.stringify(countInputs(run.criteria)) === JSON.stringify(countInputs(criteria));
  const wasLine = verdict && track?.before && track.inputs === inputs && track.before.count !== track.count
    ? `It was ${fmtInt(track.before.count)} before you changed ${changedParts(track.before.inputs, inputs)}.`
    : !res && track && track.inputs !== inputs ? `It was ${fmtInt(track.count)} before you changed ${changedParts(track.inputs, inputs)}; count again to see the new number.` : null;
  return (
    <section aria-label={`${label} search`} className="rounded-md border border-line p-3">
      <SectionTitle right={q.edited ? <Badge>edited by you</Badge> : undefined}>{label}</SectionTitle>
      {run && (
        <p className="mb-2 flex items-start gap-2" aria-live="polite">
          {!ranDone ? <Spinner className="mt-0.5 h-4 w-4 text-run" label="Running" />
            : run.status === "failed" ? <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-err" strokeWidth={1.5} aria-hidden />
            : <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-ok" strokeWidth={1.5} aria-hidden />}
          <span className="min-w-0 flex-1">
            {!ranDone ? "Searching now…"
              : run.status === "failed" ? <span className="text-err">This search failed when the searches ran: {run.error}</span>
              : <>Searched: <span className="font-semibold tabular-nums text-fg-0">{run.resultCount == null ? "?" : fmtInt(run.resultCount)}</span> matched, <span className="font-semibold tabular-nums text-fg-0">{fmtInt(run.fetchedCount)}</span> collected{run.resultCount != null && run.resultCount > run.cap ? ` (the ${run.cap} most relevant)` : ""}.</>}
            {ranDone && !ranCurrent && <span className="block text-12 text-warn">The search text, years or languages changed after it ran. Run the searches again to use the change.</span>}
          </span>
        </p>
      )}
      <div className="mb-3 flex flex-wrap items-center gap-2" aria-live="polite">
        {verdict ? (
          <p className="min-w-0 flex-1">
            <span className="font-semibold tabular-nums text-fg-0">{fmtInt(res!.count!)}</span> paper{res!.count === 1 ? "" : "s"} match. <span className={verdict.tone}>{verdict.text}</span>
            {wasLine && <span className="block text-12 text-fg-2">{wasLine}</span>}
          </p>
        ) : res?.error ? (
          <p className="min-w-0 flex-1 text-err">Could not count matches: {res.error}</p>
        ) : wasLine ? (
          <p className="min-w-0 flex-1 text-fg-2">{wasLine}</p>
        ) : run && ranCurrent ? (
          <span className="min-w-0 flex-1" />
        ) : (
          <p className="min-w-0 flex-1 text-fg-2">Not counted yet.</p>
        )}
        <button className="btn-secondary btn-sm" onClick={dry} disabled={busy} title={beforeCount ? "Saves your date and criteria changes, then asks the database how many papers match" : "Ask the database how many papers match, without downloading them"}>{busy && <Spinner className="h-3 w-3" />} {res ? "Count again" : "Count matches"}</button>
      </div>
      {blocks.length > 1 && <p className="mb-2 text-12 text-fg-2">A paper must match at least one word from every group.{blocks.some((b) => b.terms.some((t) => t.field === "mh" || t.field === "majr")) ? " An “index term” is PubMed’s official topic label, so it also finds papers that use other words." : ""}</p>}
      <ol className="space-y-2" aria-label={`${label} search: ${q.queryString}`}>
        {blocks.map((b, i) => <TermBlock key={i} block={b} index={i} />)}
      </ol>
      <p className="mt-2 text-12 text-fg-2">{q.rationale}</p>
    </section>
  );
}

function TermBlock({ block: b, index }: { block: ReturnType<typeof queryBlocks>[number]; index: number }) {
  const [all, setAll] = useState(false);
  const SHOW = 6;
  const terms = all ? b.terms : b.terms.slice(0, SHOW);
  return (
    <li>
      <p className="mb-1 text-12 font-semibold text-fg-1">{b.join === "NOT" ? "But NOT:" : `${b.join === "AND" ? "AND " : ""}group ${index + 1}: any of`}</p>
      <p className="flex flex-wrap gap-1">
        {terms.map((t, j) => (
          <span key={j} className="inline-flex items-center gap-1 rounded-sm border border-line-strong bg-bg-2 px-2 py-1 text-12 text-fg-0">
            {t.text}
            {t.field && <span className="text-fg-2" title={FIELD_LABEL[t.field] ?? t.field}>· {FIELD_LABEL[t.field] ?? t.field}</span>}
          </span>
        ))}
        {b.terms.length > SHOW && (
          <button className="btn-ghost btn-sm min-h-8" onClick={() => setAll(!all)} aria-expanded={all}>{all ? "Show fewer" : `+${b.terms.length - SHOW} more`}</button>
        )}
      </p>
    </li>
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
      <label htmlFor={id} className="label">{label} search text</label>
      <textarea id={id} className="input min-h-28 font-mono text-12 leading-relaxed" value={text} onChange={(e) => setText(e.target.value)} onBlur={() => dirty && save()} spellCheck={false} />
      <div className="mt-2 flex gap-2">
        {q.edited && <button className="btn-ghost btn-sm" onClick={async () => { setText(q.aiQueryString); await save(q.aiQueryString); }}>Reset to AI version</button>}
      </div>
    </div>
  );
}

/** The criteria form, kept as typed (so spaces, commas and new lines survive while typing) and parsed on save. */
interface Draft { yearFrom: string; yearTo: string; languages: string; studyTypes: string; inclusion: string; exclusion: string; hardFilter: string[] }
const toDraft = (c: Criteria): Draft => ({ yearFrom: c.yearFrom?.toString() ?? "", yearTo: c.yearTo?.toString() ?? "", languages: c.languages.join(", "), studyTypes: c.studyTypes.join(", "), inclusion: c.inclusion.join("\n"), exclusion: c.exclusion.join("\n"), hardFilter: c.hardFilter ?? [] });
const commas = (s: string) => s.split(",").map((x) => x.trim()).filter(Boolean);
const lines = (s: string) => s.split("\n").map((x) => x.trim()).filter(Boolean);
const year = (s: string) => (s.trim() && Number.isFinite(Number(s)) ? Number(s) : null);
const fromDraft = (d: Draft, base: Criteria): Criteria => ({ ...base, yearFrom: year(d.yearFrom), yearTo: year(d.yearTo), languages: commas(d.languages), studyTypes: commas(d.studyTypes), inclusion: lines(d.inclusion), exclusion: lines(d.exclusion), hardFilter: d.hardFilter });
const critKey = (c: Criteria) => JSON.stringify([c.yearFrom, c.yearTo, c.languages, c.studyTypes, c.inclusion, c.exclusion, c.hardFilter ?? []]);

/**
 * Unsaved criteria edits, owned by the panel so the footer can show Save next to the primary action and lock
 * actions that would ignore them. A re-fetch (Count matches, another edit, a finished job) never wipes them.
 */
function useCriteriaDraft(saved: Criteria | null, onSaved: (d: SearchData) => void) {
  const { projectId, confirmEdit, refresh } = useSession();
  // Unsaved edits outlive the panel (closing it, or opening another topic's searches, keeps them).
  const kept = criteriaDrafts.get<Draft, Criteria>(projectId);
  const [draft, setDraft] = useState<Draft | null>(kept?.draft ?? (saved && toDraft(saved)));
  const [base, setBase] = useState<Criteria | null>(kept?.base ?? saved); // the saved criteria the draft started from
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<unknown>(null);
  // Compared as typed: a saved item containing a comma must not make a just-opened form look edited.
  const dirty = !!(draft && base && JSON.stringify(draft) !== JSON.stringify(toDraft(base)) && critKey(fromDraft(draft, base)) !== critKey(base));
  useEffect(() => {
    if (draft && base && dirty) criteriaDrafts.set(projectId, { draft, base }, true);
    else criteriaDrafts.clear(projectId);
  }, [projectId, draft, base, dirty]);
  useEffect(() => {
    if (!saved || (base && critKey(saved) === critKey(base))) return;
    if (!dirty) setDraft(toDraft(saved)); // newly saved criteria replace the form only when it has no unsaved changes
    setBase(saved);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saved]);
  async function save() {
    if (!draft || !base) return true;
    if (!(await confirmEdit(3))) return false; // the edits stay in the form, still marked unsaved
    setSaving(true);
    setErr(null);
    try {
      onSaved(await api(projectPath(projectId, "criteria"), { method: "PUT", body: fromDraft(draft, base) }));
      await refresh();
      return true;
    } catch (e) {
      setErr(e);
      return false;
    } finally {
      setSaving(false);
    }
  }
  return { draft, setDraft, dirty, saving, err, save, undo: () => base && setDraft(toDraft(base)) };
}

function CriteriaCard({ crit }: { crit: ReturnType<typeof useCriteriaDraft> }) {
  const c = crit.draft!;
  const set = (patch: Partial<Draft>) => crit.setDraft({ ...c, ...patch });
  const langs = commas(c.languages);
  return (
    <Disclosure title="Dates, languages and criteria" meta={`${c.yearFrom.trim() || "any"}–${c.yearTo.trim() || "now"} · ${langs.join(", ") || "any language"}${crit.dirty ? " · not saved" : ""}`}>
      <div className="grid grid-cols-2 gap-3">
        <label className="text-12 text-fg-1">From year
          <input type="number" className="input mt-1" value={c.yearFrom} onChange={(e) => set({ yearFrom: e.target.value })} />
        </label>
        <label className="text-12 text-fg-1">To year
          <input type="number" className="input mt-1" value={c.yearTo} placeholder="present" onChange={(e) => set({ yearTo: e.target.value })} />
        </label>
        <label className="text-12 text-fg-1">Languages (ISO codes)
          <input className="input mt-1" value={c.languages} onChange={(e) => set({ languages: e.target.value })} />
        </label>
        <label className="text-12 text-fg-1">Preferred study types
          <input className="input mt-1" value={c.studyTypes} onChange={(e) => set({ studyTypes: e.target.value })} />
        </label>
        <label className="col-span-2 text-12 text-fg-1">Inclusion (one per line)
          <textarea className="input mt-1 min-h-20" value={c.inclusion} onChange={(e) => set({ inclusion: e.target.value })} />
        </label>
        <label className="col-span-2 text-12 text-fg-1">Exclusion (one per line)
          <textarea className="input mt-1 min-h-20" value={c.exclusion} onChange={(e) => set({ exclusion: e.target.value })} />
        </label>
      </div>
      {crit.dirty && <p className="mt-2 flex items-center gap-2 text-12 text-fg-0"><AlertTriangle className="h-4 w-4 shrink-0 text-warn" strokeWidth={1.5} aria-hidden /> Not saved yet: use Save criteria at the bottom of the panel, or Undo.</p>}
      <p className="mt-2 text-12 text-fg-2">Years and languages are database filters, so changing them changes the match counts. Study types and inclusion/exclusion guide ranking and appraisal and go in the report; they do not remove papers or change the counts. These apply to every search.</p>
      <fieldset className="mt-4 rounded-md border border-warn-line p-3">
        <legend className="px-1 text-12 font-semibold text-fg-0">Hard filter on article type (optional)</legend>
        <p className="text-12 text-fg-1">Off by default. If you tick types here, <strong>only</strong> those are fetched. Databases label some papers wrongly or not at all, so this can silently leave out papers you would want. The usual way is to fetch everything and filter the table instead, which hides nothing for good.</p>
        <div className="mt-2 flex flex-wrap gap-3">
          {([["journal_article", "Original research articles"], ["review", "Reviews"], ["preprint", "Preprints"]] as const).map(([k, l]) => (
            <label key={k} className="flex min-h-11 items-center gap-2">
              <input type="checkbox" checked={c.hardFilter.includes(k)} onChange={(e) => set({ hardFilter: e.target.checked ? [...c.hardFilter, k] : c.hardFilter.filter((x) => x !== k) })} />
              {l}
            </label>
          ))}
        </div>
        {c.hardFilter.length ? <p role="status" className="mt-1 text-12 text-warn">Hard filter on: only {c.hardFilter.length} of 3 article types will be fetched. This is logged and listed in your report.</p> : null}
      </fieldset>
      {crit.err ? <div className="mt-2"><ErrorState error={crit.err} /></div> : null}
    </Disclosure>
  );
}
