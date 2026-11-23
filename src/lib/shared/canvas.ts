// Shared between server and client: the compact project summary the canvas draws its nodes from.
import type { StageState } from "./stages";
import type { CorpusImpactSummary } from "./impact";

export type { CorpusImpactSummary };

export type AttentionTone = "ok" | "warn" | "err" | "run" | "idle";

/**
 * Per-topic article pipeline counts and scholarly impact summary.
 * - `retrieved`: unique articles retrieved and linked to this topic (paper_topics).
 * - `rendered`: retrieved articles processed into structured summary rows (paper_summaries).
 * - `filed`: selected articles appraised cleanly (0 undecided quotes) / filed into evidence synthesis.
 */
export interface TopicArticleStats {
  topicId: string;
  name: string;
  retrieved: number;
  rendered: number;
  filed: number;
  selected: number;
  appraised: number;
  failedAppraisals: number;
  undecidedQuotes: number;
  failedRuns: number;
  runningRuns: number;
  /** Scholarly impact aggregates across this topic's retrieved articles. */
  totalCitations: number;
  citedPapers: number;
  avgCitationsPerYear: number;
  hIndex: number;
  openAccessCount: number;
  maxCitations: number;
}

export interface TopicAttention {
  tone: AttentionTone;
  stage: number | null;
  label: string;
  detail: string;
  stageTones: {
    retrieved: AttentionTone;
    rendered: AttentionTone;
    filed: AttentionTone;
  };
}

export interface CanvasSummary {
  topics: { id: string; name: string; origin: string; approved: boolean; synonyms: number; controlledTerms: number }[];
  scoping: { messages: number; asked: number; maxQuestions: number; done: boolean; awaitingAnswer: boolean };
  /** `run`: how the query went in retrieval, while its text and database filters are unchanged since. */
  queries: { id: string; topicId: string; database: string; dryRunCount: number | null; dryRunError: string | null; run?: { count: number | null; failed: boolean } | null }[];
  retrieval: { runs: number; done: number; failed: number; running: number; fetched: number; unique: number; perSource: Record<string, { fetched: number; newUnique: number; failed: number }> };
  /** `selectedPapers`: different papers selected in any topic (the papers appraised); per-topic counts can overlap. */
  table: { papers: number; summarised: number; edited: number; selectedPapers?: number };
  /** Per topic: papers selected, scored, matching the topic (topic fit 2/5 or more), and matching but not selected. */
  ranking: { topicId: string; name: string; importanceRank: number | null; selected: number; scored: number; matching: number; spare: number; linked?: number; notScoredOverLimit?: number }[];
  appraisal: { papers: number; done: number; failed: number; running: number; fullText: number; claims: number; verified: number; pending: number; accepted: number; rejected: number; notReported: number; appraisalIds: string[] };
  synthesis: { statements: number; contradictions: number; known: number; contested: number; unknown: number };
  questions: { count: number; chosenId: string | null; chosenText: string | null };
  /** Per-topic retrieved / rendered / filed counts and citation impact. */
  topicStats?: TopicArticleStats[];
  /** Corpus-wide impact evaluation across all retrieved articles. */
  impact?: CorpusImpactSummary;
}

/**
 * Deterministic color-coded attention evaluation for a topic across Retrieved (step 4),
 * Rendered (step 5), and Filed (steps 6–8). Shared by Canvas cards, HUD, List and Graph views.
 */
