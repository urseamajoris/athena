"use client";
import { useState } from "react";
import { AlertTriangle, Pencil } from "lucide-react";
import { Tabs } from "radix-ui";
import { api, projectPath, useApi } from "../api";
import { Badge, EmptyState, ErrorState, Loading, cx } from "../ui";
import { Disclosure } from "../disclosure";
import { useJobRefresh, useSession } from "../session/SessionContext";
import { ActionButton, JobLog, JobStatus, PanelFooter, SectionTitle, StaleNotice } from "./common";
import { ClaimChip, short, type ClaimRef, type PaperRef } from "./evidence";
import { nextAction } from "@/lib/canvas/actions";

interface Cell { id: string; theme: string; paperId: string; value: string; stance: string; claimIds: string[] }
interface Contradiction { id: string; theme: string; description: string; claimIds: string[]; paperIds: string[] }
interface Item { id: string; kind: string; statement: string; claimIds: string[]; edited: boolean }
export interface SynData {
  topics: { id: string; name: string; importanceRank: number | null; items: Item[]; cells: Cell[]; contradictions: Contradiction[] }[];
  claims: Record<string, ClaimRef>;
  papers: Record<string, PaperRef>;
}

const KIND_LABEL = { known: "Known", contested: "Contested", unknown: "Unknown" } as const;
const STANCE_LABEL: Record<string, string> = { supports: "supports", contradicts: "contradicts", mixed: "mixed", neutral: "neutral", not_addressed: "not addressed" };
const STANCE_CLASS: Record<string, string> = { supports: "border-ok-line", contradicts: "border-err-line", mixed: "border-warn-line", neutral: "border-line", not_addressed: "border-line border-dashed" };

/** Synthesis node: write and verify the synthesis; every statement cites verified (or accepted) quotes. */
export function SynthesisPanel() {
  const { projectId, states, confirmEdit, refresh, graph, input } = useSession();
  const { data, error, isLoading, mutate } = useApi<SynData>(projectPath(projectId, "synthesis"));
  useJobRefresh(8, mutate);
  const [editing, setEditing] = useState<string | null>(null);
  const stale = states["8"] === "stale";
  const node = graph.nodes.find((n) => n.id === "synthesis");
  const action = node ? nextAction(node, graph, input) : null;
  if (isLoading) return <Loading />;
  if (error) return <ErrorState error={error} onRetry={() => mutate()} />;
  if (!data) return null;
  const topics = data.topics.filter((t) => t.items.length || t.cells.length);

  async function saveItem(id: string, statement: string) {
    setEditing(null);
    if (!(await confirmEdit(8))) return;
    await mutate(await api<SynData>(projectPath(projectId, `synthesis/${id}`), { method: "PATCH", body: { statement } }), { revalidate: false });
    await refresh();
  }

  return (
    <div className="space-y-4">
      <StaleNotice stage={8} />
      {states["8"] === "running" && <JobStatus stage={8} />}
      {!topics.length ? (
        <EmptyState title="No synthesis yet">It is built from the verified (or accepted) quotes in the appraisals.</EmptyState>
      ) : (
        <Tabs.Root defaultValue={topics[0].id}>
          <Tabs.List aria-label="Topics" className="-mx-1 flex gap-1 overflow-x-auto border-b border-line px-1">
            {topics.map((t) => (
              <Tabs.Trigger key={t.id} value={t.id} className="min-h-11 shrink-0 border-b-2 border-transparent px-3 py-2 text-fg-1 data-[state=active]:border-fg-0 data-[state=active]:font-medium data-[state=active]:text-fg-0">
                {t.name}{t.contradictions.length > 0 && <span className="ml-1 text-12 text-err">· {t.contradictions.length} conflict{t.contradictions.length === 1 ? "" : "s"}</span>}
              </Tabs.Trigger>
            ))}
          </Tabs.List>
          {topics.map((t) => (
            <Tabs.Content key={t.id} value={t.id} className="space-y-4 pt-4">
              {t.contradictions.length > 0 && (
                <section aria-label="Contradictions" className="rounded-md border border-err-line p-3">
                  <SectionTitle>Contradictions between papers</SectionTitle>
                  <ul className="space-y-3">
                    {t.contradictions.map((c) => (
                      <li key={c.id}>
                        <p className="flex items-start gap-2"><AlertTriangle className="mt-1 h-4 w-4 shrink-0 text-err" strokeWidth={1.5} aria-hidden /><span><strong className="font-medium">{c.theme}:</strong> {c.description}</span></p>
                        <div className="mt-2 flex flex-wrap gap-1">{c.claimIds.map((id) => <ClaimChip key={id} id={id} claims={data.claims} papers={data.papers} stale={stale} />)}</div>
                      </li>
                    ))}
                  </ul>
                </section>
              )}
              {(["known", "contested", "unknown"] as const).map((kind) => (
                <section key={kind} aria-label={KIND_LABEL[kind]}>
                  <SectionTitle>{KIND_LABEL[kind]}</SectionTitle>
                  <ul className="space-y-3">
                    {t.items.filter((i) => i.kind === kind).map((i) => (
                      <li key={i.id}>
                        {editing === i.id ? (
                          <textarea autoFocus aria-label="Edit statement" className="input min-h-20" defaultValue={i.statement} onBlur={(e) => (e.target.value.trim() && e.target.value !== i.statement ? saveItem(i.id, e.target.value) : setEditing(null))} onKeyDown={(e) => e.key === "Escape" && setEditing(null)} />
                        ) : (
                          <p className="leading-relaxed">
                            {i.statement} {i.edited && <Badge>edited</Badge>}{" "}
                            <button className="btn-ghost btn-sm align-middle" onClick={() => setEditing(i.id)} aria-label={`Edit statement: ${i.statement.slice(0, 60)}`}><Pencil className="h-3 w-3" strokeWidth={1.5} aria-hidden /> edit</button>
                          </p>
                        )}
                        <div className="mt-1 flex flex-wrap gap-1">{i.claimIds.map((id) => <ClaimChip key={id} id={id} claims={data.claims} papers={data.papers} stale={stale} />)}</div>
                      </li>
                    ))}
                    {!t.items.some((i) => i.kind === kind) && <li className="italic text-fg-2">Nothing identified.</li>}
                  </ul>
                </section>
              ))}
              <Disclosure title="Evidence matrix" meta={`${new Set(t.cells.map((c) => c.paperId)).size} papers`}>
                <Matrix t={t} data={data} stale={stale} />
              </Disclosure>
            </Tabs.Content>
          ))}
        </Tabs.Root>
      )}
      <JobLog stage={8} />
      {action && (
        <PanelFooter>
          <ActionButton action={action} primary showReason />
        </PanelFooter>
      )}
    </div>
  );
}

