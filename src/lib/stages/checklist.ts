import { normalizeQuote } from "../quotes";

type Answer = "yes" | "no" | "unclear" | "not_reported";

/** Why Athena changed the AI's checklist answer (kept on the stored item, so the panel and report can say so). */
export interface ChecklistDowngrade {
  aiAnswer: Answer;
  /** How many checklist answers the AI backed with this same quote. */
  sharedWith: number;
}

/**
 * One quote may back only one checklist answer. When the AI gives the same quote (after the quote check's own
 * normalisation) for several questions, it cannot be evidence for all of them, and there is no telling which one it
 * is about: in run 3 one "open-label, randomised" sentence backed "No" for random allocation, allocation concealment
 * and blinding. Every answer that shares a quote becomes "not reported" with no quote, and records what the AI said.
 * Answers with their own quote, and answers without a quote, are returned unchanged.
 */
export function dropSharedQuotes<T extends { answer: Answer; quote: string; location: string }>(items: T[]): (T & { downgraded?: ChecklistDowngrade })[] {
  const key = (q: string) => normalizeQuote(q).replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  const uses = new Map<string, number>();
  for (const it of items) {
    const k = key(it.quote);
    if (k) uses.set(k, (uses.get(k) ?? 0) + 1);
  }
  return items.map((it) => {
    const n = uses.get(key(it.quote)) ?? 0;
    if (n < 2) return it;
    return { ...it, answer: "not_reported", quote: "", location: "", downgraded: { aiAnswer: it.answer, sharedWith: n } };
  });
}

/** The panel's and report's one-line reason for a changed answer. */
export function downgradeNote(d: ChecklistDowngrade): string {
  const said = { yes: "Yes", no: "No", unclear: "Unclear", not_reported: "Not reported" }[d.aiAnswer];
  return `The AI said “${said}”, but it used the same quote for ${d.sharedWith} questions. One quote cannot answer several questions, so Athena shows “Not reported”.`;
}
