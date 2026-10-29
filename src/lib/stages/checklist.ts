import { normalizeQuote } from "../quotes";

type Answer = "yes" | "no" | "unclear" | "not_reported";

/** Why Athena changed the AI's checklist answer (kept on the stored item, so the panel and report can say so). */
export interface ChecklistDowngrade {
  aiAnswer: Answer;
  /** How many checklist answers the AI backed with this same quote. */
  sharedWith: number;
}

// What a checklist question asks about (matched in its wording), and the words a quote must use to be about it.
// A quote shared by several questions stays with the one question it names: "open-label" answers blinding, not
// random allocation or concealment; "intention to treat" answers the ITT question, not the registered outcome.
const TOPICS: [RegExp, RegExp][] = [
  [/intention.to.treat/i, /intention.to.treat|\bITT\b/i],
  [/blind/i, /blind|mask|open.label/i],
  [/conceal/i, /conceal|sealed|opaque|central(?:ly|ised|ized)? (?:randomi|allocat)/i],
  [/random allocation/i, /random (?:number|sequence|list)|computer.generated|block randomi|stratified randomi|permuted|minimi[sz]ation|lottery|coin|randomi[sz]ation (?:sequence|list|schedule)/i],
  [/registered|pre.?specified/i, /regist(?:ered|ry|ration)|pre.?specified|protocol|NCT\d|ISRCTN/i],
  [/sample size/i, /sample size|power (?:calculation|analysis)|powered/i],
  [/response rate/i, /response rate|responded|participation rate/i],
  [/attrition|follow.up/i, /follow.up|lost to|attrition|drop.?outs?|withdr[ae]w|retention/i],
  [/confounder/i, /confound|adjust|multivariable|multivariate|independently/i],
  [/precision/i, /\bCI\b|confidence interval|standard error|±/i],
  [/baseline/i, /baseline/i],
  [/ethic/i, /ethic|institutional review board|\bIRB\b|informed consent/i],
  [/limitation/i, /limitation|weakness/i],
  [/two or more reviewers/i, /two (?:independent )?reviewers|independently (?:screened|selected|reviewed)/i],
  [/publication bias|heterogeneity/i, /publication bias|heterogeneity|funnel|\bI2\b|I²/i],
  [/risk of bias/i, /risk of bias|quality assessment|appraisal tool|RoB|GRADE/i],
  [/reflexivity/i, /reflexiv/i],
];
/** Does this quote use the words of what this checklist question asks about? */
const about = (item: string, quote: string) => TOPICS.some(([q, words]) => q.test(item) && words.test(quote));

/**
 * One quote may back only one checklist answer. When the AI gives the same quote (after the quote check's own
 * normalisation) for several questions, it cannot be evidence for all of them: in run 3 one "open-label,
 * randomised" sentence backed "No" for random allocation, allocation concealment and blinding. The answer stays
 * for the one question the quote is about, by its words ("open-label": blinding); every other answer that shares
 * the quote becomes "not reported" with no quote, and records what the AI said. When the quote is about none of
 * them, or about several, all of them change. Answers with their own quote, answers without a quote and
 * "not reported" answers are returned unchanged (and do not count as sharing).
 */
export function dropSharedQuotes<T extends { item: string; answer: Answer; quote: string; location: string }>(items: T[]): (T & { downgraded?: ChecklistDowngrade })[] {
  const key = (q: string) => normalizeQuote(q).replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  const users = new Map<string, T[]>();
  for (const it of items) {
    const k = key(it.quote);
    if (k && it.answer !== "not_reported") users.set(k, [...(users.get(k) ?? []), it]);
  }
  return items.map((it) => {
    const shared = it.answer === "not_reported" ? [] : users.get(key(it.quote)) ?? [];
    if (shared.length < 2) return it;
    const owners = shared.filter((x) => about(x.item, x.quote));
    if (owners.length === 1 && owners[0] === it) return it;
    return { ...it, answer: "not_reported", quote: "", location: "", downgraded: { aiAnswer: it.answer, sharedWith: shared.length } };
  });
}

/** The panel's and report's one-line reason for a changed answer. */
export function downgradeNote(d: ChecklistDowngrade): string {
  const said = { yes: "Yes", no: "No", unclear: "Unclear", not_reported: "Not reported" }[d.aiAnswer];
  return `The AI said “${said}”, but it used the same quote for ${d.sharedWith} questions. One quote cannot answer several questions, so Athena shows “Not reported”.`;
}
