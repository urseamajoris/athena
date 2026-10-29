// The novelty check's verdict in plain words, shared by step 9 and the exported report (unit-tested in
// novelty.test.ts). Two different things are kept apart: how many records contain the search words (the
// database count) and whether any of the top records looks like the same question (judged from its title).
import { fmtInt } from "./format";

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
  /** What the count means, and the demo note. */
  notes: string[];
  /** Per novelty match (same order): does its title look like the same question? */
  close: boolean[];
}

/** A count at or above this reads as "well studied": narrow the question before claiming a gap. */
export const MANY_RECORDS = 1000;
/** Below this, few records use the search words at all. */
export const FEW_RECORDS = 100;

// Words that say nothing about what a question is about: question words, linking words and research boilerplate.
const STOP = new Set(
  ("a an and any are as at be been between by can compared comparison country do does during effect effects for from " +
    "has have how in into is it its of on or over than that the their these this those to under versus vs what when where " +
    "which who whom why with within without among after before about association associated relationship impact influence " +
    "role study studies research review outcome outcomes people person setting settings context mock sample less more " +
    "lower higher level levels help helps hinder hinders affect affects related less use used using other no not none")
    .split(" "),
);

/** Lower-case word stems: "Nursing nurses" → ["nurs", "nurs"]. Six letters at most, so endings rarely matter. */
export function stems(s: string): string[] {
  // Hyphens are dropped first, so "Tele-rehabilitation" and "Telerehabilitation" give the same stem.
  return (s.toLowerCase().replace(/\(mock\)/g, " ").replace(/(\w)-(\w)/g, "$1$2").match(/[a-z][a-z0-9]+/g) ?? [])
    .filter((w) => w.length >= 3 && !STOP.has(w))
    .map((w) => w.replace(/(ations|ation|ings|ing|ies|es|ed|s|e)$/, "").slice(0, 6))
    .filter((w) => w.length >= 3);
}

/**
 * The parts of the question a matching study must share: the structure's elements (population, exposure,
 * outcome …) without the comparison and design, which titles rarely name. Elements with no content words drop out.
 */
function elements(q: Pick<NoveltyInput, "text" | "structure">): { key: boolean; words: Set<string> }[] {
  return Object.entries(q.structure)
    .filter(([k]) => !/compar|design|research.?type/i.test(k))
    .map(([k, v]) => ({ key: /interven|expos|interest|phenomen/i.test(k), words: new Set(stems(v)) }))
    .filter((p) => p.words.size);
}

/**
 * Does this title look like the same question? It must touch nearly every element (all but one, at least two),
 * always including the intervention / exposure / phenomenon, which is what makes a question new. An element is
 * touched by two of its words (one if it has only one), so a generic word like "adults" alone does not count.
 */
export function looksLikeSameQuestion(q: Pick<NoveltyInput, "text" | "structure">, title: string): boolean {
  const words = new Set(stems(title));
  const parts = elements(q);
  if (parts.length) {
    const touched = (p: { words: Set<string> }) => [...p.words].filter((w) => words.has(w)).length >= Math.min(2, p.words.size);
    if (parts.some((p) => p.key && !touched(p))) return false;
    const hit = parts.filter(touched).length;
    return hit >= Math.min(parts.length, Math.max(2, parts.length - 1));
  }
  // No usable structure: at least half of the question's own content words, and at least two.
  const own = [...new Set(stems(q.text))];
  const hit = own.filter((w) => words.has(w)).length;
  return hit >= 2 && hit >= own.length / 2;
}

/** "pubmed 2,207 and openalex 412". */
const perDb = (qs: NoveltyInput["noveltyQueries"]) => qs.filter((x) => !x.error && x.count != null).map((x) => `${x.database} ${fmtInt(x.count!)}`).join(" and ");

/**
 * The plain verdict. `demo`: the databases returned recorded sample records (not results for this question),
 * so the counts and titles say nothing about it.
 */
export function noveltyVerdict(q: NoveltyInput, { demo = false }: { demo?: boolean } = {}): NoveltyVerdict {
  const close = q.noveltyMatches.map((m) => looksLikeSameQuestion(q, m.title));
  const notes: string[] = demo ? ["Demo mode: these counts and records are recorded samples, not a search for your question."] : [];
  if (q.noveltyStatus === "pending") return { headline: "Searching the databases…", notes, close };
  const ok = q.noveltyQueries.filter((x) => !x.error);
  if (!ok.length) return { headline: "The search failed, so this question could not be checked. Try Re-run.", notes, close };
  const most = Math.max(0, ...ok.map((x) => x.count ?? 0));
  const n = q.noveltyMatches.length;
  const k = close.filter(Boolean).length;
  let headline: string;
  if (demo) headline = "Demo mode: these are recorded sample records, so they say nothing about whether your question is new. Real searches run in real mode.";
  else if (k) headline = `${n === 1 ? "The top record looks" : `${k} of the top ${n} records look${k === 1 ? "s" : ""}`} like the same question: read ${k === 1 ? "it" : "them"} before you claim a gap.`;
  else if (n && most >= MANY_RECORDS) headline = `${n === 1 ? "The top record does not look" : `None of the top ${n} records looks`} like the same question, but ${fmtInt(most)} records use these words: read the closest ones before you claim a gap.`;
  else if (n) headline = `${n === 1 ? "The top record does not look" : `None of the top ${n} records looks`} like the same question. That suggests, but does not prove, that it is new.`;
  else if (most) headline = `${fmtInt(most)} records contain the search words, but none were returned to compare with your question. Look at them in the database before you claim a gap.`;
  else headline = "No records contain these search words. That does not prove the question is new: try other words for the same idea.";
  if (most && !demo) {
    notes.push(
      `Records that contain the search words: ${perDb(ok)}. This counts every record that mentions these topics, not studies that ask your question.`,
      most >= MANY_RECORDS
        ? "That many records means the area is well studied: narrow your question before you claim a gap."
        : most >= FEW_RECORDS
          ? "A busy area: check that your angle is different from the closest studies."
          : "Few records use these words, so the area is less studied, or other words are used for it.",
    );
  }
  return { headline, notes, close };
}
