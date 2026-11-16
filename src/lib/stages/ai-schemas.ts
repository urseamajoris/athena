import { z } from "zod";
import { QUESTION_FRAMEWORKS, RELEVANCE, STUDY_TYPES } from "../shared/stages";

/*
 * zod schemas for every AI output. Length/count limits live here (enforced by zod) and are stripped
 * from the JSON schema sent to the model, which does not support them.
 */

const str = (max = 600) => z.string().trim().min(1).max(max);
const nullableStr = z.string().nullable();

/**
 * What the scoping chat pins down before a research question is drafted: who is studied, what is studied
 * (exposure, intervention or phenomenon), compared with what, which outcome, where, over which years, and which
 * kinds of study. The UI shows the coverage as "what we know so far".
 */
export const SCOPING_FIELDS = ["population", "phenomenon", "comparison", "outcome", "setting", "timeframe", "studyTypes"] as const;
export type ScopingField = (typeof SCOPING_FIELDS)[number];

export const ScopingTurn = z.object({
  coverage: z.object({
    population: nullableStr,
    phenomenon: nullableStr,
    comparison: nullableStr,
    outcome: nullableStr,
    setting: nullableStr,
    timeframe: nullableStr,
    studyTypes: nullableStr,
  }),
  done: z.boolean(),
  nextQuestion: z.string().max(400).nullable(),
  questionTarget: z.enum(SCOPING_FIELDS).nullable(),
});
export type ScopingTurn = z.infer<typeof ScopingTurn>;

/** A framework's parts as element/value pairs (the model cannot return a free-form object); stored as a record. */
const structurePairs = z.array(z.object({ element: str(40), value: str(300) })).min(2).max(7);
export const pairsToRecord = (pairs: { element: string; value: string }[]): Record<string, string> => Object.fromEntries(pairs.map((s) => [s.element, s.value]));

/** Three candidate wordings of one research question, drafted from the idea and the scoping chat (stage 2). */
export const QuestionDrafts = z.object({
  drafts: z
    .array(
      z.object({
        text: str(400),
        framework: z.enum(QUESTION_FRAMEWORKS),
        structure: structurePairs,
        note: str(240),
      }),
    )
    .length(3),
});
export type QuestionDrafts = z.infer<typeof QuestionDrafts>;

/** The search topics and concept map of the search plan (stage 3), written from the working research question. */
export const SearchTopics = z.object({
  summary: z.object({
    population: str(300),
    setting: str(300),
    phenomenon: str(300),
    outcome: str(300),
    timeframe: str(200),
    studyTypes: str(300),
  }),
  conceptMap: z.object({
    nodes: z.array(z.object({ id: str(40), label: str(80), kind: z.enum(["population", "setting", "phenomenon", "outcome", "context", "method"]) })).min(3).max(16),
    edges: z.array(z.object({ from: str(40), to: str(40), label: str(60) })).max(24),
  }),
  topics: z
    .array(
      z.object({
        name: str(80),
        synonyms: z.array(str(80)).min(1).max(12),
        controlledTerms: z.array(str(100)).max(10),
        rationale: str(240),
      }),
    )
    .min(1)
    .max(8),
});
export type SearchTopics = z.infer<typeof SearchTopics>;

export const SearchBuild = z.object({
  criteria: z.object({
    yearFrom: z.number().int().nullable(),
    yearTo: z.number().int().nullable(),
    languages: z.array(str(20)).max(6),
    studyTypes: z.array(str(60)).max(12),
    inclusion: z.array(str(200)).min(1).max(8),
    exclusion: z.array(str(200)).min(1).max(8),
  }),
  queries: z
    .array(
      z.object({
        topicId: str(40),
        database: z.enum(["pubmed", "openalex"]),
        query: z.string().trim().min(3).max(1500),
        rationale: str(240),
      }),
    )
    .min(2),
});
export type SearchBuild = z.infer<typeof SearchBuild>;

