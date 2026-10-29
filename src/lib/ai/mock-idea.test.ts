import { test } from "node:test";
import assert from "node:assert/strict";
import { answersByField, gist, ideaQuestions, ideaSearch, ideaTopics, phrases, respellCommon, summaryOf, synonymsFor, synthesisStatements } from "./mock-idea";

// Ideas the simulated users typed (docs/qa), with some of their answers.
const IDEAS: [string, string[]][] = [
  ["I'm interested in sleep and grades", ["university students in the UK", "UK", "exam grades"]],
  ["Effect of mindfulness-based interventions on burnout in ICU nurses", ["nurses in adult ICUs"]],
  ["Association between long COVID and return-to-work outcomes in healthcare workers", []],
  ["Does tele-rehabilitation help older adults recover after hip fracture surgery?", ["older adults over 65"]],
  ["how mobile app help diabtes pateint in thailand control there sugar level?", ["type 2 diabetes patients in thailand, adult", "thailand", "HbA1c level go down, measure by blood test", "from 2018", "all kind of study is ok"]],
  ["Peer support groups for postpartum depression in low-income countries", ["mothers in the first year after birth"]],
  ["Effects of short-form video apps on attention span in teenagers", ["Teenagers aged 13 to 18 in school, any country"]],
];

test("demo topics keep multi-word concepts together and drop filler words", () => {
  const names = (i: number) => ideaTopics(IDEAS[i][0], answersByField(IDEAS[i][1])).map((t) => t.name);
  assert.deepEqual(names(1).slice(0, 3), ["Mindfulness-based interventions", "Burnout", "ICU nurses"]);
  assert.deepEqual(names(2).slice(0, 3), ["Long COVID", "Return-to-work outcomes", "Healthcare workers"]);
  assert.deepEqual(names(3).slice(0, 3), ["Tele-rehabilitation", "Older adults", "Hip fracture surgery"]);
  assert.deepEqual(names(5).slice(0, 3), ["Peer support groups", "Postpartum depression", "Low-income countries"]);
  assert.deepEqual(names(6).slice(0, 3), ["Short-form video apps", "Attention span", "Teenagers"]);
  assert.deepEqual(names(0), ["Sleep", "Grades", "University students", "UK"]);
  const nonnative = names(4);
  assert.ok(nonnative.includes("Mobile app") && nonnative.includes("Sugar level"), nonnative.join(", "));
  assert.ok(!nonnative.some((n) => /^(help|mobile|app|diabtes)$/i.test(n)), `no single words or typos: ${nonnative.join(", ")}`);
  assert.ok(nonnative.some((n) => /^Diabetes/.test(n)), "the typo is corrected from the user's own answer");
  for (const [idea, answers] of IDEAS) {
    const ts = ideaTopics(idea, answersByField(answers));
    assert.ok(ts.length >= 4 && ts.length <= 6, idea);
    for (const t of ts) assert.ok(t.synonyms.length >= 1 && t.synonyms.every((s) => !/s{2,}$|baseds$/.test(s)), `${t.name}: ${t.synonyms.join("; ")}`);
  }
});

test("phrases and synonyms", () => {
  assert.deepEqual(phrases("How does screen time affect sleep quality in teenagers?"), ["screen time", "sleep quality", "teenagers"]);
  assert.deepEqual(synonymsFor("Tele-rehabilitation"), ["tele-rehabilitation", "tele rehabilitation", "telerehabilitation"]);
  assert.deepEqual(synonymsFor("Type 2 diabetes"), ["type 2 diabetes"]);
  assert.deepEqual(synonymsFor("ICU nurses"), ["ICU nurses", "ICU nurse"]);
});

test("each scoping answer is filed under the field its question asked about", () => {
  assert.deepEqual(answersByField(["nurses", "anywhere", "burnout score"]), { population: "nurses", setting: "anywhere", outcome: "burnout score" });
});

