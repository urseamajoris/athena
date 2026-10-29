import { test } from "node:test";
import assert from "node:assert/strict";
import { ideaSetting, meshText, settingFit, splitHeadings, yearsFromTimeframe } from "./scope";
import { blockTerms, withBlock } from "../sources/syntax";
import { queryBlocks } from "../canvas/query-chips";
import { applyRankingRules, defaultSelection, weightedTotal } from "../scoring";

// Real outputs from QA run 3 (the Thai diabetes-app idea): the scoping summary, a topic query that lost the
// country, and the scores of papers that were selected although set elsewhere or about something else.
const SUMMARY = { population: "diabetes patients", setting: "Thailand", phenomenon: "mobile app interventions", outcome: "blood sugar level control", timeframe: "last 5 years", studyTypes: "clinical trials and reviews" };
const PUBMED_ADHERENCE = '(("Diabetes Mellitus"[mh] OR diabetes[tiab] OR "blood glucose"[tiab] OR "glycemic control"[tiab]) AND ("Mobile Applications"[mh] OR "mobile app"[tiab] OR "mobile apps"[tiab] OR mhealth[tiab] OR "smartphone app"[tiab])) AND ("Patient Compliance"[mh] OR adherence[tiab] OR engagement[tiab] OR "self management"[tiab])';
const PUBMED_THAI = '(("Diabetes Mellitus"[mh] OR diabetes[tiab]) AND ("Mobile Applications"[mh] OR "mobile app"[tiab])) AND (Thailand[mh] OR Thailand[tiab] OR Thai[tiab] OR "Asia, Southeastern"[mh])';
const OPENALEX_ADHERENCE = '("diabetes" OR "blood glucose" OR "glycemic control") AND ("mobile app" OR "mobile apps" OR mhealth OR "smartphone app") AND (adherence OR engagement OR "self management")';

test("the idea's setting comes from the scoping summary, unless it names none", () => {
  assert.equal(ideaSetting(SUMMARY), "Thailand");
  assert.equal(ideaSetting({ setting: "not specified" }), null);
  assert.equal(ideaSetting({ setting: "Global" }), null);
  assert.equal(ideaSetting({ setting: "  " }), null);
  assert.equal(ideaSetting(null), null);
  assert.equal(ideaSetting({ setting: "primary care in rural Kenya" }), "primary care in rural Kenya");
});

test("'last 5 years' is counted from this year, not the AI's guess (run 3 got 2019)", () => {
  assert.deepEqual(yearsFromTimeframe("last 5 years", 2026), { yearFrom: 2021, yearTo: null });
  assert.deepEqual(yearsFromTimeframe("Past ten years", 2026), { yearFrom: 2016, yearTo: null });
  assert.deepEqual(yearsFromTimeframe("the last decade", 2026), { yearFrom: 2016, yearTo: null });
  assert.deepEqual(yearsFromTimeframe("since 2015", 2026), { yearFrom: 2015, yearTo: null });
  assert.deepEqual(yearsFromTimeframe("2010–2020", 2026), { yearFrom: 2010, yearTo: 2020 });
  assert.deepEqual(yearsFromTimeframe("2018 to present", 2026), { yearFrom: 2018, yearTo: null });
  assert.equal(yearsFromTimeframe("not specified", 2026), null);
  assert.equal(yearsFromTimeframe("recent", 2026), null);
  assert.equal(yearsFromTimeframe(undefined, 2026), null);
});

test("MeSH headings keep their commas: one per line or separated by semicolons", () => {
  assert.deepEqual(splitHeadings("Thailand\nAsia, Southeastern"), ["Thailand", "Asia, Southeastern"]);
  assert.deepEqual(splitHeadings("Thailand; Asia, Southeastern;"), ["Thailand", "Asia, Southeastern"]);
  assert.deepEqual(splitHeadings(meshText(["Thailand", "Asia, Southeastern"])), ["Thailand", "Asia, Southeastern"]);
  assert.deepEqual(splitHeadings("  \n "), []);
});

test("every search keeps the setting: a block is added only where the query lacks it", () => {
  const block = "(Thailand[mh] OR Thailand[tiab] OR Thai[tiab])";
  assert.deepEqual(blockTerms(block), ["thailand", "thai"]);
  const added = withBlock(PUBMED_ADHERENCE, block);
  assert.equal(added.added, true);
  assert.equal(added.query, `${PUBMED_ADHERENCE} AND ${block}`);
  assert.deepEqual(withBlock(PUBMED_THAI, block), { query: PUBMED_THAI, added: false });
  assert.equal(withBlock(OPENALEX_ADHERENCE, 'Thailand OR Thai OR "Southeast Asia"').query, `${OPENALEX_ADHERENCE} AND (Thailand OR Thai OR "Southeast Asia")`);
  // "(a) OR (b)" is not one group, so it is wrapped.
  assert.equal(withBlock("(x)", "(Thailand) OR (Thai)").query, "(x) AND ((Thailand) OR (Thai))");
});

