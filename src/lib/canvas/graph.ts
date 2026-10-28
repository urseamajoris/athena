// The canvas graph is derived, not stored: server state (stages, topics, queries, counts) plus a little
// per-browser state (accepted ghost topics, pinned quotes) → nodes and edges. Pure; unit-tested.
import { STAGES, type StageState } from "../shared/stages";
import type { CanvasSummary, ClaimLite, JobLite, StageStates } from "../shared/canvas";

export type NodeKind = "idea" | "topic" | "query" | "corpus" | "table" | "appraisal" | "synthesis" | "questions" | "export" | "quote";
export type NodeStatus = "idle" | "running" | "review" | "done" | "stale" | "error";

export const KIND_LABEL: Record<NodeKind, string> = {
  idea: "Idea",
  topic: "Topic",
  query: "Query",
  corpus: "Corpus",
  table: "Table",
  appraisal: "Appraisal",
  synthesis: "Synthesis",
  questions: "Questions",
  export: "Export",
  quote: "Quote",
};

export const STATUS_LABEL: Record<NodeStatus, string> = {
  idle: "Not started",
  running: "Running",
  review: "Needs review",
  done: "Done",
  stale: "Stale",
  error: "Error",
};

/** Layout column per kind (left → right follows the review). */
export const KIND_COLUMN: Record<NodeKind, number> = { idea: 0, topic: 1, query: 2, corpus: 3, table: 4, appraisal: 5, synthesis: 6, questions: 7, export: 8, quote: 5 };

export interface Trust {
  verified: number;
  unverified: number;
  accepted: number;
  stale: boolean;
}

export interface GNode {
  id: string;
  kind: NodeKind;
  /** Stages whose work this node holds (first = the one used for "jump to stage"). */
  stages: number[];
  title: string;
  status: NodeStatus;
  /** The one key number shown on the card. */
  key: string;
  parents: string[];
  ghost?: boolean;
  topicId?: string;
  claimId?: string;
  progress?: { done: number; total: number };
  trust?: Trust;
  staleReason?: string;
}

export interface GEdge {
  id: string;
  source: string;
  target: string;
  /** Data is flowing along this edge right now (live retrieval). */
  running?: boolean;
}

export interface ClientCanvasState {
  acceptedTopics: string[];
  pinnedQuotes: string[];
}

export interface GraphInput {
  idea: string;
  title: string;
  states: StageStates;
  staleReasons: Record<string, string>;
  jobs: Record<string, JobLite | null>;
  summary: CanvasSummary | null;
  claims: ClaimLite[] | null;
  client: ClientCanvasState;
}

export interface Graph {
  nodes: GNode[];
  edges: GEdge[];
}

export const st = (states: StageStates, n: number): StageState => states[String(n)] ?? "not_started";

export function toStatus(s: StageState): NodeStatus {
  switch (s) {
    case "running": return "running";
    case "needs_review": return "review";
    case "approved": return "done";
    case "stale": return "stale";
    case "failed": return "error";
    default: return "idle";
  }
}

const fmt = (n: number) => n.toLocaleString("en-US");
const plural = (n: number, one: string, many = `${one}s`) => `${fmt(n)} ${n === 1 ? one : many}`;
const DB_LABEL: Record<string, string> = { pubmed: "PubMed", openalex: "OpenAlex" };

export function isGhostTopic(t: CanvasSummary["topics"][number], states: StageStates, accepted: string[]) {
  return t.origin === "ai" && !t.approved && st(states, 2) !== "approved" && !accepted.includes(t.id);
}

function jobProgress(jobs: GraphInput["jobs"], n: number) {
  const j = jobs[String(n)];
  return j && (j.status === "running" || j.status === "queued") ? { done: j.progress.done, total: j.progress.total } : undefined;
}

