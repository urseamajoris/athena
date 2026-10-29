// What each node offers: its one next action (only on the session's frontier) and which child
// node types may be added (stage gating). Pure; unit-tested.
import { STAGES } from "../shared/stages";
import type { StageStates } from "../shared/canvas";
import { anyStale, frontierNodeId, frontierStage, isGhostTopic, st, type GNode, type Graph, type GraphInput, type NodeKind } from "./graph";

export type Cmd =
  | { type: "approve"; stage: number }
  | { type: "run"; stage: number }
  | { type: "openScoping" }
  | { type: "answer" }
  | { type: "branch" }
  | { type: "acceptGhosts"; topicIds: string[] }
  | { type: "acceptTopic"; topicId: string }
  | { type: "dismissTopic"; topicId: string }
  | { type: "addTopic" }
  | { type: "buildQueries" }
  | { type: "rerunDownstream" }
  | { type: "pinQuote" }
  | { type: "open"; nodeId: string }
  | { type: "download" };

export interface Action {
  cmd: Cmd;
  label: string;
  /** Why the action is locked; shown in its tooltip. Undefined = enabled. */
  disabledReason?: string;
}

/** Why approving stage n is blocked by an earlier stage, or undefined. */
export function upstreamBlocker(states: StageStates, n: number): string | undefined {
  const b = STAGES.find((s) => s.n < n && st(states, s.n) !== "approved");
  return b ? `Approve step ${b.n} (${b.title}) first` : undefined;
}

function rerun(): Action {
  return { cmd: { type: "rerunDownstream" }, label: "Bring later steps up to date" };
}

/** The next action for the session's frontier stage. */
export function stageAction(stage: number | null, input: GraphInput): Action | null {
  const { states, summary: s } = input;
  if (stage === null) return { cmd: { type: "download" }, label: "Download report" };
  const state = st(states, stage);
  if (state === "stale") return rerun();
  if (state === "running") return null;
  const job = STAGES[stage - 1].job;
  if (job && (state === "failed" || state === "not_started")) return { cmd: { type: "run", stage }, label: state === "failed" ? `Retry ${STAGES[stage - 1].title.toLowerCase()}` : `Run ${STAGES[stage - 1].title.toLowerCase()}` };
  switch (stage) {
    case 1:
      return { cmd: { type: "approve", stage: 1 }, label: "Sharpen my idea", disabledReason: input.idea.trim().length < 10 ? "Write at least a sentence about your idea" : undefined };
    case 2: {
      const topics = s?.topics ?? [];
      if (!s || s.scoping.messages === 0) return { cmd: { type: "openScoping" }, label: "Sharpen my idea" };
      if (!s.scoping.done && !topics.length) return { cmd: { type: "answer" }, label: "Answer the scoping question" };
      if (!topics.length) return { cmd: { type: "branch" }, label: "Suggest search topics" };
      const ghosts = topics.filter((t) => isGhostTopic(t, states, input.client.acceptedTopics));
      if (ghosts.length) return { cmd: { type: "acceptGhosts", topicIds: ghosts.map((g) => g.id) }, label: `Keep ${ghosts.length} suggested topic${ghosts.length === 1 ? "" : "s"}` };
      return { cmd: { type: "approve", stage: 2 }, label: "Use these topics", disabledReason: topics.length > 8 ? "Keep at most 8 topics (merge or delete some)" : undefined };
    }
    case 3:
      if (!s?.queries.length) return { cmd: { type: "buildQueries" }, label: "Write the searches" };
      return { cmd: { type: "approve", stage: 3 }, label: s.queries.length > 1 ? `Run all ${s.queries.length} searches` : "Run the search" };
    case 4:
      return { cmd: { type: "approve", stage: 4 }, label: "Summarise the papers" };
    case 5:
      return { cmd: { type: "approve", stage: 5 }, label: "Rank the papers" };
    case 6:
      return { cmd: { type: "approve", stage: 6 }, label: "Appraise selected papers" };
    case 7:
      return { cmd: { type: "approve", stage: 7 }, label: "Summarise the evidence" };
    case 8:
      return { cmd: { type: "approve", stage: 8 }, label: "Suggest research questions" };
    case 9:
      return { cmd: { type: "approve", stage: 9 }, label: "Finish and export", disabledReason: s?.questions.chosenId ? undefined : "Choose one research question first" };
    default:
      return null;
  }
}

/**
 * A node's one next-action button. Only the frontier node (where the session's next step lives) has
 * one; ghost topics offer "Accept". Every other node is calm: done, or waiting on an earlier step.
 */
export function nextAction(node: GNode, graph: Graph, input: GraphInput): Action | null {
  if (node.ghost && node.topicId) return { cmd: { type: "acceptTopic", topicId: node.topicId }, label: "Keep" };
  if (node.id !== frontierNodeId(graph, input.states)) return null;
  return stageAction(frontierStage(input.states), input);
}

