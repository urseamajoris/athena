import { test } from "node:test";
import assert from "node:assert/strict";
import { NEAREST, closeness, looksLikeSameQuestion, noveltyVerdict, stems, type NoveltyInput } from "./novelty";

const q = (over: Partial<NoveltyInput> = {}): NoveltyInput => ({
  text: "Does tele-rehabilitation improve walking in adults over 65 after hip fracture surgery?",
  structure: { Population: "Adults over 65 after hip fracture surgery", Intervention: "Tele-rehabilitation", Comparison: "Usual care", Outcome: "Walking ability" },
  noveltyQueries: [
    { database: "pubmed", query: "x", count: 2207, error: null },
    { database: "openalex", query: "y", count: 412, error: null },
  ],
  noveltyMatches: [],
  noveltyStatus: "done",
  ...over,
});

test("stems drop question words and endings", () => {
  assert.deepEqual(stems("How do nurses and nursing students sleep?"), ["nurs", "nurs", "studen", "sleep"]);
  assert.deepEqual(stems("Diabetes"), ["diabet"]);
});

test("a title on the same question is close; an unrelated one is not", () => {
  assert.equal(looksLikeSameQuestion(q(), "Telerehabilitation after hip fracture surgery: a randomised trial of walking recovery"), true);
  assert.equal(looksLikeSameQuestion(q(), "Tele-rehabilitation for hip fracture in older adults"), true);
  assert.equal(looksLikeSameQuestion(q(), "Precision medicine in Thailand"), false);
  assert.equal(looksLikeSameQuestion(q(), "Hip fracture surgery outcomes in Japan"), false);
});

test("never says no matching records next to a non-zero count", () => {
  const v = noveltyVerdict(q());
  assert.doesNotMatch(v.headline, /no (closely )?matching records/i);
  assert.match(v.headline, /2,207 records contain the search words/);
  assert.ok(v.notes.some((n) => /pubmed 2,207 and openalex 412/.test(n) && /not studies that ask your question/.test(n)));
  assert.ok(v.notes.some((n) => /well studied/.test(n)));
});

test("counts the top records that are close to the question", () => {
  const v = noveltyVerdict(q({ noveltyMatches: [{ title: "Precision medicine in Thailand" }, { title: "Home tele-rehabilitation after hip fracture surgery improves walking" }] }));
  assert.deepEqual(v.close, [false, true]);
  assert.equal(v.headline, "1 of the top 2 records is close to your question: read it before you claim a gap.");
  const none = noveltyVerdict(q({ noveltyMatches: [{ title: "Precision medicine in Thailand" }] }));
  assert.match(none.headline, /^The top record is not close to your question/);
});

test("zero records, failures and pending", () => {
  const zero = noveltyVerdict(q({ noveltyQueries: [{ database: "pubmed", query: "x", count: 0, error: null }] }));
  assert.match(zero.headline, /^No records contain these search words/);
  assert.deepEqual(zero.notes, []);
  assert.match(noveltyVerdict(q({ noveltyQueries: [{ database: "pubmed", query: "x", count: null, error: "timeout" }], noveltyStatus: "failed" })).headline, /search failed/);
  assert.match(noveltyVerdict(q({ noveltyStatus: "pending" })).headline, /Searching/);
});

test("hyphen spellings match, a generic word alone does not, and the intervention is required", () => {
  assert.equal(looksLikeSameQuestion(q(), "Telerehabilitation versus usual care for older adults after hip fracture"), true);
  assert.equal(looksLikeSameQuestion(q(), "Functional ability of older adults in nursing homes"), false);
  assert.equal(looksLikeSameQuestion(q(), "Walking ability in adults after hip fracture surgery"), false);
});

test("a large count is never headlined as a sign the question is new", () => {
  const busy = noveltyVerdict(q({ noveltyQueries: [{ database: "pubmed", query: "x", count: 8058, error: null }], noveltyMatches: [{ title: "Precision medicine in Thailand" }] }));
  assert.doesNotMatch(busy.headline, /suggests/);
  assert.match(busy.headline, /8,058 records/);
});

