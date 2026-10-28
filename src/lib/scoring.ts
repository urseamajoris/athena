import type { RubricScores } from "./db/schema";
import { RUBRIC } from "./shared/stages";

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
