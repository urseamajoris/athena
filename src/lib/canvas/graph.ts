// The canvas graph is derived, not stored: server state (stages, topics, queries, counts) plus a little
// per-browser state (accepted ghost topics, pinned quotes, expanded boxes) → nodes and edges. Pure; unit-tested.
import { STAGES, type StageState } from "../shared/stages";
import {
  evaluateQueryAttention,
  evaluateTopicAttention,
  isUndecided,
  type AttentionTone,
  type CanvasSummary,
  type ClaimLite,
  type CorpusImpactSummary,
  type JobLite,
  type QueryPaperPreview,
  type QueryPaperStats,
  type StageStates,
  type TopicArticleStats,
  type TopicAttention,
} from "../shared/canvas";
import { providerLabel, type AiProvider } from "../shared/ai-providers";
import { fmtInt } from "../shared/format";

export type NodeKind =
  | "ai_config"
  | "idea"
  | "topic"
  | "query"
  | "query_item"
  | "corpus"
  | "topic_corpus"
  | "query_corpus"
  | "paper_group"
  | "table"
  | "appraisal"
  | "synthesis"
  | "questions"
  | "export"
  | "quote";
export type NodeStatus = "idle" | "running" | "review" | "done" | "stale" | "error";

export const KIND_LABEL: Record<NodeKind, string> = {
  ai_config: "Admin · AI Engine",
  idea: "Idea",
  topic: "Topic",
  query: "Queries",
  query_item: "Query",
  corpus: "Corpus",
  topic_corpus: "Retrieved · Topic",
  query_corpus: "Retrieved · Query",
  paper_group: "Papers",
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
  review: "Your turn",
  done: "Done",
  stale: "Out of date",
  error: "Failed",
};

/** Layout column per kind (left → right follows the review). Empty columns are compacted by layout.ts. */
export const KIND_COLUMN: Record<NodeKind, number> = {
  ai_config: 0,
  idea: 0,
  topic: 1,
  query: 2,
  query_item: 3,
  corpus: 4,
  topic_corpus: 4,
  query_corpus: 5,
  paper_group: 6,
  table: 7,
  appraisal: 8,
  synthesis: 9,
  questions: 10,
  export: 11,
  quote: 8,
};

export interface Trust {
  verified: number;
  unverified: number;
  accepted: number;
  stale: boolean;
}

export interface PipelineCounts {
  retrieved: number;
  rendered: number;
  filed: number;
  selected: number;
  stageTones: { retrieved: AttentionTone; rendered: AttentionTone; filed: AttentionTone };
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
  queryId?: string;
  database?: string;
  queryString?: string;
  queryCount?: number;
  claimId?: string;
  progress?: { done: number; total: number };
  /** Its job is paused (AI switched off, no key, or budget reached): work is kept and resumes later. */
  paused?: boolean;
  trust?: Trust;
  staleReason?: string;
  /** Expandable container box state. */
  expandable?: boolean;
  expanded?: boolean;
  childCount?: number;
  expandLabel?: string;
  /** Per-topic retrieved / rendered / filed counts and citation impact (Topic, Query & Topic Corpus nodes). */
  articleStats?: TopicArticleStats;
  /** Per-query stats for Query sub-boxes and Query Retrieval boxes. */
  queryStats?: QueryPaperStats;
  /** All queries' retrieval stats for a Topic Corpus box (renders the mini per-query bar visualization). */
  topicQueryStats?: QueryPaperStats[];
  /** Papers inside an expanded paper_group sub-box. */
  paperGroupKind?: "attention" | "ok";
  paperCount?: number;
  papers?: QueryPaperPreview[];
  /** Color-coded attention indicator showing which stage needs attention for this node. */
  attention?: TopicAttention;
  /** Corpus-wide retrieved / rendered / filed counts (Corpus, Table, Appraisal nodes). */
  pipelineCounts?: PipelineCounts;
  /** Corpus-wide impact summary (Corpus / Table nodes). */
  impactSummary?: CorpusImpactSummary;
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
  expandedNodes?: string[];
}