export function evaluateTopicAttention(t: TopicArticleStats, states: StageStates): TopicAttention {
  const s4 = states["4"] ?? "not_started";
  const s5 = states["5"] ?? "not_started";
  const s6 = states["6"] ?? "not_started";
  const s7 = states["7"] ?? "not_started";
  const s8 = states["8"] ?? "not_started";

  // Individual stage tones for Retrieved, Rendered, Filed
  let retrievedTone: AttentionTone = "idle";
  if (t.failedRuns > 0) retrievedTone = "err";
  else if (t.runningRuns > 0 || s4 === "running") retrievedTone = "run";
  else if (s4 === "stale") retrievedTone = "warn";
  else if (s4 === "failed" || ((s4 === "needs_review" || s4 === "approved") && t.retrieved === 0)) retrievedTone = "err";
  else if ((s4 === "needs_review" || s4 === "approved") && t.retrieved < 3) retrievedTone = "warn";
  else if (t.retrieved > 0) retrievedTone = "ok";

  let renderedTone: AttentionTone = "idle";
  if (s5 === "running") renderedTone = "run";
  else if (s5 === "failed") renderedTone = "err";
  else if (s5 === "stale") renderedTone = "warn";
  else if (s5 === "needs_review" || s5 === "approved") {
    if (t.retrieved === 0) renderedTone = "err";
    else if (t.rendered < t.retrieved) renderedTone = "warn";
    else renderedTone = "ok";
  }

  let filedTone: AttentionTone = "idle";
  if (s6 === "running" || s7 === "running" || s8 === "running") filedTone = "run";
  else if (t.failedAppraisals > 0 || s7 === "failed" || s6 === "failed") filedTone = "err";
  else if (s6 === "stale" || s7 === "stale" || s8 === "stale") filedTone = "warn";
  else if (s7 === "needs_review" || s7 === "approved") {
    if (t.selected === 0) filedTone = "err";
    else if (t.undecidedQuotes > 0 || t.filed < t.selected) filedTone = "warn";
    else filedTone = "ok";
  } else if (s6 === "needs_review" || s6 === "approved") {
    if (t.selected === 0) filedTone = "err";
    else if (t.selected < 3 || t.selected > 5) filedTone = "warn";
    else filedTone = "ok";
  }

  const stageTones = { retrieved: retrievedTone, rendered: renderedTone, filed: filedTone };

  // Overall topic attention priority: err > warn > run > ok > idle
  if (t.failedRuns > 0) {
    return { tone: "err", stage: 4, label: "Search failed", detail: `${t.failedRuns} search${t.failedRuns === 1 ? "" : "es"} failed in step 4`, stageTones };
  }
  if ((s4 === "needs_review" || s4 === "approved") && t.retrieved === 0) {
    return { tone: "err", stage: 4, label: "0 retrieved", detail: "No articles retrieved — broaden step 3 searches", stageTones };
  }
  if (t.failedAppraisals > 0) {
    return { tone: "err", stage: 7, label: "Appraisal failed", detail: `${t.failedAppraisals} selected article${t.failedAppraisals === 1 ? "" : "s"} failed appraisal`, stageTones };
  }
  if ((s6 === "needs_review" || s6 === "approved") && t.selected === 0) {
    return { tone: "err", stage: 6, label: "0 selected", detail: "No matching articles selected for appraisal", stageTones };
  }
  if (t.runningRuns > 0 || s4 === "running") {
    return { tone: "run", stage: 4, label: "Retrieving", detail: `${t.retrieved} retrieved so far`, stageTones };
  }
  if (s5 === "running") {
    return { tone: "run", stage: 5, label: "Rendering", detail: `${t.rendered}/${t.retrieved} rendered`, stageTones };
  }
  if (s6 === "running") {
    return { tone: "run", stage: 6, label: "Ranking", detail: `Scoring ${t.retrieved} articles`, stageTones };
  }
  if (s7 === "running") {
    return { tone: "run", stage: 7, label: "Filing", detail: `${t.appraised}/${t.selected} appraised`, stageTones };
  }
  if ((s5 === "needs_review" || s5 === "approved") && t.retrieved > 0 && t.rendered < t.retrieved) {
    const missing = t.retrieved - t.rendered;
    return { tone: "warn", stage: 5, label: `${missing} unrendered`, detail: `${t.rendered} of ${t.retrieved} articles rendered in step 5`, stageTones };
  }
  if ((s7 === "needs_review" || s7 === "approved") && t.undecidedQuotes > 0) {
    return { tone: "warn", stage: 7, label: `${t.undecidedQuotes} quote${t.undecidedQuotes === 1 ? "" : "s"} to check`, detail: `${t.filed}/${t.selected} cleanly filed`, stageTones };
  }
  if ((s7 === "needs_review" || s7 === "approved") && t.filed < t.selected) {
    return { tone: "warn", stage: 7, label: `${t.selected - t.filed} unfiled`, detail: `${t.filed} of ${t.selected} selected articles filed`, stageTones };
  }
  if ((s6 === "needs_review" || s6 === "approved") && (t.selected < 3 || t.selected > 5)) {
    return { tone: "warn", stage: 6, label: `${t.selected} selected`, detail: t.selected < 3 ? "Below 3–5 target in step 6" : "Above 3–5 target in step 6", stageTones };
  }
  if ((s4 === "needs_review" || s4 === "approved") && t.retrieved < 3) {
    return { tone: "warn", stage: 4, label: "Thin coverage", detail: `Only ${t.retrieved} retrieved in step 4`, stageTones };
  }
  if (s4 === "stale" || s5 === "stale" || s6 === "stale" || s7 === "stale" || s8 === "stale") {
    const staleStage = [4, 5, 6, 7, 8].find((n) => states[String(n)] === "stale") ?? 4;
    return { tone: "warn", stage: staleStage, label: "Out of date", detail: `Step ${staleStage} needs updating`, stageTones };
  }
  if (s7 === "approved" || (t.filed > 0 && t.filed >= t.selected)) {
    return { tone: "ok", stage: null, label: "Filed", detail: `${t.retrieved} retrieved · ${t.rendered} rendered · ${t.filed} filed`, stageTones };
  }
  if (t.retrieved > 0) {
    if (s5 === "needs_review") return { tone: "warn", stage: 5, label: "Review table", detail: `${t.rendered} rendered — ready to review`, stageTones };
    if (s6 === "needs_review") return { tone: "warn", stage: 6, label: "Review picks", detail: `${t.selected} selected — ready to review`, stageTones };
    if (s4 === "needs_review") return { tone: "warn", stage: 4, label: "Review corpus", detail: `${t.retrieved} retrieved — ready to summarise`, stageTones };
    return { tone: "ok", stage: null, label: "On track", detail: `${t.retrieved} retrieved · ${t.rendered} rendered`, stageTones };
  }
  return { tone: "idle", stage: null, label: "Not retrieved", detail: "Run searches to retrieve articles", stageTones };
}

/** Compact claim for pinned Quote nodes. */
export interface ClaimLite {
  id: string;
  appraisalId: string;
  paperId: string;
  paperTitle: string;
  field: string;
  statement: string;
  quote: string;
  verified: boolean;
  userAccepted: boolean;
  userRejected: boolean;
}

/**
 * A quote still waiting for the user: extracted, not found word for word in the paper, and neither accepted
 * nor rejected. The one definition behind every "to decide" count (panel, paper list, canvas, table); the
 * synthesis leaves these quotes out.
 */
export function isUndecided(c: { verified: boolean; notReported?: boolean; userAccepted: boolean; userRejected: boolean }) {
  return !c.notReported && !c.verified && !c.userAccepted && !c.userRejected;
}

export interface JobLite {
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

export type StageStates = Record<string, StageState>;
