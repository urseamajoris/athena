import { test } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { Appraisal, EXTRACTION_FIELDS, pairsToRecord, QuestionDrafts, QuestionRevisions, SCOPING_FIELDS, ScopingTurn, SearchTopics } from "./ai-schemas";

const pairs = [
  { element: "population", value: "teenagers" },
  { element: "exposure", value: "short sleep" },
  { element: "outcome", value: "school grades" },
];
const draft = (text: string, note: string) => ({ text, framework: "PEO", structure: pairs, note });

test("the scoping turn covers the seven elements of a question and has no topic list", () => {
  assert.deepEqual([...SCOPING_FIELDS], ["population", "phenomenon", "comparison", "outcome", "setting", "timeframe", "studyTypes"]);
  const coverage = { population: "teenagers", phenomenon: "short sleep", comparison: "none", outcome: null, setting: null, timeframe: null, studyTypes: null };
  assert.ok(ScopingTurn.safeParse({ coverage, done: false, nextQuestion: "What do you want to measure?", questionTarget: "outcome" }).success);
  assert.ok(!ScopingTurn.safeParse({ coverage: { ...coverage, comparison: undefined }, done: true, nextQuestion: null, questionTarget: null }).success, "comparison is part of the coverage");
  assert.ok(!("draftTopics" in ScopingTurn.shape));
});

test("question drafts: exactly three, each with a framework, its parts and a note", () => {
  const three = [draft("Do teenagers who sleep less get lower grades?", "Broadest."), draft("Do teenagers aged 13-15 who sleep less get lower grades?", "Narrower population."), draft("How do teenagers describe the effect of short sleep on school?", "Experience, not effect.")];
  const ok = QuestionDrafts.safeParse({ drafts: three });
  assert.ok(ok.success);
  assert.deepEqual(pairsToRecord(ok.data!.drafts[0].structure), { population: "teenagers", exposure: "short sleep", outcome: "school grades" });
  assert.ok(!QuestionDrafts.safeParse({ drafts: three.slice(0, 2) }).success, "two drafts are not enough");
  assert.ok(!QuestionDrafts.safeParse({ drafts: [...three, three[0]] }).success, "four are too many");
  assert.ok(!QuestionDrafts.safeParse({ drafts: three.map((d) => ({ ...d, framework: "FINER" })) }).success, "unknown framework");
  assert.ok(!QuestionDrafts.safeParse({ drafts: three.map((d) => ({ ...d, note: "" })) }).success, "the note is required");
  assert.ok(QuestionDrafts.safeParse({ drafts: three.map((d) => ({ ...d, framework: "other" })) }).success, "a question need not fit PICO");
});

test("search topics: one to eight (the count against the user's own topics is checked by the caller)", () => {
  const topic = { name: "Sleep duration", synonyms: ["sleep length"], controlledTerms: [], rationale: "The exposure in the question." };
  const base = { summary: { population: "p", setting: "s", phenomenon: "ph", outcome: "o", timeframe: "t", studyTypes: "st" }, conceptMap: { nodes: [1, 2, 3].map((i) => ({ id: `n${i}`, label: `L${i}`, kind: "context" })), edges: [] } };
  assert.ok(SearchTopics.safeParse({ ...base, topics: [topic] }).success);
  assert.ok(!SearchTopics.safeParse({ ...base, topics: [] }).success);
  assert.ok(!SearchTopics.safeParse({ ...base, topics: Array(9).fill(topic) }).success);
});

test("article analysis: the extraction and checklist as before, plus bottom line and relevance", () => {
  const extractions = EXTRACTION_FIELDS.map((field) => ({ field, statement: "not reported", notReported: true, quote: "", location: "" }));
  const base = { extractions, checklist: [{ item: "Was the sample described?", answer: "yes", quote: "We surveyed 200 pupils.", location: "Methods" }] };
  const full = { ...base, bottomLine: "A small survey suggests short sleep goes with lower grades.", relevance: "partial", relevanceNote: "Same exposure, older students." };
  assert.ok(Appraisal.safeParse(full).success);
  assert.ok(!Appraisal.safeParse(base).success, "bottom line and relevance are required");
  assert.ok(!Appraisal.safeParse({ ...full, relevance: "high" }).success, "relevance is direct, partial or background");
  assert.ok(!Appraisal.safeParse({ ...full, bottomLine: " " }).success);
});

test("final question: search words for the working question and zero to three revisions", () => {
  const search = { pubmed: "sleep[tiab] AND grades[tiab]", openalex: "sleep AND grades" };
  const revision = { text: "Do rural teenagers who sleep less get lower grades?", framework: "PECO", structure: pairs, design: "Cross-sectional survey", gap: "Only one study was rural. This wording narrows the population.", gapClaimIds: ["c_1"], synthesisIds: [], feasibility: "A school survey fits one term.", weakness: "Self-reported sleep.", noveltyQueries: search };
  assert.ok(QuestionRevisions.safeParse({ workingQuestionSearch: search, revisions: [] }).success, "no revision is a valid answer");
  assert.ok(QuestionRevisions.safeParse({ workingQuestionSearch: search, revisions: [revision, revision, revision] }).success);
  assert.ok(!QuestionRevisions.safeParse({ workingQuestionSearch: search, revisions: Array(4).fill(revision) }).success, "at most three");
  assert.ok(!QuestionRevisions.safeParse({ revisions: [revision] }).success, "the working question's search is required");
  assert.ok(!QuestionRevisions.safeParse({ workingQuestionSearch: search, revisions: [{ ...revision, gapClaimIds: [] }] }).success, "a revision must cite the claims behind its gap");
});

test("every AI schema converts to a JSON schema of closed objects (what structured outputs accept)", () => {
  for (const [name, s] of Object.entries({ ScopingTurn, QuestionDrafts, SearchTopics, Appraisal, QuestionRevisions })) {
    const json = JSON.stringify(z.toJSONSchema(s));
    assert.ok(!json.includes('"additionalProperties":{'), `${name}: no free-form objects`);
    assert.ok(!json.includes('"$ref"'), `${name}: no recursion`);
  }
});
