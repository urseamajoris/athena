"use client";
import { useEffect, useRef } from "react";
import { projectPath, useApi } from "../api";
import { AbstractBadge, Badge, ErrorState, Loading, TextSourceBadge } from "../ui";
import { RUBRIC, STUDY_TYPE_LABEL, type StudyType } from "@/lib/shared/stages";
import { useWizard } from "./Wizard";

interface Detail {
  paper: { id: string; title: string; authors: string[]; year: number | null; journal: string | null; abstract: string | null; doi: string | null; pmid: string | null; pmcid: string | null; openalexId: string | null; citationCount: number | null; oaUrl: string | null; oaStatus: string | null; license: string | null; sourceDatabases: string[]; publicationTypes: string[] };
  summary: { studyType: string; setting: string; keyFinding: string; edited: boolean } | null;
  appraisal: { id: string; status: string; textSource: string } | null;
  foundBy: { database?: string; query?: string; topic?: string; rank: number; wasNew: boolean }[];
  scores: { id: string; topicName?: string; total: number; selected: boolean; rationale: string; subScores: Record<string, number>; rationales: Record<string, string> }[];
}

export function PaperDrawer({ paperId, onClose }: { paperId: string | null; onClose: () => void }) {
  const { projectId } = useWizard();
  const { data, error, isLoading } = useApi<Detail>(paperId ? projectPath(projectId, `papers/${paperId}`) : null);
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!paperId) return;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [paperId, onClose]);
  if (!paperId) return null;
  const p = data?.paper;
  return (
    <>
      <div className="fixed inset-0 z-40 bg-scrim" onClick={onClose} aria-hidden />
      <aside role="dialog" aria-modal="true" aria-label="Paper details" className="fixed right-0 top-0 z-50 flex h-full w-[min(560px,100vw)] flex-col border-l border-line bg-bg-1">
        <div className="flex items-center justify-between border-b border-line px-5 py-3">
          <p className="text-14 font-semibold text-fg-2">Paper details</p>
          <button ref={closeRef} className="btn-ghost" onClick={onClose} aria-label="Close paper details">✕ Close</button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4 text-14">
          {isLoading && <Loading />}
          {error && <ErrorState error={error} />}
          {p && data && (
            <div className="space-y-5">
              <div>
                <h2 className="text-16 font-semibold leading-snug text-fg-0">{p.title}</h2>
                <p className="mt-1 text-fg-1">{p.authors.slice(0, 6).join(", ")}{p.authors.length > 6 ? " et al." : ""}</p>
                <p className="text-fg-2">{p.journal ?? "Journal not reported"} · {p.year ?? "year n/a"} · {p.citationCount ?? "?"} citations</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {p.sourceDatabases.map((d) => <Badge key={d} tone="sky">Found in {d}</Badge>)}
                  {p.publicationTypes.slice(0, 3).map((t) => <Badge key={t}>{t}</Badge>)}
                  {data.appraisal && <TextSourceBadge source={data.appraisal.textSource} />}
                </div>
              </div>
              <section>
                <h3 className="label">Identifiers and links</h3>
                <ul className="space-y-1">
                  {p.doi && <li>DOI: <a className="text-fg-0 underline" href={`https://doi.org/${p.doi}`} target="_blank" rel="noreferrer">{p.doi}</a></li>}
                  {p.pmid && <li>PMID: <a className="text-fg-0 underline" href={`https://pubmed.ncbi.nlm.nih.gov/${p.pmid}/`} target="_blank" rel="noreferrer">{p.pmid}</a></li>}
                  {p.pmcid && <li>PMCID: <a className="text-fg-0 underline" href={`https://pmc.ncbi.nlm.nih.gov/articles/${p.pmcid}/`} target="_blank" rel="noreferrer">{p.pmcid}</a></li>}
                  {p.openalexId && <li>OpenAlex: <a className="text-fg-0 underline" href={`https://openalex.org/${p.openalexId}`} target="_blank" rel="noreferrer">{p.openalexId}</a></li>}
                  <li>Open access: {p.oaUrl ? <a className="text-fg-0 underline" href={p.oaUrl} target="_blank" rel="noreferrer">{p.oaStatus ?? "link"}</a> : "no open-access link found"}{p.license ? ` (licence: ${p.license})` : ""}</li>
                </ul>
              </section>
              {data.summary && (
                <section>
                  <h3 className="label flex items-center gap-2">Summary <AbstractBadge />{data.summary.edited && <Badge tone="teal">edited by you</Badge>}</h3>
                  <dl className="grid grid-cols-[110px_1fr] gap-x-3 gap-y-1">
                    <dt className="text-fg-2">Study type</dt><dd>{STUDY_TYPE_LABEL[data.summary.studyType as StudyType] ?? data.summary.studyType}</dd>
                    <dt className="text-fg-2">Setting</dt><dd>{data.summary.setting}</dd>
                    <dt className="text-fg-2">Key finding</dt><dd>{data.summary.keyFinding}</dd>
                  </dl>
                </section>
              )}
              <section>
                <h3 className="label">Abstract (as returned by the database)</h3>
                <p className="whitespace-pre-line leading-relaxed text-fg-0">{p.abstract ?? "No abstract available from the databases."}</p>
              </section>
              <section>
                <h3 className="label">Found by these queries</h3>
                <ul className="space-y-2">
                  {data.foundBy.map((f, i) => (
                    <li key={i} className="rounded-sm bg-bg-2 p-2">
                      <p className="text-12 text-fg-1"><strong>{f.database}</strong> · topic “{f.topic}” · result #{f.rank}{f.wasNew ? " · first found here" : " · duplicate of an earlier hit"}</p>
                      <code className="mt-1 block break-words text-12 text-fg-1">{f.query}</code>
                    </li>
                  ))}
                </ul>
              </section>
              {data.scores.length > 0 && (
                <section>
                  <h3 className="label">Scores</h3>
                  {data.scores.map((s) => (
                    <div key={s.id} className="mb-3 rounded-sm border border-line p-2">
                      <p className="font-medium">{s.topicName}: {s.total}/100 {s.selected && <Badge tone="emerald">selected</Badge>}</p>
                      <p className="text-fg-1">{s.rationale}</p>
                      <ul className="mt-1 space-y-1 text-12 text-fg-1">
                        {RUBRIC.map((r) => <li key={r.key}><strong>{r.label} {s.subScores[r.key]}/5</strong> ({r.by}) — {s.rationales[r.key]}</li>)}
                      </ul>
                    </div>
                  ))}
                </section>
              )}
            </div>
          )}
        </div>
      </aside>
    </>
  );
}
