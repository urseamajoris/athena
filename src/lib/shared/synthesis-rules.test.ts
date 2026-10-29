import { test } from "node:test";
import assert from "node:assert/strict";
import type { Synthesis } from "../stages/ai-schemas";
import { applyEvidenceRules, labelled, significanceOnly } from "./synthesis-rules";

// Real run 3 (Thai diabetes apps): the three quotes behind the "Contested" statement and the contradiction.
const claims = {
  c_family: { statement: "Intervention group had greater HbA1c decline relative to control (-0.97% vs. -0.12%; P=0.001).", quote: "The intervention group showed greater decline in HbA 1c levels relative to the control group (- 0.97% vs. - 0.12%; P = 0.001)." },
  c_mhdsmp: { statement: "HbA1C decreased from 7.80 to 7.17% (p < 0.001) in MHDSMP group but showed no significant change in TF or UC groups.", quote: "The findings revealed that at the end-of-study, HbA1C decreased from 7.80 to 7.17% (p < 0.001) in MHDSMP group, from 7.72 to 7.65% (p = 0.468) in TF group, and from 7.89 to 7.72% (p = 0.074) in UC group." },
  c_sun570: { statement: "Greater HbA1c reduction in intervention but no significant difference versus control (p=0.13)", quote: "While a greater reduction of HbA1c was observed in the intervention group, no significant difference was found between groups (p=0.13)." },
  c_outreach: { statement: "Mobile outreach programs uncovered many untreated NCD cases, with 58% of hypertensive and 75% of diabetic elderly first diagnosed via mobile units.", quote: "Past mobile outreach programs have uncovered many untreated cases—in one survey, 58% of hypertensive and 75% of diabetic elderly were first diagnosed via a mobile unit." },
  c_worse: { statement: "HbA1c increased in the app group at 12 months.", quote: "HbA1c increased in the app group (+0.4%) compared with usual care." },
};
const three = ["c_family", "c_mhdsmp", "c_sun570"];

const base = (over: Partial<Synthesis> = {}): Synthesis => ({
  themes: ["Glycaemic control", "Screening"],
  matrix: [{ paperId: "p_1", theme: "Glycaemic control", value: "HbA1c fell", stance: "supports", claimIds: ["c_family"] }],
  contradictions: [],
  known: [],
  contested: [],
  unknown: [],
  ...over,
});

test("significance alone is not a disagreement; an opposite effect is", () => {
  assert.equal(significanceOnly(three.flatMap((id) => [claims[id as keyof typeof claims].statement, claims[id as keyof typeof claims].quote])), true);
  assert.equal(significanceOnly(["App reduced HbA1c (p<0.001).", "HbA1c increased in the app group, not statistically significant."]), false);
  assert.equal(significanceOnly(["App reduced HbA1c (p<0.001).", "App reduced HbA1c (p=0.002)."]), false);
  assert.equal(significanceOnly(["The difference did not reach statistical significance."]), true);
});

test("run 3: the 'contested' HbA1c statement becomes mixed results, and its contradiction is dropped", () => {
  const out = applyEvidenceRules(
    base({
      contested: [{ statement: "Whether mobile diabetes apps produce statistically significant HbA1c reductions compared with control conditions in all Thai adult populations is inconsistent across trials.", claimIds: three, evidence: "direct", disagreement: "opposite_effects" }],
      contradictions: [{ theme: "Impact of mobile apps on glycemic control", description: "Two RCTs found statistically significant HbA1c improvements with mobile-app interventions versus controls in Thai type 2 diabetes patients, but a third RCT reported a greater reduction that did not reach statistical significance between groups.", claimIds: three, disagreement: "opposite_effects" }],
    }),
    claims,
  );
  assert.equal(out.data.contested.length, 0);
  assert.equal(out.data.contradictions.length, 0);
  assert.equal(out.mixed, 1);
  assert.equal(out.dropped, 1);
  assert.equal(out.data.known.length, 1);
  assert.match(out.data.known[0].statement, /^Mixed results: Whether mobile diabetes apps/);
  assert.deepEqual(out.data.known[0].claimIds, three);
});

test("the model's own label moves a disagreement too, and a real one stays", () => {
  const out = applyEvidenceRules(
    base({
      contested: [
        { statement: "Mixed results: two trials found a significant fall in HbA1c, one a smaller fall.", claimIds: ["c_family", "c_sun570"], evidence: "direct", disagreement: "size_or_significance_only" },
        { statement: "Trials disagree on whether apps lower HbA1c: one found a fall, another a rise.", claimIds: ["c_family", "c_worse"], evidence: "direct", disagreement: "opposite_effects" },
      ],
      contradictions: [
        { theme: "HbA1c", description: "One trial found a fall in HbA1c and another a rise.", claimIds: ["c_family", "c_worse"], disagreement: "opposite_effects" },
        { theme: "HbA1c", description: "Effect sizes differ.", claimIds: ["c_family", "c_mhdsmp"], disagreement: "size_or_significance_only" },
      ],
    }),
    claims,
  );
  assert.deepEqual(out.data.contested.map((c) => c.claimIds), [["c_family", "c_worse"]]);
  assert.deepEqual(out.data.contradictions.map((c) => c.description), ["One trial found a fall in HbA1c and another a rise."]);
  // Already worded as mixed results: not labelled twice.
  assert.equal(out.data.known[0].statement, "Mixed results: two trials found a significant fall in HbA1c, one a smaller fall.");
});