function Matrix({ t, data, stale }: { t: SynData["topics"][number]; data: SynData; stale: boolean }) {
  const { openPaper } = useSession();
  const themes = [...new Set(t.cells.map((c) => c.theme))];
  const paperIds = [...new Set(t.cells.map((c) => c.paperId))];
  const conflict = new Set(t.contradictions.flatMap((c) => c.claimIds));
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[560px] border-separate border-spacing-1 text-12">
        <thead>
          <tr>
            <th className="w-32 text-left font-medium text-fg-2">Paper</th>
            {themes.map((th) => <th key={th} scope="col" className="text-left font-medium text-fg-1">{th}</th>)}
          </tr>
        </thead>
        <tbody>
          {paperIds.map((pid) => (
            <tr key={pid}>
              <th scope="row" className="align-top text-left font-medium">
                <button className="link min-h-11 text-left md:min-h-0" onClick={() => openPaper(pid)}>{short(data.papers[pid])}</button>
              </th>
              {themes.map((th) => {
                const c = t.cells.find((x) => x.paperId === pid && x.theme === th);
                if (!c) return <td key={th} className="rounded-sm border border-dashed border-line p-2 align-top italic text-fg-2">—</td>;
                const inConflict = c.claimIds.some((id) => conflict.has(id));
                return (
                  <td key={th} className={cx("rounded-sm border p-2 align-top", STANCE_CLASS[c.stance] ?? STANCE_CLASS.neutral)}>
                    <p className="text-fg-0">{c.value}</p>
                    <p className="mt-1 text-fg-2">{STANCE_LABEL[c.stance] ?? c.stance}{inConflict && <span className="text-err"> · in a contradiction</span>}</p>
                    <div className="mt-1 flex flex-wrap gap-1">{c.claimIds.map((id) => <ClaimChip key={id} id={id} claims={data.claims} papers={data.papers} stale={stale} />)}</div>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
