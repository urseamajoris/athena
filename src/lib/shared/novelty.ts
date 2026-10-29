// The novelty check's verdict in plain words, shared by step 9 and the exported report (unit-tested in
// novelty.test.ts). Two different things are kept apart: how many records contain the search words (the
// database count) and whether any of the top records is close to the question (judged from its title).
import { fmtInt } from "./format";
import { placesIn } from "./places";

export interface NoveltyInput {
  text: string;
  structure: Record<string, string>;
  noveltyQueries: { database: string; query: string; count: number | null; error: string | null }[];
  noveltyMatches: { title: string }[];
  noveltyStatus: string;
}

export interface NoveltyVerdict {
  /** One sentence: what the check found. */
  headline: string;
  /** What the count means. */
  notes: string[];
  /** Per novelty match (same order): is its title close to the question? */
  close: boolean[];
  /** Titles of the review's own papers that are close to the question (the strongest sign of no gap), closest first. */
  own: string[];
  /** The closest titles of both kinds, closest first, at most NEAREST: the list a candidate is warned with. */
  nearest: Near[];
  /** How many different titles are close in all (`nearest` holds the closest of them). */
  nearCount: number;
}

export interface Near {
  title: string;
  /** One of the review's own papers. */
  own: boolean;
  /** Its index in `noveltyMatches` when it is (also) one of the top records, for its link. */
  match: number | null;
  /** closeness(), above 0 and at most 1. */
  score: number;
}

/** A count at or above this reads as "well studied": narrow the question before claiming a gap. */
export const MANY_RECORDS = 1000;
/** Below this, few records use the search words at all. */
export const FEW_RECORDS = 100;
/** A candidate is warned with at most this many close titles, the closest first. */
export const NEAREST = 3;

// Words that say nothing about what a question is about: question words, linking words, research boilerplate, and
// words nearly every health title carries ("intervention", "patients", "type 2", "6 months", "efficacy").
const STOP = new Set(
  ("a an and any are as at be been between by can compared comparison country do does during effect effects for from " +
    "has have how in into is it its of on or over than that the their these this those to under versus vs what when where " +
    "which who whom why with within without among after before about association associated relationship impact influence " +
    "role study studies research review outcome outcomes people person setting settings context sample less more " +
    "lower higher level levels help helps hinder hinders affect affects related less use used using other no not none " +
    "intervention interventions type program programme programs programmes based patient patients specific factor factors " +
    "include including month months week weeks year years day days efficacy effectiveness efficiency improve improves " +
    "improving improvement")
    .split(" "),
);

const GLYC = /\bhba1c\b|\ba1c\b|\bglyc(?:ated|osylated) hemoglobin\b/g;

/** Lower-case word stems: "Nursing nurses" → ["nurs", "nurs"]. Six letters at most, so endings rarely matter. */
export function stems(s: string): string[] {
  // "COVID-19" is "COVID"; other hyphens are dropped, so "Tele-rehabilitation" and "Telerehabilitation" give the
  // same stem; British "ae" reads as American "e" ("glycaemic"); HbA1c is the measure of glycaemic control;
  // "grade point average" is "GPA" and "application" is "app"; "controlled trial" names the design, not glycaemic
  // "control".
  return (s.toLowerCase().replace(/\b([a-z]+)-\d+\b/g, "$1").replace(/(\w)-(\w)/g, "$1$2").replace(/ae/g, "e").replace(GLYC, "glycemic").replace(/\bgrade point averages?\b/g, "gpa").replace(/\bapplications?\b/g, "app").replace(/\bcontrolled\b/g, "").match(/[a-z][a-z0-9]+/g) ?? [])
    .filter((w) => w.length >= 3 && !STOP.has(w))
    .map((w) => w.replace(/(ations|ation|ings|ing|ies|es|ed|s|e)$/, "").slice(0, 6))
    .filter((w) => w.length >= 3);
}

