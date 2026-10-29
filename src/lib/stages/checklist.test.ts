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

test("a quote given for several checklist answers backs none of them: all become not reported, with no quote", () => {
  const out = dropSharedQuotes(tripod);
  for (const it of out.slice(0, 3)) {
    assert.equal(it.answer, "not_reported", it.item);
    assert.equal(it.quote, "");
    assert.equal(it.location, "");
    assert.deepEqual(it.downgraded, { aiAnswer: "no", sharedWith: 3 });
  }
  // Same words after the check's normalisation (case, dash, spaces) count as the same quote.
  assert.equal(out[2].downgraded?.sharedWith, 3);
  // An answer with its own quote, and an answer with no quote, are untouched.
  assert.deepEqual(out[3], tripod[3]);
  assert.deepEqual(out[4], tripod[4]);
  assert.equal(out.length, tripod.length);
});

test("answers with different quotes are kept as the AI gave them", () => {
  const items = [
    { answer: "yes" as const, quote: "Data were analysed by intention to treat.", location: "Methods" },
    { answer: "yes" as const, quote: "The primary outcome was registered at ClinicalTrials.gov.", location: "Methods" },
  ];
  assert.deepEqual(dropSharedQuotes(items), items);
});

test("the note says what the AI said and why Athena changed it, in plain words", () => {
  assert.equal(downgradeNote({ aiAnswer: "no", sharedWith: 3 }), "The AI said “No”, but it used the same quote for 3 questions. One quote cannot answer several questions, so Athena shows “Not reported”.");
});
