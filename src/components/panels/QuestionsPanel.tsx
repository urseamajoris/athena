"use client";
import { useEffect, useRef, useState } from "react";
import { AlertTriangle, Check, Pencil } from "lucide-react";
import { api, projectPath, useApi } from "../api";
import { Badge, EmptyState, ErrorState, Loading, Spinner, cx } from "../ui";
import { Disclosure } from "../disclosure";
import { useJobRefresh, useSession } from "../session/SessionContext";
import { ActionButton, JobLog, JobStatus, PanelFooter, StaleNotice } from "./common";
import { ClaimChip, type ClaimRef, type PaperRef } from "./evidence";
import { nextAction } from "@/lib/canvas/actions";
import { fmtInt } from "@/lib/shared/format";
import { noveltyVerdict } from "@/lib/shared/novelty";
import { WhatHappens } from "../guide/WhatHappens";

/** What each question framework's letters stand for (shown next to its name, never as a bare acronym). */
const FRAMEWORK: Record<string, string> = {
  PICO: "Population, Intervention, Comparison, Outcome",
  PICo: "Population, phenomenon of Interest, Context",
  PECO: "Population, Exposure, Comparison, Outcome",
  PEO: "Population, Exposure, Outcome",
  SPIDER: "Sample, Phenomenon of Interest, Design, Evaluation, Research type",
  SPICE: "Setting, Perspective, Intervention, Comparison, Evaluation",
};

/**
 * The framework a candidate actually uses, read from the parts of its structure: the declared name can disagree
 * with the parts the model filled in, and the card describes what is there, not what was claimed.
 */
function frameworkOf(q: { framework: string; structure: Record<string, string> }): string {
  const keys = Object.keys(q.structure).map((k) => k.toLowerCase());
  const has = (re: RegExp) => keys.some((k) => re.test(k));
  if (has(/^sample/) && has(/evaluation/)) return "SPIDER";
  if (has(/^setting/) && has(/perspective/)) return "SPICE";
  if (has(/intervention/)) return "PICO";
  if (has(/exposure/)) return has(/compar/) ? "PECO" : "PEO";
  if (has(/interest|phenomen/) && has(/context/)) return "PICo";
  return q.framework;
}

interface Match { title: string; year: number | null; doi: string | null; pmid: string | null; openalexId: string | null; database: string; similarityNote: string }
export interface RQ {
  id: string; text: string; framework: string; structure: Record<string, string>; design: string; gap: string; feasibility: string; weakness: string;
  noveltyQueries: { database: string; query: string; count: number | null; error: string | null }[];
  noveltyMatches: Match[]; noveltyStatus: string; chosen: boolean; edited: boolean; claimIds: string[];
}
export interface QData { questions: RQ[]; claims: Record<string, ClaimRef>; papers: Record<string, PaperRef>; ownTitles?: string[] }

export function useQuestions() {
  const { projectId } = useSession();
  const r = useApi<QData>(projectPath(projectId, "questions"));
  useJobRefresh(9, r.mutate);
  return r;
}