/** Study-design and age words a title may add without naming another outcome (as stems). */
const DESIGN = new Set(stems("randomised randomized controlled trial trials systematic meta analysis cohort cross sectional qualitative mixed methods scoping survey pilot prospective retrospective observational evidence older young elderly adult adults patients"));

interface Part { key: boolean; outcome: boolean; words: Set<string> }

/**
 * The parts of the question a matching study must share: the structure's elements (population, exposure,
 * outcome …) without the comparison and design, which titles rarely name. Elements with no content words drop out.
 */
function elements(q: Pick<NoveltyInput, "text" | "structure">): Part[] {
  return Object.entries(q.structure)
    .filter(([k]) => !/compar|design|research.?type/i.test(k))
    .map(([k, v]) => ({ key: /interven|expos|interest|phenomen/i.test(k), outcome: /outcome/i.test(k), words: new Set(stems(v)) }))
    .filter((p) => p.words.size);
}

/**
 * How close a title is to the question: 0 when it is not a near match, else above 0 and at most 1. A near match
 * must touch nearly every element (all but one, at least two), always including the intervention / exposure /
 * phenomenon, which is what makes a question new. An element is touched by more than half of its words, so generic
 * words do not stand for it: "adults" and "diabetes" are not "older adults with type 2 diabetes in Thailand", and
 * "mobile app" is not "mobile app features and usability for glycaemic tracking". A title set in another country
 * than the question's is not a near match. The score is the share of each element's words the title names,
 * averaged over the elements, plus a little for how much of the title is about the question, so the closest titles
 * can be listed first.
 */
export function closeness(q: Pick<NoveltyInput, "text" | "structure">, title: string): number {
  const words = new Set(stems(title));
  const ourText = [q.text, ...Object.values(q.structure)].join(" ");
  const ours = new Set([...stems(ourText), ...DESIGN]);
  // A study "in Indonesia" is not a near match for a question about Thai adults (see placesIn).
  const ourPlaces = placesIn(ourText);
  const theirPlaces = placesIn(title);
  if (ourPlaces.size && theirPlaces.size && ![...theirPlaces].some((x) => ourPlaces.has(x))) return 0;
  const onTopic = words.size ? [...words].filter((w) => ours.has(w)).length / words.size : 0;
  const parts = elements(q);
  if (parts.length) {
    const hits = (p: Part) => [...p.words].filter((w) => words.has(w)).length;
    // More than half of its words: 1 of 1, 2 of 2 or 3, 3 of 4 or 5, 4 of 6 or 7.
    const need = (p: Part) => Math.floor(p.words.size / 2) + 1;
    // The outcome named (all its words but one, at least two) lets the exposure be one word short: "sleep
    // deprivation, GPA and college graduation" asks "sleep duration and quality → cumulative GPA at graduation".
    const outcomeNamed = parts.some((p) => p.outcome && p.words.size >= 2 && hits(p) >= Math.max(2, p.words.size - 1));
    const touched = (p: Part) => hits(p) >= need(p) || (p.key && outcomeNamed && hits(p) >= Math.max(1, need(p) - 1));
    if (parts.some((p) => p.key && !touched(p))) return 0;
    // A title that leaves out the outcome may simply not name it ("Tele-rehabilitation for hip fracture in older
    // adults"), but one that names something else instead is about a different outcome ("… and periodontal disease").
    if (parts.some((p) => p.outcome && !hits(p)) && [...words].filter((w) => !ours.has(w)).length >= 2) return 0;
    if (parts.filter(touched).length < Math.min(parts.length, Math.max(2, parts.length - 1))) return 0;
    return 0.8 * (parts.reduce((a, p) => a + hits(p) / p.words.size, 0) / parts.length) + 0.2 * onTopic;
  }
  // No usable structure: at least half of the question's own content words, and at least two.
  const own = [...new Set(stems(q.text))];
  const hit = own.filter((w) => words.has(w)).length;
  return hit >= 2 && hit >= own.length / 2 ? 0.8 * (hit / own.length) + 0.2 * onTopic : 0;
}

