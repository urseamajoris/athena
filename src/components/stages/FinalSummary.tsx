"use client";
import { api, projectPath, useApi } from "../api";
import { Badge } from "../ui";
import { SectionTitle, useWizard } from "../wizard/Wizard";
import { ClaimChip } from "./SynthesisStage";
import type { QData } from "./QuestionsStage";

interface Retrieval { uniquePapers: number; runs: { status: string; database: string }[] }
interface Apps { appraisals: { textSource: string; status: string; counts: { verified: number; unverified: number; accepted: number } }[] }

export function FinalSummary({ data }: { data: QData }) {
  const { projectId, project, refresh, goTo } = useWizard();
  const { data: r } = useApi<Retrieval>(projectPath(projectId, "retrieval"));
  const { data: a } = useApi<Apps>(projectPath(projectId, "appraisals"));
  const q = data.questions.find((x) => x.chosen);
  const apps = a?.appraisals ?? [];
  const verified = apps.reduce((s, x) => s + x.counts.verified, 0);
  const unverified = apps.reduce((s, x) => s + x.counts.unverified, 0);
  return (
    <div className="space-y-5">
      <section className="card border-line-strong p-6">
        <p className="text-12 font-semibold text-fg-0">Your research question</p>
        <h2 className="mt-1 text-20 font-semibold leading-snug text-fg-0">{q?.text}</h2>
        {q && (
          <dl className="mt-4 grid gap-x-6 gap-y-1 text-14 sm:grid-cols-2">
            {Object.entries(q.structure).map(([k, v]) => <div key={k} className="flex gap-2"><dt className="w-28 shrink-0 text-fg-2">{k}</dt><dd>{v}</dd></div>)}
            {!Object.keys(q.structure).some((k) => /design/i.test(k)) && <div className="flex gap-2"><dt className="w-28 shrink-0 text-fg-2">Design</dt><dd>{q.design}</dd></div>}
          </dl>
        )}
        {q && (
          <div className="mt-4 text-14">
            <p className="font-medium text-fg-0">Gap: <span className="font-normal">{q.gap}</span></p>
            <div className="mt-1 flex flex-wrap gap-1">{q.claimIds.map((id) => <ClaimChip key={id} id={id} claims={data.claims} papers={data.papers} />)}</div>
            <p className="mt-2 text-fg-1"><strong>Feasibility:</strong> {q.feasibility}</p>
            <p className="mt-1 text-fg-1"><strong>Main weakness:</strong> {q.weakness}</p>
            <p className="mt-2 text-12 text-fg-2">Novelty check: {q.noveltyMatches.length} closest existing studies found ({q.noveltyQueries.map((n) => `${n.database}: ${n.count ?? "?"} hits`).join(", ")}). This is what the search found, not proof of novelty.</p>
          </div>
        )}
      </section>

      <section className="grid gap-3 sm:grid-cols-4">
        <Stat label="Unique papers retrieved" value={r?.uniquePapers ?? "…"} />
        <Stat label="Papers appraised" value={apps.length} />
        <Stat label="Full text / abstract only" value={`${apps.filter((x) => x.textSource === "full_text").length} / ${apps.filter((x) => x.textSource !== "full_text").length}`} />
        <Stat label="Quotes verified / unverified" value={`${verified} / ${unverified}`} />
      </section>

      <section className="card p-5">
        <SectionTitle>Export</SectionTitle>
        <div className="flex flex-wrap gap-2">
          <a className="btn-primary" href={projectPath(projectId, "export/markdown")}>Download report (Markdown)</a>
          <a className="btn-secondary" href={projectPath(projectId, "export/csv")}>Summary table (CSV)</a>
          <a className="btn-secondary" href={projectPath(projectId, "export/bibtex")}>Selected papers (BibTeX)</a>
        </div>
        <p className="mt-3 text-14 text-fg-1">The report includes the full search strategy with dates and counts, every selection you changed, the appraisals with their verified quotes, the synthesis and the decision log, so the review can be reproduced.</p>
      </section>

      <section className="card p-5 text-14">
        <SectionTitle>Idea</SectionTitle>
        <p className="text-fg-0">{project.idea}</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <button className="btn-secondary" onClick={async () => { await api(projectPath(projectId, "stages/9/reopen"), { body: {} }); await refresh(); }}>Edit the question again</button>
          <button className="btn-ghost" onClick={() => goTo(8)}>Back to synthesis</button>
          <Badge tone="emerald">Review complete</Badge>
        </div>
      </section>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="card px-4 py-3">
      <p className="text-12 text-fg-2">{label}</p>
      <p className="text-20 font-semibold tabular-nums text-fg-0">{value}</p>
    </div>
  );
}
