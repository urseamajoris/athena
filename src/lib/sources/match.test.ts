import { test } from "node:test";
import assert from "node:assert/strict";
import { fullTextMatchesTitle, ownTitle } from "./match";

// The texts as jatsToText (Europe PMC) lays them out: a TITLE section, then ABSTRACT and the body.
const jats = (title: string, abstract: string) => `TITLE\n${title}\n\nABSTRACT\n${abstract}\n\nINTRODUCTION\nBody text.`;
const SEA = jats(
  "Telemedicine Guidelines in South East Asia—A Scoping Review",
  "Background: During the COVID-19 pandemic, telemedicine use grew across Singapore, Malaysia and Thailand, and community services moved online. We reviewed national guidelines.",
);

test("a full text with another paper's title is rejected, even when it shares the topic's words", () => {
  // QA iteration 3 (masters, clinician): this paper was appraised on the Southeast Asia guidelines review.
  assert.equal(fullTextMatchesTitle("Community nursing services during the COVID-19 pandemic: the Singapore experience", SEA), false);
  assert.equal(fullTextMatchesTitle("Patient satisfaction with telemedicine in the Philippines during the COVID-19 pandemic: a mixed methods study", SEA), false);
  assert.equal(fullTextMatchesTitle("Telehealth interventions after stroke: a systematic review and meta-analysis", SEA), false);
});

test("the paper's own full text is accepted despite punctuation, case, accents and subtitles", () => {
  assert.equal(fullTextMatchesTitle("Telemedicine guidelines in South East Asia: a scoping review.", SEA), true);
  assert.equal(fullTextMatchesTitle("Telemedicine Guidelines in South East Asia-A Scoping Review", SEA), true);
  // The record adds a subtitle the text's title does not have, and the other way round.
  const short = jats("Challenges to the emergence of telerehabilitation in a developing country", "…");
  assert.equal(fullTextMatchesTitle("Challenges to the Emergence of Telerehabilitation in a Developing Country: A Systematic Review", short), true);
  assert.equal(fullTextMatchesTitle("Digital health divide in Indonesia", jats("Digital health divide in Indonesia: evidence from national-level data", "…")), true);
  assert.equal(fullTextMatchesTitle("Évaluation de la télémédecine au Québec", jats("Evaluation de la telemedecine au Quebec", "…")), true);
});

test("a PDF text without a TITLE section is judged on its opening, where the title is printed", () => {
  const pdf = "BMC Health Services Research (2021) 21:112\nRESEARCH Open Access\nMobile health clinics and tele-\nhealth outreach in Thailand: a focus on\nelderly care and NCDs\nSomchai P, Lee K\nAbstract Background …";
  assert.equal(fullTextMatchesTitle("Mobile Health Clinics and Telehealth Outreach in Thailand: A Focus on Elderly Care and NCDs", pdf), true);
  assert.equal(fullTextMatchesTitle("Community nursing services during the COVID-19 pandemic: the Singapore experience", pdf), false);
  // The title only after the first 3,000 characters is not trusted.
  assert.equal(fullTextMatchesTitle("Mobile Health Clinics and Telehealth Outreach in Thailand: A Focus on Elderly Care and NCDs", `${"x ".repeat(1600)}${pdf}`), false);
});

test("titles too short to judge are not rejected", () => {
  assert.equal(fullTextMatchesTitle("Telemedicine", SEA), true);
  assert.equal(fullTextMatchesTitle("Editorial", SEA), true);
});

test("the text's own title is read from its TITLE section", () => {
  assert.equal(ownTitle(SEA), "Telemedicine Guidelines in South East Asia—A Scoping Review");
  assert.equal(ownTitle("Page one text without sections"), null);
});

test("titles that share only a place and a study design are not the same paper", () => {
  for (const t of ["Telehealth in South East Asia: a scoping review", "Teledentistry in South East Asia: A Scoping Review", "Mental health apps in South East Asia: a scoping review"]) {
    assert.equal(fullTextMatchesTitle(t, SEA), false, t);
  }
});
