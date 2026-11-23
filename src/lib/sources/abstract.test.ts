import { test } from "node:test";
import assert from "node:assert/strict";
import { isBoilerplateSentence, usableAbstract } from "./abstract";

const REAL =
  "BACKGROUND: Long COVID may limit healthcare workers' return to work.\nMETHODS: We surveyed 471 healthcare workers in Scotland and interviewed 50 of them.\nRESULTS: Most had reduced hours; 54% worked full time (n = 244).\nCONCLUSIONS: Phased return and workplace adjustments helped staff stay in work.";

test("a data-availability statement stored as the abstract is not an abstract (real OpenAlex record)", () => {
  const das =
    "The data that support the findings of this study are available from the corresponding author upon reasonable request. The data underlying this article cannot be shared publicly due to ethical restrictions and participant confidentiality concerns, but deidentified data are available from Dr. Mizoue (Department of Epidemiology and Prevention, Center for Clinical Sciences, National Center for Global Health and Medicine, Tokyo, Japan) to qualified researchers on reasonable request. Please note: The publisher is not responsible for the content or functionality of any supporting information supplied by the authors. Any queries (other than missing content) should be directed to the corresponding author for the article.";
  assert.equal(usableAbstract(das), null);
  assert.equal(usableAbstract("Data supporting the findings are available from the corresponding author upon reasonable request."), null);
});

test("funding, conflict-of-interest and copyright notes alone are not abstracts", () => {
  assert.equal(usableAbstract("This work was supported by the National Institute for Health Research (grant NIHR123456). The funders had no role in study design, data collection or analysis."), null);
  assert.equal(usableAbstract("Conflict of interest: The authors declare that they have no conflicts of interest relevant to this article."), null);
  assert.equal(usableAbstract("© 2024 The Authors. Published by Elsevier Ltd. This is an open access article under the CC BY license."), null);
});

test("missing or too-short text is not an abstract", () => {
  assert.equal(usableAbstract(null), null);
  assert.equal(usableAbstract("   "), null);
  assert.equal(usableAbstract("Abstract not available."), null);
  assert.equal(usableAbstract("Long COVID in nurses: a commentary."), null);
});

test("a real abstract is kept as it is, line breaks and labels included", () => {
  assert.equal(usableAbstract(REAL), REAL);
  // a short but real standfirst is still an abstract
  const standfirst = "NHS workers with long covid should be given adequate sick pay and the support to work if they can";
  assert.equal(usableAbstract(standfirst), standfirst);
});

test("boilerplate is cut from the end of a real abstract, but not from the middle", () => {
  assert.equal(usableAbstract(`${REAL}\nFUNDING: Ministry of Health, Singapore.`), REAL);
  assert.equal(usableAbstract(`${REAL} Copyright © 2024 Elsevier Inc. All rights reserved.`), REAL);
  assert.equal(usableAbstract(`${REAL} (PsycInfo Database Record (c) 2021 APA, all rights reserved).`), REAL);
  const middle = "We followed 2,000 nurses for two years after infection. This study was funded by the Ministry of Health. Return to work was slower in those with fatigue.";
  assert.equal(usableAbstract(middle), middle);
  const methodsFirst = "Data were obtained from the national registry on request of the ministry. We followed 2,000 nurses for two years after infection. Return to work was slower in those with fatigue.";
  assert.equal(usableAbstract(methodsFirst), methodsFirst);
});

test("ordinary study sentences are not mistaken for boilerplate", () => {
  for (const s of [
    "Guidelines published by WHO in 2020 recommend phased return to work.",
    "Conflicts between managers and staff were a recurring theme.",
    "The study was conducted in three hospitals in Tokyo.",
    "Data were collected through an online survey of 471 healthcare workers.",
    "Sick leave data were available for 92% of participants.",
  ]) assert.equal(isBoilerplateSentence(s), false, s);
});

test("a copyright line right after the conclusion is cut without the conclusion", () => {
  const a = "Background: Burnout is common in ICU nurses. Methods: A randomised trial of 120 nurses. Results: Burnout fell by 30%. Conclusions: Mindfulness training reduced burnout scores substantially at six months. © 2021 Elsevier Ltd. All rights reserved.";
  const out = usableAbstract(a)!;
  assert.match(out, /reduced burnout scores substantially at six months\.$/);
});
