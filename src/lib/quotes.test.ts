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
test("ellipsis parts are each verified, in the paper's order; swapped parts are not verified but the note says why", () => {
  const inOrder = verifyQuote(src, "A total of 1,204 patients ... Adoption was limited by connectivity");
  assert.equal(inOrder.verified, true);
  const swapped = verifyQuote(src, "Adoption was limited by connectivity ... A total of 1,204 patients");
  assert.equal(swapped.verified, false);
  assert.match(swapped.note, /different order/);
  assert.equal(verifyQuote(src, "Adoption was limited by bandwidth ... A total of 1,204 patients").verified, false);
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

import { joinedWithoutEllipsis, normalizeQuote, partsLabel, quoteParts } from "./quotes";
test("hyphens, spaces around = and %, and quote marks do not break a match", () => {
  const t = "In-depth interviews were conducted with 50 HCWs. The majority were female (n = 463, 93 %), and 'most' were nurses.";
  assert.equal(verifyQuote(t, "In depth interviews were conducted with 50 HCWs.").verified, true);
  // Word boundaries are kept: a hyphen counts as a space, never as nothing ("a symptomatic" ≠ "asymptomatic").
  assert.equal(verifyQuote(t, "Indepth interviews were conducted with 50 HCWs").verified, false);
  assert.equal(verifyQuote("Of these, 40 were a symptomatic carriers.", "40 were asymptomatic carriers").verified, false);
  assert.equal(verifyQuote("The patient's views were sought.", "the patients views were sought").verified, false);
  assert.equal(verifyQuote(t, "The majority were female (n=463, 93%), and “most” were nurses.").verified, true);
  assert.equal(normalizeQuote("In-depth"), normalizeQuote("in depth"));
  // changed numbers or words still fail
  assert.equal(verifyQuote(t, "The majority were female (n = 436, 93%)").verified, false);
  assert.equal(verifyQuote(t, "Structured interviews were conducted with 50 HCWs.").verified, false);
});

const paper =
  "ABSTRACT A total of 3754 and 8439 HCWs with and without comorbidities, respectively, were included. Among HCWs with comorbidities, work ability was lower. " +
  "METHODS The survey was online. Of 400 222 HCWs invited, 22 496 (5.6%) completed the questionnaire []. As reported elsewhere, sociodemographic data were collected. " +
  "RESULTS The majority were female (n = 463, 93%), over half were in the 36–55 year age category (n = 277, 59%) and 54% worked full time (n = 244).";

test("an ellipsis quote is verified only if every part is found, and stores each part's real span", () => {
  const q = "The majority were female (n = 463, 93%), over half were in the 36-55 year age category (n = 277, 59%). ... 54% worked full time (n = 244).";
  const r = verifyQuote(paper, q);
  assert.equal(r.verified, true);
  assert.equal(r.parts.length, 2);
  assert.match(r.note, /in two parts/);
  assert.doesNotMatch(r.note, /different order/);
  // Each part's span is a real passage of the text holding exactly that part, and the main span is the first part
  // (never the unquoted words between the parts).
  for (const [i, p] of quoteParts(q).entries()) {
    const span = paper.slice(r.parts[i].start, r.parts[i].end);
    assert.equal(normalizeQuote(span), normalizeQuote(p).replace(/^[.,;:!?]+|[.,;:]+$/g, ""));
  }
  assert.deepEqual([r.start, r.end], [r.parts[0].start, r.parts[0].end]);
  assert.ok(!paper.slice(r.start!, r.end!).includes("worked full time"));
});
test("ellipsis parts out of the paper's order are not verified: the note says each part is there, in another order", () => {
  const r = verifyQuote(paper, "Of 400 222 HCWs invited, 22 496 (5.6%) completed the questionnaire (). ... A total of 3754 and 8439 HCWs with and without comorbidities, respectively, were included.");
  assert.equal(r.verified, false);
  assert.match(r.note, /different order/);
  // A passage cannot be used twice: the same words repeated are not two passages.
  assert.equal(verifyQuote(paper, "Among HCWs with comorbidities, work ability was lower. ... Among HCWs with comorbidities, work ability was lower.").verified, false);
});
test("an ellipsis quote fails if any part is altered or too short", () => {
  const r = verifyQuote(paper, "The majority were female (n = 463, 93%) ... 64% worked full time (n = 244).");
  assert.equal(r.verified, false);
  assert.match(r.note, /Part 2 of 2 not found/);
  const scraps = verifyQuote(paper, "The majority were female ... worked full time");
  assert.equal(scraps.verified, false);
  assert.match(scraps.note, /at least 4 words/);
  assert.equal(verifyQuote(paper, "A total of 3754 and 8439 HCWs … which clearly proves the intervention works everywhere").verified, false);
});
test("a real opening followed by an overstatement still fails", () => {
  const q = "A total of 3754 and 8439 which clearly proves the intervention works everywhere";
  assert.equal(verifyQuote(paper, q).verified, false);
  assert.equal(joinedWithoutEllipsis(paper, q), null);
});
test("sentences joined without an ellipsis stay unverified, with a note that says why", () => {
  const q = "A total of 3754 and 8439 HCWs with and without comorbidities, respectively, were included. As reported elsewhere, sociodemographic data were collected.";
  assert.equal(verifyQuote(paper, q).verified, false);
  assert.match(joinedWithoutEllipsis(paper, q)!, /not next to each other/);
  const t = "Work ability was lower in all groups; Absence was higher in nurses.";
  const adjacent = "Work ability was lower in all groups. Absence was higher in nurses.";
  assert.equal(verifyQuote(t, adjacent).verified, false);
  assert.match(joinedWithoutEllipsis(t, adjacent)!, /only the punctuation between them differs/);
});
test("partsLabel counts parts like the check does", () => {
  assert.equal(partsLabel("A total of 3754 and 8439 HCWs"), "");
  assert.equal(partsLabel("one two three four ... five six seven eight"), ", in two parts");
  assert.equal(partsLabel("one two three four […] five six seven eight . . . nine ten eleven twelve"), ", in three parts");
});

import { plainNote } from "./quotes";
test("plainNote leads with one plain sentence and keeps the check's note as detail", () => {
  const paper = "RESULTS\nBlood pressure fell in the app group. Weight did not change. Adherence improved in the app group at six months.";
  // Built the way the appraisal job builds a note (the check's note, then the joined-without-ellipsis explanation).
  const q = "Blood pressure fell in the app group. Adherence improved in the app group at six months.";
  const joined = `${verifyQuote(paper, q).note} ${joinedWithoutEllipsis(paper, q)}`;
  const j = plainNote(joined);
  assert.equal(j.lead, "Both parts are in the paper, but not together.");
  assert.match(j.detail!, /^Each of its two sentences is in the paper word for word, but not next to each other/);
  assert.equal(plainNote("Quote not found in the retrieved source text. Each of its four sentences is in the paper word for word, but not next to each other: x").lead, "All four parts are in the paper, but not together.");
  // Nothing more to say than "not found": no detail to show.
  assert.deepEqual(plainNote(verifyQuote(paper, "Weight fell sharply in the control group").note), { lead: "These words are not in the paper.", detail: null });
  assert.equal(plainNote('Quote not found in the retrieved source text. Closest passage in the text (77% of words match): "…"').lead, "These words are not in the paper.");
  assert.equal(plainNote(verifyQuote(paper, "Adherence improved in the app group ... Blood pressure fell in the app group").note).lead, "All parts are in the paper, but in a different order.");
  assert.equal(plainNote(verifyQuote(paper, "Blood pressure fell in the app group ... Weight rose a great deal").note).lead, "One part of the quote is not in the paper.");
  // Notes written by an older check still get a plain sentence.
  assert.equal(plainNote('Fragment not found in source text: "abc" Closest passage in the text (60% of words match): "x"').lead, "One part of the quote is not in the paper.");
  assert.equal(plainNote('UNVERIFIED: Quote not found in the retrieved source text. Closest passage in the text (the same words, but not in this order or form): "x"').lead, "The same words are in the paper, but in a different order or form.");
  assert.equal(plainNote(null).lead, "These words are not in the paper.");
});