/** Questions node: choose one of three research questions, then export. */
export function QuestionsPanel() {
  const { projectId, refresh, states, graph, input } = useSession();
  const { data, error, isLoading, mutate } = useQuestions();
  // Demo mode: the novelty search returns recorded sample records, which the verdict must say.
  const status = useApi<{ mockMode: boolean }>("/api/status").data;
  const demo = !!status?.mockMode;
  const known = !!status; // until the mode is known, no "may already be studied" warning (demo records would flash it)
  const [err, setErr] = useState<unknown>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  // Closing the editor removes the button that had focus: give focus back to "Edit this question".
  const editBtn = useRef<HTMLButtonElement>(null);
  const refocus = useRef(false);
  const closeEditor = () => { refocus.current = true; setEditing(false); };
  useEffect(() => {
    if (!editing && refocus.current) {
      refocus.current = false;
      editBtn.current?.focus();
    }
  }, [editing]);
  const node = graph.nodes.find((n) => n.id === "questions");
  const action = node ? nextAction(node, graph, input) : null;
  if (isLoading) return <Loading />;
  if (error) return <ErrorState error={error} onRetry={() => mutate()} />;
  if (!data) return null;
  const finished = states["9"] === "approved";

  async function choose(id: string) {
    setErr(null);
    setBusy(id);
    setEditing(false);
    try {
      await mutate(await api<QData>(projectPath(projectId, `questions/${id}/choose`), { body: {} }), { revalidate: false });
      await refresh();
    } catch (e) {
      setErr(e);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-4">
      <StaleNotice stage={9} />
      {states["9"] === "running" && <JobStatus stage={9} />}
      {err ? <ErrorState error={err} /> : null}
      {!data.questions.length ? (
        <EmptyState title="No candidate questions yet">Three are proposed from the gaps in the synthesis.</EmptyState>
      ) : (
        <>
          <WhatHappens stage={9} />
          <p className="text-fg-1">Compare the gap each one fills, how feasible it is and its main weakness, then choose one. Once chosen, “Edit this question” lets you change its wording.</p>
          <p className="text-12 text-fg-2">The novelty check searches the databases again for each question and compares the top records with it. Finding no similar study does not prove a question is new.</p>
          <ul className="space-y-3" aria-label="Candidate research questions">
            {data.questions.map((q, i) => {
              const fw = frameworkOf(q);
              const v = noveltyVerdict(q, { demo, ownTitles: data.ownTitles });
              // Top records whose titles look like this very question: warned about on the card itself, not only in
              // the reasoning. Not in demo mode, where the records are recorded samples unrelated to the question.
              const same = demo || !known ? [] : q.noveltyMatches.filter((_, j) => v.close[j]);
              return (
              <li key={q.id} className={cx("rounded-md border p-3", q.chosen ? "border-fg-1" : "border-line")} aria-label={`Candidate ${i + 1}`}>
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  {/* No "a question about …" label: the framework says how the question is structured, not what it asks. */}
                  <span className="text-12 text-fg-2">Candidate {i + 1}</span>
                  {q.edited && <Badge>edited</Badge>}
                </div>
                {q.chosen && editing ? (
                  <EditChosen key={q.id} q={q} finished={finished} onSaved={(d) => { mutate(d, { revalidate: false }); closeEditor(); }} onCancel={closeEditor} />
                ) : (
                  <p className="font-medium leading-snug">{q.text}</p>
                )}
                <dl className="mt-2 grid grid-cols-[88px_1fr] gap-x-2 gap-y-1 text-12">
                  <dt className="text-fg-2">Gap it fills</dt><dd className="line-clamp-2 text-fg-1">{q.gap}</dd>
                  <dt className="text-fg-2">Feasibility</dt><dd className="line-clamp-2 text-fg-1">{q.feasibility}</dd>
                  <dt className="text-fg-2">Weakness</dt><dd className="line-clamp-2 text-fg-1">{q.weakness}</dd>
                  <dt className="text-fg-2">Structure</dt><dd className="text-fg-1">{fw}{FRAMEWORK[fw] ? ` (${FRAMEWORK[fw]})` : ""}</dd>
                  <dt className="text-fg-2">Novelty check</dt><dd className="text-fg-1">{v.headline}{demo && <span className="text-fg-2"> (demo: sample records)</span>}</dd>
                </dl>
                {same.length + v.own.length > 0 && (
                  <div role="note" className="mt-2 rounded-md border border-warn-line bg-warn-soft px-3 py-2 text-12">
                    <p className="flex items-start gap-2 text-fg-0">
                      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warn" strokeWidth={1.5} aria-hidden />
                      <span><strong className="font-semibold">May already be studied:</strong> {same.length + v.own.length === 1 ? "this paper looks" : `these ${same.length + v.own.length} papers look`} like the same question. Read {same.length + v.own.length === 1 ? "it" : "them"} before you choose this one.</span>
                    </p>
                    <ul className="mt-1 space-y-1 pl-6">
                      {v.own.map((t) => <li key={t} className="text-fg-1">{t} <span className="text-fg-2">(already in this review)</span></li>)}
                      {same.map((m, j) => <li key={j} className="text-fg-1">{m.title} <span className="text-fg-2">({m.year ?? "n.d."})</span> <MatchLink m={m} /></li>)}
                    </ul>
                  </div>
                )}
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <button className={cx("btn-secondary", q.chosen && "border-fg-0")} onClick={() => choose(q.id)} disabled={q.chosen || finished || !!busy} aria-pressed={q.chosen}>
                    {busy === q.id ? <Spinner /> : q.chosen ? <Check className="h-4 w-4" strokeWidth={1.5} aria-hidden /> : null}
                    {q.chosen ? "Chosen" : <>Choose this question<span className="sr-only"> (candidate {i + 1})</span></>}
                  </button>
                  {q.chosen && !editing && (
                    <button ref={editBtn} className="btn-secondary" onClick={() => setEditing(true)}>
                      <Pencil className="h-4 w-4" strokeWidth={1.5} aria-hidden /> Edit this question
                    </button>
                  )}
                </div>
                <div className="mt-3">
                  <Disclosure title={<>Full reasoning and quotes<span className="sr-only"> (candidate {i + 1})</span></>} meta={`${q.claimIds.length} supporting quote${q.claimIds.length === 1 ? "" : "s"}`}>
                    <dl className="space-y-1">
                      {Object.entries(q.structure).map(([k, v]) => (
                        <div key={k} className="grid grid-cols-[96px_1fr] gap-2"><dt className="text-fg-2">{k}</dt><dd>{v}</dd></div>
                      ))}
                      {!Object.keys(q.structure).some((k) => /design/i.test(k)) && <div className="grid grid-cols-[96px_1fr] gap-2"><dt className="text-fg-2">Design</dt><dd>{q.design}</dd></div>}
                    </dl>
                    <h4 className="label mt-3">Gap it addresses</h4>
                    <p>{q.gap}</p>
                    <div className="mt-1 flex flex-wrap gap-1">{q.claimIds.map((id) => <ClaimChip key={id} id={id} claims={data.claims} papers={data.papers} />)}</div>
                    <h4 className="label mt-3">Feasibility</h4>
                    <p>{q.feasibility}</p>
                    <h4 className="label mt-3">Main weakness</h4>
                    <p>{q.weakness}</p>
                    <Novelty q={q} demo={demo} ownTitles={data.ownTitles} onRerun={(d) => mutate(d, { revalidate: false })} />
                  </Disclosure>
                </div>
              </li>
              );
            })}
          </ul>
        </>
      )}
      <JobLog stage={9} />
      {action && (
        <PanelFooter>
          <ActionButton action={action} primary showReason />
        </PanelFooter>
      )}
    </div>
  );
}

/** Where to read a novelty record: its DOI, else PubMed, else its OpenAlex ID. */
function MatchLink({ m }: { m: Match }) {
  if (m.doi) return <a className="link" href={`https://doi.org/${m.doi}`} target="_blank" rel="noreferrer">DOI {m.doi}</a>;
  if (m.pmid) return <a className="link" href={`https://pubmed.ncbi.nlm.nih.gov/${m.pmid}/`} target="_blank" rel="noreferrer">PMID {m.pmid}</a>;
  return m.openalexId ? <>OpenAlex {m.openalexId}</> : null;
}

function Novelty({ q, demo, ownTitles, onRerun }: { q: RQ; demo: boolean; ownTitles?: string[]; onRerun: (d: QData) => void }) {
  const { projectId } = useSession();
  const [busy, setBusy] = useState(false);
  const v = noveltyVerdict(q, { demo, ownTitles });
  return (
    <div className="mt-3 rounded-sm bg-bg-2 p-3 text-12">
      <div className="flex items-center justify-between gap-2">
        <p className="font-medium text-fg-1">Novelty check: what was found</p>
        <button className="btn-ghost btn-sm" disabled={busy} onClick={async () => { setBusy(true); try { onRerun(await api(projectPath(projectId, `questions/${q.id}/novelty`), { body: {} })); } finally { setBusy(false); } }}>{busy ? <Spinner className="h-3 w-3" /> : "Re-run"}</button>
      </div>
      {/* The verdict first: whether a top record looks like the same question, then what the counts mean. */}
      <p className="mt-1 text-fg-0">{v.headline}</p>
      {v.notes.map((n) => <p key={n} className="mt-1 text-fg-1">{n}</p>)}
      <ul className="mt-2 space-y-1 text-fg-2">
        {q.noveltyQueries.map((n) => (
          <li key={n.database}><strong className="font-medium">{n.database}</strong>: {n.error ? <span className="text-err">failed: {n.error}</span> : `${n.count == null ? "?" : fmtInt(n.count)} records contain the search words${demo ? " (sample count)" : ""}`}<code className="block truncate font-mono" title={n.query}>{n.query}</code></li>
        ))}
      </ul>
      {q.noveltyMatches.length > 0 && <p className="mt-2 text-fg-2">Top records{demo ? " (recorded samples)" : ""}:</p>}
      <ol className="mt-1 space-y-2">
        {q.noveltyMatches.map((m, i) => (
          <li key={i} className="text-fg-1">
            {m.title} <span className="text-fg-2">({m.year ?? "n.d."})</span>
            <span className="block text-fg-2">
<MatchLink m={m} /> · {m.similarityNote}
            </span>
            {v.close[i] && <span className="mt-0.5 flex items-center gap-1 font-medium text-fg-0"><AlertTriangle className="h-3 w-3 shrink-0 text-warn" strokeWidth={2} aria-hidden /> Looks like the same question</span>}
          </li>
        ))}
      </ol>
    </div>
  );
}

/** In place of the chosen question's text: its wording, structure and design, editable. */
function EditChosen({ q, finished, onSaved, onCancel }: { q: RQ; finished: boolean; onSaved: (d: QData) => void; onCancel: () => void }) {
  const { projectId, refresh } = useSession();
  const [text, setText] = useState(q.text);
  const [structure, setStructure] = useState(q.structure);
  const [design, setDesign] = useState(q.design);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<unknown>(null);
  const dirty = text !== q.text || JSON.stringify(structure) !== JSON.stringify(q.structure) || design !== q.design;
  return (
    <div role="group" aria-label="Edit the chosen question" className="rounded-sm bg-bg-2 p-3">
      <label htmlFor="chosen-question" className="label">Question</label>
      <textarea id="chosen-question" className="input min-h-16" value={text} onChange={(e) => setText(e.target.value)} autoFocus />
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        {Object.entries(structure).map(([k, v]) => (
          <label key={k} className="text-12 text-fg-1">{k}
            <input className="input mt-1" value={v} onChange={(e) => setStructure({ ...structure, [k]: e.target.value })} />
          </label>
        ))}
        <label className="text-12 text-fg-1">Design
          <input className="input mt-1" value={design} onChange={(e) => setDesign(e.target.value)} />
        </label>
      </div>
      {finished && <p className="mt-2 text-12 text-fg-2">Saving reopens step 9: press “Finish and export” again to update the report.</p>}
      {err ? <div className="mt-2"><ErrorState error={err} /></div> : null}
      <div className="mt-3 flex justify-end gap-2">
        <button className="btn-ghost" onClick={onCancel}>Cancel</button>
        <button className="btn-secondary" disabled={!dirty || busy} onClick={async () => { setBusy(true); setErr(null); try { onSaved(await api(projectPath(projectId, `questions/${q.id}`), { method: "PATCH", body: { text, structure, design } })); await refresh(); } catch (e) { setErr(e); } finally { setBusy(false); } }}>
          {busy && <Spinner />} Save edits
        </button>
      </div>
    </div>
  );
}
