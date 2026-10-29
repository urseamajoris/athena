// Rules applied in code to every synthesis answer (unit-tested in synthesis-rules.test.ts). The model labels each
// statement's evidence as direct or indirect, and each disagreement as opposite effects or a difference in size or
// significance only; code then makes those labels true on the page:
// - indirect evidence (a mobile clinic or telemedicine for a question about apps, another population) says so at
//   the start of its statement, so it never reads as a plain "known" fact about the review's own intervention;
// - "one study significant, another not significant" is mixed evidence, not a disagreement: such a contested
//   statement moves to "known" as "Mixed results: …" and such a contradiction is dropped. The quotes are checked
//   too, so a mislabelled one is caught when its quotes report non-significance and none reports an opposite effect.
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

/** A statement's leading label, up to its colon ("Indirect evidence (from telemedicine, not apps):"), or "". */
const head = (s: string) => /^[^:]{0,100}:/.exec(s)?.[0] ?? "";

/** The statement with its labels in words: "Indirect evidence: …", "Mixed results: …" or "Indirect evidence, mixed results: …". */
export function labelled(statement: string, { indirect, mixed }: { indirect: boolean; mixed: boolean }): string {
  let s = statement.trim();
  if (mixed && !/\bmixed (?:results|evidence)\b/i.test(head(s))) s = `Mixed results: ${s}`;
  if (indirect && !/\bindirect evidence\b/i.test(head(s))) s = /^mixed (?:results|evidence)\b/i.test(s) ? s.replace(/^mixed/i, "Indirect evidence, mixed") : `Indirect evidence: ${s}`;
  return s;
}

/** The synthesis with the rules applied, and how many statements moved and contradictions were dropped. */
export function applyEvidenceRules(o: Synthesis, claims: Record<string, RuleClaim | undefined>): { data: Synthesis; mixed: number; dropped: number } {
  const texts = (ids: string[]) => ids.flatMap((id) => (claims[id] ? [claims[id]!.statement, claims[id]!.quote] : []));
  const notOpposite = (x: { disagreement: string; claimIds: string[] }, own: string) => x.disagreement !== "opposite_effects" || significanceOnly([own, ...texts(x.claimIds)]);
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
