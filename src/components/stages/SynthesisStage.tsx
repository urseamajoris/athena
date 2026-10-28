"use client";
import { useState } from "react";
import { api, projectPath, useApi } from "../api";
import { Badge, EmptyState, ErrorState, Loading, cx } from "../ui";
import { JobPanel, SectionTitle, useJobRefresh, useWizard } from "../wizard/Wizard";
import { shortCite } from "@/lib/shared/stages";

export interface ClaimRef { id: string; paperId: string; field: string; statement: string; quote: string; location: string; verified: boolean; userAccepted: boolean; ordinal?: number; ofField?: number }
export interface PaperRef { id: string; title: string; year: number | null; authors: string[] }
interface Cell { id: string; theme: string; paperId: string; value: string; stance: string; claimIds: string[] }
interface Contradiction { id: string; theme: string; description: string; claimIds: string[]; paperIds: string[] }
interface Item { id: string; kind: string; statement: string; claimIds: string[]; edited: boolean }
interface SynData {
  topics: { id: string; name: string; importanceRank: number | null; items: Item[]; cells: Cell[]; contradictions: Contradiction[] }[];
  claims: Record<string, ClaimRef>;
  papers: Record<string, PaperRef>;
}

const STANCE: Record<string, string> = {
  supports: "bg-ok-soft border-ok-line",
  contradicts: "bg-err-soft border-err-line",
  mixed: "bg-warn-soft border-warn-line",
  neutral: "bg-bg-1 border-line",
  not_addressed: "bg-bg-2 border-line",
};

const FIELD_SHORT: Record<string, string> = { key_findings: "finding", limitations: "limitation", checklist: "quality item", methods: "methods", sample: "sample", setting: "setting", aim: "aim" };

export function short(p?: PaperRef) {
  return p ? shortCite(p.authors, p.year) : "?";
}

/** A clickable citation to a claim: shows the verified quote on hover/focus, opens the paper on click. */
export function ClaimChip({ id, claims, papers }: { id: string; claims: Record<string, ClaimRef>; papers: Record<string, PaperRef> }) {
  const { openPaper } = useWizard();
  const c = claims[id];
  if (!c) return <Badge tone="rose">{id}?</Badge>;
  return (
    <span className="group relative inline-block">
      <button onClick={() => openPaper(c.paperId)} className={cx("rounded-sm border px-2 py-0 text-12 font-medium", c.verified ? "border-line-strong bg-bg-2 text-fg-0" : "border-warn-line bg-warn-soft text-warn")} aria-label={`Evidence: ${short(papers[c.paperId])}, ${c.field}: ${c.statement}. Quote: ${c.quote}`}>
        {short(papers[c.paperId])} · {FIELD_SHORT[c.field] ?? c.field.replace("_", " ")}{c.ofField && c.ofField > 1 ? ` ${c.ordinal}` : ""}
      </button>
      <span role="tooltip" className="pointer-events-none absolute bottom-full left-0 z-40 mb-1 hidden w-80 rounded-md bg-bg-0 p-2 text-12 leading-snug text-fg-0 group-focus-within:block group-hover:block">
        <span className="block font-semibold">{c.statement}</span>
        <span className="mt-1 block italic text-fg-1">“{c.quote}”</span>
        <span className="mt-1 block text-fg-2">{c.location} · {c.verified ? "quote verified" : "unverified, accepted by user"}</span>
      </span>
    </span>
  );
}

