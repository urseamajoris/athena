import { z } from "zod";
import { STUDY_TYPES } from "../shared/stages";

/*
 * zod schemas for every AI output. Length/count limits live here (enforced by zod) and are stripped
 * from the JSON schema sent to xAI.
 */

const str = (max = 600) => z.string().trim().min(1).max(max);
const nullableStr = z.string().nullable();

export const SCOPING_FIELDS = ["population", "setting", "phenomenon", "outcome", "timeframe", "studyTypes"] as const;

export const ScopingTurn = z.object({
  coverage: z.object({
    population: nullableStr,
    setting: nullableStr,
    phenomenon: nullableStr,
    outcome: nullableStr,
    timeframe: nullableStr,
    studyTypes: nullableStr,
  }),
  done: z.boolean(),
  nextQuestion: z.string().max(400).nullable(),
  questionTarget: z.enum(SCOPING_FIELDS).nullable(),
  draftTopics: z.array(str(80)).max(8),
});
export type ScopingTurn = z.infer<typeof ScopingTurn>;

/** What the person is studying: asked before years and study designs (scoping_turn v2). */
const CORE_FIELDS = ["population", "phenomenon", "outcome"] as const;

/**
 * The scoping order, enforced on every turn (a failed check is sent back once with this reason): the first
 * question, and every question while population, phenomenon or outcome is still unknown, is about one of those
 * three or the setting, never about publication years or study designs. Run 3 opened with "Which publication
 * years?" because the idea named the rest; v2 of the prompt then sharpens one of them instead.
 */
export function scopingOrderProblem(o: Pick<ScopingTurn, "done" | "questionTarget" | "coverage">, asked: number): string | null {
  if (o.done || !o.questionTarget || (o.questionTarget !== "timeframe" && o.questionTarget !== "studyTypes")) return null;
  const missing = CORE_FIELDS.filter((k) => !o.coverage[k]?.trim());
  if (asked === 0) return `The first question must be about what the person is studying (population, phenomenon or outcome), not ${o.questionTarget}. If the idea names all three, ask to make the vaguest one more specific.`;
  if (missing.length) return `Ask about ${missing.join(", ")} before ${o.questionTarget}.`;
  return null;
}

export const ScopingTopics = z.object({
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
    .min(4)
    .max(8),
});
export type ScopingTopics = z.infer<typeof ScopingTopics>;

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

export const ResearchQuestions = z.object({
  questions: z
    .array(
      z.object({
        text: str(400),
        framework: z.enum(["PICO", "PECO", "PEO", "PICo", "SPIDER", "other"]),
        structure: z.array(z.object({ element: str(40), value: str(300) })).min(2).max(7),
        design: str(200),
        gap: str(1000),
        gapClaimIds: z.array(str(40)).min(1).max(10),
        synthesisIds: z.array(str(40)).max(10),
        feasibility: str(800),
        weakness: str(600),
        noveltyQueries: z.object({ pubmed: z.string().trim().min(3).max(800), openalex: z.string().trim().min(3).max(800) }),
      }),
    )
    .length(3),
});
export type ResearchQuestions = z.infer<typeof ResearchQuestions>;
