"use client";
import { useState } from "react";
import { api, projectPath, useApi } from "../api";
import { Badge, EmptyState, ErrorState, Loading, Tooltip, cx } from "../ui";
import { JobPanel, useJobRefresh, useWizard } from "../wizard/Wizard";
import { RUBRIC, STUDY_TYPE_LABEL, type StudyType } from "@/lib/shared/stages";

interface ScoreRow {
  id: string; paperId: string; total: number; selected: boolean; userChanged: boolean; rationale: string;
  subScores: Record<string, number>; rationales: Record<string, string>;
  paper: { id: string; title: string; year: number | null; journal: string | null; citationCount: number | null; studyType: string | null };
}
interface RankingData { topics: { id: string; name: string; importanceRank: number | null; importanceJustification: string | null; scores: ScoreRow[] }[] }

const SEG = ["bg-run", "bg-fg-1", "bg-ok", "bg-warn", "bg-fg-2"];

export function RankingStage() {
  const { projectId, states, confirmEdit, refresh } = useWizard();
  const { data, error, isLoading, mutate } = useApi<RankingData>(projectPath(projectId, "ranking"));
  useJobRefresh(6, mutate);
  const [err, setErr] = useState<unknown>(null);

  if (states["5"] !== "approved" && (states["6"] ?? "not_started") === "not_started") return <EmptyState title="Approve the summary table first">Ranking scores every paper per topic.</EmptyState>;
  if (isLoading) return <Loading />;
  if (error) return <ErrorState error={error} onRetry={() => mutate()} />;
  if (!data) return null;

  async function change(fn: () => Promise<RankingData>) {
    if (!(await confirmEdit(6))) return;
    setErr(null);
    try {
      await mutate(await fn(), { revalidate: false });
      await refresh();
    } catch (e) {
      setErr(e);
    }
  }
  const toggle = (s: ScoreRow) => change(() => api(projectPath(projectId, "ranking/select"), { body: { scoreId: s.id, selected: !s.selected } }));
  const swap = (outId: string, inId: string) => change(() => api(projectPath(projectId, "ranking/swap"), { body: { outId, inId } }));
  const hasScores = data.topics.some((t) => t.scores.length);

  return (
    <div className="space-y-4">
      <JobPanel stage={6} runLabel="Score papers" />
      <details className="card p-3 text-14">
        <summary className="cursor-pointer font-medium text-fg-0">How papers are scored (rubric)</summary>
        <ul className="mt-2 grid gap-1 sm:grid-cols-2">
          {RUBRIC.map((r, i) => (
            <li key={r.key} className="flex items-center gap-2"><span className={cx("inline-block h-3 w-3 rounded-sm", SEG[i])} /> <strong>{r.label}</strong> — weight {Math.round(r.weight * 100)}% · {r.by === "AI" ? "scored by the AI from title/abstract" : "calculated by a fixed formula"}</li>
          ))}
        </ul>
        <p className="mt-2 text-12 text-fg-2">Total = weighted sum, out of 100. The top 4 per topic are pre-selected. Hover a bar for the reasons behind each score.</p>
      </details>
      {err ? <ErrorState error={err} /> : null}
      {!hasScores ? (
        <EmptyState title="No scores yet">Run this step to score papers.</EmptyState>
      ) : (
        <div className="flex gap-4 overflow-x-auto pb-3" role="list" aria-label="Topics in order of importance">
          {data.topics.map((t) => {
            const sel = t.scores.filter((s) => s.selected);
            const rest = t.scores.filter((s) => !s.selected);
            return (
              <section key={t.id} role="listitem" className="card w-[340px] shrink-0 p-3" aria-label={`Topic ${t.name}`}>
                <div className="mb-2">
                  <p className="text-12 font-semibold text-fg-0">Importance #{t.importanceRank ?? "–"}</p>
                  <h3 className="font-semibold leading-snug text-fg-0">{t.name}</h3>
                  {t.importanceJustification && <p className="mt-1 text-12 text-fg-2">{t.importanceJustification}</p>}
                  <p className={cx("mt-1 text-12", sel.length < 3 || sel.length > 5 ? "text-warn" : "text-fg-2")}>{sel.length} selected {sel.length < 3 || sel.length > 5 ? "· aim for 3–5" : ""} · {t.scores.length} scored</p>
                </div>
                <ul className="space-y-2">
                  {sel.map((s) => <ScoreCard key={s.id} s={s} onToggle={() => toggle(s)} swapOptions={rest} onSwap={(inId) => swap(s.id, inId)} />)}
                </ul>
                {rest.length > 0 && (
                  <details className="mt-3">
                    <summary className="cursor-pointer text-12 font-medium text-fg-1">Other candidates ({rest.length})</summary>
                    <ul className="mt-2 space-y-2">{rest.map((s) => <ScoreCard key={s.id} s={s} onToggle={() => toggle(s)} />)}</ul>
                  </details>
                )}
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}

function ScoreCard({ s, onToggle, swapOptions, onSwap }: { s: ScoreRow; onToggle: () => void; swapOptions?: ScoreRow[]; onSwap?: (inId: string) => void }) {
  const { openPaper } = useWizard();
  return (
    <li className={cx("rounded-sm border p-2", s.selected ? "border-ok-line bg-ok-soft" : "border-line")}>
      <div className="flex items-start gap-2">
        <input type="checkbox" className="mt-1 h-4 w-4" checked={s.selected} onChange={onToggle} aria-label={`${s.selected ? "Deselect" : "Select"} ${s.paper.title}`} />
        <div className="min-w-0 flex-1">
          <button className="text-left text-14 font-medium leading-snug text-fg-0 hover:underline" onClick={() => openPaper(s.paperId)}>{s.paper.title}</button>
          <p className="text-12 text-fg-2">{s.paper.year ?? "n.d."} · {s.paper.studyType ? STUDY_TYPE_LABEL[s.paper.studyType as StudyType] : "?"} · {s.paper.citationCount ?? "?"} cites {s.userChanged && <Badge tone="teal">changed by you</Badge>}</p>
          <div className="mt-2 flex items-center gap-2">
            <div className="flex h-2.5 flex-1 overflow-hidden rounded-sm bg-bg-2" aria-hidden>
              {RUBRIC.map((r, i) => (
                <div key={r.key} className={SEG[i]} style={{ width: `${(s.subScores[r.key] / 5) * r.weight * 100}%` }} />
              ))}
            </div>
            <Tooltip text={`${s.rationale}\n\n${RUBRIC.map((r) => `${r.label}: ${s.subScores[r.key]}/5 — ${s.rationales[r.key]}`).join("\n")}`}>
              <span className="cursor-help text-14 font-semibold tabular-nums text-fg-0" aria-label={`Total score ${s.total} out of 100. ${s.rationale}`}>{s.total}</span>
            </Tooltip>
          </div>
          <details className="mt-1">
            <summary className="cursor-pointer text-12 text-fg-2">Why this score</summary>
            <p className="mt-1 text-12 text-fg-1">{s.rationale}</p>
            <ul className="mt-1 space-y-1 text-12 text-fg-1">
              {RUBRIC.map((r) => <li key={r.key}><strong>{r.label} {s.subScores[r.key]}/5:</strong> {s.rationales[r.key]}</li>)}
            </ul>
          </details>
          {swapOptions && swapOptions.length > 0 && onSwap && (
            <label className="mt-2 flex items-center gap-1 text-12 text-fg-1">Swap for
              <select className="input py-1 text-12" value="" onChange={(e) => e.target.value && onSwap(e.target.value)}>
                <option value="">choose a paper…</option>
                {swapOptions.slice(0, 30).map((o) => <option key={o.id} value={o.id}>{o.total} · {o.paper.title.slice(0, 70)}</option>)}
              </select>
            </label>
          )}
        </div>
      </div>
    </li>
  );
}
