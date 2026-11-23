import { STUDY_TYPE_LABEL, type StudyType } from "./stages";

export interface CriteriaLike {
  yearFrom: number | null;
  yearTo: number | null;
  languages: string[];
  studyTypes: string[];
  inclusion: string[];
  exclusion: string[];
}

export interface PaperFlag {
  kind: "publication_type" | "criteria_exclusion" | "study_type_mismatch";
  label: string;
  reason: string;
}

/**
 * Format the researcher's study-type, inclusion, and exclusion criteria for AI prompts.
 * Intentionally excludes year/language (those are applied as database filters).
 */
export function formatCriteriaGuidance(criteria: CriteriaLike | null | undefined): string {
  const studyTypes = (criteria?.studyTypes ?? []).map((s) => s.trim()).filter(Boolean);
  const inclusion = (criteria?.inclusion ?? []).map((s) => s.trim()).filter(Boolean);
  const exclusion = (criteria?.exclusion ?? []).map((s) => s.trim()).filter(Boolean);
  if (!studyTypes.length && !inclusion.length && !exclusion.length) {
    return "No explicit preferred study types, inclusion criteria, or exclusion criteria were specified. Use the research idea and scoping summary as guidance.";
  }
  const lines = [
    "These criteria are guidance for scoring and appraisal — they are NOT a hard database filter.",
    `- Preferred study types: ${studyTypes.length ? studyTypes.join("; ") : "none specified"}`,
    `- Inclusion criteria: ${inclusion.length ? inclusion.join("; ") : "none specified"}`,
    `- Exclusion criteria: ${exclusion.length ? exclusion.join("; ") : "none specified"}`,
  ];
  return lines.join("\n");
}

const NON_STUDY_PATTERNS: { key: string; label: string; pubRe: RegExp; titleRe?: RegExp; reason: string }[] = [
  {
    key: "protocol",
    label: "Protocol",
    pubRe: /\bprotocols?\b/i,
    titleRe: /^\s*protocol\s+(?:for|of)\b|\b(?:study|trial|review|research)\s+protocol\b|:\s*(?:a\s+)?(?:study\s+|trial\s+)?protocol\b/i,
    reason: "Study/trial protocol — describes planned methods rather than completed findings.",
  },
  {
    key: "editorial",
    label: "Editorial",
    pubRe: /\beditorials?\b/i,
    titleRe: /^\s*editorial\s*[:—–-]/i,
    reason: "Editorial publication type — opinion/commentary rather than an empirical study.",
  },
  {
    key: "letter",
    label: "Letter",
    pubRe: /\bletters?\b/i,
    titleRe: /^\s*letter\s+to\s+the\s+editor\b/i,
    reason: "Letter publication type — correspondence rather than a primary study.",
  },
  {
    key: "comment",
    label: "Comment",
    pubRe: /\bcomment(?:ary|aries|s)?\b/i,
    titleRe: /^\s*commentary\s*[:—–-]/i,
    reason: "Comment/commentary publication type — not an empirical study.",
  },
  {
    key: "erratum",
    label: "Erratum",
    pubRe: /\b(?:errat(?:um|a)|correction|corrigendum|retract(?:ed|ion))\b/i,
    titleRe: /^\s*(?:erratum|corrigendum|correction|retraction)\s*[:—–-]/i,
    reason: "Erratum, correction, or retraction notice rather than a primary study.",
  },
];

