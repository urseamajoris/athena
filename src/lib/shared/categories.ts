// Categories and colour coding, shared by every view: table chips, canvas, 2D/3D maps, legends, admin charts.
//
// Rules (also in docs/ux-intent.md):
// - One meaning per colour within a "Color by" dimension, the same everywhere it appears.
// - Never colour alone: every category also has a shape and a text label.
// - The palette is validated (dataviz validate_palette.js): adjacent-pair CVD ΔE >= 8, normal-vision ΔE >= 15,
//   >= 3:1 against the page and card surfaces in both themes. src/lib/design/categories.test.ts keeps the CSS
//   tokens (--cat-1..8, --cat-none in globals.css) equal to the hex values below.
import type { StudyType } from "./stages";

export type Theme = "light" | "dark";
export type Shape = "circle" | "square" | "triangle" | "diamond" | "star" | "cross" | "ring" | "hexagon";

/** Categorical slots, fixed order (the order is part of the colour-blind safety: never reorder or cycle). */
export const PALETTE: Record<Theme, readonly string[]> = {
  light: ["#2a78d6", "#d95926", "#13936a", "#b97f00", "#d4558a", "#008300", "#6250d6", "#e34948"],
  dark: ["#3987e5", "#d95926", "#199e70", "#c98500", "#d55181", "#2a9a2a", "#9085e9", "#e66767"],
};
/** "Not reported" / "unknown": neutral, never a hue. */
export const NONE: Record<Theme, string> = { light: "#6e6e78", dark: "#8a8a94" };
/** Sequential ramp (ranking score), one hue light→dark; ordered so the step nearest the surface still reads. */
export const SEQUENTIAL: Record<Theme, readonly string[]> = {
  light: ["#86b6ef", "#5598e7", "#2a78d6", "#1c5cab", "#104281"],
  dark: ["#184f95", "#256abf", "#3987e5", "#6da7ec", "#9ec5f4"],
};

export const SLOT_COUNT = 8;
/** CSS variable for a slot (1-based); the value switches with the theme. */
export const slotVar = (slot: number | null) => (slot ? `var(--cat-${slot})` : "var(--cat-none)");
export const slotHex = (slot: number | null, theme: Theme) => (slot ? PALETTE[theme][(slot - 1) % SLOT_COUNT] : NONE[theme]);

export interface Category {
  key: string;
  label: string;
  /** Plain-language definition for novices (legend tooltip, filter help). */
  hint?: string;
  slot: number | null;
  shape: Shape;
}

// ---------- study type (default colour) ----------
// Groups match the appraisal templates (src/lib/stages/templates.ts), plus "not reported".
export const STUDY_GROUPS: Category[] = [
  { key: "trial", label: "Trial", hint: "Researchers assigned people to an intervention (randomised or not) and compared outcomes.", slot: 1, shape: "circle" },
  { key: "cohort", label: "Cohort / case-control", hint: "People followed over time, or cases compared with controls, without assigning an intervention.", slot: 2, shape: "square" },
  { key: "cross_sectional", label: "Cross-sectional", hint: "A snapshot at one point in time, such as a survey.", slot: 3, shape: "triangle" },
  { key: "qualitative", label: "Qualitative / mixed methods", hint: "Interviews, focus groups or observation, sometimes combined with numbers.", slot: 4, shape: "diamond" },
  { key: "review", label: "Systematic / scoping review", hint: "A structured summary of many earlier studies.", slot: 5, shape: "star" },
  { key: "other", label: "Other design", hint: "Narrative reviews, economic evaluations, case reports, protocols, commentaries and anything else.", slot: 6, shape: "cross" },
  { key: "not_reported", label: "Not reported", hint: "The abstract does not say what kind of study it is.", slot: null, shape: "ring" },
];

export function studyGroupOf(st: StudyType | string | null | undefined): string {
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
      return "review";
    case "not_reported":
    case null:
    case undefined:
    case "":
      return "not_reported";
    default:
      return "other";
  }
}

