import { test } from "node:test";
import assert from "node:assert/strict";
import { downgradeNote, dropSharedQuotes } from "./checklist";

// Run 3 (TRIPOD trial, abstract only): one design sentence backed three different "No" answers.
const design = "The TRIal to slow the Progression Of Diabetes (TRIPOD) study was an open-label, parallel-group, randomised controlled trial.";
const tripod = [
  { item: "Random allocation method described", answer: "no" as const, quote: design, location: "Abstract" },
  { item: "Allocation concealment described", answer: "no" as const, quote: design, location: "Abstract" },
  { item: "Blinding of participants, staff or assessors", answer: "no" as const, quote: `  ${design.replace("open-label", "open label").toUpperCase()} `, location: "Abstract" },
  { item: "Groups similar at baseline", answer: "no" as const, quote: "The mean age in the intervention group was significantly different from the control group.", location: "Results" },
  { item: "Attrition / loss to follow-up reported", answer: "not_reported" as const, quote: "", location: "" },
];

test("a quote given for several checklist answers stays only with the question it is about", () => {
  const out = dropSharedQuotes(tripod);
  // "open-label" answers blinding; it says nothing about how allocation was randomised or concealed.
  for (const it of out.slice(0, 2)) {
    assert.equal(it.answer, "not_reported", it.item);
    assert.equal(it.quote, "");
    assert.equal(it.location, "");
    assert.deepEqual(it.downgraded, { aiAnswer: "no", sharedWith: 3 });
  }
  // Same words after the check's normalisation (case, dash, spaces) count as the same quote, and blinding keeps its "No".
  assert.deepEqual(out[2], tripod[2]);
  // An answer with its own quote, and an answer with no quote, are untouched.
  assert.deepEqual(out[3], tripod[3]);
  assert.deepEqual(out[4], tripod[4]);
  assert.equal(out.length, tripod.length);
});

// Real run 3, the same TRIPOD paper: one sentence backed "Yes" for intention-to-treat and for a registered outcome.
test("the TRIPOD intention-to-treat quote keeps its ITT answer and backs nothing else", () => {
  const itt = "Data were analysed using intention-to-treat analysis with change in HbA 1c at month 12 between DMP and UC as the primary outcome.";
  const out = dropSharedQuotes([
    { item: "Intention-to-treat analysis", answer: "yes" as const, quote: itt, location: "Abstract" },
    { item: "Primary outcome pre-specified or registered", answer: "yes" as const, quote: itt, location: "Abstract" },
  ]);
  assert.equal(out[0].answer, "yes");
  assert.equal(out[0].quote, itt);
  assert.equal(out[0].downgraded, undefined);
  assert.equal(out[1].answer, "not_reported");
  assert.deepEqual(out[1].downgraded, { aiAnswer: "yes", sharedWith: 2 });
});

test("a quote about none (or several) of its questions backs none of them", () => {
  // Real run 3: "extremely encouraging" is neither a source of data nor a limitation.
  const q = "Preliminary tests performed for daily life data gathering by both clinicians and users are extremely encouraging.";
  const none = dropSharedQuotes([
    { item: "Sources of data or evidence identified", answer: "yes" as const, quote: q, location: "Abstract" },
    { item: "Limitations acknowledged", answer: "no" as const, quote: q, location: "Abstract" },
  ]);
  assert.deepEqual(none.map((x) => [x.answer, x.downgraded?.aiAnswer]), [["not_reported", "yes"], ["not_reported", "no"]]);
  const both = "Participants were randomised using a computer-generated sequence and outcome assessors were blinded.";
  const several = dropSharedQuotes([
    { item: "Random allocation method described", answer: "yes" as const, quote: both, location: "Methods" },
    { item: "Blinding of participants, staff or assessors", answer: "yes" as const, quote: both, location: "Methods" },
  ]);
  assert.deepEqual(several.map((x) => x.answer), ["not_reported", "not_reported"]);
});

test("a 'not reported' answer that repeats a quote is left alone and does not count as sharing it", () => {
  const items = [
    { item: "Sample size justified", answer: "not_reported" as const, quote: "A total of 270 first-year students participated.", location: "Abstract" },
    { item: "Sampling frame and method described", answer: "no" as const, quote: "A total of 270 first-year students participated.", location: "Abstract" },
  ];
  assert.deepEqual(dropSharedQuotes(items), items);
});

test("answers with different quotes are kept as the AI gave them", () => {
  const items = [
    { item: "Intention-to-treat analysis", answer: "yes" as const, quote: "Data were analysed by intention to treat.", location: "Methods" },
    { item: "Primary outcome pre-specified or registered", answer: "yes" as const, quote: "The primary outcome was registered at ClinicalTrials.gov.", location: "Methods" },
  ];
  assert.deepEqual(dropSharedQuotes(items), items);
});

test("the note says what the AI said and why Athena changed it, in plain words", () => {
  assert.equal(downgradeNote({ aiAnswer: "no", sharedWith: 3 }), "The AI said “No”, but it used the same quote for 3 questions. One quote cannot answer several questions, so Athena shows “Not reported”.");
});
