// Test fixtures for the canvas logic (not imported by the app).
import type { CanvasSummary, StageStates } from "../shared/canvas";
import type { GraphInput } from "./graph";

export function states(...approvedThrough: [number, ...Partial<Record<number, StageStates[string]>>[]]): StageStates {
  const [n, overrides = {}] = approvedThrough;
  const out: StageStates = {};
  for (let i = 1; i <= 9; i++) out[String(i)] = i <= n ? "approved" : i === n + 1 ? "needs_review" : "not_started";
  for (const [k, v] of Object.entries(overrides)) if (v) out[k] = v;
  return out;
}

export function summary(over: Partial<CanvasSummary> = {}): CanvasSummary {
  return {
    topics: [
      { id: "t1", name: "Adoption", origin: "ai", approved: false, synonyms: 3, controlledTerms: 1 },
      { id: "t2", name: "Barriers", origin: "ai", approved: false, synonyms: 2, controlledTerms: 0 },
    ],
    scoping: { messages: 6, asked: 3, maxQuestions: 5, done: true, awaitingAnswer: false },
    queries: [],
    retrieval: { runs: 0, done: 0, failed: 0, running: 0, fetched: 0, unique: 0, perSource: {} },
    table: { papers: 0, summarised: 0, edited: 0 },
    ranking: [],
    appraisal: { papers: 0, done: 0, failed: 0, running: 0, fullText: 0, claims: 0, verified: 0, pending: 0, accepted: 0, rejected: 0, notReported: 0, appraisalIds: [] },
    synthesis: { statements: 0, contradictions: 0, known: 0, contested: 0, unknown: 0 },
    questions: { count: 0, chosenId: null, chosenText: null },
    ...over,
  };
}

export const QUERIES: CanvasSummary["queries"] = [
  { id: "q1", topicId: "t1", database: "pubmed", dryRunCount: 979, dryRunError: null },
  { id: "q2", topicId: "t1", database: "openalex", dryRunCount: 1630, dryRunError: null },
  { id: "q3", topicId: "t2", database: "pubmed", dryRunCount: null, dryRunError: null },
  { id: "q4", topicId: "t2", database: "openalex", dryRunCount: null, dryRunError: "HTTP 400" },
];

/** A finished review: every stage approved, appraisal counts filled in. */
export function finished(over: Partial<GraphInput> = {}): GraphInput {
  return input({
    states: states(9),
    summary: summary({
      topics: [
        { id: "t1", name: "Adoption", origin: "ai", approved: true, synonyms: 3, controlledTerms: 1 },
        { id: "t2", name: "Barriers", origin: "user", approved: true, synonyms: 2, controlledTerms: 0 },
      ],
      queries: QUERIES,
      retrieval: { runs: 4, done: 4, failed: 0, running: 0, fetched: 400, unique: 195, perSource: { pubmed: { fetched: 200, newUnique: 120, failed: 0 }, openalex: { fetched: 200, newUnique: 75, failed: 0 } } },
      table: { papers: 195, summarised: 195, edited: 0 },
      ranking: [
        { topicId: "t1", name: "Adoption", importanceRank: 1, selected: 4, scored: 40, matching: 12, spare: 8 },
        { topicId: "t2", name: "Barriers", importanceRank: 2, selected: 4, scored: 38, matching: 9, spare: 5 },
      ],
      appraisal: { papers: 8, done: 8, failed: 0, running: 0, fullText: 5, claims: 80, verified: 72, pending: 6, accepted: 2, rejected: 0, notReported: 4, appraisalIds: ["a1"] },
      synthesis: { statements: 15, contradictions: 2, known: 6, contested: 4, unknown: 5 },
      questions: { count: 3, chosenId: "rq1", chosenText: "What drives adoption?" },
    }),
    ...over,
  });
}

export function input(over: Partial<GraphInput> = {}): GraphInput {
  return {
    idea: "What is the knowledge gap in implementing telemedicine in Southeast Asia?",
    title: "Telemedicine in Southeast Asia",
    states: states(0),
    staleReasons: {},
    jobs: {},
    summary: summary(),
    claims: [],
    client: { acceptedTopics: [], pinnedQuotes: [] },
    ...over,
  };
}