/**
 * Before the AI reads the abstracts (retrieval), a study group only where the database itself labels the design
 * (e.g. PubMed "Randomized Controlled Trial"); everything else is "not labelled yet". Never guessed.
 */
export function studyGroupFromLabels(publicationTypes: string[] | null | undefined): string {
  const t = (publicationTypes ?? []).map((x) => x.toLowerCase());
  if (t.some((x) => /randomi[sz]ed controlled trial|clinical trial|controlled clinical trial/.test(x))) return "trial";
  if (t.some((x) => /systematic review|meta-analysis|scoping review/.test(x))) return "review";
  if (t.some((x) => /^(editorial|comment|letter|case reports)$/.test(x))) return "other";
  return "not_reported";
}

// ---------- article type (what kind of publication) ----------
export const ARTICLE_TYPES: Category[] = [
  { key: "journal_article", label: "Journal article", hint: "Original research published in a journal.", slot: 1, shape: "circle" },
  { key: "review", label: "Review article", hint: "Published as a review (systematic or narrative).", slot: 2, shape: "square" },
  { key: "preprint", label: "Preprint", hint: "Shared before peer review. Treat findings as preliminary.", slot: 3, shape: "triangle" },
  { key: "editorial", label: "Editorial / letter / comment", hint: "Opinion or correspondence, not a study.", slot: 4, shape: "diamond" },
  { key: "other", label: "Other publication", hint: "Books, chapters, conference papers, datasets and similar.", slot: 5, shape: "star" },
  { key: "unknown", label: "Unknown", hint: "The databases did not say what kind of publication this is.", slot: null, shape: "ring" },
];

/** From the OpenAlex `type` and PubMed publication types already stored on the paper. Never guesses: no data → unknown. */
export function articleTypeOf(publicationTypes: string[] | null | undefined): string {
  const t = (publicationTypes ?? []).map((x) => x.toLowerCase().trim());
  if (!t.length) return "unknown";
  if (t.some((x) => x === "preprint" || x === "posted-content" || x.includes("preprint"))) return "preprint";
  if (t.some((x) => x === "review" || x === "systematic review" || x === "meta-analysis" || x === "scoping review")) return "review";
  if (t.some((x) => ["editorial", "letter", "comment", "news", "erratum", "retraction", "published erratum"].includes(x))) return "editorial";
  if (t.some((x) => x === "article" || x === "journal article" || x.includes("trial") || x.includes("study") || x === "case reports")) return "journal_article";
  return "other";
}

// ---------- the other dimensions ----------
export const SOURCES: Category[] = [
  { key: "both", label: "PubMed and OpenAlex", slot: 1, shape: "circle" },
  { key: "pubmed", label: "PubMed only", slot: 2, shape: "square" },
  { key: "openalex", label: "OpenAlex only", slot: 3, shape: "triangle" },
];
export function sourceOf(dbs: string[] | null | undefined): string {
  const s = new Set(dbs ?? []);
  return s.has("pubmed") && s.has("openalex") ? "both" : s.has("pubmed") ? "pubmed" : s.has("openalex") ? "openalex" : "openalex";
}

export const EVIDENCE: Category[] = [
  { key: "full_text", label: "Full text, no quote to decide", hint: "Appraised on the open full text; every quote was found word for word or decided by you.", slot: 1, shape: "circle" },
  { key: "abstract_only", label: "Abstract only, no quote to decide", hint: "Only the abstract was available; every quote was found word for word or decided by you.", slot: 4, shape: "square" },
  { key: "unverified", label: "Has a quote to decide", hint: "At least one quote was not found word for word in the source and you have not accepted or rejected it yet.", slot: 8, shape: "triangle" },
  { key: "not_appraised", label: "Not appraised", hint: "Not selected for appraisal (yet).", slot: null, shape: "ring" },
];
export function evidenceOf(a: { textSource?: string | null; unverified?: number } | null | undefined): string {
  if (!a?.textSource) return "not_appraised";
  if ((a.unverified ?? 0) > 0) return "unverified";
  return a.textSource === "full_text" ? "full_text" : "abstract_only";
}