test("demo searches use the user's topics, never telemedicine, and never an empty group", () => {
  const topics = ideaTopics(IDEAS[2][0]).map((t, i) => ({ ...t, id: `t${i}` }));
  topics.push({ id: "tx", name: "Work ability", synonyms: [], controlledTerms: [], rationale: "Added by you" });
  const sum = summaryOf({ population: "(mock) healthcare workers", setting: "(mock) not stated", timeframe: "(mock) from 2020 to now" });
  const out = ideaSearch(topics, sum);
  assert.equal(out.criteria.yearFrom, 2020);
  for (const q of out.queries) {
    assert.ok(!/telemedicine|telehealth|Southeast Asia/i.test(q.query), q.query);
    assert.ok(!/\(\s*\)/.test(q.query), q.query);
  }
  assert.match(out.queries.find((q) => q.topicId === "tx" && q.database === "openalex")!.query, /^\("Work ability"\) AND \("long COVID"\)$/);
});

test("demo candidate questions are well formed and distinct", () => {
  for (const [idea, answers] of IDEAS) {
    const topics = ideaTopics(idea, answersByField(answers));
    const by = answersByField(answers);
    const qs = ideaQuestions(topics, summaryOf({ population: by.population ?? "(mock) not stated", setting: by.setting ?? "(mock) not stated" }), undefined, idea);
    assert.equal(qs.length, 3);
    assert.equal(new Set(qs.map((q) => q.text)).size, 3);
    assert.equal(new Set(qs.map((q) => q.weakness)).size, 3);
    assert.equal(new Set(qs.map((q) => q.design)).size, 3);
    for (const q of qs) {
      assert.match(q.text, /^\(mock\) (How do|Is there an association between|What is the effect of|What helps or hinders) .+\?$/);
      assert.ok(!/factors shape|Southeast Asia|telemedicine/i.test(q.text), q.text);
      assert.ok(!/Less or no/.test(JSON.stringify(q.structure)), JSON.stringify(q.structure));
    }
  }
  const [, assoc] = ideaQuestions(ideaTopics(IDEAS[0][0], answersByField(IDEAS[0][1])), summaryOf({ population: "university students in the UK", setting: "UK" }));
  assert.equal(assoc.text, "(mock) Is there an association between sleep and grades among university students in the UK?");
});

test("the association question keeps the idea's direction and a sensible comparison", () => {
  // The user deleted "Sleep" and added it back, so it is now the last topic.
  const idea = "How does sleep affect grades in university students?";
  const topics = ideaTopics(idea).filter((t) => t.name !== "Sleep");
  topics.push({ name: "Sleep", synonyms: ["sleep"], controlledTerms: [], rationale: "Added by you" });
  const [, assoc] = ideaQuestions(topics, summaryOf({ population: "university students" }), "", idea);
  const el = Object.fromEntries(assoc.structure.map((s) => [s.element, s.value]));
  assert.equal(assoc.framework, "PECO");
  assert.equal(assoc.text, "(mock) Is there an association between sleep and grades among university students?");
  assert.deepEqual([el.Exposure, el.Comparison, el.Outcome], ["Sleep", "Less sleep", "Grades"]);
});

test("an idea that asks whether a treatment helps gets an effect (PICO) question that does not repeat the population", () => {
  const idea = IDEAS[3][0];
  const topics = ideaTopics(idea, answersByField(["adults over 65 after hip fracture surgery"]));
  const qs = ideaQuestions(topics, summaryOf({ population: "adults over 65 after hip fracture surgery" }), "", idea);
  const effect = qs.find((q) => q.framework === "PICO");
  assert.ok(effect, qs.map((q) => q.text).join(" | "));
  assert.equal(effect.text, "(mock) What is the effect of tele-rehabilitation compared with usual care on recovery among adults over 65 after hip fracture surgery?");
  assert.deepEqual(effect.structure.map((s) => s.element), ["Population", "Intervention", "Comparison", "Outcome"]);
  assert.match(effect.design, /trial/i);
  for (const q of qs) assert.ok((q.text.match(/hip fracture surgery/g) ?? []).length <= 1, q.text);
  // "return-to-work" does not make an association idea ask about an effect.
  const covid = ideaQuestions(ideaTopics(IDEAS[2][0]), summaryOf({}), "", IDEAS[2][0]);
  assert.ok(!covid.some((q) => q.framework === "PICO"), covid.map((q) => q.text).join(" | "));
});

