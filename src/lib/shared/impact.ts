// Pure, deterministic scholarly impact evaluation for retrieved articles, topics and corpora.
// Uses stored citation counts, publication years, study design, open-access status and cross-database
// corroboration — transparent formulas, zero external calls.
import { citationScore, recencyScore } from "../scoring";
import { studyGroupFromLabels, studyGroupOf } from "./categories";

export type ImpactTier = "high" | "notable" | "moderate" | "low" | "unknown";

export interface ImpactPaperInput {
  id: string;
  title: string;
  year: number | null;
  citationCount: number | null;
  studyType?: string | null;
  publicationTypes?: string[] | null;
  oaUrl?: string | null;
  pmcid?: string | null;
  sourceDatabases?: string[] | null;
}

export interface ImpactBreakdown {
  citation: number;
  design: number;
  recency: number;
  accessibility: number;
}

export interface ImpactEvaluation {
  /** Composite 0–100 scholarly impact index (weighted sum of transparent 0–5 subscores). */
  score: number;
  tier: ImpactTier;
  citationsPerYear: number | null;
  hasCitations: boolean;
  breakdown: ImpactBreakdown;
}

export interface CorpusImpactSummary {
  totalCitations: number;
  medianCitations: number;
  meanCitations: number;
  avgCitationsPerYear: number;
  hIndex: number;
  citedPapers: number;
  withCitationData: number;
  highlyCitedCount: number;
  openAccessCount: number;
  multiSourceCount: number;
  topPaper: { id: string; title: string; year: number | null; citations: number } | null;
}

export const IMPACT_WEIGHTS = {
  citation: 0.5,
  design: 0.25,
  recency: 0.15,
  accessibility: 0.1,
} as const;

export function citationsPerYear(citations: number | null | undefined, year: number | null | undefined, now = new Date().getFullYear()): number | null {
  if (citations === null || citations === undefined) return null;
  const years = Math.max(1, now - (year ?? now) + 1);
  return Math.round((citations / years) * 10) / 10;
}

/**
 * Impact tier combining raw citation volume and age-adjusted citation velocity (citations/year),
 * so recent influential articles are not penalized for having fewer years to accumulate citations.
 */
export function impactTierOf(citations: number | null | undefined, year: number | null | undefined, now = new Date().getFullYear()): ImpactTier {
  if (citations === null || citations === undefined) return "unknown";
  const cpy = citationsPerYear(citations, year, now) ?? 0;
  if (citations >= 100 || cpy >= 12) return "high";
  if (citations >= 25 || cpy >= 5) return "notable";
  if (citations >= 5 || cpy >= 1.5) return "moderate";
  return "low";
}

/** Evidence design tier (0–5) from AI summary study type or database publication labels. */
export function designTierScore(studyType?: string | null, publicationTypes?: string[] | null): number {
  const group = studyType ? studyGroupOf(studyType) : studyGroupFromLabels(publicationTypes);
  switch (group) {
    case "review":
    case "trial":
      return 5;
    case "cohort":
      return 4;
    case "cross_sectional":
    case "qualitative":
      return 3;
    case "other":
      return 2;
    default:
      return 1;
  }
}

/** Accessibility & cross-source corroboration score (0–5). */
export function accessibilityScore(p: Pick<ImpactPaperInput, "oaUrl" | "pmcid" | "sourceDatabases">): number {
  const open = !!(p.oaUrl || p.pmcid);
  const dbs = new Set(p.sourceDatabases ?? []);
  const multi = dbs.has("pubmed") && dbs.has("openalex");
  if (open && multi) return 5;
  if (open) return 4;
  if (multi) return 3;
  return 2;
}

/** Transparent 0–100 composite impact evaluation for a single retrieved article. */
export function paperImpactEvaluation(p: ImpactPaperInput, now = new Date().getFullYear()): ImpactEvaluation {
  const cit = citationScore(p.citationCount, p.year, now).score;
  const design = designTierScore(p.studyType, p.publicationTypes);
  const rec = recencyScore(p.year, now).score;
  const acc = accessibilityScore(p);
  const hasCitations = p.citationCount !== null && p.citationCount !== undefined;
  const weighted =
    (cit / 5) * IMPACT_WEIGHTS.citation +
    (design / 5) * IMPACT_WEIGHTS.design +
    (rec / 5) * IMPACT_WEIGHTS.recency +
    (acc / 5) * IMPACT_WEIGHTS.accessibility;
  return {
    score: Math.round(weighted * 100),
    tier: impactTierOf(p.citationCount, p.year, now),
    citationsPerYear: citationsPerYear(p.citationCount, p.year, now),
    hasCitations,
    breakdown: { citation: cit, design, recency: rec, accessibility: acc },
  };
}

/** Standard bibliometric h-index: largest h such that at least h papers have >= h citations. */
export function computeHIndex(citations: (number | null | undefined)[]): number {
  const sorted = citations
    .filter((c): c is number => typeof c === "number" && Number.isFinite(c) && c > 0)
    .sort((a, b) => b - a);
  let h = 0;
  for (let i = 0; i < sorted.length; i++) {
    if (sorted[i] >= i + 1) h = i + 1;
    else break;
  }
  return h;
}

export function summarizeCorpusImpact(papers: ImpactPaperInput[], now = new Date().getFullYear()): CorpusImpactSummary {
  const withData = papers.filter((p): p is ImpactPaperInput & { citationCount: number } => typeof p.citationCount === "number" && Number.isFinite(p.citationCount));
  const counts = withData.map((p) => p.citationCount).sort((a, b) => a - b);
  const totalCitations = counts.reduce((a, b) => a + b, 0);
  const mid = Math.floor(counts.length / 2);
  const medianCitations = counts.length === 0 ? 0 : counts.length % 2 === 1 ? counts[mid] : Math.round(((counts[mid - 1] + counts[mid]) / 2) * 10) / 10;
  const meanCitations = counts.length ? Math.round((totalCitations / counts.length) * 10) / 10 : 0;
  const velocities = withData.map((p) => citationsPerYear(p.citationCount, p.year, now) ?? 0);
  const avgCitationsPerYear = velocities.length ? Math.round((velocities.reduce((a, b) => a + b, 0) / velocities.length) * 10) / 10 : 0;
  const hIndex = computeHIndex(counts);
  const citedPapers = counts.filter((c) => c > 0).length;
  const highlyCitedCount = withData.filter((p) => impactTierOf(p.citationCount, p.year, now) === "high").length;
  const openAccessCount = papers.filter((p) => !!(p.oaUrl || p.pmcid)).length;
  const multiSourceCount = papers.filter((p) => {
    const s = new Set(p.sourceDatabases ?? []);
    return s.has("pubmed") && s.has("openalex");
  }).length;
  let topPaper: CorpusImpactSummary["topPaper"] = null;
  for (const p of withData) {
    if (!topPaper || p.citationCount > topPaper.citations) {
      topPaper = { id: p.id, title: p.title, year: p.year, citations: p.citationCount };
    }
  }
  return {
    totalCitations,
    medianCitations,
    meanCitations,
    avgCitationsPerYear,
    hIndex,
    citedPapers,
    withCitationData: withData.length,
    highlyCitedCount,
    openAccessCount,
    multiSourceCount,
    topPaper,
  };
}
