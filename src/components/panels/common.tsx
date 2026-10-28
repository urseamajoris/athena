"use client";
import { createContext, useContext, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { AlertTriangle } from "lucide-react";
import { api, projectPath } from "../api";
import { Disclosure, ErrorState, ProgressBar, Spinner, cx } from "../ui";
import { useSession } from "../session/SessionContext";
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

/** Where a Focus panel wants its footer (outside the scrolling body). Null on full pages: render inline. */
export const PanelFooterSlot = createContext<HTMLElement | null>(null);

/** The panel's footer: its one primary action (plus quiet secondaries). */
export function PanelFooter({ children, note }: { children: ReactNode; note?: ReactNode }) {
  const slot = useContext(PanelFooterSlot);
  const content = (
    <div className={slot ? "px-4 py-3" : "mt-6 border-t border-line pt-3"}>
      {note && <p className="mb-2 text-12 text-fg-2">{note}</p>}
      <div className="flex flex-wrap items-center justify-end gap-2">{children}</div>
    </div>
  );
  return slot ? createPortal(content, slot) : content;
}

/** Background-job status for stages 4–9: progress while running, failure, or when it finished. */
export function JobStatus({ stage }: { stage: number }) {
  const { jobs, states } = useSession();
  const j = jobs[String(stage)];
  const running = j && (j.status === "running" || j.status === "queued");
  if (running) {
    return (
      <div className="rounded-md border border-run-line bg-bg-1 p-3" role="status">
        <p className="flex items-center gap-2 font-medium text-fg-0"><Spinner className="text-run" label="Running" /> {j!.progress.message || "Working…"}</p>
        <div className="mt-2"><ProgressBar value={j!.progress.done} max={j!.progress.total} label={`${STAGES[stage - 1].title} progress`} /></div>
        <p className="mt-1 text-12 text-fg-2"><span className="tabular-nums">{j!.progress.done} / {j!.progress.total}</span> · runs on the server, so it is safe to close this page.</p>
      </div>
    );
  }
  if (j?.status === "failed") return <ErrorState error={j.error ?? "The job failed."} title="This step failed" />;
  if (j?.status === "done") return <p className="text-12 text-fg-2">Finished {j.endedAt ? new Date(j.endedAt).toLocaleTimeString() : ""}. {j.progress.message}</p>;
  return <p className="text-12 text-fg-2">{(states[String(stage)] ?? "not_started") === "not_started" ? "This step has not run yet." : "No job information."}</p>;
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
  const running = j && (j.status === "running" || j.status === "queued");
  const blocked = STAGES.some((x) => x.n < stage && states[String(x.n)] !== "approved");
  return [
    running
      ? { label: "Cancel this step", onSelect: async () => { await api(projectPath(projectId, `stages/${stage}/cancel`), { body: {} }); await refresh(); } }
      : { label: j ? "Re-run this step" : "Run this step", disabled: blocked, hint: blocked ? "approve earlier steps" : undefined, onSelect: async () => { await api(projectPath(projectId, `stages/${stage}/run`), { body: { force: true } }); await refresh(); } },
  ];
}

/** Stale results: say why, and offer to keep them (Re-run downstream is the node's next action). */
export function StaleNotice({ stage, also = [] }: { stage: number; also?: number[] }) {
  const { projectId, refresh, states, staleReasons } = useSession();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<unknown>(null);
  // A node holding several stages (the Table: 5 and 6) shows one notice, for its first stale stage.
  stage = [stage, ...also].find((n) => states[String(n)] === "stale") ?? stage;
  if (states[String(stage)] !== "stale") return null;
  const reason = staleReasons[String(stage)];
  const blocker = STAGES.find((s) => s.n < stage && states[String(s.n)] !== "approved");
  return (
    <div role="status" className="rounded-md border border-warn-line bg-warn-soft px-3 py-3">
      <p className="flex items-start gap-2 text-fg-0">
        <AlertTriangle className="mt-1 h-4 w-4 shrink-0 text-warn" strokeWidth={1.5} aria-hidden />
        <span><strong className="font-semibold">Stale.</strong> {reason ? `${reason} after these results were produced.` : "An earlier step changed after these results were produced."} You can still read them.</span>
      </p>
      {blocker ? (
        <p className="mt-2 text-12 text-fg-1">Step {blocker.n} ({blocker.title}) needs approval first.</p>
      ) : (
        <div className="mt-2">
          <button
            className="btn-ghost btn-sm"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setErr(null);
              try {
                await api(projectPath(projectId, `stages/${stage}/keep`), { body: {} });
                await refresh();
              } catch (e) {
                setErr(e);
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy && <Spinner className="h-3 w-3" />} Keep these results and review them
          </button>
        </div>
      )}
      {err ? <div className="mt-2"><ErrorState error={err} /></div> : null}
    </div>
  );
}

export function Stat({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="rounded-md border border-line bg-bg-1 px-3 py-2">
      <p className="text-12 text-fg-2">{label}</p>
      <p className="text-16 font-semibold tabular-nums text-fg-0">{value}</p>
    </div>
  );
}