test("PubMed's nested AND reads as the same groups as OpenAlex's flat one", () => {
  assert.equal(queryBlocks(PUBMED_ADHERENCE).length, 3);
  assert.equal(queryBlocks(OPENALEX_ADHERENCE).length, 3);
  assert.deepEqual(queryBlocks(PUBMED_ADHERENCE).map((b) => b.join), [null, "AND", "AND"]);
  // Groups whose meaning would change keep their brackets.
  assert.equal(queryBlocks("(a) NOT ((b) AND (c))").length, 2);
  assert.equal(queryBlocks("((a) OR (b)) AND (c)").length, 2);
  assert.equal(queryBlocks("((a) AND (b)) OR (c)").length, 1);
});

test("off-setting papers have their score halved and say why; word-only matches do not match the topic", () => {
  const formula = { recency: 5, citationImpact: 2 };
  // The Singapore app trial (run 3: settingMatch 1 → 64, selected).
  const sg = applyRankingRules({ topicFit: 3, topicFitWhy: "App programme.", designStrength: 5, settingMatch: 0, settingMatchWhy: "Singapore, not Thailand.", overall: "RCT in Singapore." }, formula, "Thailand");
  assert.equal(weightedTotal(sg.sub), 60);
  assert.equal(sg.total, 30);
  assert.match(sg.overall, /^RCT in Singapore\. Score halved \(60 to 30\) because it is set outside Thailand\.$/);
  assert.match(sg.settingMatchWhy, /Singapore, not Thailand\. \(Score halved: your idea is about Thailand\.\)/);
  const unreported = applyRankingRules({ topicFit: 5, topicFitWhy: "", designStrength: 5, settingMatch: 1, settingMatchWhy: "Not reported.", overall: "Meta-analysis." }, formula, "Thailand");
  assert.match(unreported.overall, /setting is not reported, so it may not be Thailand/);
  // No setting named: nothing is capped.
  const free = applyRankingRules({ topicFit: 5, topicFitWhy: "", designStrength: 5, settingMatch: 0, settingMatchWhy: "", overall: "x" }, formula, null);
  assert.equal(free.total, weightedTotal(free.sub));
  assert.equal(free.total, 74);
  // In the setting: unchanged.
  const thai = applyRankingRules({ topicFit: 5, topicFitWhy: "", designStrength: 4, settingMatch: 5, settingMatchWhy: "Thailand.", overall: "Thai RCT." }, formula, "Thailand");
  assert.equal(thai.total, weightedTotal(thai.sub));
  assert.equal(thai.overall, "Thai RCT.");
  // The mobile-clinic review (run 3: topic fit 5, score 82, selected): a van is not an app.
  const clinic = applyRankingRules({ topicFit: 5, topicFitWhy: "Mobile clinics (vans) for NCDs.", designStrength: 2, settingMatch: 5, settingMatchWhy: "Thailand.", overall: "Narrative review.", onlySharesWords: true }, formula, "Thailand");
  assert.equal(clinic.sub.topicFit, 1);
  assert.match(clinic.topicFitWhy, /^Different subject that only shares words with your idea/);
  assert.equal(defaultSelection([{ total: clinic.total, subScores: clinic.sub }]).length, 0);
});

test("setting fit for the ranking note: the AI's rating first, the paper's own setting words otherwise", () => {
  assert.equal(settingFit("Thailand", "hospital in southern Thailand", 5), "match");
  assert.equal(settingFit("Thailand", "Malaysia, China, Japan, Pakistan, Thailand, Indonesia", 3), "match");
  assert.equal(settingFit("Thailand", "Duke-NUS Medical School, Singapore", 1), "differs");
  assert.equal(settingFit("Thailand", "not reported", 0), "not_reported");
  assert.equal(settingFit("Thailand", "", undefined), "not_reported");
  assert.equal(settingFit("Thailand", "Ramathibodi hospital, Thailand", undefined), "match");
  assert.equal(settingFit("rural Kenya", "Nairobi, Kenya", undefined), "match");
  assert.equal(settingFit("Thailand", "Singapore", undefined), "differs");
});