export const ACCESS: Category[] = [
  { key: "open", label: "Open full text available", slot: 1, shape: "circle" },
  { key: "closed", label: "Abstract only", slot: 4, shape: "square" },
];
export const accessOf = (p: { oaUrl?: string | null; pmcid?: string | null }) => (p.oaUrl || p.pmcid ? "open" : "closed");

export const SELECTION: Category[] = [
  { key: "selected", label: "Selected for appraisal", slot: 1, shape: "circle" },
  { key: "not_selected", label: "Not selected", slot: null, shape: "ring" },
];

export const PERIODS: Category[] = [
  { key: "2023+", label: "2023 or later", slot: 1, shape: "circle" },
  { key: "2020-2022", label: "2020–2022", slot: 2, shape: "square" },
  { key: "2015-2019", label: "2015–2019", slot: 3, shape: "triangle" },
  { key: "pre2015", label: "Before 2015", slot: 4, shape: "diamond" },
  { key: "unknown", label: "Year unknown", slot: null, shape: "ring" },
];
export function periodOf(year: number | null | undefined): string {
  if (!year) return "unknown";
  return year >= 2023 ? "2023+" : year >= 2020 ? "2020-2022" : year >= 2015 ? "2015-2019" : "pre2015";
}

export const SCORE_BANDS: Category[] = [
  { key: "80+", label: "Score 80–100", slot: null, shape: "circle" },
  { key: "60-79", label: "Score 60–79", slot: null, shape: "circle" },
  { key: "40-59", label: "Score 40–59", slot: null, shape: "circle" },
  { key: "20-39", label: "Score 20–39", slot: null, shape: "circle" },
  { key: "0-19", label: "Score under 20", slot: null, shape: "circle" },
  { key: "unscored", label: "Not scored", slot: null, shape: "ring" },
];
export function scoreBandOf(score: number | null | undefined): string {
  if (score == null) return "unscored";
  return score >= 80 ? "80+" : score >= 60 ? "60-79" : score >= 40 ? "40-59" : score >= 20 ? "20-39" : "0-19";
}
/** Sequential colour for a score band (darker = higher in light; brighter = higher in dark). */
export function scoreHex(band: string, theme: Theme): string {
  const i = ["0-19", "20-39", "40-59", "60-79", "80+"].indexOf(band);
  return i < 0 ? NONE[theme] : SEQUENTIAL[theme][i];
}

/** Topics take slots in their importance order (max 8 topics, so never cycled). */
export function topicCategories(topics: { id: string; name: string }[]): Category[] {
  const shapes: Shape[] = ["circle", "square", "triangle", "diamond", "star", "cross", "hexagon", "ring"];
  return topics.slice(0, SLOT_COUNT).map((t, i) => ({ key: t.id, label: t.name, slot: i + 1, shape: shapes[i] }));
}

// ---------- "Color by" ----------
export type ColorBy = "study" | "topic" | "source" | "evidence" | "score";
export const COLOR_BY: { key: ColorBy; label: string }[] = [
  { key: "study", label: "Study type" },
  { key: "topic", label: "Topic" },
  { key: "source", label: "Source database" },
  { key: "evidence", label: "Evidence status" },
  { key: "score", label: "Ranking score" },
];

/** Filter / group dimensions available in the table and maps. */
export type Dimension = "study" | "article" | "topic" | "source" | "period" | "access" | "selected" | "evidence";
export const DIMENSIONS: { key: Dimension; label: string; plural: string }[] = [
  { key: "study", label: "Study type", plural: "study types" },
  { key: "article", label: "Article type", plural: "article types" },
  { key: "topic", label: "Topic", plural: "topics" },
  { key: "source", label: "Source database", plural: "sources" },
  { key: "period", label: "Year", plural: "periods" },
  { key: "access", label: "Full text", plural: "access" },
  { key: "selected", label: "Selection", plural: "selection" },
  { key: "evidence", label: "Evidence status", plural: "evidence" },
];

