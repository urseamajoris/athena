"use client";
// One review, for every screen of the workspace: its data, live updates, and the commands that change it.
//
//   data      project, stage states, why a stage is out of date, jobs, AI use, the compact summary (counts)
//   live      server-sent events keep states, jobs and the summary current; jobs run on the server either way
//   state     whether AI can run (server-wide) and the account's credits
//   commands  approve, run, keep, reopen, cancel, bring up to date, build the search plan, download; the
//             "editing this changes later screens" confirmation; open a paper
//   where     the screen that is open (`step`), the screen that needs the user (`current`), and goToStep
//
// What the server sends is typed loosely on purpose (fields are optional and unknown ones pass through): the
// project gains `question`, `questionFramework`, `questionStructure` and `questionDrafts`, and the summary's
// shape belongs to the server (GET /api/projects/:id/canvas, also in the event stream as `canvas`).
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import dynamic from "next/dynamic";
import { useRouter, useSearchParams } from "next/navigation";
import { useSWRConfig } from "swr";
import { api, projectPath, useApi } from "../api";
import { useCredits, type Credits } from "../credits";
import { STAGES, STATE_LABEL, thinTopics, type StageState } from "@/lib/shared/stages";
import { STEP_BY_KEY, currentStep, isStepKey, stepForStage, type StepKey } from "@/lib/shared/flow";
import { cmdKey, downstreamSteps, stepAction, upToDateCmd, type Action, type ActionFacts, type Cmd } from "./actions";

const PaperDialog = dynamic(() => import("./PaperDialog").then((m) => m.PaperDialog), { ssr: false });
const ConfirmEditDialog = dynamic(() => import("./SessionDialogs").then((m) => m.ConfirmEditDialog), { ssr: false });
const ConfirmLeaveOutDialog = dynamic(() => import("./SessionDialogs").then((m) => m.ConfirmLeaveOutDialog), { ssr: false });
const ThinTopicsDialog = dynamic(() => import("./SessionDialogs").then((m) => m.ThinTopicsDialog), { ssr: false });

export interface Job {
  id: string;
  kind: string;
  stage: number;
  /** queued | running | paused | done | failed | cancelled */
  status: string;
  progress: { done: number; total: number; message: string };
  log: string[];
  error: string | null;
  createdAt: string;
  endedAt: string | null;
}
/** One suggested wording of the research question (written by the AI on the Question screen). */
export interface QuestionDraft { text: string; framework: string; structure: Record<string, string>; note: string }
export interface Project {
  id: string;
  title: string;
  idea: string;
  stageStates: Record<string, StageState>;
  staleReasons: Record<string, string>;
  currentStage?: number;
  status?: string;
  /** The working research question. Empty until it is chosen on the Question screen. */
  question?: string | null;
  questionFramework?: string | null;
  questionStructure?: Record<string, string> | null;
  questionDrafts?: QuestionDraft[] | null;
  questionConfirmedAt?: string | null;
  criteria?: { yearFrom: number | null; yearTo: number | null; languages: string[]; studyTypes: string[]; inclusion: string[]; exclusion: string[] } | null;
  [field: string]: unknown;
}
/** AI use recorded for one engine stage. */
export interface Cost { calls: number; input: number; output: number; cost: number; failures: number; credits?: number }
/** Whether AI steps can run on this server right now: the admin's switch, the server budget, and an API key. */
export interface AiState { enabled: boolean; budgetReached: boolean; keyMissing: boolean }
/** Per-topic selection counts, as the "few papers in a topic" check needs them. */
export interface TopicCount { topicId: string; name: string; selected: number; matching: number; spare: number; scored?: number; importanceRank?: number | null }
/** The compact counts behind button labels and one-line summaries. Every part is optional. */
export interface Summary {
  topics?: { id: string; name: string }[];
  scoping?: { messages: number; asked: number; maxQuestions: number; done: boolean; awaitingAnswer: boolean };
  queries?: { id: string; topicId: string; database: string }[];
  retrieval?: { unique: number; fetched: number; runs: number; done: number; failed: number; running: number };
  table?: { papers: number; summarised: number; edited: number; selectedPapers?: number };
  ranking?: TopicCount[];
  appraisal?: { papers: number; done: number; failed: number; running: number; fullText: number; claims: number; verified: number; pending: number; accepted: number; rejected: number };
  synthesis?: { statements: number; contradictions: number; known: number; contested: number; unknown: number };
  questions?: { count: number; chosenId: string | null; chosenText: string | null };
  [part: string]: unknown;
}
interface ProjectViewData { project: Project; costs: Record<string, Cost>; jobs: Record<string, Job | null> }
interface LiveData { stageStates: Record<string, StageState>; staleReasons: Record<string, string>; jobs: Record<string, Job | null>; costs: Record<string, Cost>; retrieval: unknown; canvas?: Summary; summary?: Summary; ai?: AiState }

