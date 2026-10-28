"use client";
import { useState } from "react";
import { api, projectPath, useApi } from "../api";
import { Badge, EmptyState, ErrorState, Loading, Spinner, cx } from "../ui";
import { JobPanel, SectionTitle, useJobRefresh, useWizard } from "../wizard/Wizard";
import { ClaimChip, type ClaimRef, type PaperRef } from "./SynthesisStage";
import { FinalSummary } from "./FinalSummary";

interface Match { title: string; year: number | null; doi: string | null; pmid: string | null; openalexId: string | null; database: string; similarityNote: string }
export interface RQ {
  id: string; text: string; framework: string; structure: Record<string, string>; design: string; gap: string; feasibility: string; weakness: string;
  noveltyQueries: { database: string; query: string; count: number | null; error: string | null }[];
  noveltyMatches: Match[]; noveltyStatus: string; chosen: boolean; edited: boolean; claimIds: string[];
}
export interface QData { questions: RQ[]; claims: Record<string, ClaimRef>; papers: Record<string, PaperRef> }

export function QuestionsStage() {
  const { projectId, states, refresh } = useWizard();
  const { data, error, isLoading, mutate } = useApi<QData>(projectPath(projectId, "questions"));
  useJobRefresh(9, mutate);
  const [err, setErr] = useState<unknown>(null);
  if (states["8"] !== "approved" && (states["9"] ?? "not_started") === "not_started") return <EmptyState title="Approve the synthesis first">Questions are built from the synthesis gaps.</EmptyState>;
  if (isLoading) return <Loading />;
  if (error) return <ErrorState error={error} onRetry={() => mutate()} />;
  if (!data) return null;
  if (states["9"] === "approved") return <FinalSummary data={data} />;

  async function choose(id: string) {
    setErr(null);
    try {
      await mutate(await api<QData>(projectPath(projectId, `questions/${id}/choose`), { body: {} }), { revalidate: false });
      await refresh();
    } catch (e) {
      setErr(e);
    }
  }
  const chosen = data.questions.find((q) => q.chosen);

  return (
    <div className="space-y-4">
      <JobPanel stage={9} runLabel="Propose questions" />
      {err ? <ErrorState error={err} /> : null}
      {!data.questions.length ? (
        <EmptyState title="No candidate questions yet">Run this step to propose three questions.</EmptyState>
      ) : (
        <>
          <p className="text-sm text-gray-600">Compare the three candidates side by side. Each states the gap it addresses (with the evidence behind it), how feasible it is, and its main weakness. The novelty check shows the closest existing studies a fresh search found — <strong>it is not proof that a question is new</strong>.</p>
          <div className="grid gap-4 xl:grid-cols-3">
            {data.questions.map((q, i) => (
              <article key={q.id} className={cx("card flex flex-col p-4", q.chosen && "ring-2 ring-teal-600")} aria-label={`Candidate ${i + 1}`}>
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">Candidate {i + 1}</span>
                  <span className="flex gap-1"><Badge tone="sky">{q.framework}</Badge>{q.edited && <Badge tone="teal">edited</Badge>}</span>
                </div>
                <h3 className="font-semibold leading-snug text-gray-900">{q.text}</h3>
                <dl className="mt-3 space-y-1 text-sm">
                  {Object.entries(q.structure).map(([k, v]) => (
                    <div key={k} className="grid grid-cols-[96px_1fr] gap-2"><dt className="text-gray-500">{k}</dt><dd className="text-gray-800">{v}</dd></div>
                  ))}
                  {!Object.keys(q.structure).some((k) => /design/i.test(k)) && <div className="grid grid-cols-[96px_1fr] gap-2"><dt className="text-gray-500">Design</dt><dd className="text-gray-800">{q.design}</dd></div>}
                </dl>
                <Block title="Gap it addresses">
                  <p>{q.gap}</p>
                  <div className="mt-1 flex flex-wrap gap-1">{q.claimIds.map((id) => <ClaimChip key={id} id={id} claims={data.claims} papers={data.papers} />)}</div>
                </Block>
                <Block title="Feasibility">{q.feasibility}</Block>
                <Block title="Main weakness">{q.weakness}</Block>
                <Novelty q={q} onRerun={(d) => mutate(d, { revalidate: false })} />
                <div className="mt-auto pt-4">
                  <button className={q.chosen ? "btn-secondary w-full" : "btn-primary w-full"} onClick={() => choose(q.id)} disabled={q.chosen} aria-pressed={q.chosen}>{q.chosen ? "✓ Chosen" : "Choose this question"}</button>
                </div>
              </article>
            ))}
          </div>
          {chosen && <EditChosen q={chosen} onSaved={(d) => mutate(d, { revalidate: false })} />}
        </>
      )}
    </div>
  );
}

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mt-3 text-sm text-gray-800">
      <p className="label">{title}</p>
      <div>{children}</div>
    </div>
  );
}