export function buildGraph(input: GraphInput): Graph {
  const { states, summary: s, client } = input;
  const nodes: GNode[] = [];
  const edges: GEdge[] = [];
  const reason = (n: number) => input.staleReasons[String(n)];
  const add = (n: GNode) => {
    nodes.push(n);
    for (const p of n.parents) edges.push({ id: `${p}->${n.id}`, source: p, target: n.id });
  };

  // 1. Idea (stage 1, plus the stage-2 scoping chat).
  const s1 = st(states, 1);
  const s2 = st(states, 2);
  const ideaStatus: NodeStatus = s1 !== "approved" ? toStatus(s1) : s2 === "approved" ? "done" : s2 === "stale" ? "stale" : "review";
  const topics = s?.topics ?? [];
  add({
    id: "idea",
    kind: "idea",
    stages: [1, 2],
    title: input.title || input.idea,
    status: ideaStatus,
    key: s1 !== "approved" ? "Draft idea" : topics.length ? plural(topics.length, "topic") : s ? `${s.scoping.asked} of ${s.scoping.maxQuestions} questions` : "Scoping",
    parents: [],
    staleReason: ideaStatus === "stale" ? reason(2) : undefined,
  });

  // 2. Topics.
  for (const t of topics) {
    const ghost = isGhostTopic(t, states, client.acceptedTopics);
    add({
      id: `topic:${t.id}`,
      kind: "topic",
      stages: [2],
      title: t.name,
      status: ghost ? "review" : toStatus(s2),
      key: ghost ? "Suggested subtopic" : `${plural(t.synonyms, "synonym")} · ${t.controlledTerms} MeSH`,
      parents: ["idea"],
      ghost,
      topicId: t.id,
      staleReason: s2 === "stale" ? reason(2) : undefined,
    });
  }

  // 3. One Query node per topic (holds that topic's PubMed and OpenAlex queries).
  const s3 = st(states, 3);
  const queryIds: string[] = [];
  for (const t of topics) {
    const qs = (s?.queries ?? []).filter((q) => q.topicId === t.id);
    if (!qs.length) continue;
    const id = `query:${t.id}`;
    queryIds.push(id);
    const counts = qs.map((q) => `${DB_LABEL[q.database] ?? q.database} ${q.dryRunError ? "failed" : q.dryRunCount === null ? "–" : fmt(q.dryRunCount)}`);
    add({ id, kind: "query", stages: [3], title: t.name, status: toStatus(s3), key: counts.join(" · "), parents: [`topic:${t.id}`], topicId: t.id, staleReason: s3 === "stale" ? reason(3) : undefined });
  }

  // 4. Corpus: every query merges into one retrieval.
  const s4 = st(states, 4);
  if (s4 !== "not_started") {
    const r = s?.retrieval;
    const running = s4 === "running";
    const key = !r ? "Retrieval" : running ? `${plural(r.unique, "paper")} so far` : `${plural(r.unique, "paper")}, ${fmt(Math.max(0, r.fetched - r.unique))} dupes removed${r.failed ? ` · ${r.failed} failed` : ""}`;
    add({ id: "corpus", kind: "corpus", stages: [4], title: "Retrieved papers", status: toStatus(s4), key, parents: queryIds.length ? queryIds : ["idea"], progress: jobProgress(input.jobs, 4), staleReason: s4 === "stale" ? reason(4) : undefined });
    if (running) for (const e of edges) if (e.target === "corpus") e.running = true;
  }

  // 5–6. Table: summary rows, then ranking.
  const s5 = st(states, 5);
  const s6 = st(states, 6);
  if (s5 !== "not_started" && nodes.some((n) => n.id === "corpus")) {
    const tableState: StageState = s5 !== "approved" ? s5 : s6 === "not_started" ? "needs_review" : s6;
    const selected = (s?.ranking ?? []).reduce((a, t) => a + t.selected, 0);
    const t = s?.table;
    const key = !t ? "Summary table" : s5 === "running" ? `${fmt(t.summarised)} of ${fmt(t.papers)} summarised` : s6 === "not_started" || s6 === "running" ? `${plural(t.papers, "row")}${s6 === "running" ? " · ranking" : ""}` : `${plural(t.papers, "row")} · ${fmt(selected)} selected`;
    add({ id: "table", kind: "table", stages: [5, 6], title: "Summary & ranking", status: toStatus(tableState), key, parents: ["corpus"], progress: jobProgress(input.jobs, s5 === "approved" ? 6 : 5), staleReason: tableState === "stale" ? reason(s5 === "stale" ? 5 : 6) : undefined });
  }

  // 7. Appraisal (batch over the selected papers).
  const s7 = st(states, 7);
  if (s7 !== "not_started" && nodes.some((n) => n.id === "table")) {
    const a = s?.appraisal;
    add({
      id: "appraisal",
      kind: "appraisal",
      stages: [7],
      title: "Appraisal",
      status: toStatus(s7),
      key: a ? `${plural(a.papers, "paper")} · ${fmt(a.fullText)} full text` : "Appraisal",
      parents: ["table"],
      progress: jobProgress(input.jobs, 7),
      trust: a ? { verified: a.verified, unverified: a.pending, accepted: a.accepted, stale: s7 === "stale" } : undefined,
      staleReason: s7 === "stale" ? reason(7) : undefined,
    });
  }

  // 8. Synthesis.
  const s8 = st(states, 8);
  if (s8 !== "not_started" && nodes.some((n) => n.id === "appraisal")) {
    const y = s?.synthesis;
    add({
      id: "synthesis",
      kind: "synthesis",
      stages: [8],
      title: "Synthesis",
      status: toStatus(s8),
      key: y ? `${plural(y.statements, "statement")} · ${plural(y.contradictions, "conflict")}` : "Synthesis",
      parents: ["appraisal"],
      progress: jobProgress(input.jobs, 8),
      trust: s?.appraisal ? { verified: s.appraisal.verified, unverified: 0, accepted: s.appraisal.accepted, stale: s8 === "stale" } : undefined,
      staleReason: s8 === "stale" ? reason(8) : undefined,
    });
  }

  // 9. Questions, then Export once the review is finished.
  const s9 = st(states, 9);
  if (s9 !== "not_started" && nodes.some((n) => n.id === "synthesis")) {
    const q = s?.questions;
    add({
      id: "questions",
      kind: "questions",
      stages: [9],
      title: q?.chosenText ?? "Research questions",
      status: toStatus(s9),
      key: q ? `${plural(q.count, "candidate")}${q.chosenId ? " · 1 chosen" : ""}` : "Research questions",
      parents: ["synthesis"],
      progress: jobProgress(input.jobs, 9),
      staleReason: s9 === "stale" ? reason(9) : undefined,
    });
    if (s9 === "approved") add({ id: "export", kind: "export", stages: [9], title: "Report", status: "done", key: "Markdown · CSV · BibTeX", parents: ["questions"] });
  }

  // Quotes pinned from the appraisal (verification status always visible).
  if (nodes.some((n) => n.id === "appraisal") && input.claims) {
    const byId = new Map(input.claims.map((c) => [c.id, c]));
    for (const cid of client.pinnedQuotes) {
      const c = byId.get(cid);
      if (!c) continue;
      const verdict = c.verified ? "Verified" : c.userAccepted ? "Accepted by you" : c.userRejected ? "Rejected by you" : "Unverified";
      add({
        id: `quote:${c.id}`,
        kind: "quote",
        stages: [7],
        title: `“${c.quote}”`,
        status: s7 === "stale" ? "stale" : c.verified || c.userAccepted ? "done" : c.userRejected ? "idle" : "review",
        key: `${verdict} · ${c.paperTitle}`,
        parents: ["appraisal"],
        claimId: c.id,
        trust: { verified: c.verified ? 1 : 0, unverified: !c.verified && !c.userAccepted && !c.userRejected ? 1 : 0, accepted: !c.verified && c.userAccepted ? 1 : 0, stale: s7 === "stale" },
        staleReason: s7 === "stale" ? reason(7) : undefined,
      });
    }
  }

  return { nodes, edges };
}

