"use client";
import type { ReactNode } from "react";
import { api, projectPath } from "../api";
import { Disclosure } from "../disclosure";
import { useSession } from "../session/SessionContext";
import { StepActions } from "../workspace/StepFrame";
import { STAGES } from "@/lib/shared/stages";

export function SectionTitle({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div className="mb-2 flex items-center justify-between gap-2">
      <h3 className="text-12 font-medium text-fg-2">{children}</h3>
      {right}
    </div>
  );
}

export { ActionButton } from "./action-button";

/** The screen's buttons: drawn in the step frame's action bar (see StepActions). */
export function PanelFooter({ children, note }: { children: ReactNode; note?: ReactNode }) {
  return <StepActions next={note}>{children}</StepActions>;
}

/** When a stage's job finished. While it runs, is paused or has stopped, the step frame's banner says so. */
export function JobStatus({ stage }: { stage: number }) {
  const { jobs } = useSession();
  const j = jobs[String(stage)];
  if (j?.status === "done") return <p className="text-12 text-fg-2">Finished {j.endedAt ? new Date(j.endedAt).toLocaleTimeString() : ""}. {j.progress.message}</p>;
  return null;
}

export function JobLog({ stage }: { stage: number }) {
  const { jobs } = useSession();
  const j = jobs[String(stage)];
  if (!j || !j.log.length) return null;
  return (
    <Disclosure title="Live log" meta={`${j.log.length} lines`}>
      <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded-sm bg-bg-0 p-3 font-mono text-12 text-fg-1">{j.log.join("\n")}</pre>
    </Disclosure>
  );
}

/** Re-run / cancel for job stages, for the panel's ⋯ menu. */
export function useJobMenu(stage: number) {
  const { jobs, projectId, refresh, states } = useSession();
  const j = jobs[String(stage)];
  const running = j && (j.status === "running" || j.status === "queued" || j.status === "paused");
  const blocked = STAGES.some((x) => x.n < stage && states[String(x.n)] !== "approved");
  return [
    running
      ? { label: "Cancel this step", onSelect: async () => { await api(projectPath(projectId, `stages/${stage}/cancel`), { body: {} }); await refresh(); } }
      : { label: j ? "Re-run this step" : "Run this step", disabled: blocked, hint: blocked ? "approve earlier steps" : undefined, onSelect: async () => { await api(projectPath(projectId, `stages/${stage}/run`), { body: { force: true } }); await refresh(); } },
  ];
}

/** Out-of-date results are announced by the step frame's banner, with its two choices. */
export function StaleNotice(_: { stage: number; also?: number[] }) {
  return null;
}

export function Stat({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="rounded-md border border-line bg-bg-1 px-3 py-2">
      <p className="text-12 text-fg-2">{label}</p>
      <p className="text-20 font-semibold tabular-nums text-fg-0">{value}</p>
    </div>
  );
}
