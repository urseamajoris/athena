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
  { n: 1, key: "idea", title: "Idea", done: "Describe what you want to research in a sentence or a paragraph, then continue." },
  { n: 2, key: "scoping", title: "Research question", done: "Answer up to five short questions, then choose, edit or write your research question and confirm it." },
  { n: 3, key: "search", title: "Search plan", done: "Check the search topics, the database searches and the criteria, then run the searches." },
  { n: 4, key: "retrieval", title: "Papers found", done: "Wait for every search to finish, look at what came back and any errors, then continue.", job: "retrieval" },
  { n: 5, key: "summary", title: "Paper summaries", done: "Every paper is summarised from its abstract. Ranking starts by itself when the summaries are ready.", job: "summaries" },
  { n: 6, key: "ranking", title: "Choose papers", done: "Check the 3–5 papers chosen per topic, correct any summary, swap papers you disagree with, then continue.", job: "ranking" },
  { n: 7, key: "appraisal", title: "Article analysis", done: "Read the analysis of each article, accept or reject the quotes not found in its text, then continue.", job: "appraisal" },
  { n: 8, key: "synthesis", title: "Evidence summary", done: "Read what is known, contested and unknown, and the evidence matrix, then continue.", job: "synthesis" },
  { n: 9, key: "questions", title: "Final question", done: "Keep your research question or pick a revision the evidence suggests, edit it if needed, then finish.", job: "questions" },
];

/** Title of an engine stage, for messages ("Finish \"Search plan\" first"). */
export function stageTitle(n: number): string {
  return STAGES[n - 1]?.title ?? `stage ${n}`;
}

export const STATE_LABEL: Record<StageState, string> = {
  not_started: "Not started",
  running: "Running",
  needs_review: "Your turn",
  approved: "Approved",
  stale: "Out of date",
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

/** Frameworks a research question can be structured with (the working question in stage 2, the final one in stage 9). */
export const QUESTION_FRAMEWORKS = ["PICO", "PECO", "PEO", "PICo", "SPIDER", "other"] as const;
export type QuestionFramework = (typeof QUESTION_FRAMEWORKS)[number];

/** How an analysed article bears on the working research question (stage 7). "" on analyses with no judgement. */
export const RELEVANCE = ["direct", "partial", "background"] as const;
export type Relevance = (typeof RELEVANCE)[number];
export const RELEVANCE_LABEL: Record<Relevance, string> = {
  direct: "Answers your question directly",
  partial: "Answers part of your question",
  background: "Background only",
};

/**
 * Stage 9 lists the working research question first, as a candidate the user can keep ("Your question,
 * unchanged"), then the revisions the evidence suggests. The working-question candidate is the row with
 * `order` 0 and this exact `gap` text (the gap cannot be edited through the API).
 */
export const WORKING_QUESTION_ORDER = 0;
export const WORKING_QUESTION_GAP = "This is your working research question, as you confirmed it before the search.";
export function isWorkingQuestionCandidate(q: { order: number; gap: string }): boolean {
  return q.order === WORKING_QUESTION_ORDER && q.gap === WORKING_QUESTION_GAP;
}

/** Papers kept per topic for article analysis ("3–5"). Fewer is allowed when few papers match a topic, but is said plainly. */
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
