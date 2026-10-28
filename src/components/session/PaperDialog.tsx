"use client";
import { Dialog } from "radix-ui";
import { X } from "lucide-react";
import { projectPath, useApi } from "../api";
import { AbstractBadge, Badge, Disclosure, ErrorState, Loading, TextSourceBadge } from "../ui";
import { RUBRIC, STUDY_TYPE_LABEL, type StudyType } from "@/lib/shared/stages";
import { useSession } from "./SessionContext";

interface Detail {
  paper: { id: string; title: string; authors: string[]; year: number | null; journal: string | null; abstract: string | null; doi: string | null; pmid: string | null; pmcid: string | null; openalexId: string | null; citationCount: number | null; oaUrl: string | null; oaStatus: string | null; license: string | null; sourceDatabases: string[]; publicationTypes: string[] };
  summary: { studyType: string; setting: string; keyFinding: string; edited: boolean } | null;
  appraisal: { id: string; status: string; textSource: string } | null;
  foundBy: { database?: string; query?: string; topic?: string; rank: number; wasNew: boolean }[];
  scores: { id: string; topicName?: string; total: number; selected: boolean; rationale: string; subScores: Record<string, number>; rationales: Record<string, string> }[];
}

/** Paper details: identifiers, AI summary, abstract, which queries found it, scores. */
export function PaperDialog({ paperId, onClose }: { paperId: string | null; onClose: () => void }) {
  const { projectId } = useSession();
  const { data, error, isLoading } = useApi<Detail>(paperId ? projectPath(projectId, `papers/${paperId}`) : null);
  const p = data?.paper;
  return (
    <Dialog.Root open={!!paperId} onOpenChange={(o) => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-scrim" />
        <Dialog.Content aria-describedby={undefined} className="fixed inset-y-0 right-0 z-50 flex w-[min(560px,100vw)] flex-col border-l border-line-strong bg-bg-1">
          <div className="flex items-center justify-between gap-2 border-b border-line px-4 py-2">
            <Dialog.Title className="text-12 font-medium text-fg-2">Paper details</Dialog.Title>
            <Dialog.Close className="btn-ghost h-11 w-11 px-0" aria-label="Close paper details">
              <X className="h-4 w-4" strokeWidth={1.5} aria-hidden />
            </Dialog.Close>
          </div>
          <div className="flex-1 overflow-y-auto px-4 py-4">
            {isLoading && <Loading />}
            {error && <ErrorState error={error} />}
            {p && data && (
              <div className="space-y-4">
                <div>
                  <h2 className="text-16 font-semibold text-fg-0">{p.title}</h2>
                  <p className="mt-1 text-fg-1">{p.authors.slice(0, 6).join(", ")}{p.authors.length > 6 ? " et al." : ""}</p>
                  <p className="text-fg-2">{p.journal ?? "Journal not reported"} · {p.year ?? "year n/a"} · <span className="tabular-nums">{p.citationCount ?? "?"}</span> citations</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {p.sourceDatabases.map((d) => <Badge key={d}>Found in {d}</Badge>)}
                    {data.appraisal && <TextSourceBadge source={data.appraisal.textSource} />}
                  </div>
                </div>
                <section>
                  <h3 className="label">Identifiers and links</h3>
                  <ul className="space-y-1">
                    {p.doi && <li>DOI: <a className="link" href={`https://doi.org/${p.doi}`} target="_blank" rel="noreferrer">{p.doi}</a></li>}
                    {p.pmid && <li>PMID: <a className="link" href={`https://pubmed.ncbi.nlm.nih.gov/${p.pmid}/`} target="_blank" rel="noreferrer">{p.pmid}</a></li>}
                    {p.pmcid && <li>PMCID: <a className="link" href={`https://pmc.ncbi.nlm.nih.gov/articles/${p.pmcid}/`} target="_blank" rel="noreferrer">{p.pmcid}</a></li>}
                    {p.openalexId && <li>OpenAlex: <a className="link" href={`https://openalex.org/${p.openalexId}`} target="_blank" rel="noreferrer">{p.openalexId}</a></li>}
                    <li>Open access: {p.oaUrl ? <a className="link" href={p.oaUrl} target="_blank" rel="noreferrer">{p.oaStatus ?? "link"}</a> : "no open-access link found"}{p.license ? ` (licence: ${p.license})` : ""}</li>
                  </ul>
                </section>
                {data.summary && (
                  <section>
                    <h3 className="label flex items-center gap-2">Summary <AbstractBadge />{data.summary.edited && <Badge>edited by you</Badge>}</h3>
                    <dl className="grid grid-cols-[112px_1fr] gap-x-3 gap-y-1">
                      <dt className="text-fg-2">Study type</dt><dd>{STUDY_TYPE_LABEL[data.summary.studyType as StudyType] ?? data.summary.studyType}</dd>
                      <dt className="text-fg-2">Setting</dt><dd>{data.summary.setting}</dd>
                      <dt className="text-fg-2">Key finding</dt><dd>{data.summary.keyFinding}</dd>
                    </dl>
                  </section>
                )}
                <section>
                  <h3 className="label">Abstract (as returned by the database)</h3>
                  <p className="whitespace-pre-line leading-relaxed text-fg-1">{p.abstract ?? "No abstract available from the databases."}</p>
                </section>
                <Disclosure title="Found by these queries" meta={`${data.foundBy.length}`}>
                  <ul className="space-y-2">
                    {data.foundBy.map((f, i) => (
                      <li key={i} className="rounded-sm bg-bg-2 p-2">
                        <p className="text-12 text-fg-1"><strong>{f.database}</strong> · topic “{f.topic}” · result #{f.rank}{f.wasNew ? " · first found here" : " · duplicate of an earlier hit"}</p>
                        <code className="mt-1 block break-words font-mono text-12 text-fg-1">{f.query}</code>
                      </li>
                    ))}
                  </ul>
                </Disclosure>
                {data.scores.length > 0 && (
                  <Disclosure title="Scores" meta={data.scores.map((s) => s.total).join(" · ")}>
                    {data.scores.map((s) => (
                      <div key={s.id} className="mb-3 rounded-sm border border-line p-2">
                        <p className="font-medium">{s.topicName}: <span className="tabular-nums">{s.total}</span>/100 {s.selected && <Badge tone="ok">selected</Badge>}</p>
                        <p className="text-fg-1">{s.rationale}</p>
                        <ul className="mt-1 space-y-1 text-12 text-fg-1">
                          {RUBRIC.map((r) => <li key={r.key}><strong>{r.label} {s.subScores[r.key]}/5</strong> ({r.by}) — {s.rationales[r.key]}</li>)}
                        </ul>
                      </div>
                    ))}
                  </Disclosure>
                )}
              </div>
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
