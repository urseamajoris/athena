// Shared literature-review credit math, top-up packs, and formatting (no Node APIs here).

export const CHARS_PER_TOKEN = 4;
export const TOKENS_PER_CREDIT = 1000;
export const DEFAULT_STARTING_CREDITS = 100;
/** Average title + metadata + abstract size (chars) used only when estimating before retrieval runs. */
export const ESTIMATED_AVG_ARTICLE_CHARS = 1600;

export type ReviewStageOperation = "retrieval" | "summaries" | "ranking" | "appraisal" | "synthesis" | "questions";
export type CreditOperation = ReviewStageOperation | "starter_grant" | "top_up" | "admin_adjustment";

export interface ArticleSizeInput {
  title?: string | null;
  abstract?: string | null;
  authors?: string[] | null;
  journal?: string | null;
  /** Characters of full text processed (used in appraisal when full text is fetched). */
  fullTextChars?: number | null;
}

export interface CreditQuote {
  operation: ReviewStageOperation;
  stage: number;
  label: string;
  articleCount: number;
  totalChars: number;
  inputTokens: number;
  outputTokens: number;
  approxTokens: number;
  credits: number;
}

export interface CreditPack {
  id: string;
  name: string;
  credits: number;
  priceCents: number;
  approxTokens: number;
  tagline: string;
  popular?: boolean;
}

export const CREDIT_PACKS: CreditPack[] = [
  {
    id: "starter",
    name: "Starter",
    credits: 250,
    priceCents: 500,
    approxTokens: 250 * TOKENS_PER_CREDIT,
    tagline: "Ideal for a focused scoping review or pilot query.",
  },
  {
    id: "researcher",
    name: "Researcher",
    credits: 1000,
    priceCents: 1500,
    approxTokens: 1000 * TOKENS_PER_CREDIT,
    tagline: "Covers several full end-to-end literature reviews.",
    popular: true,
  },
  {
    id: "lab",
    name: "Lab",
    credits: 3000,
    priceCents: 3900,
    approxTokens: 3000 * TOKENS_PER_CREDIT,
    tagline: "For systematic reviews with large multi-database corpora.",
  },
  {
    id: "department",
    name: "Department",
    credits: 10000,
    priceCents: 9900,
    approxTokens: 10000 * TOKENS_PER_CREDIT,
    tagline: "High-volume research teams running continuous reviews.",
  },
];

export function findCreditPack(packId: string): CreditPack | undefined {
  return CREDIT_PACKS.find((p) => p.id === packId);
}

interface StageTokenProfile {
  stage: number;
  label: string;
  /** Prompt / metadata input tokens added per article on top of article text tokens. */
  inputOverheadPerArticle: number;
  /** Approximate generated output tokens per article. */
  outputPerArticle: number;
  /** Minimum output tokens for synthesis/report generation when at least 1 article is present. */
  minOutputTokens: number;
}

export const STAGE_PROFILES: Record<ReviewStageOperation, StageTokenProfile> = {
  retrieval: {
    stage: 4,
    label: "Data gathering",
    inputOverheadPerArticle: 80,
    outputPerArticle: 0,
    minOutputTokens: 0,
  },
  summaries: {
    stage: 5,
    label: "Summarizing",
    inputOverheadPerArticle: 120,
    outputPerArticle: 150,
    minOutputTokens: 0,
  },
  ranking: {
    stage: 6,
    label: "Ranking",
    inputOverheadPerArticle: 160,
    outputPerArticle: 180,
    minOutputTokens: 0,
  },
  appraisal: {
    stage: 7,
    label: "Result generation (Appraisal)",
    inputOverheadPerArticle: 300,
    outputPerArticle: 900,
    minOutputTokens: 0,
  },
  synthesis: {
    stage: 8,
    label: "Result generation (Synthesis)",
    inputOverheadPerArticle: 250,
    outputPerArticle: 350,
    minOutputTokens: 800,
  },
  questions: {
    stage: 9,
    label: "Result generation (Research questions)",
    inputOverheadPerArticle: 200,
    outputPerArticle: 150,
    minOutputTokens: 1200,
  },
};

export const STAGE_TO_OPERATION: Record<number, ReviewStageOperation> = {
  4: "retrieval",
  5: "summaries",
  6: "ranking",
  7: "appraisal",
  8: "synthesis",
  9: "questions",
};

