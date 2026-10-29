"use client";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useStore } from "zustand";
import { useShallow } from "zustand/react/shallow";
import { useSWRConfig } from "swr";
import { api, projectPath, useApi } from "../api";
import dynamic from "next/dynamic";
import { STAGES, STATE_LABEL, type StageState } from "@/lib/shared/stages";
import type { CanvasSummary, ClaimLite, JobLite } from "@/lib/shared/canvas";
import { buildGraph, nodeForStage, type Graph, type GraphInput } from "@/lib/canvas/graph";
import { cascadeStep, type Cmd } from "@/lib/canvas/actions";
import { createCanvasStore, sessionOf, type SessionUi } from "@/lib/canvas/store";
import type { Pos } from "@/lib/canvas/layout";
const PaperDialog = dynamic(() => import("./PaperDialog").then((m) => m.PaperDialog), { ssr: false });
const ConfirmEditDialog = dynamic(() => import("./SessionDialogs").then((m) => m.ConfirmEditDialog), { ssr: false });
const AddTopicDialog = dynamic(() => import("./SessionDialogs").then((m) => m.AddTopicDialog), { ssr: false });

export type Job = JobLite;
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
  canvas: CanvasSummary;
  ai?: AiState;
}
/** Whether AI steps can run right now (admin switch and server budget). */
export interface AiState { enabled: boolean; budgetReached: boolean }

/** One canvas store per browser tab; layout and choices persist per session. */
export const canvasStore = createCanvasStore();
export function useCanvas<T>(selector: (s: ReturnType<typeof canvasStore.getState>) => T): T {
  return useStore(canvasStore, selector);
}

interface Ctx {
  projectId: string;
  project: Project;
  states: Record<string, StageState>;
  staleReasons: Record<string, string>;
  jobs: Record<string, Job | null>;
  costs: Record<string, Cost>;
  ai: AiState;
  summary: CanvasSummary | null;
  claims: ClaimLite[] | null;
  graph: Graph;
  input: GraphInput;
  ui: SessionUi;
  /** Open the node that holds stage n. */
  goTo: (n: number) => void;
  refresh: () => Promise<unknown>;
  openPaper: (id: string) => void;
  /** Ask before an edit that would make later stages stale. Resolves true if the user agrees. */
  confirmEdit: (stage: number) => Promise<boolean>;
  approve: (stage: number) => Promise<void>;
  /** Run a node command (next action, add-child option, palette command). */
  run: (cmd: Cmd, opts?: { flowAt?: Pos; from?: string }) => Promise<void>;
  busy: string | null;
  error: unknown;
  clearError: () => void;
  announce: (msg: string) => void;
}
const SessionCtx = createContext<Ctx | null>(null);
/** Live retrieval runs from the event stream: only the Corpus panel needs them, so they are kept out of the
 *  session context (which would otherwise change, and re-render every view, on each update). */
const RetrievalCtx = createContext<unknown>(null);
export const useLiveRetrieval = () => useContext(RetrievalCtx);

/** The same object for as long as its content is the same (server data, SWR and the event stream each give
 *  new objects for unchanged data; passing those on would re-render the whole session view). */
function useStable<T>(v: T): T {
  const ref = useRef<{ json: string; v: T } | null>(null);
  const json = JSON.stringify(v);
  if (!ref.current || ref.current.json !== json) ref.current = { json, v };
  return ref.current.v;
}
interface Actions { run: Ctx["run"]; busy: string | null }
const ActionsCtx = createContext<Actions | null>(null);
/** Just run + busy, stable across data updates (node cards and action buttons use this). */
export const useSessionActions = () => {
  const c = useContext(ActionsCtx);
  if (!c) throw new Error("useSessionActions outside SessionProvider");
  return c;
};
export const useSession = () => {
  const c = useContext(SessionCtx);
  if (!c) throw new Error("useSession outside SessionProvider");
  return c;
};
/** The stage UIs were written against the wizard; the session provides the same fields. */
export const useWizard = useSession;

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

export const cmdKey = (c: Cmd) => JSON.stringify(c);