// Real run 2 (undergraduate): an unrelated title was flagged, and the paper in the review that asks the question was not.
const gpa = (over: Partial<NoveltyInput> = {}) =>
  q({
    text: "Is sleep duration associated with cumulative GPA at graduation among university students?",
    structure: { Population: "University students", Exposure: "Sleep duration and sleep quality", Outcome: "Cumulative GPA at graduation" },
    ...over,
  });
test("a title on the same exposure but another outcome is not the same question", () => {
  assert.equal(looksLikeSameQuestion(gpa(), "Association between Sleep Quality and Duration and Periodontal Disease among University Students"), false);
  assert.equal(looksLikeSameQuestion(gpa(), "Sleep duration and quality in university students: a cross-sectional survey"), true);
});
test("the review's own papers are checked too", () => {
  const own = "Consequences of inadequate sleep during the college years: sleep deprivation, GPA and college graduation";
  assert.equal(looksLikeSameQuestion(gpa(), own), true);
  const v = noveltyVerdict(gpa(), { ownTitles: ["Precision medicine in Thailand", own] });
  assert.deepEqual(v.own, [own]);
  assert.match(v.headline, /^One of the papers in this review is close to your question/);
});

// Real run 2, as stored: the outcome is "cumulative GPA at graduation after 3-4 years" and the paper says "grade point
// average"; the periodontal paper was one of its top records.
test("the stored GPA question still finds its paper, and not the periodontal one", () => {
  const stored = q({
    text: "Does sleep quality during the first year of university predict cumulative GPA at graduation among students in diverse international settings?",
    structure: { Population: "first-year university students in diverse international settings", Exposure: "sleep quality during the first year", Comparison: "students with good versus poor sleep quality", Outcome: "cumulative GPA at graduation after 3-4 years" },
  });
  assert.equal(looksLikeSameQuestion(stored, "Consequences of inadequate sleep during the college years: Sleep deprivation, grade point average, and college graduation."), true);
  assert.equal(looksLikeSameQuestion(stored, "Association between Sleep Quality and Duration and Periodontal Disease among University Students: A Cross-Sectional Study."), false);
});