export interface ChildOption {
  kind: NodeKind;
  label: string;
  cmd: Cmd;
  /** Locked: why (shown dimmed with this tooltip). */
  reason?: string;
}

const READY = new Set(["needs_review", "approved"]);

function gate(states: StageStates, parentStage: number, wait: string): string | undefined {
  const s = st(states, parentStage);
  if (s === "stale") return "Re-run or keep the stale results first";
  if (s === "failed") return "This step failed; retry it first";
  if (s === "running") return "Wait for this step to finish";
  if (!READY.has(s)) return wait;
  return upstreamBlocker(states, parentStage);
}

/** Child node types a node may add (stage gating): offered only once the parent's work is ready. */
export function childOptions(node: GNode, graph: Graph, input: GraphInput): ChildOption[] {
  const { states, summary: s } = input;
  const has = (id: string) => graph.nodes.some((n) => n.id === id);
  const opt = (kind: NodeKind, label: string, cmd: Cmd, reason?: string): ChildOption => ({ kind, label, cmd, reason });
  switch (node.kind) {
    case "idea": {
      const started = st(states, 1) === "approved" ? undefined : "Start scoping first";
      return [
        opt("topic", "Topic (name your own)", { type: "addTopic" }, started ?? ((s?.topics.length ?? 0) >= 8 ? "A review can have at most 8 topics" : undefined)),
        opt("topic", "Suggested subtopics", { type: "branch" }, started ?? (!s?.scoping.done ? "Finish the scoping questions first" : undefined)),
      ];
    }
    case "topic": {
      if (node.ghost) return [];
      const q = `query:${node.topicId}`;
      if (has(q)) return [opt("query", "Open its query", { type: "open", nodeId: q })];
      return [opt("query", "Query", { type: "buildQueries" }, st(states, 2) === "approved" ? undefined : "Approve your topics first")];
    }
    case "query":
      if (has("corpus")) return [opt("corpus", "Open the corpus", { type: "open", nodeId: "corpus" })];
      return [opt("corpus", "Corpus (run the search)", { type: "approve", stage: 3 }, gate(states, 3, "Build the queries first"))];
    case "corpus":
      if (has("table")) return [opt("table", "Open the table", { type: "open", nodeId: "table" })];
      return [opt("table", "Table (summarise papers)", { type: "approve", stage: 4 }, gate(states, 4, "Wait for retrieval to finish"))];
    case "table":
      if (has("appraisal")) return [opt("appraisal", "Open the appraisal", { type: "open", nodeId: "appraisal" })];
      if (st(states, 5) !== "approved") return [opt("appraisal", "Appraisal", { type: "approve", stage: 5 }, gate(states, 5, "Wait for the summaries") ?? "Rank the papers first")];
      return [opt("appraisal", "Appraisal (selected papers)", { type: "approve", stage: 6 }, gate(states, 6, "Rank the papers first"))];
    case "appraisal": {
      const opts: ChildOption[] = [opt("quote", "Quote (pin from a paper)", { type: "pinQuote" }, (s?.appraisal.claims ?? 0) ? undefined : "No quotes extracted yet")];
      opts.unshift(has("synthesis") ? opt("synthesis", "Open the synthesis", { type: "open", nodeId: "synthesis" }) : opt("synthesis", "Synthesis", { type: "approve", stage: 7 }, gate(states, 7, "Wait for the appraisals")));
      return opts;
    }
    case "synthesis":
      if (has("questions")) return [opt("questions", "Open the questions", { type: "open", nodeId: "questions" })];
      return [opt("questions", "Research questions", { type: "approve", stage: 8 }, gate(states, 8, "Wait for the synthesis"))];
    case "questions":
      if (has("export")) return [opt("export", "Open the export", { type: "open", nodeId: "export" })];
      return [opt("export", "Export", { type: "approve", stage: 9 }, gate(states, 9, "Wait for the questions") ?? (s?.questions.chosenId ? undefined : "Choose one research question first"))];
    default:
      return [];
  }
}

/** Sibling options (Shift+A): only topics have siblings. */
export function siblingOptions(node: GNode, graph: Graph, input: GraphInput): ChildOption[] {
  if (node.kind !== "topic") return [];
  const idea = graph.nodes.find((n) => n.id === "idea")!;
  return childOptions(idea, graph, input).filter((o) => o.cmd.type === "addTopic");
}

export type CascadeStep = { kind: "run" | "keep"; stage: number } | { kind: "wait"; stage: number } | { kind: "done" };

/**
 * "Re-run downstream" walks the stale steps in order, but keeps the review checkpoints: it re-runs (or,
 * for steps without a job, re-opens for review) the first stale step, then waits for the user to approve
 * it before moving on. Returns what to do now.
 */
export function cascadeStep(states: StageStates): CascadeStep {
  if (!anyStale(states)) return { kind: "done" };
  const f = frontierStage(states);
  if (f === null) return { kind: "done" };
  if (st(states, f) === "stale") return { kind: STAGES[f - 1].job ? "run" : "keep", stage: f };
  return { kind: "wait", stage: f };
}