export const SummaryRows = z.object({
  rows: z
    .array(
      z.object({
        paperId: str(40),
        studyType: z.enum(STUDY_TYPES),
        setting: str(200),
        keyFinding: str(300),
      }),
    )
    .min(1),
});
export type SummaryRows = z.infer<typeof SummaryRows>;

const score = z.number().int().min(0).max(5);
export const RankingBatch = z.object({
  scores: z
    .array(
      z.object({
        paperId: str(40),
        topicFit: score,
        topicFitWhy: str(200),
        designStrength: score,
        designStrengthWhy: str(200),
        settingMatch: score,
        settingMatchWhy: str(200),
        overall: str(240),
      }),
    )
    .min(1),
});
export type RankingBatch = z.infer<typeof RankingBatch>;

export const TopicImportance = z.object({
  order: z.array(z.object({ topicId: str(40), rank: z.number().int().min(1), justification: str(200) })).min(1),
});

export const EXTRACTION_FIELDS = ["aim", "setting", "sample", "methods", "key_findings", "limitations"] as const;
export type ExtractionField = (typeof EXTRACTION_FIELDS)[number];

export const Appraisal = z.object({
  extractions: z
    .array(
      z.object({
        field: z.enum(EXTRACTION_FIELDS),
        statement: str(500),
        notReported: z.boolean(),
        quote: z.string().max(1200),
        location: z.string().max(160),
      }),
    )
    .min(6)
    .max(24),
  checklist: z
    .array(
      z.object({
        item: str(200),
        answer: z.enum(["yes", "no", "unclear", "not_reported"]),
        quote: z.string().max(1200),
        location: z.string().max(160),
      }),
    )
    .min(1)
    .max(14),
  // Judgements about the article as a whole, read against the working research question. They carry no quote.
  bottomLine: str(500),
  relevance: z.enum(RELEVANCE),
  relevanceNote: str(300),
});
export type Appraisal = z.infer<typeof Appraisal>;

export const Synthesis = z.object({
  themes: z.array(str(80)).min(2).max(6),
  matrix: z
    .array(
      z.object({
        paperId: str(40),
        theme: str(80),
        value: str(240),
        stance: z.enum(["supports", "contradicts", "mixed", "neutral", "not_addressed"]),
        claimIds: z.array(str(40)).max(6),
      }),
    )
    .min(1),
  contradictions: z.array(z.object({ theme: str(80), description: str(400), claimIds: z.array(str(40)).min(2).max(8) })).max(6),
  known: z.array(z.object({ statement: str(600), claimIds: z.array(str(40)).min(1).max(10) })).max(6),
  contested: z.array(z.object({ statement: str(600), claimIds: z.array(str(40)).min(1).max(10) })).max(6),
  unknown: z.array(z.object({ statement: str(600), claimIds: z.array(str(40)).min(1).max(10) })).max(6),
});
export type Synthesis = z.infer<typeof Synthesis>;

/**
 * Stage 9: search words for the working research question (so its novelty search can run too) and up to three
 * revisions of it that the evidence supports. The working question itself is not rewritten by the model.
 */
export const QuestionRevisions = z.object({
  workingQuestionSearch: z.object({ pubmed: z.string().trim().min(3).max(800), openalex: z.string().trim().min(3).max(800) }),
  revisions: z
    .array(
      z.object({
        text: str(400),
        framework: z.enum(QUESTION_FRAMEWORKS),
        structure: structurePairs,
        design: str(200),
        gap: str(1000),
        gapClaimIds: z.array(str(40)).min(1).max(10),
        synthesisIds: z.array(str(40)).max(10),
        feasibility: str(800),
        weakness: str(600),
        noveltyQueries: z.object({ pubmed: z.string().trim().min(3).max(800), openalex: z.string().trim().min(3).max(800) }),
      }),
    )
    .max(3),
});
export type QuestionRevisions = z.infer<typeof QuestionRevisions>;
