import { test } from "node:test";
import assert from "node:assert/strict";
import { looksLikeSameQuestion, noveltyVerdict, stems, type NoveltyInput } from "./novelty";

const q = (over: Partial<NoveltyInput> = {}): NoveltyInput => ({
  text: "(mock) Does tele-rehabilitation improve walking in adults over 65 after hip fracture surgery?",
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
  assert.deepEqual(stems("(mock) Diabetes"), ["diabet"]);
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

test("counts the top records that look like the same question", () => {
  const v = noveltyVerdict(q({ noveltyMatches: [{ title: "Precision medicine in Thailand" }, { title: "Home tele-rehabilitation after hip fracture surgery improves walking" }] }));
  assert.deepEqual(v.close, [false, true]);
  assert.equal(v.headline, "1 of the top 2 records looks like the same question: read it before you claim a gap.");
  const none = noveltyVerdict(q({ noveltyMatches: [{ title: "Precision medicine in Thailand" }] }));
  assert.match(none.headline, /^The top record does not look like the same question/);
});

test("zero records, failures, pending and demo mode", () => {
  const zero = noveltyVerdict(q({ noveltyQueries: [{ database: "pubmed", query: "x", count: 0, error: null }] }));
  assert.match(zero.headline, /^No records contain these search words/);
  assert.deepEqual(zero.notes, []);
  assert.match(noveltyVerdict(q({ noveltyQueries: [{ database: "pubmed", query: "x", count: null, error: "timeout" }], noveltyStatus: "failed" })).headline, /search failed/);
  assert.match(noveltyVerdict(q({ noveltyStatus: "pending" })).headline, /Searching/);
  const demo = noveltyVerdict(q(), { demo: true });
  assert.match(demo.notes[0], /^Demo mode: these counts and records are recorded samples/);
  assert.equal(demo.notes.length, 1);
});
