"use client";
import { useState } from "react";
import { Check } from "lucide-react";
import { api, projectPath, useApi } from "../api";
import { Badge, EmptyState, ErrorState, Loading, Spinner, cx } from "../ui";
import { Disclosure } from "../disclosure";
import { useJobRefresh, useSession } from "../session/SessionContext";
import { ActionButton, JobLog, JobStatus, PanelFooter, StaleNotice } from "./common";
import { ClaimChip, type ClaimRef, type PaperRef } from "./evidence";
import { nextAction } from "@/lib/canvas/actions";
import { fmtInt } from "@/lib/shared/format";

interface Match { title: string; year: number | null; doi: string | null; pmid: string | null; openalexId: string | null; database: string; similarityNote: string }
export interface RQ {
  id: string; text: string; framework: string; structure: Record<string, string>; design: string; gap: string; feasibility: string; weakness: string;
  noveltyQueries: { database: string; query: string; count: number | null; error: string | null }[];
  noveltyMatches: Match[]; noveltyStatus: string; chosen: boolean; edited: boolean; claimIds: string[];
}
export interface QData { questions: RQ[]; claims: Record<string, ClaimRef>; papers: Record<string, PaperRef> }

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
  const [err, setErr] = useState<unknown>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const node = graph.nodes.find((n) => n.id === "questions");
  const action = node ? nextAction(node, graph, input) : null;
  if (isLoading) return <Loading />;
  if (error) return <ErrorState error={error} onRetry={() => mutate()} />;
  if (!data) return null;
  const finished = states["9"] === "approved";

  async function choose(id: string) {
    setErr(null);
    setBusy(id);
    try {
      await mutate(await api<QData>(projectPath(projectId, `questions/${id}/choose`), { body: {} }), { revalidate: false });
      await refresh();
    } catch (e) {
      setErr(e);
    } finally {
      setBusy(null);
    }
  }
  const chosen = data.questions.find((q) => q.chosen);

  return (
    <div className="space-y-4">
      <StaleNotice stage={9} />
      {states["9"] === "running" && <JobStatus stage={9} />}
      {err ? <ErrorState error={err} /> : null}
      {!data.questions.length ? (
        <EmptyState title="No candidate questions yet">Three are proposed from the gaps in the synthesis.</EmptyState>
      ) : (
        <>
          <p className="text-fg-1">Each candidate names the gap it addresses, with the evidence behind it. The novelty check shows the closest existing studies a fresh search found; it is not proof that a question is new.</p>
          <ul className="space-y-3" aria-label="Candidate research questions">
            {data.questions.map((q, i) => (
              <li key={q.id} className={cx("rounded-md border p-3", q.chosen ? "border-fg-1" : "border-line")} aria-label={`Candidate ${i + 1}`}>
                <div className="mb-2 flex items-center justify-between gap-2">
                  <span className="text-12 text-fg-2">Candidate {i + 1}</span>
                  <span className="flex gap-1"><Badge>{q.framework}</Badge>{q.edited && <Badge>edited</Badge>}</span>
                </div>
                <p className="font-medium leading-snug">{q.text}</p>
                <div className="mt-3 flex items-center gap-2">
                  <button className={cx("btn-secondary", q.chosen && "border-fg-0")} onClick={() => choose(q.id)} disabled={q.chosen || finished || !!busy} aria-pressed={q.chosen}>
                    {busy === q.id ? <Spinner /> : q.chosen ? <Check className="h-4 w-4" strokeWidth={1.5} aria-hidden /> : null}
                    {q.chosen ? "Chosen" : "Choose this question"}
                  </button>
                </div>
                <div className="mt-3">
                  <Disclosure title="Why this question" meta={`${q.claimIds.length} evidence`}>
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
                    <Novelty q={q} onRerun={(d) => mutate(d, { revalidate: false })} />
                  </Disclosure>
                </div>
              </li>
            ))}
          </ul>
          {chosen && !finished && <EditChosen key={chosen.id} q={chosen} onSaved={(d) => mutate(d, { revalidate: false })} />}
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

function Novelty({ q, onRerun }: { q: RQ; onRerun: (d: QData) => void }) {
  const { projectId } = useSession();
  const [busy, setBusy] = useState(false);
  return (
    <div className="mt-3 rounded-sm bg-bg-2 p-3 text-12">
      <div className="flex items-center justify-between gap-2">
        <p className="font-medium text-fg-1">Novelty check: what was found</p>
        <button className="btn-ghost btn-sm" disabled={busy} onClick={async () => { setBusy(true); try { onRerun(await api(projectPath(projectId, `questions/${q.id}/novelty`), { body: {} })); } finally { setBusy(false); } }}>{busy ? <Spinner className="h-3 w-3" /> : "Re-run"}</button>
      </div>
      <ul className="mt-1 space-y-1 text-fg-2">
        {q.noveltyQueries.map((n) => (
          <li key={n.database}><strong className="font-medium">{n.database}</strong>: {n.error ? <span className="text-err">failed: {n.error}</span> : `${n.count == null ? "?" : fmtInt(n.count)} matching records`}<code className="block truncate font-mono" title={n.query}>{n.query}</code></li>
        ))}
      </ul>
      {q.noveltyStatus === "pending" && <p className="mt-1 text-fg-2">Searching…</p>}
      <ol className="mt-2 space-y-2">
        {q.noveltyMatches.slice(0, 6).map((m, i) => (
          <li key={i} className="text-fg-1">
            {m.title} <span className="text-fg-2">({m.year ?? "n.d."})</span>
            <span className="block text-fg-2">
              {m.doi ? <a className="link" href={`https://doi.org/${m.doi}`} target="_blank" rel="noreferrer">DOI {m.doi}</a> : m.pmid ? <a className="link" href={`https://pubmed.ncbi.nlm.nih.gov/${m.pmid}/`} target="_blank" rel="noreferrer">PMID {m.pmid}</a> : m.openalexId ? `OpenAlex ${m.openalexId}` : ""} · {m.similarityNote}
            </span>
          </li>
        ))}
        {q.noveltyStatus === "done" && !q.noveltyMatches.length && <li className="text-fg-2">No closely matching records were returned. This does not prove the question is new.</li>}
      </ol>
    </div>
  );
}

function EditChosen({ q, onSaved }: { q: RQ; onSaved: (d: QData) => void }) {
  const { projectId, refresh } = useSession();
  const [text, setText] = useState(q.text);
  const [structure, setStructure] = useState(q.structure);
  const [design, setDesign] = useState(q.design);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<unknown>(null);
  const dirty = text !== q.text || JSON.stringify(structure) !== JSON.stringify(q.structure) || design !== q.design;
  return (
    <Disclosure title="Refine the chosen question">
      <label htmlFor="chosen-question" className="label">Question</label>
      <textarea id="chosen-question" className="input min-h-16" value={text} onChange={(e) => setText(e.target.value)} />
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
      {err ? <div className="mt-2"><ErrorState error={err} /></div> : null}
      <div className="mt-3 flex justify-end gap-2">
        {dirty && <button className="btn-ghost" onClick={() => { setText(q.text); setStructure(q.structure); setDesign(q.design); }}>Undo</button>}
        <button className="btn-secondary" disabled={!dirty || busy} onClick={async () => { setBusy(true); setErr(null); try { onSaved(await api(projectPath(projectId, `questions/${q.id}`), { method: "PATCH", body: { text, structure, design } })); await refresh(); } catch (e) { setErr(e); } finally { setBusy(false); } }}>
          {busy && <Spinner />} Save edits
        </button>
      </div>
    </Disclosure>
  );
}
