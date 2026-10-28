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
  { n: 7, key: "appraisal", title: "Appraisal", done: "Review each appraisal, accept or reject unverified quotes, then approve.", job: "appraisal" },
  { n: 8, key: "synthesis", title: "Synthesis", done: "Read the evidence matrix and the known / contested / unknown summaries, then approve.", job: "synthesis" },
  { n: 9, key: "questions", title: "Research question", done: "Compare the three candidates, pick one, edit it if needed, then finish.", job: "questions" },
];

export const STATE_LABEL: Record<StageState, string> = {
  not_started: "Not started",
  running: "Running",
  needs_review: "Needs review",
  approved: "Approved",
  stale: "Stale",
  failed: "Failed",
};

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