function Novelty({ q, onRerun }: { q: RQ; onRerun: (d: QData) => void }) {
  const { projectId } = useWizard();
  const [busy, setBusy] = useState(false);
  return (
    <div className="mt-3 rounded-lg bg-gray-50 p-2.5 text-xs">
      <div className="flex items-center justify-between">
        <p className="font-semibold text-gray-700">Novelty check — here is what was found</p>
        <button className="btn-ghost px-1.5 py-0.5 text-[11px]" disabled={busy} onClick={async () => { setBusy(true); try { onRerun(await api(projectPath(projectId, `questions/${q.id}/novelty`), { body: {} })); } finally { setBusy(false); } }}>{busy ? <Spinner className="h-3 w-3" /> : "Re-run"}</button>
      </div>
      <ul className="mt-1 space-y-0.5 text-gray-500">
        {q.noveltyQueries.map((n) => (
          <li key={n.database}><strong>{n.database}</strong>: {n.error ? <span className="text-rose-700">failed — {n.error}</span> : `${n.count?.toLocaleString() ?? "?"} matching records`} <code className="block truncate text-[10px]" title={n.query}>{n.query}</code></li>
        ))}
      </ul>
      {q.noveltyStatus === "pending" && <p className="mt-1 text-gray-500">Searching…</p>}
      <ol className="mt-2 space-y-1.5">
        {q.noveltyMatches.slice(0, 6).map((m, i) => (
          <li key={i} className="text-gray-800">
            {m.title} <span className="text-gray-500">({m.year ?? "n.d."})</span>
            <span className="block text-[10px] text-gray-500">
              {m.doi ? <a className="underline" href={`https://doi.org/${m.doi}`} target="_blank" rel="noreferrer">DOI {m.doi}</a> : m.pmid ? <a className="underline" href={`https://pubmed.ncbi.nlm.nih.gov/${m.pmid}/`} target="_blank" rel="noreferrer">PMID {m.pmid}</a> : m.openalexId ? `OpenAlex ${m.openalexId}` : ""} · {m.similarityNote}
            </span>
          </li>
        ))}
        {q.noveltyStatus === "done" && !q.noveltyMatches.length && <li className="text-gray-500">No closely matching records were returned. This does not prove the question is new.</li>}
      </ol>
    </div>
  );
}

function EditChosen({ q, onSaved }: { q: RQ; onSaved: (d: QData) => void }) {
  const { projectId, refresh } = useWizard();
  const [text, setText] = useState(q.text);
  const [structure, setStructure] = useState(q.structure);
  const [design, setDesign] = useState(q.design);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<unknown>(null);
  const dirty = text !== q.text || JSON.stringify(structure) !== JSON.stringify(q.structure) || design !== q.design;
  return (
    <section className="card p-4" aria-label="Edit the chosen question">
      <SectionTitle>Refine your chosen question</SectionTitle>
      <label htmlFor="chosen-question" className="block text-xs text-gray-600">Question</label>
      <textarea id="chosen-question" className="input mt-0.5 min-h-16 text-base" value={text} onChange={(e) => setText(e.target.value)} />
      <div className="mt-3 grid gap-3 md:grid-cols-2">
        {Object.entries(structure).map(([k, v]) => (
          <label key={k} className="text-xs text-gray-600">{k}
            <input className="input mt-0.5" value={v} onChange={(e) => setStructure({ ...structure, [k]: e.target.value })} />
          </label>
        ))}
        <label className="text-xs text-gray-600">Design
          <input className="input mt-0.5" value={design} onChange={(e) => setDesign(e.target.value)} />
        </label>
      </div>
      {err ? <div className="mt-2"><ErrorState error={err} /></div> : null}
      <div className="mt-3 flex justify-end gap-2">
        {dirty && <button className="btn-ghost" onClick={() => { setText(q.text); setStructure(q.structure); setDesign(q.design); }}>Undo</button>}
        <button className="btn-primary" disabled={!dirty || busy} onClick={async () => { setBusy(true); setErr(null); try { onSaved(await api(projectPath(projectId, `questions/${q.id}`), { method: "PATCH", body: { text, structure, design } })); await refresh(); } catch (e) { setErr(e); } finally { setBusy(false); } }}>
          {busy && <Spinner />} Save edits
        </button>
      </div>
      <p className="mt-2 text-xs text-gray-500">When you are happy, press “Finish and see summary” below.</p>
    </section>
  );
}