/** Detect non-study publication types (protocol, editorial, letter, comment, erratum). */
export function detectPublicationTypeFlags(
  publicationTypes: string[] | null | undefined,
  studyType?: string | null,
  title?: string | null,
): PaperFlag[] {
  const pubText = (publicationTypes ?? []).join(" ");
  const titleText = title ?? "";
  const seen = new Set<string>();
  const flags: PaperFlag[] = [];

  for (const p of NON_STUDY_PATTERNS) {
    if (p.pubRe.test(pubText) || (p.titleRe && p.titleRe.test(titleText))) {
      seen.add(p.key);
      flags.push({ kind: "publication_type", label: p.label, reason: p.reason });
    }
  }

  if (studyType === "protocol" && !seen.has("protocol")) {
    seen.add("protocol");
    flags.push({
      kind: "publication_type",
      label: "Protocol",
      reason: "Abstract-derived study type is protocol — planned study rather than completed findings.",
    });
  }
  if (studyType === "commentary_or_editorial" && !seen.has("editorial") && !seen.has("comment") && !seen.has("letter")) {
    seen.add("editorial");
    flags.push({
      kind: "publication_type",
      label: "Commentary / editorial",
      reason: "Abstract-derived study type is commentary/editorial rather than an empirical study.",
    });
  }

  return flags;
}

const STOPWORDS = new Set([
  "the", "and", "for", "with", "from", "that", "this", "their", "have", "been", "were", "about", "into",
  "more", "than", "such", "other", "mock", "study", "studies", "paper", "papers", "article", "articles",
  "report", "reports", "research", "based", "using", "focused", "focus", "focusing", "only", "purely",
  "conducted", "published", "related", "involving", "including", "among", "between", "within", "during",
  "after", "before", "exclude", "excluded", "excluding", "does", "not", "without", "outside", "non",
  "any", "all", "are", "was", "but", "our", "its", "can", "may", "will", "which", "where", "when", "who",
]);

const DESIGN_MATCHERS: {
  ruleRe: RegExp;
  studyTypes?: StudyType[];
  pubRe?: RegExp;
  oaRe?: RegExp;
}[] = [
  { ruleRe: /\bprotocols?\b/i, studyTypes: ["protocol"], pubRe: /\bprotocols?\b/i },
  { ruleRe: /\b(?:editorials?|commentar(?:y|ies)|comments?|letters?|opinion|viewpoint)\b/i, studyTypes: ["commentary_or_editorial"], pubRe: /\b(?:editorials?|letters?|comment(?:ary|s)?)\b/i },
  { ruleRe: /\b(?:errat(?:um|a)|corrections?|retract(?:ed|ion))\b/i, pubRe: /\b(?:errat(?:um|a)|correction|corrigendum|retract(?:ed|ion))\b/i },
  { ruleRe: /\bcase\s+(?:reports?|series)\b/i, studyTypes: ["case_report_or_series"], pubRe: /\bcase\s+reports?\b/i },
  { ruleRe: /\bnarrative\s+reviews?\b/i, studyTypes: ["narrative_review"] },
  { ruleRe: /\bscoping\s+reviews?\b/i, studyTypes: ["scoping_review"] },
  { ruleRe: /\b(?:systematic\s+reviews?|meta-?analys(?:is|es))\b/i, studyTypes: ["systematic_review"], pubRe: /\b(?:systematic\s+review|meta-analysis)\b/i },
  { ruleRe: /\bqualitative\b/i, studyTypes: ["qualitative"] },
  { ruleRe: /\bmixed[- ]methods?\b/i, studyTypes: ["mixed_methods"] },
  { ruleRe: /\b(?:cross[- ]sectional|surveys?)\b/i, studyTypes: ["cross_sectional"] },
  { ruleRe: /\bcohort\b/i, studyTypes: ["cohort"] },
  { ruleRe: /\bcase[- ]control\b/i, studyTypes: ["case_control"] },
  { ruleRe: /\bnon[- ]randomi[sz]ed\b/i, studyTypes: ["non_randomized_trial"] },
  { ruleRe: /(?<!\bnon[- ])\b(?:randomi[sz]ed|rcts?)\b/i, studyTypes: ["randomized_trial"], pubRe: /\brandomized\s+controlled\s+trial\b/i },
  { ruleRe: /\beconomic\s+evaluations?\b/i, studyTypes: ["economic_evaluation"] },
  { ruleRe: /\bpreprints?\b/i, pubRe: /\bpreprints?\b/i, oaRe: /\bpreprint\b/i },
  { ruleRe: /\bconference\s+(?:abstracts?|papers?|proceedings)\b/i, pubRe: /\b(?:congress|conference|meeting\s+abstract)\b/i },
];

