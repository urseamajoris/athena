// Shared between server and client.
export type StageState = "not_started" | "running" | "needs_review" | "approved" | "stale" | "failed";

export interface StageDef {
  n: number;
  key: string;
  title: string;
  /** One-line definition of done shown in the stage header. */
  done: string;
  /** Stage work runs as a background job. */
  job?: string;
}

export const STAGES: StageDef[] = [
  { n: 1, key: "idea", title: "Idea", done: "Describe your research idea in a sentence or a paragraph, then approve it." },
  { n: 2, key: "scoping", title: "Scoping", done: "Answer up to five questions, then edit and approve the list of 4–8 search topics." },
  { n: 3, key: "search", title: "Search builder", done: "Check each database query and the shared criteria, dry-run the counts, then approve." },
  { n: 4, key: "retrieval", title: "Retrieval", done: "Wait for every query to finish, review the counts and any errors, then approve.", job: "retrieval" },
  { n: 5, key: "summary", title: "Summary table", done: "Skim the papers found, correct any abstract-derived cells, then approve.", job: "summaries" },
  { n: 6, key: "ranking", title: "Ranking", done: "Check the 3–5 papers selected per topic, swap any you disagree with, then approve.", job: "ranking" },
  { n: 7, key: "appraisal", title: "Appraisal", done: "Review each appraisal, accept or reject the quotes not found in the paper, then approve.", job: "appraisal" },
  { n: 8, key: "synthesis", title: "Synthesis", done: "Read the evidence matrix and the known / contested / unknown summaries, then approve.", job: "synthesis" },
  { n: 9, key: "questions", title: "Research question", done: "Compare the three candidates, pick one, edit it if needed, then finish.", job: "questions" },
];

/**
 * What the stage's Re-run control replaces, shown beside the control and confirmed before a re-run of a stage that
 * already has results. A re-run that fails or is cancelled leaves the existing results in place for stages 5, 7, 8 and 9.
 */
export const RERUN_REPLACES: Record<number, string> = {
  4: "A re-run replaces every retrieved paper, and with them the summaries, scores, appraisals and synthesis built on them.",
  5: "A full re-run replaces every existing summary, including cells you corrected (the corrected text is kept in the decision log). To fill in only papers without a summary, use “Retry missing summaries” instead.",
  6: "A full re-run replaces every score and your selections. To score only papers whose batch failed, use “Retry unscored papers” instead.",
  7: "A full re-run redoes every appraisal and replaces the existing ones, including your accept/reject decisions and edited statements (the decisions are kept in the decision log). To appraise only newly selected papers, use “Update appraisals for your selection” instead.",
  8: "A re-run replaces the synthesis, including statements you edited (the replaced text is kept in the decision log).",
  9: "A re-run replaces all three candidate questions, including the one you chose and edited (the replaced text is kept in the decision log).",
};

export const STATE_LABEL: Record<StageState, string> = {
  not_started: "Not started",
  running: "Running",
  needs_review: "Your turn",
  approved: "Approved",
  stale: "Out of date",
  failed: "Failed",
};

/** Stages that are not approved, i.e. why a review is not yet a current, final result. Empty = final. */
export function reviewProblems(states: Record<string, StageState>, staleReasons: Record<string, string> = {}) {
  return STAGES.filter((s) => states[String(s.n)] !== "approved").map((s) => ({
    n: s.n,
    title: s.title,
    state: (states[String(s.n)] ?? "not_started") as StageState,
    reason: staleReasons[String(s.n)] ?? null,
  }));
}

/** One state for a whole review in a list: stale or failed anywhere outranks a finished-looking status. */
export function overallState(states: Record<string, StageState>, currentStage: number): StageState {
  const all = STAGES.map((s) => states[String(s.n)] ?? "not_started");
  if (all.includes("stale")) return "stale";
  if (all.includes("failed")) return "failed";
  if (all.every((x) => x === "approved")) return "approved";
  return states[String(currentStage)] ?? "not_started";
}

export const STUDY_TYPES = [
  "randomized_trial",
  "non_randomized_trial",
  "cohort",
  "case_control",
  "cross_sectional",
  "qualitative",
  "mixed_methods",
  "systematic_review",
  "scoping_review",
  "narrative_review",
  "economic_evaluation",
  "case_report_or_series",
  "protocol",
  "commentary_or_editorial",
  "other",
  "not_reported",
] as const;
export type StudyType = (typeof STUDY_TYPES)[number];

export const STUDY_TYPE_LABEL: Record<StudyType, string> = {
  randomized_trial: "Randomised trial",
  non_randomized_trial: "Non-randomised trial",
  cohort: "Cohort",
  case_control: "Case-control",
  cross_sectional: "Cross-sectional",
  qualitative: "Qualitative",
  mixed_methods: "Mixed methods",
  systematic_review: "Systematic review / meta-analysis",
  scoping_review: "Scoping review",
  narrative_review: "Narrative review",
  economic_evaluation: "Economic evaluation",
  case_report_or_series: "Case report / series",
  protocol: "Protocol",
  commentary_or_editorial: "Commentary / editorial",
  other: "Other",
  not_reported: "Not reported",
};

export const RUBRIC = [
  { key: "topicFit", label: "Topic fit", weight: 0.35, by: "AI" },
  { key: "designStrength", label: "Design strength", weight: 0.2, by: "AI" },
  { key: "settingMatch", label: "Setting match", weight: 0.2, by: "AI" },
  { key: "recency", label: "Recency", weight: 0.15, by: "formula" },
  { key: "citationImpact", label: "Citation impact", weight: 0.1, by: "formula" },
] as const;

/** Papers kept per topic for appraisal ("3–5"). Fewer is allowed when few papers match a topic, but is said plainly. */
export const PER_TOPIC = { min: 3, max: 5 } as const;
/** Topic fit below this (0–1 of 5: unrelated, no topic terms in title or abstract) means the paper does not match the topic. */
export const MIN_TOPIC_FIT = 2;

/** Topics with fewer papers selected than the minimum, in the order given. */
export function thinTopics<T extends { selected: number }>(topics: T[]): T[] {
  return topics.filter((t) => t.selected < PER_TOPIC.min);
}

/** Surname from either PubMed style ("Teoh KW") or OpenAlex style ("Carl Froilan D. Leochico"). */
export function surname(name: string | undefined | null): string {
  if (!name) return "Anon";
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0];
  const last = parts[parts.length - 1];
  if (/^[A-Z]{1,3}$/.test(last)) return parts.slice(0, -1).join(" "); // PubMed: "Lee SWH"
  return last.replace(/[.,]$/, "");
}

export function shortCite(authors: string[], year: number | null): string {
  return `${surname(authors[0])}${authors.length > 1 ? " et al." : ""} ${year ?? "n.d."}`;
}

/** Remove internal IDs a model may have written into prose ("… (sy_ab12…, c_cd34…)"); citations are shown separately. */
export function scrubIds(text: string): string {
  return text
    .replace(/\b(?:c|p|sy|t|rq|ap|st)_[a-f0-9]{8,}\b/g, "")
    .replace(/\(\s*(?:[,;]\s*)*\)/g, "")
    .replace(/\[\s*(?:[,;]\s*)*\]/g, "")
    .replace(/\(\s*[,;]\s*/g, "(")
    .replace(/\s*[,;]\s*\)/g, ")")
    .replace(/\s+([,.;:])/g, "$1")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}
