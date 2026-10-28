import { test } from "node:test";
import assert from "node:assert/strict";
import { verifyQuote, sectionAt } from "./quotes";

const src = `RESULTS\nA total of 1,204 patients—mostly rural—used the  service.\nAdoption was “limited by connectivity” in remote provinces.`;

test("exact quote verifies with offsets", () => {
  const r = verifyQuote(src, "A total of 1,204 patients");
  assert.equal(r.verified, true);
  assert.equal(src.slice(r.start!, r.end!), "A total of 1,204 patients");
});
test("whitespace, dash and curly-quote normalisation", () => {
  const r = verifyQuote(src, 'patients-mostly rural-used the service. Adoption was "limited by connectivity"');
  assert.equal(r.verified, true);
});
test("case-insensitive", () => assert.equal(verifyQuote(src, "ADOPTION WAS \"LIMITED BY CONNECTIVITY\"").verified, true));
test("fabricated quote fails", () => {
  const r = verifyQuote(src, "Adoption was high in all provinces");
  assert.equal(r.verified, false);
});
test("ellipsis fragments must appear in order", () => {
  assert.equal(verifyQuote(src, "A total of 1,204 patients ... limited by connectivity").verified, true);
  assert.equal(verifyQuote(src, "limited by connectivity ... A total of 1,204 patients").verified, false);
});
test("too-short quote rejected", () => assert.equal(verifyQuote(src, "used").verified, false));
test("sectionAt", () => {
  assert.equal(sectionAt([{ title: "Intro", start: 0 }, { title: "Methods", start: 50 }], 60), "Methods");
});

import { closestPassage } from "./quotes";
test("structured-abstract labels are skipped when matching", () => {
  const abs = "Prospective cohort study conducted in 2025. PARTICIPANTS: Fifty stable recipients at a hospital in Bangkok.";
  const r = verifyQuote(abs, "Prospective cohort study conducted in 2025. Fifty stable recipients at a hospital in Bangkok.");
  assert.equal(r.verified, true);
  assert.ok(abs.slice(r.start!, r.end!).includes("PARTICIPANTS:"));
});
test("a dropped word still fails, but the closest passage is suggested", () => {
  const t = "Of the 578 eligible individuals, 113 declined. We then utilised a stratified framework to purposively select 78 individuals.";
  const q = "we utilised a stratified framework to purposively select 78 individuals";
  assert.equal(verifyQuote(t, q).verified, false);
  const near = closestPassage(t, q)!;
  assert.ok(near.overlap > 0.8 && near.text.includes("purposively select 78"));
});
test("citation apparatus and PDF hyphenation are ignored symmetrically", () => {
  const src = "They declared it a crime if citizens withheld results []. On 1 October the government stopped testing [3-5].\nSee the 46 in-\ndepth interviews (Table 2). Data were analysed (Stanyon et al., 2021). Search ran to 20 May 2026 (original search to 31 May).";
  assert.equal(verifyQuote(src, "They declared it a crime if citizens withheld results. On 1 October the government stopped testing.").verified, true);
  assert.equal(verifyQuote(src, "See the 46 in-depth interviews.").verified, true);
  assert.equal(verifyQuote(src, "the 46 in-depth interviews. Data were analysed.").verified, true);
  assert.equal(verifyQuote(src, "Search ran to 20 May 2026.").verified, true);
  // genuine wording changes still fail
  assert.equal(verifyQuote(src, "They declared it illegal if citizens withheld results.").verified, false);
  assert.equal(verifyQuote(src, "See the 46 structured interviews.").verified, false);
});