export function categoriesFor(dim: Dimension | ColorBy, topics: { id: string; name: string }[] = []): Category[] {
  switch (dim) {
    case "study": return STUDY_GROUPS;
    case "article": return ARTICLE_TYPES;
    case "topic": return topicCategories(topics);
    case "source": return SOURCES;
    case "period": return PERIODS;
    case "access": return ACCESS;
    case "selected": return SELECTION;
    case "evidence": return EVIDENCE;
    case "score": return SCORE_BANDS;
  }
}

/**
 * Only the "Colour by" dimensions own hues. The others (article type, year, full text, selection) are drawn in
 * plain ink with their shapes, so one colour never means two things on the same screen.
 */
const INK: Record<Theme, string> = { light: "#3e3e47", dark: "#b4b4bd" };
export function hasHues(dim: Dimension | ColorBy): boolean {
  return COLOR_BY.some((c) => c.key === dim);
}

/** The colour of a category in a dimension (score uses the sequential ramp). */
export function categoryHex(dim: Dimension | ColorBy, key: string, theme: Theme, topics: { id: string; name: string }[] = []): string {
  if (dim === "score") return scoreHex(key, theme);
  if (!hasHues(dim)) return INK[theme];
  const c = categoriesFor(dim, topics).find((x) => x.key === key);
  return slotHex(c?.slot ?? null, theme);
}
export function categoryVar(dim: Dimension | ColorBy, key: string, topics: { id: string; name: string }[] = []): string {
  if (dim === "score") {
    const i = ["0-19", "20-39", "40-59", "60-79", "80+"].indexOf(key);
    return i < 0 ? "var(--cat-none)" : `var(--seq-${i + 1})`;
  }
  if (!hasHues(dim)) return "var(--fg-1)";
  return slotVar(categoriesFor(dim, topics).find((x) => x.key === key)?.slot ?? null);
}

/** A plain-language summary of active filters: "Showing 42 of 231: trials and cohort studies, 2019+". */
export function describeFilters(shown: number, total: number, active: { dim: Dimension; keys: string[] }[], topics: { id: string; name: string }[] = []): string {
  const parts = active
    .filter((a) => a.keys.length)
    .map((a) => {
      const cats = categoriesFor(a.dim, topics);
      const lower = (x: string) => (a.dim === "topic" ? x : x.charAt(0).toLowerCase() + x.slice(1));
      const names = a.keys.map((k) => lower(cats.find((c) => c.key === k)?.label ?? k));
      const list = names.length <= 2 ? names.join(" or ") : `${names.slice(0, -1).join(", ")} or ${names[names.length - 1]}`;
      return a.dim === "topic" ? `topic ${list}` : list;
    });
  const head = shown === total ? `Showing all ${total}` : `Showing ${shown} of ${total}`;
  return parts.length ? `${head}: ${parts.join("; ")}` : head;
}

// ---------- saved view choices (per project) ----------
export interface ViewPrefs {
  colorBy?: ColorBy;
  /** Non-destructive filters: the categories to show per dimension (empty/missing = all). */
  filters?: Partial<Record<Dimension, string[]>>;
  groupBy?: Dimension | null;
}

/** "Colour by study type; showing trial or cohort / case-control; grouped by year" (for the report). */
export function describeView(v: ViewPrefs | null | undefined, topics: { id: string; name: string }[] = []): string | null {
  if (!v) return null;
  const parts: string[] = [];
  const active = Object.entries(v.filters ?? {}).filter(([, keys]) => keys && keys.length) as [Dimension, string[]][];
  if (active.length) parts.push(describeFilters(0, 0, active.map(([dim, keys]) => ({ dim, keys })), topics).replace(/^Showing all 0: /, "showing only "));
  if (v.groupBy) parts.push(`grouped by ${DIMENSIONS.find((d) => d.key === v.groupBy)?.label.toLowerCase() ?? v.groupBy}`);
  if (v.colorBy && v.colorBy !== "study") parts.push(`coloured by ${COLOR_BY.find((c) => c.key === v.colorBy)?.label.toLowerCase()}`);
  return parts.length ? parts.join("; ") : null;
}