test("common health words are spelt right even when every answer has the same typo", () => {
  const idea = "how mobile app help diabtes pateint in thailand control there sugar level?";
  const names = ideaTopics(idea, answersByField(["type 2 diabetes pateints in thailand"])).map((t) => t.name);
  assert.ok(names.includes("Diabetes patient"), names.join(", "));
  assert.equal(respellCommon("pateints with diabtes"), "patients with diabetes");
  assert.equal(respellCommon("patent law and parents"), "patent law and parents");
});

test("demo synthesis statements say what the claims they cite say, and cite only those claims", () => {
  const claims = [
    { id: "c0", paperId: "p1", field: "key_findings", statement: "(mock) Telemedicine works which clearly proves the intervention works everywhere", verified: false },
    { id: "c1", paperId: "p1", field: "key_findings", statement: "(mock) The results showed that teleconsultation reduced travel time for rural patients by half.", verified: true },
    { id: "c2", paperId: "p1", field: "key_findings", statement: "(mock) Satisfaction was associated with prior internet use.", verified: true },
    { id: "c3", paperId: "p2", field: "key_findings", statement: "(mock) RESULTS: Uptake stayed low in remote provinces; cost was the main barrier.", verified: true },
    { id: "c4", paperId: "p2", field: "key_findings", statement: "(mock) Most nurses found the platform easy to use.", verified: true },
    { id: "c5", paperId: "p2", field: "limitations", statement: "(mock) The sample was small and self-selected.", verified: true },
    { id: "c6", paperId: "p1", field: "methods", statement: "(mock) A survey was used.", verified: true },
  ];
  const papers = [{ id: "p1", authors: ["Lee SWH", "Kim J"], year: 2021 }, { id: "p2", authors: ["Carl Froilan D. Leochico"], year: 2020 }];
  const out = synthesisStatements(claims, papers, "Main findings");
  assert.deepEqual(out.known.map((k) => k.statement), [
    "(mock) Teleconsultation reduced travel time for rural patients by half (reported by Lee et al. 2021).",
    "(mock) Uptake stayed low in remote provinces (reported by Leochico 2020).",
  ]);
  assert.deepEqual(out.contested[0].claimIds, ["c2", "c4"], "other findings than Known, from two papers");
  assert.match(out.contested[0].statement, /Lee et al\. 2021: Satisfaction was associated with prior internet use\. Leochico 2020: Most nurses/);
  assert.deepEqual(out.unknown, [{ statement: "(mock) Still uncertain: The sample was small and self-selected (a limitation noted by Leochico 2020).", claimIds: ["c5"] }]);
  const ids = new Set(claims.map((c) => c.id));
  for (const s of [...out.known, ...out.contested, ...out.unknown, ...out.contradictions]) assert.ok(s.claimIds.length && s.claimIds.every((id) => ids.has(id)));
  for (const s of [...out.known, ...out.contested, ...out.unknown]) assert.match(s.statement, /^\(mock\) /);
  // No limitations: Unknown says so and points at how a study was done, not at nothing.
  const none = synthesisStatements(claims.filter((c) => c.field !== "limitations"), papers, "Main findings");
  assert.deepEqual(none.unknown[0].claimIds, ["c6"]);
  assert.equal(gist("(mock) In conclusion, we found that apps improved adherence among 40 participants in a twelve week pilot trial in two rural districts of northern Thailand with nurse support", 10), "Apps improved adherence among 40 participants in a twelve week…");
});