export function operationLabel(op: string): string {
  if (op in STAGE_PROFILES) return STAGE_PROFILES[op as ReviewStageOperation].label;
  if (op === "top_up") return "Credit top-up (Stripe)";
  if (op === "starter_grant") return "Starter credits";
  if (op === "admin_adjustment") return "Admin adjustment";
  return op;
}

/** Approximate token count using the standard ~4 characters per token heuristic. */
export function approxTokensFromChars(chars: number): number {
  if (!Number.isFinite(chars) || chars <= 0) return 0;
  return Math.ceil(chars / CHARS_PER_TOKEN);
}

export function approxTokensFromText(text: string | null | undefined): number {
  if (!text) return 0;
  return approxTokensFromChars(text.trim().length);
}

/** Total character size of a single gathered article (title, metadata, abstract, and any full text). */
export function measureArticleChars(article: ArticleSizeInput): number {
  const titleLen = article.title?.trim().length ?? 0;
  const abstractLen = article.abstract?.trim().length ?? 0;
  const authorsLen = article.authors?.length ? article.authors.join(", ").length : 0;
  const journalLen = article.journal?.trim().length ?? 0;
  const fullTextLen = article.fullTextChars && article.fullTextChars > 0 ? article.fullTextChars : 0;
  // If full text is present, it supersedes the abstract in size; otherwise use abstract.
  const bodyLen = fullTextLen > 0 ? fullTextLen : abstractLen;
  return titleLen + authorsLen + journalLen + bodyLen;
}

/**
 * Calculate the approximate tokens and credit cost for a literature review operation based on the
 * total number of articles and their combined sizes.
 */
export function calculateReviewCredits(operation: ReviewStageOperation, articles: ArticleSizeInput[]): CreditQuote {
  const profile = STAGE_PROFILES[operation];
  const articleCount = articles.length;
  const totalChars = articles.reduce((sum, a) => sum + measureArticleChars(a), 0);
  if (articleCount === 0) {
    return {
      operation,
      stage: profile.stage,
      label: profile.label,
      articleCount: 0,
      totalChars: 0,
      inputTokens: 0,
      outputTokens: 0,
      approxTokens: 0,
      credits: 0,
    };
  }
  const contentTokens = approxTokensFromChars(totalChars);
  const inputTokens = contentTokens + articleCount * profile.inputOverheadPerArticle;
  const outputTokens = Math.max(profile.minOutputTokens, articleCount * profile.outputPerArticle);
  const approxTokens = inputTokens + outputTokens;
  const credits = Math.max(1, Math.ceil(approxTokens / TOKENS_PER_CREDIT));
  return {
    operation,
    stage: profile.stage,
    label: profile.label,
    articleCount,
    totalChars,
    inputTokens,
    outputTokens,
    approxTokens,
    credits,
  };
}

/**
 * Estimate data-gathering credits before retrieval runs, using each query's dry-run count (capped by maxResultsPerQuery)
 * and the average article size. Once articles are actually gathered, `calculateReviewCredits("retrieval", papers)`
 * computes the exact charge from the real gathered corpus.
 */
export function estimateRetrievalCreditsFromQueries(
  queries: { dryRunCount: number | null }[],
  cap: number,
): CreditQuote {
  const safeCap = Math.max(1, cap);
  let expectedArticles = 0;
  for (const q of queries) {
    if (q.dryRunCount === null || q.dryRunCount === undefined) {
      expectedArticles += Math.min(safeCap, 20);
    } else if (q.dryRunCount > 0) {
      expectedArticles += Math.min(safeCap, q.dryRunCount);
    }
  }
  // Deduplication across PubMed & OpenAlex typically leaves ~75% unique records when multiple queries run.
  const estimatedUnique = queries.length > 1 ? Math.max(1, Math.round(expectedArticles * 0.75)) : expectedArticles;
  const syntheticArticles: ArticleSizeInput[] = Array.from({ length: estimatedUnique }, () => ({
    title: "x".repeat(120),
    abstract: "x".repeat(ESTIMATED_AVG_ARTICLE_CHARS - 120),
  }));
  return calculateReviewCredits("retrieval", syntheticArticles);
}

export function formatCredits(credits: number): string {
  return new Intl.NumberFormat("en-US").format(Math.round(credits));
}

export function formatTokens(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(2).replace(/\.?0+$/, "")}M`;
  if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(1).replace(/\.0$/, "")}k`;
  return new Intl.NumberFormat("en-US").format(Math.round(tokens));
}

export function formatUsd(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}