export function SessionProvider({ projectId, children, fallback }: { projectId: string; children: ReactNode; fallback: (s: { error: unknown; retry: () => void } | null) => ReactNode }) {
  const { data: fetched, error, mutate } = useApi<ProjectViewData>(projectPath(projectId));
  const data = useStable(fetched);
  const { data: fetchedSummary, mutate: mutateSummary } = useApi<CanvasSummary>(projectPath(projectId, "canvas"));
  const [live, setLive] = useState<LiveData | null>(null);
  // The saved viewport changes on every pan; nothing rendered depends on it, so it is left out here.
  const ui = useCanvas(useShallow((s) => ({ ...sessionOf(s, projectId), viewport: null })));
  const { data: claims, mutate: mutateClaims } = useApi<ClaimLite[]>(ui.pinnedQuotes.length ? projectPath(projectId, "claims") : null);
  const [paperId, setPaperId] = useState<string | null>(null);
  const [guard, setGuard] = useState<{ stage: number; downstream: number[]; resolve: (b: boolean) => void } | null>(null);
  const confirmed = useRef(new Set<number>());
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<unknown>(null);
  const [message, setMessage] = useState("");
  const [addTopic, setAddTopic] = useState<{ flowAt?: Pos } | null>(null);
  const pendingStage = useRef<{ stage: number; panel: boolean } | null>(null);

  const announce = useCallback((msg: string) => {
    setMessage("");
    requestAnimationFrame(() => setMessage(msg));
  }, []);

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

  const states = useStable(live?.stageStates ?? data?.project.stageStates ?? {});
  const statesKey = JSON.stringify(states);
  const summary = useStable(live?.canvas ?? fetchedSummary ?? null);
  const staleReasons = useStable(live?.staleReasons ?? data?.project.staleReasons ?? {});
  const jobs = useStable(live?.jobs ?? data?.jobs ?? {});
  const costs = useStable(live?.costs ?? data?.costs ?? {});
  const liveRetrieval = useStable(live?.retrieval ?? null);
  const { data: status } = useApi<{ ai?: AiState }>("/api/status");
  const ai = useStable(live?.ai ?? status?.ai ?? { enabled: true, budgetReached: false });

  // Announce run-state changes to screen readers, and refresh the project when stages move.
  const prevStates = useRef<Record<string, StageState> | null>(null);
  useEffect(() => {
    const prev = prevStates.current;
    prevStates.current = states;
    if (!prev || !Object.keys(prev).length) return;
    const changed = STAGES.filter((s) => prev[String(s.n)] && prev[String(s.n)] !== states[String(s.n)]);
    if (changed.length) {
      mutate();
      const stale = changed.filter((s) => states[String(s.n)] === "stale");
      announce(
        stale.length > 1
          ? `${stale.length} later steps are now stale.`
          : changed.map((s) => `${s.title}: ${STATE_LABEL[states[String(s.n)] ?? "not_started"].toLowerCase()}.`).join(" "),
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statesKey]);

  // Pinned quotes need fresh claim verdicts whenever appraisal decisions change.
  const appraisalKey = summary ? `${summary.appraisal.verified}:${summary.appraisal.pending}:${summary.appraisal.accepted}:${summary.appraisal.rejected}:${summary.appraisal.claims}` : "";
  useEffect(() => {
    if (ui.pinnedQuotes.length) mutateClaims();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appraisalKey]);

  const input: GraphInput = useMemo(
    () => ({
      idea: data?.project.idea ?? "",
      title: data?.project.title ?? "",
      states,
      staleReasons,
      jobs,
      summary,
      claims: claims ?? null,
      client: { acceptedTopics: ui.acceptedTopics, pinnedQuotes: ui.pinnedQuotes },
    }),
    [data, states, staleReasons, jobs, summary, claims, ui.acceptedTopics, ui.pinnedQuotes],
  );
  const graph = useMemo(() => buildGraph(input), [input]);

  // After any change, every cached request for this project (panels included) revalidates.
  const { mutate: mutateAll } = useSWRConfig();
  const refresh = useCallback(() => mutateAll((key) => typeof key === "string" && key.startsWith(projectPath(projectId))), [mutateAll, projectId]);

  const focusStage = useCallback((stage: number, panel: boolean) => {
    pendingStage.current = { stage, panel };
  }, []);
  // After an approval the next stage's node may only appear once the server state arrives.
  useEffect(() => {
    const p = pendingStage.current;
    if (!p) return;
    // Stage 10 = the finished review: wait for the Export node itself.
    const id = p.stage > 9 ? (graph.nodes.some((n) => n.id === "export") ? "export" : null) : nodeForStage(graph, p.stage);
    if (!id) return;
    const kindReady = p.stage < 4 || p.stage > 9 || graph.nodes.some((n) => n.stages.includes(p.stage));
    if (!kindReady) return;
    pendingStage.current = null;
    const st = canvasStore.getState();
    if (p.panel) st.openPanel(id);
    else st.select(id);
  }, [graph]);

  const goTo = useCallback(
    (n: number) => {
      const id = nodeForStage(graph, n);
      if (id) canvasStore.getState().openPanel(id);
    },
    [graph],
  );

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
      const panel = canvasStore.getState().panel !== null;
      await api(projectPath(projectId, `stages/${n}/approve`), { body: {} });
      confirmed.current.clear();
      await refresh();
      announce(`${STAGES[n - 1].title} approved.`);
      // Approving the idea opens the scoping chat straight away; otherwise keep the panel as it was.
      if (n < 9) focusStage(n + 1, panel || n === 1);
      else focusStage(10, panel);
    },
    [projectId, refresh, announce, focusStage],
  );

  const run = useCallback(
    async (cmd: Cmd, opts: { flowAt?: Pos; from?: string } = {}) => {
      const key = cmdKey(cmd);
      const store = canvasStore.getState();
      setErr(null);
      const step = async (fn: () => Promise<unknown>) => {
        setBusy(key);
        try {
          await fn();
        } catch (e) {
          setErr(e);
          announce(`Failed: ${e instanceof Error ? e.message : String(e)}`);
        } finally {
          setBusy(null);
        }
      };
      switch (cmd.type) {
        case "approve":
          return step(() => approve(cmd.stage));
        case "run":
          return step(async () => {
            await api(projectPath(projectId, `stages/${cmd.stage}/run`), { body: { force: true } });
            await refresh();
            announce(`${STAGES[cmd.stage - 1].title} started.`);
          });
        case "openScoping":
        case "pinQuote":
          store.openPanel(cmd.type === "pinQuote" ? "appraisal" : "idea");
          if (cmd.type === "pinQuote") announce("Pick a quote in the appraisal and press Pin to canvas.");
          return;
        case "answer": {
          const form = document.getElementById("scoping-answer-form") as HTMLFormElement | null;
          if (form && store.panel === "idea") form.requestSubmit();
          else store.openPanel("idea");
          return;
        }
        case "branch":
          return step(async () => {
            if (summary?.topics.length && !(await confirmEdit(2))) return;
            await api(projectPath(projectId, "scoping/topics"), { body: {} });
            await refresh();
            announce("Subtopics suggested. Accept each with Enter or dismiss it with Escape.");
            focusStage(2, false);
          });
        case "acceptGhosts":
          store.acceptTopics(projectId, cmd.topicIds);
          announce(`${cmd.topicIds.length} subtopic${cmd.topicIds.length === 1 ? "" : "s"} accepted.`);
          return;
        case "acceptTopic":
          store.acceptTopics(projectId, [cmd.topicId]);
          announce("Subtopic accepted.");
          return;
        case "dismissTopic":
          return step(async () => {
            if (!(await confirmEdit(2))) return;
            await api(projectPath(projectId, `topics/${cmd.topicId}`), { method: "DELETE" });
            if (store.selected === `topic:${cmd.topicId}`) store.select("idea");
            if (store.panel === `topic:${cmd.topicId}`) store.closePanel();
            await refresh();
            announce("Subtopic dismissed.");
          });
        case "addTopic":
          setAddTopic({ flowAt: opts.flowAt });
          return;
        case "buildQueries":
          return step(async () => {
            if (summary?.queries.length && !(await confirmEdit(3))) return;
            await api(projectPath(projectId, "search/build"), { body: {} });
            await refresh();
            announce("Queries built: one per database for each topic.");
            focusStage(3, store.panel !== null);
          });
        case "rerunDownstream":
          store.setCascade(projectId, true);
          announce("Re-running downstream steps. Each one stops for your review before the next re-runs.");
          return;
        case "open":
          store.openPanel(cmd.nodeId);
          return;
        case "download":
          window.location.assign(projectPath(projectId, "export/markdown"));
          return;
      }
    },
    [approve, projectId, refresh, announce, confirmEdit, summary, focusStage],
  );

  const runRef = useRef(run);
  runRef.current = run;
  const stableRun = useCallback<Ctx["run"]>((c, o) => runRef.current(c, o), []);
  const actions = useMemo<Actions>(() => ({ run: stableRun, busy }), [stableRun, busy]);

  // "Re-run downstream": advance one stale step at a time, pausing at every review checkpoint.
  const cascading = useRef<string | null>(null);
  useEffect(() => {
    if (!ui.cascade) return;
    const step = cascadeStep(states);
    if (step.kind === "done") {
      canvasStore.getState().setCascade(projectId, false);
      announce("Downstream steps are up to date.");
      return;
    }
    if (step.kind === "wait") return;
    const key = `${step.kind}:${step.stage}:${statesKey}`;
    if (cascading.current === key) return;
    cascading.current = key;
    (async () => {
      try {
        await api(projectPath(projectId, `stages/${step.stage}/${step.kind === "run" ? "run" : "keep"}`), { body: step.kind === "run" ? { force: true } : {} });
        await refresh();
        const id = nodeForStage(graph, step.stage);
        if (id) canvasStore.getState().select(id);
        announce(step.kind === "run" ? `Re-running ${STAGES[step.stage - 1].title}.` : `${STAGES[step.stage - 1].title} re-opened for your review.`);
      } catch (e) {
        setErr(e);
        canvasStore.getState().setCascade(projectId, false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ui.cascade, statesKey]);

  const ctx = useMemo<Ctx | null>(
    () =>
      data
        ? {
            projectId,
            project: data.project,
            states,
            staleReasons: input.staleReasons,
            jobs: input.jobs,
            costs,
            ai,
            summary,
            claims: claims ?? null,
            graph,
            input,
            ui,
            goTo,
            refresh,
            openPaper: setPaperId,
            confirmEdit,
            approve,
            run,
            busy,
            error: err,
            clearError: () => setErr(null),
            announce,
          }
        : null,
    [data, projectId, states, input, costs, ai, summary, claims, graph, ui, goTo, refresh, confirmEdit, approve, run, busy, err, announce],
  );

  // Data, not SWR's isLoading: that stays true while server-provided (fallback) data revalidates.
  if (!ctx && !error) return <>{fallback(null)}</>;
  if (!ctx) return <>{fallback({ error: error ?? "Not found", retry: () => mutate() })}</>;

  return (
    <SessionCtx.Provider value={ctx}>
      <RetrievalCtx.Provider value={liveRetrieval}>
      <ActionsCtx.Provider value={actions}>
      {children}
      <div aria-live="polite" role="status" className="sr-only">{message}</div>
      {paperId && <PaperDialog paperId={paperId} onClose={() => setPaperId(null)} />}
      {guard && (
        <ConfirmEditDialog
          downstream={guard.downstream}
          onCancel={() => {
            guard.resolve(false);
            setGuard(null);
          }}
          onConfirm={() => {
            confirmed.current.add(guard.stage);
            guard.resolve(true);
            setGuard(null);
          }}
        />
      )}
      {addTopic && <AddTopicDialog state={addTopic} onClose={() => setAddTopic(null)} />}
      </ActionsCtx.Provider>
      </RetrievalCtx.Provider>
    </SessionCtx.Provider>
  );
}

