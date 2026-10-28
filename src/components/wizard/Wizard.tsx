"use client";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { api, projectPath, useApi } from "../api";
import { Badge, ErrorState, Loading, Modal, StateBadge, Spinner, cx } from "../ui";
import { STAGES, type StageState } from "@/lib/shared/stages";
import { PaperDrawer } from "./PaperDrawer";
import { IdeaStage } from "../stages/IdeaStage";
import { ScopingStage } from "../stages/ScopingStage";
import { SearchStage } from "../stages/SearchStage";
import { RetrievalStage } from "../stages/RetrievalStage";
import { SummaryStage } from "../stages/SummaryStage";
import { RankingStage } from "../stages/RankingStage";
import { AppraisalStage } from "../stages/AppraisalStage";
import { SynthesisStage } from "../stages/SynthesisStage";
import { QuestionsStage } from "../stages/QuestionsStage";

export interface Job {
  id: string;
  kind: string;
  stage: number;
  status: string;
  progress: { done: number; total: number; message: string };
  log: string[];
  error: string | null;
  createdAt: string;
  endedAt: string | null;
}
export interface Project {
  id: string;
  title: string;
  idea: string;
  currentStage: number;
  status: string;
  stageStates: Record<string, StageState>;
  staleReasons: Record<string, string>;
  scopingSummary: Record<string, string> | null;
  conceptMap: { nodes: { id: string; label: string; kind: string }[]; edges: { from: string; to: string; label: string }[] } | null;
  criteria: { yearFrom: number | null; yearTo: number | null; languages: string[]; studyTypes: string[]; inclusion: string[]; exclusion: string[] } | null;
}
export interface Cost { calls: number; input: number; output: number; cost: number; failures: number }
export interface ProjectViewData {
  project: Project;
  costs: Record<string, Cost>;
  jobs: Record<string, Job | null>;
}
export interface LiveData {
  stageStates: Record<string, StageState>;
  staleReasons: Record<string, string>;
  jobs: Record<string, Job | null>;
  costs: Record<string, Cost>;
  retrieval: unknown;
}

interface Ctx {
  projectId: string;
  project: Project;
  states: Record<string, StageState>;
  jobs: Record<string, Job | null>;
  live: LiveData | null;
  stage: number;
  goTo: (n: number) => void;
  refresh: () => Promise<unknown>;
  openPaper: (id: string) => void;
  /** Ask before an edit that would make later stages stale. Resolves true if the user agrees. */
  confirmEdit: (stage: number) => Promise<boolean>;
  approve: (stage: number) => Promise<void>;
}
const WizardCtx = createContext<Ctx | null>(null);
export const useWizard = () => {
  const c = useContext(WizardCtx);
  if (!c) throw new Error("useWizard outside Wizard");
  return c;
};

/** Revalidate a stage's data when its job changes state or progress. */
export function useJobRefresh(stage: number, mutate: () => unknown) {
  const { jobs } = useWizard();
  const j = jobs[String(stage)];
  const key = j ? `${j.id}:${j.status}:${j.progress.done}` : "none";
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    mutate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
}

