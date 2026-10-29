// Shared between server and client: the compact project summary the canvas draws its nodes from.
import type { StageState } from "./stages";

export interface CanvasSummary {
  topics: { id: string; name: string; origin: string; approved: boolean; synonyms: number; controlledTerms: number }[];
  scoping: { messages: number; asked: number; maxQuestions: number; done: boolean; awaitingAnswer: boolean };
  /** `run`: how the query went in retrieval, while its text and database filters are unchanged since. */
  queries: { id: string; topicId: string; database: string; dryRunCount: number | null; dryRunError: string | null; run?: { count: number | null; failed: boolean } | null }[];
  retrieval: { runs: number; done: number; failed: number; running: number; fetched: number; unique: number; perSource: Record<string, { fetched: number; newUnique: number; failed: number }> };
  /** `selectedPapers`: different papers selected in any topic (the papers appraised); per-topic counts can overlap. */
  table: { papers: number; summarised: number; edited: number; selectedPapers?: number };
  /** Per topic: papers selected, scored, matching the topic (topic fit 2/5 or more), and matching but not selected. */
  ranking: { topicId: string; name: string; importanceRank: number | null; selected: number; scored: number; matching: number; spare: number }[];
  appraisal: { papers: number; done: number; failed: number; running: number; fullText: number; claims: number; verified: number; pending: number; accepted: number; rejected: number; notReported: number; appraisalIds: string[] };
  synthesis: { statements: number; contradictions: number; known: number; contested: number; unknown: number };
  questions: { count: number; chosenId: string | null; chosenText: string | null };
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