/** Earliest stage that is not approved yet (the session's next step), or null when the review is finished. */
export function frontierStage(states: StageStates): number | null {
  for (const s of STAGES) if (st(states, s.n) !== "approved") return s.n;
  return null;
}

export function anyStale(states: StageStates): boolean {
  return STAGES.some((s) => st(states, s.n) === "stale");
}

/** The node that represents a stage on the canvas (for the stage rail, 1–9 keys and redirects). */
export function nodeForStage(graph: Graph, n: number): string | null {
  const has = (id: string) => graph.nodes.some((x) => x.id === id);
  const first = (kind: NodeKind, pred: (x: GNode) => boolean = () => true) => graph.nodes.find((x) => x.kind === kind && pred(x))?.id ?? null;
  switch (n) {
    case 1:
    case 2: return "idea";
    case 3: return first("query") ?? first("topic", (x) => !x.ghost) ?? first("topic") ?? "idea";
    case 4: return has("corpus") ? "corpus" : nodeForStage(graph, 3);
    case 5:
    case 6: return has("table") ? "table" : nodeForStage(graph, 4);
    case 7: return has("appraisal") ? "appraisal" : nodeForStage(graph, 6);
    case 8: return has("synthesis") ? "synthesis" : nodeForStage(graph, 7);
    case 9: return has("questions") ? "questions" : nodeForStage(graph, 8);
    default: return has("export") ? "export" : nodeForStage(graph, 9);
  }
}

/** Old wizard stage keys (from /projects/[id]?stage=N) → canvas node ids. */
export const STAGE_KEY_TO_NODE: Record<string, number> = Object.fromEntries(STAGES.map((s) => [s.key, s.n]));

export function frontierNodeId(graph: Graph, states: StageStates): string {
  const f = frontierStage(states);
  return f === null ? (nodeForStage(graph, 10) ?? "idea") : (nodeForStage(graph, f) ?? "idea");
}