export function Wizard({ projectId }: { projectId: string }) {
  const router = useRouter();
  const search = useSearchParams();
  const { data, error, mutate, isLoading } = useApi<ProjectViewData>(projectPath(projectId));
  const [live, setLive] = useState<LiveData | null>(null);
  const [paperId, setPaperId] = useState<string | null>(null);
  const [guard, setGuard] = useState<{ stage: number; downstream: number[]; resolve: (b: boolean) => void } | null>(null);
  const confirmed = useRef(new Set<number>());
  const [approveErr, setApproveErr] = useState<unknown>(null);
  const [approving, setApproving] = useState(false);

  // Live updates over SSE (jobs keep running server-side if this tab closes).
  useEffect(() => {
    const es = new EventSource(projectPath(projectId, "events"));
    es.onmessage = (ev) => {
      try {
        setLive(JSON.parse(ev.data));
      } catch {}
    };
    return () => es.close();
  }, [projectId]);

  const states = live?.stageStates ?? data?.project.stageStates ?? {};
  const statesKey = JSON.stringify(states);
  useEffect(() => {
    if (live) mutate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statesKey]);

  const stageParam = Number(search.get("stage"));
  const stage = stageParam >= 1 && stageParam <= 9 ? stageParam : data?.project.currentStage ?? 1;
  const goTo = useCallback((n: number) => router.push(`/projects/${projectId}?stage=${n}`, { scroll: false }), [router, projectId]);

  const confirmEdit = useCallback(
    (s: number) => {
      const downstream = STAGES.filter((x) => x.n > s && states[String(x.n)] && states[String(x.n)] !== "not_started").map((x) => x.n);
      if (!downstream.length || confirmed.current.has(s)) return Promise.resolve(true);
      return new Promise<boolean>((resolve) => setGuard({ stage: s, downstream, resolve }));
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [statesKey],
  );

  const approve = useCallback(
    async (n: number) => {
      setApproving(true);
      setApproveErr(null);
      try {
        await api(projectPath(projectId, `stages/${n}/approve`), { body: {} });
        confirmed.current.clear();
        await mutate();
        if (n < 9) goTo(n + 1);
      } catch (e) {
        setApproveErr(e);
      } finally {
        setApproving(false);
      }
    },
    [projectId, mutate, goTo],
  );

  const ctx = useMemo<Ctx | null>(
    () =>
      data
        ? { projectId, project: data.project, states, jobs: live?.jobs ?? data.jobs, live, stage, goTo, refresh: mutate, openPaper: setPaperId, confirmEdit, approve }
        : null,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [data, statesKey, live, stage, confirmEdit, approve],
  );

  if (isLoading) return <div className="p-8"><Loading label="Opening your review…" /></div>;
  if (error || !ctx) return <div className="mx-auto max-w-xl p-8"><ErrorState error={error ?? "Not found"} onRetry={() => mutate()} title="Could not open this review" /></div>;

  const def = STAGES[stage - 1];
  const costs = live?.costs ?? data!.costs;
  const cost = costs[String(stage)];
  const st = states[String(stage)] ?? "not_started";

  return (
    <WizardCtx.Provider value={ctx}>
      <div className="mx-auto flex max-w-[1600px] gap-0">
        {/* Stepper */}
        <nav aria-label="Review stages" className="sticky top-12 hidden h-[calc(100vh-3rem)] w-60 shrink-0 overflow-y-auto border-r border-[var(--color-line)] bg-white/60 px-3 py-4 md:block">
          <p className="mb-3 line-clamp-3 px-2 text-xs text-gray-500" title={data!.project.idea}>{data!.project.idea}</p>
          <ol className="space-y-0.5">
            {STAGES.map((s) => {
              const state = states[String(s.n)] ?? "not_started";
              const active = s.n === stage;
              return (
                <li key={s.n}>
                  <button
                    onClick={() => goTo(s.n)}
                    aria-current={active ? "step" : undefined}
                    className={cx("flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-sm", active ? "bg-[var(--color-accent-soft)] font-semibold text-teal-900" : "text-gray-700 hover:bg-gray-100")}
                  >
                    <span className={cx("flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs", state === "approved" ? "bg-emerald-600 text-white" : active ? "bg-teal-700 text-white" : "bg-gray-200 text-gray-700")}>
                      {state === "approved" ? "✓" : s.n}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate">{s.title}</span>
                      <span className="mt-0.5 block"><StateBadge state={state} /></span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ol>
          <div className="mt-6 space-y-1 border-t border-gray-100 px-2 pt-4 text-xs">
            <p className="font-semibold text-gray-500">Export</p>
            <a className="block text-teal-800 hover:underline" href={projectPath(projectId, "export/markdown")}>Markdown report</a>
            <a className="block text-teal-800 hover:underline" href={projectPath(projectId, "export/csv")}>Summary table (CSV)</a>
            <a className="block text-teal-800 hover:underline" href={projectPath(projectId, "export/bibtex")}>Selected papers (BibTeX)</a>
          </div>
        </nav>

        <main className="min-w-0 flex-1 px-4 py-5 md:px-8" aria-labelledby="stage-title">
          {/* Mobile stage picker */}
          <label className="mb-3 block md:hidden">
            <span className="sr-only">Go to stage</span>
            <select className="input" value={stage} onChange={(e) => goTo(Number(e.target.value))}>
              {STAGES.map((s) => (
                <option key={s.n} value={s.n}>{s.n}. {s.title} — {states[String(s.n)]}</option>
              ))}
            </select>
          </label>
          <header className="mb-5">
            <div className="flex flex-wrap items-center gap-3">
              <h1 id="stage-title" className="text-xl font-semibold tracking-tight text-gray-900">
                <span className="text-gray-400">{def.n}.</span> {def.title}
              </h1>
              <StateBadge state={st} />
              {cost && (
                <span className="text-xs text-gray-500" title="Tokens include reasoning tokens. Cost as reported by xAI, or estimated from published prices.">
                  AI this stage: {cost.calls} call{cost.calls === 1 ? "" : "s"} · {((cost.input + cost.output) / 1000).toFixed(1)}k tokens · ${cost.cost.toFixed(3)}
                  {cost.failures ? ` · ${cost.failures} failed/retried` : ""}
                </span>
              )}
            </div>
            <p className="mt-1 text-sm text-gray-600"><span className="font-medium text-gray-800">To finish this step:</span> {def.done}</p>
            {st === "stale" && <StaleBanner stage={stage} reason={(live?.staleReasons ?? data!.project.staleReasons)[String(stage)]} />}
          </header>

          <StageBody stage={stage} />

          {approveErr ? <div className="mt-4"><ErrorState error={approveErr} title="Could not approve this stage" /></div> : null}
          <ApproveBar stage={stage} approving={approving} />
        </main>
      </div>

      <PaperDrawer paperId={paperId} onClose={() => setPaperId(null)} />

      <Modal
        open={!!guard}
        onClose={() => {
          guard?.resolve(false);
          setGuard(null);
        }}
        title="Edit an earlier step?"
        footer={
          <>
            <button className="btn-secondary" onClick={() => { guard?.resolve(false); setGuard(null); }}>Cancel</button>
            <button
              className="btn-primary"
              onClick={() => {
                if (guard) confirmed.current.add(guard.stage);
                guard?.resolve(true);
                setGuard(null);
              }}
            >
              Edit and mark later steps stale
            </button>
          </>
        }
      >
        <p>
          Later steps ({guard?.downstream.map((n) => STAGES[n - 1].title).join(", ")}) were built from the current version of this step. If you change it, they will be marked
          <strong> stale</strong>. Nothing is re-run automatically: you will be asked to re-run or keep each one.
        </p>
      </Modal>
    </WizardCtx.Provider>
  );
}

function StaleBanner({ stage, reason }: { stage: number; reason?: string }) {
  const { projectId, refresh, states, goTo } = useWizard();
  const def = STAGES[stage - 1];
  const blocker = STAGES.find((s) => s.n < stage && states[String(s.n)] !== "approved");
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<unknown>(null);
  async function act(kind: "run" | "keep") {
    setBusy(kind);
    setErr(null);
    try {
      await api(projectPath(projectId, `stages/${stage}/${kind}`), { body: kind === "run" ? { force: true } : {} });
      await refresh();
    } catch (e) {
      setErr(e);
    } finally {
      setBusy(null);
    }
  }
  return (
    <div role="status" className="mt-3 rounded-xl border border-orange-200 bg-orange-50 px-4 py-3 text-sm text-orange-950">
      <p>
        <strong>These results may be out of date.</strong> {reason ? `${reason} after they were produced.` : "An earlier step changed after they were produced."}
      </p>
      {blocker && (
        <p className="mt-1">
          An earlier step is not approved yet. Re-check and approve{" "}
          <button className="font-semibold underline" onClick={() => goTo(blocker.n)}>step {blocker.n} ({blocker.title})</button> first; then come back here to re-run or keep these results. You can still read them below.
        </p>
      )}
      <div className="mt-2 flex flex-wrap gap-2">
        {def.job ? (
          <button className="btn-primary" onClick={() => act("run")} disabled={!!busy || !!blocker}>
            {busy === "run" && <Spinner />} Re-run this step
          </button>
        ) : (
          <span className="text-xs text-orange-900">Use the controls below to regenerate this step if needed.</span>
        )}
        <button className="btn-secondary" onClick={() => act("keep")} disabled={!!busy || !!blocker}>
          {busy === "keep" && <Spinner />} Keep current results and review them
        </button>
      </div>
      {err ? <div className="mt-2"><ErrorState error={err} /></div> : null}
    </div>
  );
}

function StageBody({ stage }: { stage: number }) {
  switch (stage) {
    case 1: return <IdeaStage />;
    case 2: return <ScopingStage />;
    case 3: return <SearchStage />;
    case 4: return <RetrievalStage />;
    case 5: return <SummaryStage />;
    case 6: return <RankingStage />;
    case 7: return <AppraisalStage />;
    case 8: return <SynthesisStage />;
    case 9: return <QuestionsStage />;
    default: return null;
  }
}

function ApproveBar({ stage, approving }: { stage: number; approving: boolean }) {
  const { states, approve, goTo } = useWizard();
  const st = states[String(stage)] ?? "not_started";
  const upstreamOk = STAGES.filter((s) => s.n < stage).every((s) => states[String(s.n)] === "approved");
  const blocked = !upstreamOk ? STAGES.find((s) => s.n < stage && states[String(s.n)] !== "approved") : null;
  if (stage === 9 && st === "approved") return null;
  return (
    <div className="sticky bottom-0 z-20 -mx-4 mt-8 border-t border-[var(--color-line)] bg-[var(--color-paper)]/95 px-4 py-3 backdrop-blur md:-mx-8 md:px-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="text-sm text-gray-600">
          {blocked ? (
            <span>
              Approve <button className="font-medium text-teal-800 underline" onClick={() => goTo(blocked.n)}>step {blocked.n} ({blocked.title})</button> first.
            </span>
          ) : st === "approved" ? (
            <span className="text-emerald-800">Approved. You can still edit this step; later steps will be marked stale.</span>
          ) : st === "running" ? (
            <span>Running in the background — you can leave this page and come back.</span>
          ) : st === "stale" ? (
            <span>Re-run or keep the results above before approving.</span>
          ) : (
            <span>Review the results above, edit anything you disagree with, then approve.</span>
          )}
        </div>
        <div className="flex gap-2">
          {stage > 1 && <button className="btn-ghost" onClick={() => goTo(stage - 1)}>← Back</button>}
          {st === "approved" && stage < 9 ? (
            <button className="btn-secondary" onClick={() => goTo(stage + 1)}>Next step →</button>
          ) : (
            <button className="btn-primary" disabled={!upstreamOk || approving || st === "running" || st === "stale" || st === "not_started" || st === "failed"} onClick={() => approve(stage)}>
              {approving && <Spinner />} {stage === 9 ? "Finish and see summary" : "Approve and continue"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export function SectionTitle({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div className="mb-2 flex items-center justify-between gap-2">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">{children}</h2>
      {right}
    </div>
  );
}

export function JobPanel({ stage, runLabel = "Run this step" }: { stage: number; runLabel?: string }) {
  const { jobs, projectId, states, refresh } = useWizard();
  const j = jobs[String(stage)];
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<unknown>(null);
  const [showLog, setShowLog] = useState(false);
  const st = states[String(stage)];
  async function run() {
    setBusy(true);
    setErr(null);
    try {
      await api(projectPath(projectId, `stages/${stage}/run`), { body: { force: true } });
      await refresh();
    } catch (e) {
      setErr(e);
    } finally {
      setBusy(false);
    }
  }
  async function cancel() {
    await api(projectPath(projectId, `stages/${stage}/cancel`), { body: {} });
    await refresh();
  }
  const running = j && (j.status === "running" || j.status === "queued");
  return (
    <div className="card mb-4 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0 flex-1">
          {running ? (
            <>
              <p className="flex items-center gap-2 text-sm font-medium text-gray-800"><Spinner className="text-teal-700" /> {j!.progress.message || "Working…"}</p>
              <div className="mt-2"><ProgressBarSafe done={j!.progress.done} total={j!.progress.total} /></div>
              <p className="mt-1 text-xs text-gray-500">{j!.progress.done} / {j!.progress.total} · runs on the server — safe to leave this page.</p>
            </>
          ) : j?.status === "failed" ? (
            <ErrorState error={j.error ?? "The job failed."} title="This step failed" />
          ) : j?.status === "done" ? (
            <p className="text-sm text-gray-700">Finished {j.endedAt ? new Date(j.endedAt).toLocaleTimeString() : ""}. {j.progress.message}</p>
          ) : (
            <p className="text-sm text-gray-600">{st === "not_started" ? "This step has not run yet." : "No job information."}</p>
          )}
        </div>
        <div className="flex gap-2">
          {j && j.log.length > 0 && <button className="btn-ghost text-xs" onClick={() => setShowLog((s) => !s)} aria-expanded={showLog}>{showLog ? "Hide" : "Show"} log</button>}
          {running ? (
            <button className="btn-secondary" onClick={cancel}>Cancel</button>
          ) : (
            <button className="btn-secondary" onClick={run} disabled={busy || STAGES.some((x) => x.n < stage && states[String(x.n)] !== "approved")} title={STAGES.some((x) => x.n < stage && states[String(x.n)] !== "approved") ? "Approve the earlier steps first" : undefined}>{busy && <Spinner />}{j ? "Re-run" : runLabel}</button>
          )}
        </div>
      </div>
      {err ? <div className="mt-2"><ErrorState error={err} /></div> : null}
      {showLog && j && (
        <pre className="mt-3 max-h-64 overflow-auto rounded-lg bg-gray-900 p-3 text-[11px] leading-relaxed text-gray-100">{j.log.join("\n")}</pre>
      )}
    </div>
  );
}

function ProgressBarSafe({ done, total }: { done: number; total: number }) {
  const pct = total > 0 ? Math.round((done / total) * 100) : 5;
  return (
    <div role="progressbar" aria-valuenow={done} aria-valuemin={0} aria-valuemax={total} className="h-2 w-full overflow-hidden rounded-full bg-gray-100">
      <div className="h-full rounded-full bg-teal-600 transition-all" style={{ width: `${Math.max(3, pct)}%` }} />
    </div>
  );
}

export { Badge };