export interface GraphAiState {
  enabled: boolean;
  budgetReached: boolean;
  keyMissing: boolean;
  provider?: AiProvider;
  activeModel?: string;
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
  /** When true, the Canvas renders the Admin AI Engine box (choose Anthropic / Gemini / xAI and pipeline model). */
  isAdmin?: boolean;
  ai?: GraphAiState;
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

const fmt = fmtInt;
const plural = (n: number, one: string, many = `${one}s`) => `${fmt(n)} ${n === 1 ? one : many}`;
const DB_LABEL: Record<string, string> = { pubmed: "PubMed", openalex: "OpenAlex" };

export function isGhostTopic(t: CanvasSummary["topics"][number], states: StageStates, accepted: string[]) {
  return t.origin === "ai" && !t.approved && st(states, 2) !== "approved" && !accepted.includes(t.id);
}

function jobProgress(jobs: GraphInput["jobs"], n: number) {
  const j = jobs[String(n)];
  return j && (j.status === "running" || j.status === "queued") ? { done: j.progress.done, total: j.progress.total } : undefined;
}

function synthesizeQueryStats(
  qs: CanvasSummary["queries"],
  topicId: string,
  s4: StageState,
): QueryPaperStats[] {
  const mine = qs.filter((q) => q.topicId === topicId);
  const dbTotals = new Map<string, number>();
  for (const q of mine) dbTotals.set(q.database, (dbTotals.get(q.database) ?? 0) + 1);
  const dbIdx = new Map<string, number>();
  return mine.map((q) => {
    const idx = (dbIdx.get(q.database) ?? 0) + 1;
    dbIdx.set(q.database, idx);
    const base = DB_LABEL[q.database] ?? q.database;
    const label = (dbTotals.get(q.database) ?? 1) > 1 ? `${base} #${idx}` : base;
    const runStatus: QueryPaperStats["runStatus"] = q.run
      ? q.run.failed
        ? "failed"
        : "done"
      : s4 === "running"
        ? "running"
        : "not_run";
    return {
      queryId: q.id,
      topicId: q.topicId,
      database: q.database,
      queryString: q.queryString ?? "",
      label,
      runStatus,
      resultCount: q.run?.count ?? null,
      error: q.dryRunError,
      retrieved: q.run && !q.run.failed ? (q.run.count ?? 0) : 0,
      newUnique: q.run && !q.run.failed ? (q.run.count ?? 0) : 0,
      duplicates: 0,
      rendered: 0,
      selected: 0,
      filed: 0,
      needsAttention: 0,
      attentionBreakdown: { missingSummary: 0, unscored: 0, failedAppraisal: 0, undecidedQuotes: 0, undecidedQuoteCount: 0 },
      papers: [],
    };
  });
}

export function buildGraph(input: GraphInput): Graph {
  const { states, summary: s, client } = input;
  const expanded = new Set(client.expandedNodes ?? []);
  const nodes: GNode[] = [];
  const edges: GEdge[] = [];
  const reason = (n: number) => input.staleReasons[String(n)];
  const add = (n: GNode) => {
    nodes.push(n);
    for (const p of n.parents) edges.push({ id: `${p}->${n.id}`, source: p, target: n.id });
  };

  // 0. Admin AI Engine box (only visible to admins: choose Anthropic / Gemini / xAI and pipeline model).
  if (input.isAdmin) {
    const ai = input.ai;
    const prov = ai?.provider ? providerLabel(ai.provider) : "AI";
    const status: NodeStatus = ai?.budgetReached ? "error" : ai?.keyMissing || ai?.enabled === false ? "review" : "done";
    const keyLine = ai?.keyMissing
      ? `${prov} · No API key set`
      : ai?.enabled === false
        ? `${prov} · Paused`
        : ai?.budgetReached
          ? `${prov} · Budget reached`
          : `${prov}${ai?.activeModel ? ` · ${ai.activeModel}` : " · Ready"}`;
    add({
      id: "admin:ai",
      kind: "ai_config",
      stages: [],
      title: "AI Provider & Pipeline Model",
      status,
      key: keyLine,
      parents: [],
    });
  }

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

  const topicStatsById = new Map((s?.topicStats ?? []).map((ts) => [ts.topicId, ts]));
  const queryStatsById = new Map((s?.queryStats ?? []).map((qs) => [qs.queryId, qs]));
  const s4All = st(states, 4);
  const s5All = st(states, 5);
  const s6All = st(states, 6);
  const s7All = st(states, 7);

  const corpusPipeline: PipelineCounts | undefined = s && (s4All !== "not_started" || s.retrieval.unique > 0) ? (() => {
    const retrieved = s.retrieval.unique;
    const rendered = s.table.summarised;
    const selected = s.table.selectedPapers ?? s.ranking.reduce((acc, r) => acc + r.selected, 0);
    const filed = s.appraisal.done > 0 ? Math.max(0, s.appraisal.done - (s.appraisal.pending > 0 ? Math.min(s.appraisal.done, s.appraisal.pending) : 0)) : 0;
    const retTone: AttentionTone = s4All === "failed" || s.retrieval.failed > 0 || ((s4All === "needs_review" || s4All === "approved") && retrieved === 0) ? "err" : s4All === "running" ? "run" : s4All === "stale" || s4All === "needs_review" ? "warn" : retrieved > 0 ? "ok" : "idle";
    const renTone: AttentionTone = s5All === "failed" ? "err" : s5All === "running" ? "run" : s5All === "stale" ? "warn" : (s5All === "needs_review" || s5All === "approved") ? (rendered < retrieved ? "warn" : "ok") : "idle";
    const filTone: AttentionTone = s7All === "failed" || s.appraisal.failed > 0 || s6All === "failed" ? "err" : s6All === "running" || s7All === "running" ? "run" : s6All === "stale" || s7All === "stale" ? "warn" : (s7All === "needs_review" || s7All === "approved") ? (s.appraisal.pending > 0 || filed < selected ? "warn" : "ok") : (s6All === "needs_review" || s6All === "approved") ? (selected === 0 ? "err" : "warn") : "idle";
    return { retrieved, rendered, filed, selected, stageTones: { retrieved: retTone, rendered: renTone, filed: filTone } };
  })() : undefined;

  // 2. Topics.
  for (const t of topics) {
    const ghost = isGhostTopic(t, states, client.acceptedTopics);
    const ts = topicStatsById.get(t.id);
    const qCount = (s?.queries ?? []).filter((q) => q.topicId === t.id).length;
    const showStats = !!ts && (s4All !== "not_started" || ts.retrieved > 0 || ts.failedRuns > 0 || ts.runningRuns > 0);
    add({
      id: `topic:${t.id}`,
      kind: "topic",
      stages: [2],
      title: t.name,
      // A kept topic is done: what step 2 still needs ("Use these topics") is on the Idea card, not on every topic.
      status: ghost ? "review" : s2 === "needs_review" || s2 === "not_started" ? "done" : toStatus(s2),
      key: ghost ? "Suggested subtopic" : `${plural(t.synonyms, "synonym")} · ${t.controlledTerms} MeSH${qCount ? ` · ${plural(qCount, "query", "queries")}` : ""}`,
      parents: ["idea"],
      ghost,
      topicId: t.id,
      queryCount: qCount,
      staleReason: s2 === "stale" ? reason(2) : undefined,
      articleStats: showStats ? ts : undefined,
      attention: showStats && ts ? evaluateTopicAttention(ts, states) : undefined,
    });
  }

  // 3. Queries per topic (each topic may have 1 or many queries; expandable into individual query sub-boxes).
  const s3 = st(states, 3);
  const queryOutByTopic = new Map<string, string[]>();
  const allQueryHubIds: string[] = [];
  for (const t of topics) {
    const qs = (s?.queries ?? []).filter((q) => q.topicId === t.id);
    if (!qs.length) continue;
    const id = `query:${t.id}`;
    allQueryHubIds.push(id);
    const ran = qs.every((q) => q.run);
    const counts = qs.map((q) => {
      const lbl = queryStatsById.get(q.id)?.label ?? DB_LABEL[q.database] ?? q.database;
      return `${lbl} ${q.run ? (q.run.failed ? "failed" : q.run.count === null ? "done" : `${fmt(q.run.count)}${ran ? "" : " (ran)"}`) : q.dryRunError ? "failed" : q.dryRunCount === null ? "not counted" : fmt(q.dryRunCount)}`;
    });
    const ts = topicStatsById.get(t.id);
    const showStats = !!ts && (s4All !== "not_started" || ts.retrieved > 0 || ts.failedRuns > 0 || ts.runningRuns > 0);
    const isExp = expanded.has(id);
    add({
      id,
      kind: "query",
      stages: [3],
      title: t.name,
      status: toStatus(s3),
      key: `${ran ? "Ran: " : ""}${counts.join(" · ")}`,
      parents: [`topic:${t.id}`],
      topicId: t.id,
      queryCount: qs.length,
      expandable: true,
      expanded: isExp,
      childCount: qs.length,
      expandLabel: `${plural(qs.length, "query", "queries")}`,
      staleReason: s3 === "stale" ? reason(3) : undefined,
      articleStats: showStats ? ts : undefined,
      attention: showStats && ts ? evaluateTopicAttention(ts, states) : undefined,
    });

    if (isExp) {
      const subIds: string[] = [];
      const dbTotals = new Map<string, number>();
      for (const q of qs) dbTotals.set(q.database, (dbTotals.get(q.database) ?? 0) + 1);
      const dbIdx = new Map<string, number>();
      for (const q of qs) {
        const idx = (dbIdx.get(q.database) ?? 0) + 1;
        dbIdx.set(q.database, idx);
        const baseDb = DB_LABEL[q.database] ?? q.database;
        const qStat = queryStatsById.get(q.id);
        const lbl = qStat?.label ?? ((dbTotals.get(q.database) ?? 1) > 1 ? `${baseDb} #${idx}` : baseDb);
        const itemId = `query-item:${q.id}`;
        subIds.push(itemId);
        const itemKey = q.run
          ? q.run.failed
            ? "Search failed"
            : q.run.count === null
              ? "Ran"
              : `Ran: ${fmt(q.run.count)} hits`
          : q.dryRunError
            ? `Dry run failed`
            : q.dryRunCount === null
              ? "Not counted yet"
              : `${fmt(q.dryRunCount)} matches (dry run)`;
        const itemStatus: NodeStatus = q.run?.failed || q.dryRunError ? "error" : toStatus(s3);
        add({
          id: itemId,
          kind: "query_item",
          stages: [3],
          title: `${lbl} · ${t.name}`,
          status: itemStatus,
          key: itemKey,
          parents: [id],
          topicId: t.id,
          queryId: q.id,
          database: q.database,
          queryString: q.queryString ?? qStat?.queryString,
          queryStats: qStat,
          staleReason: s3 === "stale" ? reason(3) : undefined,
        });
      }
      queryOutByTopic.set(t.id, subIds);
    } else {
      queryOutByTopic.set(t.id, [id]);
    }
  }

  // 4. Retrieved papers: divided into multiple boxes based on topic, each expandable into query sub-boxes
  //    (showing retrieved papers & papers needing attention per query) and further expandable into paper sub-boxes.
  const s4 = st(states, 4);
  const retrievalOutIds: string[] = [];
  if (s4 !== "not_started") {
    const running = s4 === "running";
    if (topics.length > 0) {
      for (const t of topics) {
        const tcId = `corpus:topic:${t.id}`;
        const parents = queryOutByTopic.get(t.id) ?? [`topic:${t.id}`];
        const ts = topicStatsById.get(t.id);
        const rawQStats = (s?.queryStats ?? []).filter((q) => q.topicId === t.id);
        const tQueryStats = rawQStats.length ? rawQStats : synthesizeQueryStats(s?.queries ?? [], t.id, s4);
        const totalRetrieved = ts?.retrieved ?? tQueryStats.reduce((acc, q) => acc + q.retrieved, 0);
        const totalAttention = tQueryStats.reduce((acc, q) => acc + q.needsAttention, 0);
        const failedQueries = tQueryStats.filter((q) => q.runStatus === "failed").length;
        const attn = ts ? evaluateTopicAttention(ts, states) : undefined;
        const tcStatus: NodeStatus = running
          ? "running"
          : failedQueries > 0 && totalRetrieved === 0
            ? "error"
            : s4 === "stale"
              ? "stale"
              : attn?.tone === "err"
                ? "error"
                : attn?.tone === "warn" && s4 === "approved"
                  ? "review"
                  : toStatus(s4);
        const tcKey = running
          ? `${plural(totalRetrieved, "paper")} so far`
          : `${plural(totalRetrieved, "paper")}${totalAttention > 0 ? ` · ${totalAttention} need attention` : failedQueries > 0 ? ` · ${failedQueries} failed` : tQueryStats.length ? ` · ${plural(tQueryStats.length, "query", "queries")}` : ""}`;
        const isExp = expanded.has(tcId) && tQueryStats.length > 0;

        add({
          id: tcId,
          kind: "topic_corpus",
          stages: [4],
          title: t.name,
          status: tcStatus,
          key: tcKey,
          parents,
          topicId: t.id,
          progress: running ? jobProgress(input.jobs, 4) : undefined,
          staleReason: s4 === "stale" ? reason(4) : undefined,
          articleStats: ts,
          attention: attn,
          topicQueryStats: tQueryStats,
          expandable: tQueryStats.length > 0,
          expanded: isExp,
          childCount: tQueryStats.length,
          expandLabel: plural(tQueryStats.length, "query", "queries"),
        });

        if (running) {
          for (const e of edges) if (e.target === tcId) e.running = true;
        }

        if (isExp) {
          for (const qs of tQueryStats) {
            const qcId = `corpus:query:${qs.queryId}`;
            const qAttn = evaluateQueryAttention(qs, states);
            const okCount = Math.max(0, qs.retrieved - qs.needsAttention);
            const groupCount = (qs.needsAttention > 0 ? 1 : 0) + (okCount > 0 ? 1 : 0);
            const qcExp = expanded.has(qcId) && groupCount > 0;
            const qcStatus: NodeStatus =
              qs.runStatus === "running" || qs.runStatus === "queued"
                ? "running"
                : qs.runStatus === "failed" || qAttn.tone === "err"
                  ? "error"
                  : s4 === "stale"
                    ? "stale"
                    : qAttn.tone === "warn"
                      ? "review"
                      : qs.retrieved > 0
                        ? "done"
                        : toStatus(s4);
            const qcKey =
              qs.runStatus === "failed"
                ? "Search failed"
                : qs.runStatus === "running" || qs.runStatus === "queued"
                  ? `${plural(qs.retrieved, "paper")} so far`
                  : `${plural(qs.retrieved, "paper")} (${qs.newUnique} new) · ${qs.needsAttention > 0 ? `${qs.needsAttention} need attention` : "all clear"}`;

            add({
              id: qcId,
              kind: "query_corpus",
              stages: [4],
              title: qs.label,
              status: qcStatus,
              key: qcKey,
              parents: [tcId],
              topicId: t.id,
              queryId: qs.queryId,
              database: qs.database,
              queryString: qs.queryString,
              queryStats: qs,
              attention: qAttn,
              staleReason: s4 === "stale" ? reason(4) : undefined,
              expandable: groupCount > 0,
              expanded: qcExp,
              childCount: groupCount,
              expandLabel: plural(qs.retrieved, "paper"),
            });

            if (qcExp) {
              const attnPapers = (qs.papers ?? []).filter((p) => p.needsAttention);
              const okPapers = (qs.papers ?? []).filter((p) => !p.needsAttention);
              if (qs.needsAttention > 0) {
                const pgId = `papers:attention:${qs.queryId}`;
                add({
                  id: pgId,
                  kind: "paper_group",
                  stages: [qAttn.stage ?? 4],
                  title: `Needs attention · ${qs.label}`,
                  status: qs.attentionBreakdown.failedAppraisal > 0 ? "error" : "review",
                  key: `${plural(qs.needsAttention, "paper")} · ${qAttn.detail}`,
                  parents: [qcId],
                  topicId: t.id,
                  queryId: qs.queryId,
                  database: qs.database,
                  queryStats: qs,
                  attention: qAttn,
                  paperGroupKind: "attention",
                  paperCount: qs.needsAttention,
                  papers: attnPapers,
                });
              }
              if (okCount > 0) {
                const pgId = `papers:ok:${qs.queryId}`;
                add({
                  id: pgId,
                  kind: "paper_group",
                  stages: [4],
                  title: `Ready papers · ${qs.label}`,
                  status: "done",
                  key: `${plural(okCount, "paper")} · no action needed`,
                  parents: [qcId],
                  topicId: t.id,
                  queryId: qs.queryId,
                  database: qs.database,
                  queryStats: qs,
                  paperGroupKind: "ok",
                  paperCount: okCount,
                  papers: okPapers,
                });
              }
            }
            retrievalOutIds.push(qcId);
          }
        } else {
          retrievalOutIds.push(tcId);
        }
      }
    } else {
      // Fallback single corpus node if there are no topics.
      const r = s?.retrieval;
      const key = !r ? "Retrieval" : running ? `${plural(r.unique, "paper")} so far` : `${plural(r.unique, "paper")}, ${fmt(Math.max(0, r.fetched - r.unique))} dupes removed${r.failed ? ` · ${r.failed} failed` : ""}`;
      add({ id: "corpus", kind: "corpus", stages: [4], title: "Retrieved papers", status: toStatus(s4), key, parents: allQueryHubIds.length ? allQueryHubIds : ["idea"], progress: jobProgress(input.jobs, 4), staleReason: s4 === "stale" ? reason(4) : undefined, pipelineCounts: corpusPipeline, impactSummary: s?.impact });
      if (running) for (const e of edges) if (e.target === "corpus") e.running = true;
      retrievalOutIds.push("corpus");
    }
  }

  // 5–6. Table: summary rows, then ranking.
  const s5 = st(states, 5);
  const s6 = st(states, 6);
  if (s5 !== "not_started" && retrievalOutIds.length > 0) {
    const tableState: StageState = s5 !== "approved" ? s5 : s6 === "not_started" ? "needs_review" : s6;
    const t = s?.table;
    const selected = t?.selectedPapers ?? (s?.ranking ?? []).reduce((a, x) => a + x.selected, 0);
    const key = !t ? "Summary table" : s5 === "running" ? `${fmt(t.summarised)} of ${fmt(t.papers)} summarised` : s6 === "not_started" || s6 === "running" ? `${plural(t.papers, "row")}${s6 === "running" ? " · ranking" : ""}` : `${plural(t.papers, "row")} · ${plural(selected, "paper")} selected`;
    add({ id: "table", kind: "table", stages: [5, 6], title: "Summary & ranking", status: toStatus(tableState), key, parents: retrievalOutIds, progress: jobProgress(input.jobs, s5 === "approved" ? 6 : 5), staleReason: tableState === "stale" ? reason(s5 === "stale" ? 5 : 6) : undefined, pipelineCounts: corpusPipeline, impactSummary: s?.impact });
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
      pipelineCounts: corpusPipeline,
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
      const verdict = c.verified ? "Found word for word" : c.userAccepted ? "Not found, accepted by you" : c.userRejected ? "Rejected by you" : "Not found, you decide";
      add({
        id: `quote:${c.id}`,
        kind: "quote",
        stages: [7],
        title: `“${c.quote}”`,
        status: s7 === "stale" ? "stale" : c.verified || c.userAccepted ? "done" : c.userRejected ? "idle" : "review",
        key: `${verdict} · ${c.paperTitle}`,
        parents: ["appraisal"],
        claimId: c.id,
        trust: { verified: c.verified ? 1 : 0, unverified: isUndecided(c) ? 1 : 0, accepted: !c.verified && c.userAccepted ? 1 : 0, stale: s7 === "stale" },
        staleReason: s7 === "stale" ? reason(7) : undefined,
      });
    }
  }

  for (const n of nodes) if (n.status === "running" && n.stages.some((st) => input.jobs[String(st)]?.status === "paused")) n.paused = true;
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
    case 4: return first("topic_corpus") ?? (has("corpus") ? "corpus" : nodeForStage(graph, 3));
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
