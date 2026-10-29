"use client";
import { AlertTriangle, Check, Loader2, X } from "lucide-react";
import { cx } from "../ui";
import { canvasStore, useSession } from "../session/SessionContext";
import { STAGES, STATE_LABEL, type StageState } from "@/lib/shared/stages";
import { frontierStage, nodeForStage } from "@/lib/canvas/graph";

const TONE: Record<StageState, string> = { not_started: "border-line-strong text-fg-2", running: "border-run-line text-run", needs_review: "border-warn text-fg-0", approved: "border-ok-line text-ok", stale: "border-warn-line text-warn", failed: "border-err-line text-err" };

/** Where am I: "Step 7 of 9 · Appraisal", the nine steps (numbered, never colour alone), and what comes next. */
export function StageRail({ compact }: { compact: boolean }) {
  const { states, graph, ai } = useSession();
  const f = frontierStage(states);
  const cur = f ? STAGES[f - 1] : null;
  const stale = STAGES.filter((s) => states[String(s.n)] === "stale").length;
  const done = STAGES.filter((s) => states[String(s.n)] === "approved").length;
  const label = cur ? `Step ${cur.n} of 9: ${cur.title}` : "All 9 steps done";
  const next = cur && cur.n < 9 ? `Next: ${STAGES[cur.n].title}` : cur ? "Next: download your review" : null;
  if (compact) {
    return (
      <div className="min-w-0" aria-label={`${label}. ${done} of 9 done.`}>
        <p className="truncate text-12 font-medium text-fg-0">{cur ? <>Step <span className="tabular-nums">{cur.n}</span>/9 · {cur.title}</> : "Review finished"}</p>
        <div className="mt-1 flex gap-0.5" aria-hidden>
          {STAGES.map((s) => <span key={s.n} className={cx("h-1 flex-1 rounded-full", states[String(s.n)] === "approved" ? "bg-ok" : s.n === f ? "bg-fg-1" : states[String(s.n)] === "stale" ? "bg-warn" : "bg-bg-3")} />)}
        </div>
      </div>
    );
  }
  return (
    <nav aria-label="Steps" className="flex min-w-0 items-center gap-3">
      <ol className="flex shrink-0 items-center gap-1">
        {STAGES.map((s) => {
          const state = (states[String(s.n)] ?? "not_started") as StageState;
          const current = s.n === f;
          const paused = state === "running" && ai && (!ai.enabled || ai.budgetReached);
          return (
            <li key={s.n}>
              <button
                className={cx("relative inline-flex h-7 min-w-7 items-center justify-center rounded-full border text-12 font-semibold tabular-nums", TONE[state], current && "outline-2 outline-offset-2 outline-fg-1 outline")}
                aria-label={`Step ${s.n}, ${s.title}: ${paused ? "paused" : STATE_LABEL[state]}`}
                aria-current={current ? "step" : undefined}
                title={`Step ${s.n}: ${s.title} (${STATE_LABEL[state]})`}
                onClick={() => {
                  const id = nodeForStage(graph, s.n);
                  if (!id) return;
                  canvasStore.getState().openPanel(id);
                }}
              >
                {state === "approved" ? <Check className="h-3.5 w-3.5" strokeWidth={3} aria-hidden /> : state === "running" ? <Loader2 className="h-3.5 w-3.5 motion-safe:animate-spin" strokeWidth={2.5} aria-hidden /> : state === "stale" ? <AlertTriangle className="h-3.5 w-3.5" strokeWidth={2.5} aria-hidden /> : state === "failed" ? <X className="h-3.5 w-3.5" strokeWidth={3} aria-hidden /> : s.n}
              </button>
            </li>
          );
        })}
      </ol>
      <p className="hidden min-w-0 truncate text-fg-0 lg:block">
        <span className="font-medium">{label}</span>
        {next && <span className="hidden text-fg-2 2xl:inline"> · {next}</span>}
        {stale > 0 && <span className="text-warn"> · {stale} out of date</span>}
      </p>
    </nav>
  );
}
