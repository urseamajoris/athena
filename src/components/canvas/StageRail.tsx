"use client";
import { AlertTriangle, Check, Circle, CircleDot, Loader2, X } from "lucide-react";
import { cx } from "../ui";
import { canvasStore, useSession } from "../session/SessionContext";
import { focusNode } from "./focus";
import { STAGES, STATE_LABEL, type StageState } from "@/lib/shared/stages";
import { frontierStage, nodeForStage } from "@/lib/canvas/graph";

const ICON: Record<StageState, typeof Check> = { not_started: Circle, running: Loader2, needs_review: CircleDot, approved: Check, stale: AlertTriangle, failed: X };
const TONE: Record<StageState, string> = { not_started: "text-fg-2", running: "text-run", needs_review: "text-warn", approved: "text-ok", stale: "text-warn", failed: "text-err" };

/** Thin progress strip: stages 1–9, the current one ringed; each jumps to its node. */
export function StageRail({ compact }: { compact: boolean }) {
  const { states, graph } = useSession();
  const f = frontierStage(states);
  const stale = STAGES.filter((s) => states[String(s.n)] === "stale").length;
  if (compact) {
    const cur = f ? STAGES[f - 1] : null;
    return (
      <p className="min-w-0 truncate text-12 text-fg-1" aria-label={cur ? `Step ${cur.n} of 9: ${cur.title}` : "Review finished"}>
        {cur ? <>Step <span className="tabular-nums">{cur.n}/9</span> · {cur.title}</> : "Finished"}
        {stale > 0 && <span className="text-warn"> · {stale} stale</span>}
      </p>
    );
  }
  return (
    <nav aria-label="Stages" className="flex items-center gap-2">
      <ol className="flex items-center">
        {STAGES.map((s, i) => {
          const state = (states[String(s.n)] ?? "not_started") as StageState;
          const Icon = ICON[state];
          const current = s.n === f;
          return (
            <li key={s.n} className="flex items-center">
              {i > 0 && <span aria-hidden className={cx("h-px w-3", states[String(s.n - 1)] === "approved" ? "bg-fg-2" : "bg-line-strong")} />}
              <button
                className={cx("group relative inline-flex h-8 w-8 items-center justify-center rounded-full", current ? "bg-bg-3 outline-2 outline-offset-2 outline-fg-1 outline" : "hover:bg-bg-3")}
                aria-label={`Stage ${s.n}, ${s.title}: ${STATE_LABEL[state]}`}
                aria-current={current ? "step" : undefined}
                title={`${s.n}. ${s.title} — ${STATE_LABEL[state]}`}
                onClick={() => {
                  const id = nodeForStage(graph, s.n);
                  if (!id) return;
                  canvasStore.getState().select(id);
                  focusNode(id);
                }}
              >
                <Icon className={cx("h-4 w-4", TONE[state], state === "running" && "motion-safe:animate-spin")} strokeWidth={2} aria-hidden />
              </button>
            </li>
          );
        })}
      </ol>
      {stale > 0 && <span className="text-12 text-warn">{stale} stale</span>}
    </nav>
  );
}
