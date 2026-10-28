import type { StudyType } from "../shared/stages";

export type TemplateType = "trial" | "cohort" | "cross_sectional" | "qualitative" | "systematic_review" | "other";

export const TEMPLATE_LABEL: Record<TemplateType, string> = {
  trial: "Trial",
  cohort: "Cohort",
  cross_sectional: "Cross-sectional",
  qualitative: "Qualitative",
  systematic_review: "Systematic review",
  other: "Other",
};

export function templateFor(st: StudyType | string | null | undefined): TemplateType {
  switch (st) {
    case "randomized_trial":
    case "non_randomized_trial":
      return "trial";
    case "cohort":
    case "case_control":
      return "cohort";
    case "cross_sectional":
      return "cross_sectional";
    case "qualitative":
    case "mixed_methods":
      return "qualitative";
    case "systematic_review":
    case "scoping_review":
      return "systematic_review";
    default:
      return "other";
  }
}

/** Field guidance per template (what "sample", "methods" etc. should capture for that design). */
export const FIELD_GUIDANCE: Record<TemplateType, Record<string, string>> = {
  trial: { aim: "trial objective / hypothesis", setting: "country, sites, care level", sample: "number randomised per arm, eligibility", methods: "design, randomisation, intervention vs comparator, primary outcome, follow-up", key_findings: "primary outcome result with effect size and CI if reported", limitations: "authors' stated limitations" },
  cohort: { aim: "research question / exposure-outcome", setting: "country, data source, period", sample: "cohort size, follow-up", methods: "exposure definition, outcome ascertainment, adjustment", key_findings: "main association with effect estimate if reported", limitations: "authors' stated limitations" },
  cross_sectional: { aim: "objective", setting: "country, sites, period", sample: "sample size, response rate, sampling method", methods: "instrument, variables, analysis", key_findings: "main results with numbers if reported", limitations: "authors' stated limitations" },
  qualitative: { aim: "aim / research question", setting: "country, sites, context", sample: "participants, number, sampling", methods: "data collection and analysis approach", key_findings: "main themes", limitations: "authors' stated limitations" },
  systematic_review: { aim: "review question", setting: "geographic scope / settings of included studies", sample: "number of included studies / participants", methods: "databases, dates, eligibility, appraisal tool, synthesis method", key_findings: "main conclusions", limitations: "authors' stated limitations" },
  other: { aim: "aim or purpose", setting: "context / country", sample: "data or participants, if any", methods: "approach used", key_findings: "main points", limitations: "stated limitations" },
};

/** Short quality checklists, adapted from CASP / JBI style items. */
export const CHECKLISTS: Record<TemplateType, string[]> = {
  trial: [
    "Random allocation method described",
    "Allocation concealment described",
    "Blinding of participants, staff or assessors",
    "Groups similar at baseline",
    "Attrition / loss to follow-up reported",
    "Intention-to-treat analysis",
    "Primary outcome pre-specified or registered",
  ],
  cohort: [
    "Cohort clearly defined and recruited appropriately",
    "Exposure measured reliably",
    "Outcome measured reliably",
    "Confounders identified and adjusted for",
    "Follow-up complete and long enough",
    "Effect estimates reported with precision (e.g. CI)",
  ],
  cross_sectional: [
    "Sampling frame and method described",
    "Sample size justified",
    "Response rate reported",
    "Validated or piloted instrument",
    "Confounders or subgroups considered in analysis",
    "Ethics approval reported",
  ],
  qualitative: [
    "Clear statement of aims",
    "Qualitative methodology appropriate",
    "Recruitment strategy explained",
    "Data collection described",
    "Researcher reflexivity considered",
    "Ethical issues considered",
    "Data analysis sufficiently rigorous",
    "Clear statement of findings",
  ],
  systematic_review: [
    "Clearly focused question (PICO or equivalent)",
    "Comprehensive search of multiple databases",
    "Selection by two or more reviewers",
    "Risk of bias / quality of included studies assessed",
    "Methods for combining results appropriate",
    "Publication bias or heterogeneity considered",
  ],
  other: [
    "Aim clearly stated",
    "Methods or approach described",
    "Sources of data or evidence identified",
    "Limitations acknowledged",
  ],
};
