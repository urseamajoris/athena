import { test } from "node:test";
import assert from "node:assert/strict";
import { ideaSetting, meshText, mentionsSetting, placeLike, rankedSetting, settingFit, settingTerms, splitHeadings, yearsFromTimeframe } from "./scope";
import { blockTerms, termsBlock, withBlock } from "../sources/syntax";
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

// Review of run 3: answers that mean "no limit" were taken as a place, and every search was limited to it.
test("a setting answer that says it has no limit names no setting, wherever the wording is", () => {
  for (const s of ["not specified (any country)", "No specific setting", "International (any country)", "Not limited", "globally", "Any country"]) assert.equal(ideaSetting({ setting: s }), null, s);
  // Real run 1 (prj_538d411ba3c44ae0): its ranking halved 104 of 240 scores against this "setting".
  assert.equal(ideaSetting({ setting: "hospitals and other healthcare settings globally" }), null);
  // A country stays a setting, with or without a qualifier.
  assert.equal(ideaSetting({ setting: "Thailand" }), "Thailand");
  assert.equal(ideaSetting({ setting: "Thailand (any region)" }), "Thailand (any region)");
  assert.equal(ideaSetting({ setting: "Thailand, not limited to Bangkok" }), "Thailand, not limited to Bangkok");
});

test("every search is limited to a place, not to a kind of care setting", () => {
  for (const s of ["Thailand", "primary care in rural Kenya", "Bangkok", "rural Ontario", "UK"]) assert.equal(placeLike(s), true, s);
  for (const s of ["hospitals", "primary care", "nursing homes", "community pharmacies"]) assert.equal(placeLike(s), false, s);
});

test("a search builder reply without a setting block gets one from the setting's own words", () => {
  assert.deepEqual(settingTerms("Thailand"), ["thailand", "thai"]);
  assert.equal(termsBlock(settingTerms("Thailand"), "[tiab]"), "(thailand[tiab] OR thai[tiab])");
  assert.equal(termsBlock(settingTerms("United States"), "[tiab]"), '("united states"[tiab] OR usa[tiab] OR america[tiab] OR american[tiab])');
  assert.equal(termsBlock(settingTerms("Bangkok")), "(bangkok)");
  assert.equal(termsBlock([]), "");
  // The block it builds limits the run-3 query that lost the country, and reads as the setting in the report.
  const limited = withBlock(OPENALEX_ADHERENCE, termsBlock(settingTerms("Thailand")));
  assert.deepEqual(limited, { query: `${OPENALEX_ADHERENCE} AND (thailand OR thai)`, added: true });
  assert.equal(mentionsSetting("Thailand", limited.query), true);
});

test("a topic that compares settings is scored without the setting, so papers from elsewhere keep their score", () => {
  assert.equal(rankedSetting("Thailand", [{ scope: { comparesSettings: true } }, { scope: { comparesSettings: false } }]), null);
  assert.equal(rankedSetting("Thailand", [{ scope: { comparesSettings: false } }]), "Thailand");
  assert.equal(rankedSetting("Thailand", [{ scope: null }]), "Thailand"); // queries built before the flag was kept
  const sg = { topicFit: 4, topicFitWhy: "", designStrength: 5, settingMatch: 0, settingMatchWhy: "Singapore.", overall: "RCT in Singapore." };
  const formula = { recency: 5, citationImpact: 2 };
  const compared = applyRankingRules(sg, formula, rankedSetting("Thailand", [{ scope: { comparesSettings: true } }]));
  assert.equal(compared.total, weightedTotal(compared.sub));
  assert.equal(compared.overall, "RCT in Singapore.");
  // Run 1's "hospitals … globally" is no setting, so nothing is halved there either.
  const r1 = applyRankingRules(sg, formula, ideaSetting({ setting: "hospitals and other healthcare settings globally" }));
  assert.equal(r1.total, weightedTotal(r1.sub));
});

test("setting fit by words: countries by any name and as whole words, care settings by all their words", () => {
  assert.equal(settingFit("UK", "London, England", undefined), "match");
  assert.equal(settingFit("UK", "Boston, United States", undefined), "differs");
  assert.equal(settingFit("USA", "Boston, United States", undefined), "match");
  assert.equal(settingFit("United States", "Manchester, United Kingdom", undefined), "differs");
  assert.equal(settingFit("rural India", "rural Kenya", undefined), "differs");
  assert.equal(settingFit("rural India", "villages in Tamil Nadu, India", undefined), "match");
  assert.equal(settingFit("primary care", "Primary schools in Kenya", undefined), "differs");
  assert.equal(settingFit("primary care", "Primary care clinics in Kenya", undefined), "match");
  assert.equal(settingFit("Thailand", "Two Thai provinces", undefined), "match");
});

test("the report counts a search that limits by the demonym as limited to the setting", () => {
  assert.equal(mentionsSetting("Thailand", `${PUBMED_ADHERENCE} AND (Thai[tiab])`), true);
  assert.equal(mentionsSetting("Thailand", PUBMED_THAI), true);
  assert.equal(mentionsSetting("Thailand", PUBMED_ADHERENCE), false);
  assert.equal(mentionsSetting("UK", '(diabetes[tiab]) AND ("United Kingdom"[mh] OR UK[tiab])'), true);
  // "usability" does not name the USA.
  assert.equal(mentionsSetting("USA", OPENALEX_ADHERENCE.replace("adherence", "usability")), false);
});

test("'last N years' wins over a range written next to it", () => {
  assert.deepEqual(yearsFromTimeframe("last 10 years (2015-2025)", 2026), { yearFrom: 2016, yearTo: null });
  // Real run 1.
  assert.deepEqual(yearsFromTimeframe("2020 to present", 2026), { yearFrom: 2020, yearTo: null });
});
