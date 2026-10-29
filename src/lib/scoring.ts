import type { RubricScores } from "./db/schema";
import { MIN_TOPIC_FIT, PER_TOPIC, RUBRIC } from "./shared/stages";

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

/**
 * Each topic's selection against the 3–5 rule, given how many papers are selected and how many papers that match
 * the topic are not (`spare`). `short`: fewer than 3 selected while matching papers are left, so the user can tick
 * more. `few`: fewer than 3 selected and every matching paper is already in, so only new searches can add more.
 * `over`: more than 5 selected. The 3–5 rule is met when `short` and `over` are empty.
 */
export function topicCoverage<T extends { selected: number; spare: number }>(topics: T[]): { short: T[]; few: T[]; over: T[] } {
  return {
    short: topics.filter((t) => t.selected < PER_TOPIC.min && t.spare > 0),
    few: topics.filter((t) => t.selected < PER_TOPIC.min && t.spare === 0),
    over: topics.filter((t) => t.selected > PER_TOPIC.max),
  };
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

/** When the idea names a setting, a paper not shown to be in it gets this share of its score (half: at most 42). */
export const OFF_SETTING_FACTOR = 0.5;

/**
 * The deterministic rules on top of the AI's ratings for one paper and topic:
 * - a paper the AI marks as only sharing words with the idea (a "mobile health clinic", a van, for an idea about
 *   mobile apps) gets topic fit 1 at most, so it is never pre-selected;
 * - when the idea names a setting, a paper rated 0–1 for setting (set elsewhere, or its setting not reported)
 *   has its score halved, so papers from the idea's setting come first (and the order among the others is kept).
 * Each rule that applies says so in the reasons the ranking table shows.
 */
export function applyRankingRules(
  ai: { topicFit: number; topicFitWhy: string; designStrength: number; settingMatch: number; settingMatchWhy: string; overall: string; onlySharesWords?: boolean },
  formula: Pick<RubricScores, "recency" | "citationImpact">,
  setting: string | null,
): { sub: RubricScores; topicFitWhy: string; settingMatchWhy: string; overall: string; total: number } {
  const sub: RubricScores = { topicFit: ai.onlySharesWords ? Math.min(ai.topicFit, 1) : ai.topicFit, designStrength: ai.designStrength, settingMatch: ai.settingMatch, ...formula };
  const topicFitWhy = ai.onlySharesWords ? `Different subject that only shares words with your idea: ${ai.topicFitWhy}` : ai.topicFitWhy;
  const overall = ai.onlySharesWords ? `It only shares words with your idea, so it does not match the topic. ${ai.overall}` : ai.overall;
  const total = weightedTotal(sub);
  if (!setting || sub.settingMatch > 1) return { sub, topicFitWhy, settingMatchWhy: ai.settingMatchWhy, overall, total };
  const low = Math.round(total * OFF_SETTING_FACTOR);
  const why = sub.settingMatch === 0 ? `it is set outside ${setting}` : `its setting is not reported, so it may not be ${setting}`;
  return { sub, topicFitWhy, settingMatchWhy: `${ai.settingMatchWhy} (Score halved: your idea is about ${setting}.)`, overall: `${overall} Score halved (${total} to ${low}) because ${why}.`, total: low };
}
