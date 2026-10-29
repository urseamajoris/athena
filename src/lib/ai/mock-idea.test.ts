import { test } from "node:test";
import assert from "node:assert/strict";
import { answersByField, ideaQuestions, ideaSearch, ideaTopics, phrases, summaryOf, synonymsFor } from "./mock-idea";

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
    const qs = ideaQuestions(topics, summaryOf({ population: by.population ?? "(mock) not stated", setting: by.setting ?? "(mock) not stated" }));
    assert.equal(qs.length, 3);
    assert.equal(new Set(qs.map((q) => q.text)).size, 3);
    assert.equal(new Set(qs.map((q) => q.weakness)).size, 3);
    for (const q of qs) {
      assert.match(q.text, /^\(mock\) (How do|Is there an association between|What helps or hinders) .+\?$/);
      assert.ok(!/factors shape|Southeast Asia|telemedicine/i.test(q.text), q.text);
    }
  }
  const [, assoc] = ideaQuestions(ideaTopics(IDEAS[0][0], answersByField(IDEAS[0][1])), summaryOf({ population: "university students in the UK", setting: "UK" }));
  assert.equal(assoc.text, "(mock) Is there an association between sleep and grades among university students in the UK?");
});