export interface Session {
  projectId: string;
  project: Project;
  /** Engine stage states by number ("1".."9"). Screens read them through `stepStatus` (src/lib/shared/flow.ts). */
  states: Record<string, StageState>;
  /** Why a stage is out of date, by stage number. */
  staleReasons: Record<string, string>;
  /** The latest background job of each job stage ("4".."9"), or null. */
  jobs: Record<string, Job | null>;
  costs: Record<string, Cost>;
  ai: AiState;
  /** The account's credits, or null while unknown (the page works without them). */
  credits: Credits | null;
  summary: Summary | null;

  /** The screen that is open. */
  step: StepKey;
  /** The screen that needs the user: the first one that is not done. */
  current: StepKey;
  goToStep: (step: StepKey) => void;
  /** Open the screen that holds an engine stage. */
  goTo: (stage: number) => void;

  /** Revalidate everything cached for this review. Call it after any change. */
  refresh: () => Promise<unknown>;
  /** Run a command. Sets `busy` while it runs and `error` if it fails; never throws. */
  run: (cmd: Cmd) => Promise<void>;
  /** The command that is running (`cmdKey(cmd)`), or null. */
  busy: string | null;
  /** The next action of a screen while it is the one that needs the user, else null. */
  actionFor: (step: StepKey) => Action | null;
  /** Confirm an engine stage, then move on to the screen that needs the user next. Throws on failure. */
  approve: (stage: number) => Promise<void>;
  /** Ask before an edit that puts later screens out of date. Resolves true when the user agrees (or nothing depends on it). */
  confirmEdit: (stage: number) => Promise<boolean>;
  /** Show a long request as "working" in the screen's banner while it runs. Returns the request's result. */
  track: <T>(label: string, request: () => Promise<T>) => Promise<T>;
  /** The long request being tracked, or null. */
  pending: { label: string; since: number } | null;
  /** The last command that failed, with what went wrong. */
  error: { error: unknown; cmd: Cmd | null } | null;
  clearError: () => void;
  openPaper: (paperId: string) => void;
  /** Say something to screen-reader users (a polite live region). */
  announce: (message: string) => void;
}

const SessionCtx = createContext<Session | null>(null);
/** Live search runs from the event stream. Only the "Papers found" screen needs them, so they stay out of the
 *  session (which would otherwise change, and re-render every screen, on each update). */
const RetrievalCtx = createContext<unknown>(null);
export const useLiveRetrieval = () => useContext(RetrievalCtx);

export const useSession = () => {
  const c = useContext(SessionCtx);
  if (!c) throw new Error("useSession outside SessionProvider");
  return c;
};
/** The session, or null on a page that has none (the new-review page uses the same frame before a review exists). */
export const useOptionalSession = () => useContext(SessionCtx);

/** Just `run` and `busy` (buttons use this). */
export const useSessionActions = () => {
  const { run, busy } = useSession();
  return { run, busy };
};

/** The same object for as long as its content is the same (server data, SWR and the event stream each give
 *  new objects for unchanged data; passing those on would re-render the whole workspace). */
function useStable<T>(v: T): T {
  const ref = useRef<{ json: string; v: T } | null>(null);
  const json = JSON.stringify(v);
  if (!ref.current || ref.current.json !== json) ref.current = { json, v };
  return ref.current.v;
}

