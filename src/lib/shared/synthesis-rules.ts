// Rules applied in code to every synthesis answer (unit-tested in synthesis-rules.test.ts). The model labels each
// statement's evidence as direct or indirect, and each disagreement as opposite effects or a difference in size or
// significance only; code then makes those labels true on the page:
// - indirect evidence (a mobile clinic or telemedicine for a question about apps, another population) says so at
//   the start of its statement, so it never reads as a plain "known" fact about the review's own intervention;
// - "one study significant, another not significant" is mixed evidence, not a disagreement: such a contested
//   statement moves to "known" as "Mixed results: …" and such a contradiction is dropped. A mislabelled one is caught
//   from its own words ("… did not reach statistical significance"); its quotes count only when its own words are
//   about significance, so a non-significant side result in a quote never overrules "opposite effects".
import type { Synthesis } from "../stages/ai-schemas";

export interface RuleClaim { statement: string; quote: string }

// "no significant difference", "not statistically significant", "non-significant", "did not reach significance",
// "p = 0.13", "p > 0.05".
const NOT_SIGNIFICANT = /\b(?:not|no|without)\s+(?:a\s+)?(?:statistically\s+)?significan|\bnon-?\s?significan|\binsignifican|\b(?:did not|failed to) reach (?:statistical )?significance|\bp\s*(?:=|>)\s*0?\.(?:0[5-9]|[1-9])/i;
// Words that report an effect in the other direction: worse, harm, reversal, a rise in HbA1c or glucose, a fall in
// adherence or quality of life.
const OPPOSITE = /\b(?:wors(?:e|ened|ening)|harm(?:s|ed|ful)?|opposite|revers(?:e|ed|al)|deteriorat\w*|adverse effects?|negative effects?|increas\w* (?:in )?(?:hba1c|glucose|blood (?:sugar|glucose|pressure))|(?:hba1c|glucose) (?:rose|increased)|(?:reduced|lower|decreased|poorer|declin\w*) (?:in )?(?:adherence|engagement|quality of life|self-management))\b/i;

/** Do these texts describe a difference in significance only (a non-significant result, and no opposite effect)? */
export function significanceOnly(texts: string[]): boolean {
  return texts.some((t) => NOT_SIGNIFICANT.test(t)) && !texts.some((t) => OPPOSITE.test(t));
}

/** The labels a statement starts with, however many and in whatever order: "Mixed results: Indirect evidence (from SMS): ". */
const LABELS = /^(?:(?:mixed (?:results|evidence)|indirect evidence)(?: \([^)]*\))?\s*(?::|,(?=\s*(?:mixed|indirect)))\s*)+/i;

/** The statement with its labels in words, once: "Indirect evidence: …", "Mixed results: …" or "Indirect evidence, mixed results: …". */
export function labelled(statement: string, { indirect, mixed }: { indirect: boolean; mixed: boolean }): string {
  const s = statement.trim();
  if (!indirect && !mixed) return s;
  const head = LABELS.exec(s)?.[0] ?? "";
  // The model's own qualifier is kept: "Indirect evidence (from telemedicine, not apps)".
  const from = /indirect evidence( \([^)]*\))/i.exec(head)?.[1] ?? "";
  const ind = indirect || /indirect evidence/i.test(head);
  const mix = mixed || /mixed (?:results|evidence)/i.test(head);
  const label = ind && mix ? `Indirect evidence${from}, mixed results` : ind ? `Indirect evidence${from}` : "Mixed results";
  return `${label}: ${s.slice(head.length)}`;
}

/** The synthesis with the rules applied, and how many statements moved and contradictions were dropped. */
export function applyEvidenceRules(o: Synthesis, claims: Record<string, RuleClaim | undefined>): { data: Synthesis; mixed: number; dropped: number } {
  const texts = (ids: string[]) => ids.flatMap((id) => (claims[id] ? [claims[id]!.statement, claims[id]!.quote] : []));
  // The item's own words decide; its quotes are read only when those words are about significance.
  const notOpposite = (x: { disagreement: string; claimIds: string[] }, own: string) =>
    x.disagreement !== "opposite_effects" || significanceOnly([own]) || (/significan/i.test(own) && significanceOnly([own, ...texts(x.claimIds)]));
  const contradictions = o.contradictions.filter((c) => !notOpposite(c, c.description));
  const moved = o.contested.filter((c) => notOpposite(c, c.statement));
  const fix = <T extends { statement: string; evidence: string }>(s: T, mixed = false): T => ({ ...s, statement: labelled(s.statement, { indirect: s.evidence === "indirect", mixed }) });
  return {
    data: {
      ...o,
      contradictions,
      known: [...o.known.map((s) => fix(s)), ...moved.map((s) => fix({ statement: s.statement, claimIds: s.claimIds, evidence: s.evidence }, true))],
      contested: o.contested.filter((c) => !moved.includes(c)).map((s) => fix(s)),
      unknown: o.unknown.map((s) => fix(s)),
    },
    mixed: moved.length,
    dropped: o.contradictions.length - contradictions.length,
  };
}