export function SynthesisStage() {
  const { projectId, states, confirmEdit, refresh } = useWizard();
  const { data, error, isLoading, mutate } = useApi<SynData>(projectPath(projectId, "synthesis"));
  useJobRefresh(8, mutate);
  const [tab, setTab] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);

  if (states["7"] !== "approved" && (states["8"] ?? "not_started") === "not_started") return <EmptyState title="Approve the appraisals first">Synthesis only uses verified (or accepted) quotes from step 7.</EmptyState>;
  if (isLoading) return <Loading />;
  if (error) return <ErrorState error={error} onRetry={() => mutate()} />;
  if (!data) return null;
  const topics = data.topics.filter((t) => t.items.length || t.cells.length);
  const t = topics.find((x) => x.id === tab) ?? topics[0];

  async function saveItem(id: string, statement: string) {
    setEditing(null);
    if (!(await confirmEdit(8))) return;
    await mutate(await api<SynData>(projectPath(projectId, `synthesis/${id}`), { method: "PATCH", body: { statement } }), { revalidate: false });
    await refresh();
  }

  return (
    <div className="space-y-4">
      <JobPanel stage={8} runLabel="Synthesise evidence" />
      {!topics.length ? (
        <EmptyState title="No synthesis yet">Run this step to build the evidence matrix and summaries.</EmptyState>
      ) : (
        <>
          <div role="tablist" aria-label="Topics" className="flex flex-wrap gap-1 border-b border-line">
            {topics.map((x) => (
              <button key={x.id} role="tab" aria-selected={x.id === t.id} onClick={() => setTab(x.id)} className={cx("-mb-px rounded-t-sm border px-3 py-2 text-14", x.id === t.id ? "border-line border-b-bg-1 bg-bg-1 font-semibold text-fg-0" : "border-transparent text-fg-1 hover:text-fg-0")}>
                {x.name} {x.contradictions.length > 0 && <Badge tone="rose">{x.contradictions.length} conflict{x.contradictions.length === 1 ? "" : "s"}</Badge>}
              </button>
            ))}
          </div>
          <div role="tabpanel" className="space-y-4">
            <Matrix t={t} data={data} />
            {t.contradictions.length > 0 && (
              <section className="card border-err-line p-4">
                <SectionTitle>Contradictions between papers</SectionTitle>
                <ul className="space-y-2">
                  {t.contradictions.map((c) => (
                    <li key={c.id} className="rounded-sm bg-err-soft p-3 text-14 text-err">
                      <p><strong>{c.theme}:</strong> {c.description}</p>
                      <div className="mt-2 flex flex-wrap gap-1">{c.claimIds.map((id) => <ClaimChip key={id} id={id} claims={data.claims} papers={data.papers} />)}</div>
                    </li>
                  ))}
                </ul>
              </section>
            )}
            <div className="grid gap-4 lg:grid-cols-3">
              {(["known", "contested", "unknown"] as const).map((kind) => (
                <section key={kind} className="card p-4">
                  <SectionTitle>{kind === "known" ? "Known" : kind === "contested" ? "Contested" : "Unknown"}</SectionTitle>
                  <ul className="space-y-3">
                    {t.items.filter((i) => i.kind === kind).map((i) => (
                      <li key={i.id} className="text-14">
                        {editing === i.id ? (
                          <textarea autoFocus className="input min-h-20" defaultValue={i.statement} onBlur={(e) => (e.target.value.trim() && e.target.value !== i.statement ? saveItem(i.id, e.target.value) : setEditing(null))} onKeyDown={(e) => e.key === "Escape" && setEditing(null)} />
                        ) : (
                          <p className="leading-relaxed text-fg-0">
                            {i.statement} {i.edited && <Badge tone="teal">edited</Badge>}{" "}
                            <button className="text-12 text-fg-2 hover:text-fg-1" onClick={() => setEditing(i.id)} aria-label="Edit statement">edit</button>
                          </p>
                        )}
                        <div className="mt-1 flex flex-wrap gap-1">{i.claimIds.map((id) => <ClaimChip key={id} id={id} claims={data.claims} papers={data.papers} />)}</div>
                      </li>
                    ))}
                    {!t.items.some((i) => i.kind === kind) && <li className="text-14 italic text-fg-2">Nothing identified.</li>}
                  </ul>
                </section>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function Matrix({ t, data }: { t: SynData["topics"][number]; data: SynData }) {
  const { openPaper } = useWizard();
  const themes = [...new Set(t.cells.map((c) => c.theme))];
  const paperIds = [...new Set(t.cells.map((c) => c.paperId))];
  const conflictCells = new Set(t.contradictions.flatMap((c) => c.claimIds));
  return (
    <section className="card overflow-x-auto p-4">
      <SectionTitle right={<span className="flex gap-1 text-12"><Badge tone="emerald">supports</Badge><Badge tone="amber">mixed</Badge><Badge tone="rose">contradicts</Badge></span>}>Evidence matrix</SectionTitle>
      <table className="w-full min-w-[640px] border-separate border-spacing-1 text-14">
        <thead>
          <tr>
            <th className="w-48 text-left text-12 font-semibold text-fg-2">Paper</th>
            {themes.map((th) => <th key={th} scope="col" className="text-left text-12 font-semibold text-fg-1">{th}</th>)}
          </tr>
        </thead>
        <tbody>
          {paperIds.map((pid) => (
            <tr key={pid}>
              <th scope="row" className="align-top text-left text-12 font-medium text-fg-0">
                <button className="text-left hover:underline" onClick={() => openPaper(pid)}>{short(data.papers[pid])}</button>
                <span className="block font-normal text-fg-2 line-clamp-2">{data.papers[pid]?.title}</span>
              </th>
              {themes.map((th) => {
                const c = t.cells.find((x) => x.paperId === pid && x.theme === th);
                if (!c) return <td key={th} className="rounded-md border border-dashed border-line p-2 align-top text-12 italic text-fg-2">—</td>;
                const conflict = c.claimIds.some((id) => conflictCells.has(id));
                return (
                  <td key={th} className={cx("rounded-md border p-2 align-top text-12", STANCE[c.stance] ?? STANCE.neutral, conflict && "ring-2 ring-err")}>
                    <p className="text-fg-0">{c.value}</p>
                    {conflict && <p className="mt-1 font-semibold text-err">⚠ involved in a contradiction</p>}
                    <div className="mt-1 flex flex-wrap gap-1">{c.claimIds.map((id) => <ClaimChip key={id} id={id} claims={data.claims} papers={data.papers} />)}</div>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