// Real run 3 (Thai diabetes apps): candidates 1 and 2 were warned with the same generic list, an office-worker
// "sit less" trial among them, and candidate 3 with about 10 titles, an Indonesian protocol among them.
const thai = {
  c1: q({
    text: "What is the impact of a mobile app self-management intervention on HbA1c levels at 12 months in Thai adults with type 2 diabetes compared to usual care?",
    structure: { Population: "Thai adults with type 2 diabetes", Intervention: "Mobile app self-management intervention", Comparison: "Usual care", Outcome: "HbA1c levels at 12 months" },
  }),
  c2: q({
    text: "What is the effect of a mobile app intervention on blood sugar control and acceptability among older adults with type 2 diabetes in Thailand at 6 months compared to usual care?",
    structure: { Population: "Older adults over 65 with type 2 diabetes in Thailand", Intervention: "Mobile app self-management intervention", Comparison: "Usual care", Outcome: "HbA1c levels at 6 months and acceptability" },
  }),
  c3: q({
    text: "Which specific features and usability elements of mobile apps for glycemic tracking best support engagement and blood sugar control over 3 months in diabetes patients in Thailand?",
    structure: { Population: "Diabetes patients in Thailand", Exposure: "Specific mobile app features and usability elements for glycemic tracking", Outcome: "Engagement, adherence and HbA1c control over 3 months" },
  }),
};
const T = {
  mhdsmp: "Effects of a mobile health diabetes self-management program on HbA1C, self-management and patient satisfaction in adults with uncontrolled type 2 diabetes: a randomized controlled trial",
  family: "Family support-based intervention using a mobile application provided by pharmacists for older adults with diabetes to improve glycaemic control: a randomised controlled trial",
  sitLess: "Impact of a primary care-based mobile health intervention to 'sit less and move more' on HbA1c, blood pressure, and other clinical outcomes in office employees with type 2 diabetes: A randomized controlled trial.",
  indonesia: "Integrated Diabetes Self-Management (IDSM) mobile application to improve self-management and glycemic control among patients with Type 2 Diabetes Mellitus (T2DM) in Indonesia: A mixed methods study protocol.",
  emr: "Efficacy of Personalized Diabetes Self-care Using an Electronic Medical Record-Integrated Mobile App in Patients With Type 2 Diabetes: 6-Month Randomized Controlled Trial.",
  china: "Effectiveness of Smartphone App–Based Interactive Management on Glycemic Control in Chinese Patients With Poorly Controlled Diabetes: Randomized Controlled Trial",
  pharmacistApp: "Effect of a pharmacist-led mHealth app on adherence, quality of life, and glycaemic control in diabetes: A multicentre RCT.",
  umbrella: "Effectiveness of mobile applications on glycemic control and medication adherence in diabetes management: an umbrella review and meta-analysis of HbA1c outcomes",
};
test("run 3: the Thai trials stay close, the generic and other-country titles do not", () => {
  assert.equal(looksLikeSameQuestion(thai.c1, T.mhdsmp), true);
  assert.equal(looksLikeSameQuestion(thai.c2, T.family), true);
  for (const c of [thai.c1, thai.c2, thai.c3]) {
    assert.equal(looksLikeSameQuestion(c, T.sitLess), false);
    assert.equal(looksLikeSameQuestion(c, T.indonesia), false);
    assert.equal(looksLikeSameQuestion(c, T.china), false);
  }
  // Adults in general are not "older adults over 65"; two generic words do not stand for app features and usability.
  assert.equal(looksLikeSameQuestion(thai.c2, T.mhdsmp), false);
  assert.equal(looksLikeSameQuestion(thai.c2, T.emr), false);
  assert.equal(looksLikeSameQuestion(thai.c3, T.mhdsmp), false);
  assert.equal(looksLikeSameQuestion(thai.c3, T.pharmacistApp), false);
});
test("the warning lists at most the closest titles, closest first, and differs between candidates", () => {
  const own = Object.values(T);
  const one = noveltyVerdict(thai.c1, { ownTitles: own });
  const two = noveltyVerdict(thai.c2, { ownTitles: own });
  assert.ok(one.nearest.length <= NEAREST);
  assert.equal(one.nearest[0].title, T.mhdsmp);
  assert.deepEqual(one.nearest.map((x) => x.score), [...one.nearest.map((x) => x.score)].sort((a, b) => b - a));
  assert.deepEqual(two.nearest.map((x) => x.title), [T.family]);
  assert.ok(!one.nearest.some((x) => x.title === T.sitLess));
  assert.ok(closeness(thai.c1, T.mhdsmp) > closeness(thai.c1, T.umbrella));
  assert.equal(closeness(thai.c1, T.sitLess), 0);
});
test("a top record that is also in the review is listed once, as the review's paper", () => {
  const v = noveltyVerdict(thai.c2, { ownTitles: [T.family + "."] });
  const withRecord = noveltyVerdict({ ...thai.c2, noveltyMatches: [{ title: "Precision medicine in Thailand" }, { title: T.family }] }, { ownTitles: [T.family + "."] });
  assert.equal(v.nearest.length, 1);
  assert.deepEqual(withRecord.nearest.map((x) => [x.own, x.match]), [[true, 1]]);
  assert.deepEqual(withRecord.close, [false, true]);
});

// Review of run 3: "Spanish-speaking" read as Spain, so a US trial was ruled out for a question about US adults.
test("a language is not a country: a US trial of Spanish-speaking adults is close to a question about US adults", () => {
  const us = q({
    text: "Does a culturally tailored text-message programme improve HbA1c in Hispanic American adults with type 2 diabetes?",
    structure: { Population: "Hispanic American adults with type 2 diabetes", Intervention: "Culturally tailored text-message programme", Outcome: "HbA1c" },
  });
  assert.equal(looksLikeSameQuestion(us, "A culturally tailored text-message programme to improve HbA1c in Spanish-speaking Hispanic adults with type 2 diabetes in the US"), true);
  // Another country is still not a near match.
  assert.equal(looksLikeSameQuestion(us, "A culturally tailored text-message programme to improve HbA1c in adults with type 2 diabetes in Spain"), false);
  const india = q({ text: "Does a text-message programme improve HbA1c in Indian adults with type 2 diabetes?", structure: { Population: "Indian adults with type 2 diabetes", Intervention: "Text-message programme", Outcome: "HbA1c" } });
  assert.equal(looksLikeSameQuestion(india, "A text-message programme to improve HbA1c in adults with type 2 diabetes in Kenya"), false);
});
