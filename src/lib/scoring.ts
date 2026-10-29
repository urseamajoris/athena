import type { RubricScores } from "./db/schema";
import { MIN_TOPIC_FIT, RUBRIC } from "./shared/stages";

/** Papers pre-selected per topic after ranking. */
export const DEFAULT_SELECT = 4;

/**
 * The papers pre-selected for one topic: the best-scoring ones that match the topic at all. A paper with no
 * topic match is never pre-selected, however well it scores on design, setting or recency, so a topic can end
 * up with fewer than `n` papers, or none.
 */
export function defaultSelection<T extends { total: number; subScores: Pick<RubricScores, "topicFit"> }>(scores: T[], n = DEFAULT_SELECT): T[] {
  return scores.filter((s) => s.subScores.topicFit >= MIN_TOPIC_FIT).sort((a, b) => b.total - a.total).slice(0, n);
}

/** Recency: deterministic formula (0–5). */
export function recencyScore(year: number | null, now = new Date().getFullYear()): { score: number; why: string } {
  if (!year) return { score: 0, why: "Publication year not reported." };
  const age = now - year;
  const score = age <= 2 ? 5 : age <= 4 ? 4 : age <= 6 ? 3 : age <= 9 ? 2 : age <= 14 ? 1 : 0;
  return { score, why: `Published ${year} (${age} year${age === 1 ? "" : "s"} ago). Formula: ≤2y=5, ≤4y=4, ≤6y=3, ≤9y=2, ≤14y=1.` };
}

/** Citation impact: citations per year since publication, log-scaled (0–5). */
export function citationScore(cites: number | null, year: number | null, now = new Date().getFullYear()): { score: number; why: string } {
  if (cites === null) return { score: 0, why: "Citation count not available from OpenAlex/Crossref." };
  const years = Math.max(1, now - (year ?? now) + 1);
  const perYear = cites / years;
  const score = perYear >= 30 ? 5 : perYear >= 12 ? 4 : perYear >= 5 ? 3 : perYear >= 2 ? 2 : perYear >= 0.5 ? 1 : 0;
  return { score, why: `${cites} citations (${perYear.toFixed(1)}/year). Formula: ≥30/y=5, ≥12=4, ≥5=3, ≥2=2, ≥0.5=1.` };
}

export function weightedTotal(s: RubricScores) {
  return Math.round(RUBRIC.reduce((acc, r) => acc + (s[r.key] / 5) * r.weight * 100, 0));
}