/** Revalidate a stage's data when its job changes state or progress. */
export function useJobRefresh(stage: number, mutate: () => unknown) {
  const { jobs } = useSession();
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

export function factsOf(project: Project, summary: Summary | null): ActionFacts {
  return {
    idea: project.idea,
    question: "question" in project ? (project.question ?? "") : undefined,
    searches: summary?.queries?.length,
    papersFound: summary?.retrieval?.unique,
    papersChosen: summary?.table?.selectedPapers,
    finalQuestionChosen: summary?.questions ? !!summary.questions.chosenId : undefined,
  };
}

export function SessionProvider({ projectId, children, fallback }: { projectId: string; children: ReactNode; fallback: (s: { error: unknown; retry: () => void } | null) => ReactNode }) {
  const { data: fetched, error: loadError, mutate } = useApi<ProjectViewData>(projectPath(projectId));
  const data = useStable(fetched);
  const { data: fetchedSummary } = useApi<Summary>(projectPath(projectId, "canvas"), { shouldRetryOnError: false });
  const { data: status } = useApi<{ ai?: AiState }>("/api/status");
  const credits = useCredits();
  const [live, setLive] = useState<LiveData | null>(null);
  const [paperId, setPaperId] = useState<string | null>(null);
  const [guard, setGuard] = useState<{ stage: number; resolve: (b: boolean) => void } | null>(null);
  const [thin, setThin] = useState<{ topics: TopicCount[]; resolve: (choice: "analyse" | "back" | "edit") => void } | null>(null);
  const [leaveOut, setLeaveOut] = useState<{ count: number; resolve: (b: boolean) => void } | null>(null);
  const confirmed = useRef(new Set<number>());
  const [busy, setBusy] = useState<string | null>(null);
  const [pending, setPending] = useState<{ label: string; since: number } | null>(null);
  const [error, setError] = useState<{ error: unknown; cmd: Cmd | null } | null>(null);
  const [message, setMessage] = useState("");
  const router = useRouter();
  const params = useSearchParams();

  const announce = useCallback((msg: string) => {
    setMessage("");
    requestAnimationFrame(() => setMessage(msg));
  }, []);

  // Live updates (jobs keep running on the server if this tab closes).
  useEffect(() => {
    const es = new EventSource(projectPath(projectId, "events"));
    es.onmessage = (ev) => {
      try {
        setLive(JSON.parse(ev.data));
      } catch {}
    };
    return () => es.close();
  }, [projectId]);

  const states = useStable(live?.stageStates ?? data?.project.stageStates ?? {});
  const statesKey = JSON.stringify(states);
  const summary = useStable(live?.summary ?? live?.canvas ?? fetchedSummary ?? null);
  const staleReasons = useStable(live?.staleReasons ?? data?.project.staleReasons ?? {});
  const jobs = useStable(live?.jobs ?? data?.jobs ?? {});
  const costs = useStable(live?.costs ?? data?.costs ?? {});
  const liveRetrieval = useStable(live?.retrieval ?? null);
  const ai = useStable(live?.ai ?? status?.ai ?? { enabled: true, budgetReached: false, keyMissing: false });

  const current = currentStep(states).key;
  const asked = params.get("step");
  const step: StepKey = isStepKey(asked) ? asked : current;

  const goToStep = useCallback(
    (key: StepKey) => {
      setError(null);
      // Without ?step the page follows the screen that needs the user, so that is how the current screen opens.
      router.push(key === currentStep(states).key ? `/s/${projectId}` : `/s/${projectId}?step=${key}`);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [router, projectId, statesKey],
  );
  const goTo = useCallback((stage: number) => goToStep(stepForStage(stage).key), [goToStep]);

  // After any change, every cached request for this review revalidates (and the credits, which AI steps spend).
  const { mutate: mutateAll } = useSWRConfig();
  const refresh = useCallback(() => mutateAll((key) => typeof key === "string" && (key.startsWith(projectPath(projectId)) || key === "/api/billing")), [mutateAll, projectId]);

  // Tell screen-reader users when a screen changes state, and refresh the project when stages move.
  const prevStates = useRef<Record<string, StageState> | null>(null);
  useEffect(() => {
    const prev = prevStates.current;
    prevStates.current = states;
    if (!prev || !Object.keys(prev).length) return;
    const changed = STAGES.filter((s) => prev[String(s.n)] && prev[String(s.n)] !== states[String(s.n)]);
    if (!changed.length) return;
    mutate();
    const stale = changed.filter((s) => states[String(s.n)] === "stale");
    announce(stale.length > 1 ? `${stale.length} later screens are now out of date.` : changed.map((s) => `${stepForStage(s.n).title}: ${STATE_LABEL[states[String(s.n)] ?? "not_started"].toLowerCase()}.`).join(" "));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statesKey]);

  const confirmEdit = useCallback(
    (stage: number) => {
      if (!downstreamSteps(stage, states).length || confirmed.current.has(stage)) return Promise.resolve(true);
      return new Promise<boolean>((resolve) => setGuard({ stage, resolve }));
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [statesKey],
  );

  const approve = useCallback(
    async (n: number) => {
      await api(projectPath(projectId, `stages/${n}/approve`), { body: {} });
      confirmed.current.clear();
      await refresh();
      announce(`${stepForStage(n).title} confirmed.`);
      // Drop ?step: the page then opens the screen that needs the user next.
      router.push(`/s/${projectId}`);
    },
    [projectId, refresh, announce, router],
  );

  const track = useCallback(async <T,>(label: string, request: () => Promise<T>): Promise<T> => {
    setPending({ label, since: Date.now() });
    try {
      return await request();
    } finally {
      setPending(null);
    }
  }, []);

  const run = useCallback(
    async (cmd: Cmd) => {
      if (cmd.type === "goToStep") return goToStep(cmd.step);
      if (cmd.type === "download") return void window.location.assign(projectPath(projectId, "export/markdown"));
      setError(null);
      setBusy(cmdKey(cmd));
      const post = (path: string, body: unknown = {}) => api(projectPath(projectId, path), { body });
      const todo = cmd.type === "bringUpToDate" ? upToDateCmd(cmd.stage) : cmd;
      try {
        switch (todo.type) {
          case "approve": {
            // Analysing with too few papers in a topic is allowed, but never silent.
            const few = todo.stage === 6 ? thinTopics(summary?.ranking ?? []) : [];
            if (few.length) {
              const choice = await new Promise<"analyse" | "back" | "edit">((resolve) => setThin({ topics: few, resolve }));
              if (choice === "edit") goToStep("search");
              if (choice !== "analyse") return;
            }
            // Summarising the evidence leaves undecided quotes out: say so and ask first. Read the count fresh,
            // because the live summary lags a decision made a moment ago.
            const left = todo.stage === 7 ? ((await api<Summary>(projectPath(projectId, "canvas")).catch(() => summary))?.appraisal?.pending ?? 0) : 0;
            if (left && !(await new Promise<boolean>((resolve) => setLeaveOut({ count: left, resolve })))) return;
            await approve(todo.stage);
            return;
          }
          case "run":
            await post(`stages/${todo.stage}/run`, { force: true });
            await refresh();
            announce(`${stepForStage(todo.stage).title}: started.`);
            return;
          case "keep":
            await post(`stages/${todo.stage}/keep`);
            await refresh();
            announce(`${stepForStage(todo.stage).title}: kept as it is, ready for you to check.`);
            return;
          case "reopen":
            await post(`stages/${todo.stage}/reopen`);
            await refresh();
            return;
          case "cancel":
            await post(`stages/${todo.stage}/cancel`);
            await refresh();
            announce(`${stepForStage(todo.stage).title}: stopped.`);
            return;
          case "buildSearch":
            if (summary?.queries?.length && !(await confirmEdit(3))) return;
            await track("Building your search plan", () => post("search/plan"));
            await refresh();
            announce("Your search plan is ready to check.");
            return;
        }
      } catch (e) {
        setError({ error: e, cmd });
        announce(`That did not work: ${e instanceof Error ? e.message : String(e)}`);
      } finally {
        setBusy(null);
      }
    },
    [approve, projectId, refresh, announce, confirmEdit, summary, goToStep, track],
  );
  const runRef = useRef(run);
  runRef.current = run;
  const stableRun = useCallback<Session["run"]>((c) => runRef.current(c), []);

  const project = data?.project;
  const actionFor = useCallback(
    (key: StepKey) => (project ? stepAction(key, states, factsOf(project, summary)) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [project, statesKey, summary],
  );
  const clearError = useCallback(() => setError(null), []);

  const ctx = useMemo<Session | null>(
    () =>
      project
        ? { projectId, project, states, staleReasons, jobs, costs, ai, credits, summary, step, current, goToStep, goTo, refresh, run: stableRun, busy, actionFor, approve, confirmEdit, track, pending, error, clearError, openPaper: setPaperId, announce }
        : null,
    [project, projectId, states, staleReasons, jobs, costs, ai, credits, summary, step, current, goToStep, goTo, refresh, stableRun, busy, actionFor, approve, confirmEdit, track, pending, error, clearError, announce],
  );

  // Data, not SWR's isLoading: that stays true while server-provided (fallback) data revalidates.
  if (!ctx && !loadError) return <>{fallback(null)}</>;
  if (!ctx) return <>{fallback({ error: loadError ?? "Not found", retry: () => mutate() })}</>;

  const closeGuard = (ok: boolean) => {
    if (!guard) return;
    if (ok) confirmed.current.add(guard.stage);
    guard.resolve(ok);
    setGuard(null);
  };
  return (
    <SessionCtx.Provider value={ctx}>
      <RetrievalCtx.Provider value={liveRetrieval}>
        {children}
        <div aria-live="polite" role="status" className="sr-only">{message}</div>
        {paperId && <PaperDialog paperId={paperId} onClose={() => setPaperId(null)} />}
        {guard && <ConfirmEditDialog later={downstreamSteps(guard.stage, states).map((s) => STEP_BY_KEY[s.key].title)} onCancel={() => closeGuard(false)} onConfirm={() => closeGuard(true)} />}
        {leaveOut && (
          <ConfirmLeaveOutDialog
            count={leaveOut.count}
            onCancel={() => { leaveOut.resolve(false); setLeaveOut(null); }}
            onConfirm={() => { leaveOut.resolve(true); setLeaveOut(null); }}
          />
        )}
        {thin && (
          <ThinTopicsDialog
            topics={thin.topics}
            onCancel={() => { thin.resolve("back"); setThin(null); }}
            onEditSearches={() => { thin.resolve("edit"); setThin(null); }}
            onConfirm={() => { thin.resolve("analyse"); setThin(null); }}
          />
        )}
      </RetrievalCtx.Provider>
    </SessionCtx.Provider>
  );
}