test("run 3: indirect evidence (a mobile clinic for an app question) says so in its wording", () => {
  const out = applyEvidenceRules(
    base({
      known: [
        { statement: "Mobile outreach clinics in Thailand have identified many previously undiagnosed diabetes cases among older adults.", claimIds: ["c_outreach"], evidence: "indirect" },
        { statement: "Indirect evidence (from mobile outreach clinics, not apps): such clinics found many undiagnosed cases.", claimIds: ["c_outreach"], evidence: "indirect" },
        { statement: "Two randomised trials found that app-based programmes lowered HbA1c more than usual care.", claimIds: ["c_family", "c_mhdsmp"], evidence: "direct" },
      ],
      unknown: [{ statement: "It is unclear whether older Thai adults accept diabetes apps.", claimIds: ["c_outreach"], evidence: "indirect" }],
    }),
    claims,
  );
  assert.deepEqual(out.data.known.map((k) => k.statement), [
    "Indirect evidence: Mobile outreach clinics in Thailand have identified many previously undiagnosed diabetes cases among older adults.",
    "Indirect evidence (from mobile outreach clinics, not apps): such clinics found many undiagnosed cases.",
    "Two randomised trials found that app-based programmes lowered HbA1c more than usual care.",
  ]);
  assert.match(out.data.unknown[0].statement, /^Indirect evidence: It is unclear/);
  assert.equal(out.mixed + out.dropped, 0);
});

test("labels combine without repeating", () => {
  assert.equal(labelled("Apps lowered HbA1c in one trial and not significantly in another.", { indirect: true, mixed: true }), "Indirect evidence, mixed results: Apps lowered HbA1c in one trial and not significantly in another.");
  assert.equal(labelled("Mixed results: a and b.", { indirect: true, mixed: true }), "Indirect evidence, mixed results: a and b.");
  assert.equal(labelled("Indirect evidence, mixed results: a and b.", { indirect: true, mixed: true }), "Indirect evidence, mixed results: a and b.");
  assert.equal(labelled("  Plain.  ", { indirect: false, mixed: false }), "Plain.");
});

// Review of run 3: a non-significant side result in one quote overruled the model's "opposite effects".
test("a quote's non-significant side result does not overrule an opposite effect the item describes", () => {
  const side = { c_side: { statement: "Mean HbA1c was 0.3% higher in the app group at 12 months; body weight showed no significant difference.", quote: "Mean HbA1c was 0.3% higher in the app group at 12 months, while body weight showed no significant difference between groups." } };
  const out = applyEvidenceRules(
    base({
      contradictions: [{ theme: "HbA1c", description: "One trial found HbA1c fell with the app; another found it was higher in the app group.", claimIds: ["c_family", "c_side"], disagreement: "opposite_effects" }],
      contested: [{ statement: "Trials disagree on the direction of the app's effect on HbA1c.", claimIds: ["c_family", "c_side"], evidence: "direct", disagreement: "opposite_effects" }],
    }),
    { ...claims, ...side },
  );
  assert.equal(out.data.contradictions.length, 1);
  assert.equal(out.data.contested.length, 1);
  assert.equal(out.mixed + out.dropped, 0);
});

test("both real significance-only contradictions are still caught from their own words", () => {
  const out = applyEvidenceRules(
    base({
      contradictions: [
        // Run 3 (Thai diabetes apps) and run 2 (sleep and grades), as stored; no quotes needed.
        { theme: "Impact of mobile apps on glycemic control", description: "Two RCTs found statistically significant HbA1c improvements with mobile-app interventions versus controls in Thai type 2 diabetes patients, but a third RCT reported a greater reduction that did not reach statistical significance between groups.", claimIds: [], disagreement: "opposite_effects" },
        { theme: "Sleep quality", description: "Subjective sleep quality showed a significant positive association with exam performance in medical students but no significant association in university students assessed via PSQI.", claimIds: [], disagreement: "opposite_effects" },
      ],
    }),
    claims,
  );
  assert.equal(out.data.contradictions.length, 0);
  assert.equal(out.dropped, 2);
});

test("a statement that already carries labels gets one canonical prefix, its qualifier kept", () => {
  assert.equal(labelled("Indirect evidence (from SMS): reminders improved adherence.", { indirect: true, mixed: true }), "Indirect evidence (from SMS), mixed results: reminders improved adherence.");
  assert.equal(labelled("Mixed results: Indirect evidence (from SMS): reminders improved adherence.", { indirect: true, mixed: true }), "Indirect evidence (from SMS), mixed results: reminders improved adherence.");
  assert.equal(labelled("Indirect evidence (from SMS): reminders improved adherence.", { indirect: false, mixed: true }), "Indirect evidence (from SMS), mixed results: reminders improved adherence.");
});