/** Is this title close to the question (a near match to read before claiming a gap)? */
export function looksLikeSameQuestion(q: Pick<NoveltyInput, "text" | "structure">, title: string): boolean {
  return closeness(q, title) > 0;
}

/** "pubmed 2,207 and openalex 412". */
const perDb = (qs: NoveltyInput["noveltyQueries"]) => qs.filter((x) => !x.error && x.count != null).map((x) => `${x.database} ${fmtInt(x.count!)}`).join(" and ");

/** One title as the database and the review may spell it ("Sleep vs. grades." and "Sleep vs grades"). */
const titleKey = (t: string) => t.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** The plain verdict. `ownTitles`: the review's own papers, checked as well as the database's top records. */
export function noveltyVerdict(q: NoveltyInput, { ownTitles = [] }: { ownTitles?: string[] } = {}): NoveltyVerdict {
  const matchScore = q.noveltyMatches.map((m) => closeness(q, m.title));
  const close = matchScore.map((x) => x > 0);
  const ownScored = [...new Set(ownTitles)].map((title) => ({ title, score: closeness(q, title) })).filter((x) => x.score > 0).sort((a, b) => b.score - a.score);
  const own = ownScored.map((x) => x.title);
  // One list of the closest titles: a top record that is also one of the review's papers is listed once, as the
  // review's paper, with the record's link.
  const byKey = new Map<string, Near>(ownScored.map((x) => [titleKey(x.title), { title: x.title, own: true, match: null, score: x.score }]));
  q.noveltyMatches.forEach((m, i) => {
    if (!close[i]) return;
    const same = byKey.get(titleKey(m.title));
    if (same) same.match ??= i;
    else byKey.set(titleKey(m.title), { title: m.title, own: false, match: i, score: matchScore[i] });
  });
  const nearest = [...byKey.values()].sort((a, b) => b.score - a.score || Number(b.own) - Number(a.own)).slice(0, NEAREST);
  const near = { close, own, nearest, nearCount: byKey.size };
  const notes: string[] = [];
  if (q.noveltyStatus === "pending") return { headline: "Searching the databases…", notes, ...near };
  const ok = q.noveltyQueries.filter((x) => !x.error);
  if (!ok.length) return { headline: "The search failed, so this question could not be checked. Try Re-run.", notes, ...near };
  const most = Math.max(0, ...ok.map((x) => x.count ?? 0));
  const n = q.noveltyMatches.length;
  const k = close.filter(Boolean).length;
  let headline: string;
  if (own.length) headline = `${own.length === 1 ? "One of the papers in this review is close to your question" : `${own.length} papers in this review are close to your question, the closest`}: “${own[0].slice(0, 120)}”. Read ${own.length === 1 ? "it" : "them"} before you claim a gap.`;
  else if (k) headline = `${n === 1 ? "The top record is" : `${k} of the top ${n} records ${k === 1 ? "is" : "are"}`} close to your question: read ${k === 1 ? "it" : "them"} before you claim a gap.`;
  else if (n && most >= MANY_RECORDS) headline = `${n === 1 ? "The top record is not" : `None of the top ${n} records is`} close to your question, but ${fmtInt(most)} records use these words: read the closest ones before you claim a gap.`;
  else if (n) headline = `${n === 1 ? "The top record is not" : `None of the top ${n} records is`} close to your question. That suggests, but does not prove, that it is new.`;
  else if (most) headline = `${fmtInt(most)} records contain the search words, but none were returned to compare with your question. Look at them in the database before you claim a gap.`;
  else headline = "No records contain these search words. That does not prove the question is new: try other words for the same idea.";
  if (most) {
    notes.push(
      `Records that contain the search words: ${perDb(ok)}. This counts every record that mentions these topics, not studies that ask your question.`,
      most >= MANY_RECORDS
        ? "That many records means the area is well studied: narrow your question before you claim a gap."
        : most >= FEW_RECORDS
          ? "A busy area: check that your angle is different from the closest studies."
          : "Few records use these words, so the area is less studied, or other words are used for it.",
    );
  }
  return { headline, notes, ...near };
}