const EMPIRICAL_STUDY_TYPES = new Set<StudyType>([
  "randomized_trial",
  "non_randomized_trial",
  "cohort",
  "case_control",
  "cross_sectional",
  "qualitative",
  "mixed_methods",
  "economic_evaluation",
  "case_report_or_series",
]);

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function tokenMatches(corpus: string, token: string): boolean {
  const stem = token.length > 5 ? token.replace(/(?:ies|es|s)$/i, "") : token;
  if (stem.length < 3) return false;
  const re = new RegExp(`\\b${escapeRegExp(stem)}[a-z]*\\b`, "i");
  return re.test(corpus);
}

const NEGATION_WORD_RE =
  /\b(?:outside|not|no|never|neither|nor|cannot|without|lacking|other\s+than|except)\b|\b(?:do|does|did|is|are|was|were|have|has|had|can|could|would|should|wo|ca)n['’]t\b/i;

const NON_PREFIX_RE = /\bnon[-\s]+[a-z]/i;

/**
 * True when a rule uses negation framing ("not X", "outside X", "without X", "non-X")
 * where matching X directly would invert the rule.
 * When allowNonRandomizedDesign is true (structured DESIGN_MATCHERS step), the known
 * "non-randomized" study-type phrase is allowed through unless another negation is present.
 */
function hasInvertedNegation(rule: string, allowNonRandomizedDesign = false): boolean {
  const cleaned = rule.replace(/^\(mock\)\s*/i, "").replace(/\s+/g, " ").trim();
  if (NEGATION_WORD_RE.test(cleaned)) return true;
  const forNonPrefix = allowNonRandomizedDesign ? cleaned.replace(/\bnon[- ]randomi[sz]ed\b/gi, "") : cleaned;
  return NON_PREFIX_RE.test(forNonPrefix);
}

function matchesPreferredStudyTypes(studyType: StudyType, preferred: string[]): boolean {
  const joined = preferred.join(" ; ");
  if (/\b(?:any|all)\s+(?:study\s+|research\s+)?(?:designs?|types?|methods?|studies)\b/i.test(joined) || /^\s*(?:any|all)\s*$/i.test(joined)) {
    return studyType !== "protocol" && studyType !== "commentary_or_editorial";
  }
  for (const pref of preferred) {
    if (/\bempirical\b/i.test(pref) && EMPIRICAL_STUDY_TYPES.has(studyType)) return true;
    if (/\bobservational\b/i.test(pref) && (studyType === "cohort" || studyType === "case_control" || studyType === "cross_sectional")) return true;
    if (/\btrials?\b/i.test(pref) && (studyType === "randomized_trial" || studyType === "non_randomized_trial")) return true;
    if (/\breviews?\b/i.test(pref) && !/\b(?:systematic|scoping|narrative)\b/i.test(pref) && (studyType === "systematic_review" || studyType === "scoping_review" || studyType === "narrative_review")) return true;
    for (const dm of DESIGN_MATCHERS) {
      if (dm.ruleRe.test(pref) && dm.studyTypes?.includes(studyType)) return true;
    }
    const label = STUDY_TYPE_LABEL[studyType];
    if (label && pref.toLowerCase().includes(label.toLowerCase())) return true;
  }
  return false;
}

export interface FlaggablePaper {
  title: string;
  abstract?: string | null;
  publicationTypes?: string[] | null;
  oaStatus?: string | null;
}

export interface FlaggableSummary {
  studyType?: string | null;
  setting?: string | null;
  keyFinding?: string | null;
}

/**
 * Evaluate flags for a paper based on its publication types, abstract-derived study type,
 * and the project's stored exclusion / study-type criteria. Never deletes the paper.
 */
export function detectCriteriaFlags(
  paper: FlaggablePaper,
  summary: FlaggableSummary | null | undefined,
  criteria: CriteriaLike | null | undefined,
): PaperFlag[] {
  const flags = detectPublicationTypeFlags(paper.publicationTypes, summary?.studyType, paper.title);
  const pubText = (paper.publicationTypes ?? []).join(" ");
  const oaText = paper.oaStatus ?? "";
  const studyType = (summary?.studyType ?? null) as StudyType | null;
  const corpus = [paper.title, pubText, summary?.setting ?? "", summary?.keyFinding ?? "", paper.abstract ?? ""].join("\n");

  const seenRules = new Set<string>();
  for (const rawRule of criteria?.exclusion ?? []) {
    const rule = rawRule.trim();
    if (!rule || seenRules.has(rule)) continue;
    const cleaned = rule.replace(/^\(mock\)\s*/i, "").replace(/\s+/g, " ").trim();
    if (!cleaned) continue;

    // 1. Check structured study-type / publication-type exclusion matches.
    let matched = false;
    if (!hasInvertedNegation(cleaned, true)) {
      for (const dm of DESIGN_MATCHERS) {
        if (!dm.ruleRe.test(cleaned)) continue;
        const hitStudy = !!(studyType && dm.studyTypes?.includes(studyType));
        const hitPub = !!(dm.pubRe && dm.pubRe.test(pubText));
        const hitOa = !!(dm.oaRe && dm.oaRe.test(oaText));
        if (hitStudy || hitPub || hitOa) {
          matched = true;
          break;
        }
      }
    }

    // 2. Check substantive keyword/phrase match for non-negated exclusion rules.
    if (!matched && !hasInvertedNegation(cleaned)) {
      const tokens = [
        ...new Set(
          cleaned
            .toLowerCase()
            .replace(/[^a-z0-9\s-]/g, " ")
            .split(/[\s-]+/)
            .filter((w) => w.length >= 4 && !STOPWORDS.has(w)),
        ),
      ];
      if (tokens.length === 1) {
        if (tokenMatches(corpus, tokens[0])) matched = true;
      } else if (tokens.length >= 2) {
        const hits = tokens.filter((t) => tokenMatches(corpus, t));
        const need = tokens.length === 2 ? 2 : Math.max(2, Math.ceil(tokens.length * 0.6));
        if (hits.length >= need) matched = true;
      }
    }

    if (matched) {
      seenRules.add(rule);
      flags.push({
        kind: "criteria_exclusion",
        label: "Matches exclusion",
        reason: `Matches stored exclusion criterion: "${rule}"`,
      });
    }
  }

  // 3. Check preferred study types when concrete preferences are stated.
  const preferred = (criteria?.studyTypes ?? []).map((s) => s.trim()).filter(Boolean);
  if (
    preferred.length > 0 &&
    studyType &&
    studyType !== "not_reported" &&
    studyType !== "other" &&
    studyType !== "protocol" &&
    studyType !== "commentary_or_editorial" &&
    !matchesPreferredStudyTypes(studyType, preferred)
  ) {
    const label = STUDY_TYPE_LABEL[studyType] ?? studyType;
    flags.push({
      kind: "study_type_mismatch",
      label: "Outside preferred designs",
      reason: `Study type (${label}) does not match preferred study types (${preferred.join(", ")}).`,
    });
  }

  return flags;
}

/** True when a paper has a non-study publication type flag (protocol, editorial, letter, comment, erratum). */
export function hasNonStudyFlag(flags: PaperFlag[]): boolean {
  return flags.some((f) => f.kind === "publication_type");
}

/** Papers that are excluded or flagged by criteria/publication type must not be silently pre-selected. */
export function shouldAvoidAutoSelect(flags: PaperFlag[], excluded?: boolean | null): boolean {
  return Boolean(excluded) || flags.length > 0;
}
