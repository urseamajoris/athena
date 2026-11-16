import { test } from "node:test";
import assert from "node:assert/strict";
import { approvalBlock, clipTitle, keepTogether, normalizeQuestion, questionText, retitle, sameQuestion, summariesStep, topicsWithoutQueries, upstreamBlock, workingQuestion, workingQuestionCandidate, type ApprovalFacts } from "./rules";
import { isWorkingQuestionCandidate, STAGES, WORKING_QUESTION_GAP, type StageState } from "../shared/stages";
import { STEPS, stepStatus } from "../shared/flow";

/** Stage states with stages 1..upTo approved and the rest as given (default: not started). */
function states(upTo: number, rest: Record<number, StageState> = {}): Record<string, StageState> {
  return Object.fromEntries(STAGES.map((s) => [String(s.n), s.n <= upTo ? "approved" : rest[s.n] ?? "not_started"])) as Record<string, StageState>;
}
const facts = (over: Partial<ApprovalFacts> = {}): ApprovalFacts => ({ idea: "Sleep and grades in teenagers", question: null, topics: [], queries: [], questionChosen: false, ...over });

test("stage titles use the new vocabulary and keep their keys", () => {
  assert.deepEqual(STAGES.map((s) => s.title), ["Idea", "Research question", "Search plan", "Papers found", "Paper summaries", "Choose papers", "Article analysis", "Evidence summary", "Final question"]);
  assert.deepEqual(STAGES.map((s) => s.key), ["idea", "scoping", "search", "retrieval", "summary", "ranking", "appraisal", "synthesis", "questions"]);
});

test("a stage is open only when every stage before it is confirmed, and the message names the stage by title", () => {
  assert.equal(upstreamBlock(states(0), 1), null);
  assert.equal(upstreamBlock(states(1), 2), null);
  assert.equal(upstreamBlock(states(1), 3), "Finish “Research question” first.");
  assert.equal(upstreamBlock(states(2, { 3: "needs_review" }), 4), "Finish “Search plan” first.");
  assert.ok(!/\d/.test(upstreamBlock(states(0), 9)!), "no stage numbers in the message");
});

test("stage 2 is confirmed only with a research question; topics are not needed", () => {
  assert.deepEqual(approvalBlock(2, "needs_review", facts(), false), { status: 400, message: "Choose or write your research question first." });
  assert.equal(approvalBlock(2, "needs_review", facts({ question: "   " }), false)?.status, 400);
  assert.equal(approvalBlock(2, "needs_review", facts({ question: "Does sleep affect grades in teenagers?" }), false), null);
  // Also straight from "not started": the user may write a question without using the chat or the drafts.
  assert.equal(approvalBlock(2, "not_started", facts({ question: "Does sleep affect grades in teenagers?" }), false), null);
});

test("the search plan needs a topic, and every topic needs at least one search (the message names the topic)", () => {
  const topics = [{ id: "t1", name: "Sleep duration" }, { id: "t2", name: "School grades" }, { id: "t3", name: "Screen time" }];
  assert.equal(approvalBlock(3, "needs_review", facts(), false)?.message, "Add at least one search topic first.");
  assert.deepEqual(topicsWithoutQueries(topics, [{ topicId: "t1" }, { topicId: "t1" }]).map((t) => t.id), ["t2", "t3"]);
  assert.equal(
    approvalBlock(3, "needs_review", facts({ topics, queries: [{ topicId: "t1" }, { topicId: "t3" }] }), false)?.message,
    "The topic “School grades” has no searches yet. Write its searches or delete the topic, then continue.",
  );
  assert.match(approvalBlock(3, "needs_review", facts({ topics, queries: [{ topicId: "t1" }] }), false)!.message, /^These topics have no searches yet: “School grades”, “Screen time”\./);
  assert.equal(approvalBlock(3, "needs_review", facts({ topics, queries: topics.map((t) => ({ topicId: t.id })) }), false), null);
  const nine = Array.from({ length: 9 }, (_, i) => ({ id: `t${i}`, name: `T${i}` }));
  assert.match(approvalBlock(3, "needs_review", facts({ topics: nine, queries: nine.map((t) => ({ topicId: t.id })) }), false)!.message, /at most 8/);
});

test("a stage with background work cannot be confirmed while it runs or before it has finished", () => {
  assert.deepEqual(approvalBlock(4, "running", facts(), true), { status: 409, message: "This step is still running. Wait for it to finish." });
  assert.equal(approvalBlock(4, "not_started", facts(), true)?.status, 409);
  assert.equal(approvalBlock(7, "failed", facts(), true)?.status, 409);
  assert.equal(approvalBlock(7, "needs_review", facts(), true), null);
  assert.equal(approvalBlock(8, "stale", facts(), true), null);
  assert.equal(approvalBlock(9, "needs_review", facts(), true)?.message, "Pick your final question first.");
  assert.equal(approvalBlock(9, "needs_review", facts({ questionChosen: true }), true), null);
});

test("summaries confirm themselves and ranking follows when a summaries job finishes", () => {
  // First run: 1-4 confirmed, the runner has just set stage 5 to "needs review", ranking never ran.
  assert.deepEqual(summariesStep(states(4, { 5: "needs_review" }), { jobFinished: true }), { approve: true, rank: true });
  // Re-run of out-of-date summaries: ranking is out of date too and runs again.
  assert.deepEqual(summariesStep(states(4, { 5: "needs_review", 6: "stale", 7: "stale" }), { jobFinished: true }), { approve: true, rank: true });
  assert.deepEqual(summariesStep(states(4, { 5: "needs_review", 6: "approved" }), { jobFinished: true }), { approve: true, rank: true });
  // Ranking already running (started by an earlier chain): confirm, but do not start it twice.
  assert.deepEqual(summariesStep(states(4, { 5: "needs_review", 6: "running" }), { jobFinished: true }), { approve: true, rank: false });
});

test("a failed, paused, cancelled or still-running summaries job never starts ranking", () => {
  // Failed and cancelled jobs leave the stage "failed"; a paused job leaves it "running".
  for (const five of ["failed", "running", "not_started", "stale", "approved"] as StageState[]) {
    assert.deepEqual(summariesStep(states(4, { 5: five }), { jobFinished: true }), { approve: false, rank: false }, five);
  }
});

test("summaries wait while an earlier stage is open, and continue once it is confirmed again", () => {
  // The idea was edited while the summaries ran: stages 2-4 are open, so nothing continues by itself.
  const reopened = { ...states(1, { 2: "needs_review", 3: "stale", 4: "stale", 5: "needs_review" }) };
  assert.deepEqual(summariesStep(reopened, { jobFinished: true }), { approve: false, rank: false });
  // Later, with 1-4 confirmed again (no job has just finished): confirm, and rank only if ranking never ran.
  assert.deepEqual(summariesStep(states(4, { 5: "needs_review" }), { jobFinished: false }), { approve: true, rank: true });
  assert.deepEqual(summariesStep(states(4, { 5: "needs_review", 6: "stale" }), { jobFinished: false }), { approve: true, rank: false });
  assert.deepEqual(summariesStep(states(4, { 5: "needs_review", 6: "needs_review" }), { jobFinished: false }), { approve: true, rank: false });
});

test("the choose screen (stages 5 and 6) reads as one checkpoint through the chain", () => {
  const choose = STEPS.find((s) => s.key === "choose")!;
  assert.equal(stepStatus(choose, states(4, { 5: "running" })), "working");
  // Between the two jobs stage 5 is confirmed and stage 6 is running: still "working", never "your turn".
  assert.equal(stepStatus(choose, states(5, { 6: "running" })), "working");
  assert.equal(stepStatus(choose, states(5, { 6: "needs_review" })), "review");
  assert.equal(stepStatus(choose, states(6)), "done");
  // Keeping out-of-date results applies to both stages at once.
  assert.deepEqual(keepTogether(5), [5, 6]);
  assert.deepEqual(keepTogether(6), [5, 6]);
  assert.deepEqual(keepTogether(7), [7]);
});

test("the working question: normalised, compared, and written out for prompts and reports", () => {
  const q = normalizeQuestion({ text: "  Does sleep   affect grades in teenagers? ", framework: "PECO", structure: { population: " teenagers ", exposure: "short sleep", comparison: "", outcome: "school grades" } });
  assert.deepEqual(q, { text: "Does sleep affect grades in teenagers?", framework: "PECO", structure: { population: "teenagers", exposure: "short sleep", outcome: "school grades" } });
  assert.deepEqual(normalizeQuestion({ text: "My own question about sleep?" }), { text: "My own question about sleep?", framework: null, structure: null });
  assert.ok(sameQuestion(q, { ...q, structure: { outcome: "school grades", exposure: "short sleep", population: "teenagers" } }), "part order does not matter");
  assert.ok(!sameQuestion(q, { ...q, text: "Does sleep affect grades in adults?" }));
  assert.ok(!sameQuestion(q, { ...q, framework: null }));
  assert.ok(!sameQuestion(null, q));
  assert.equal(questionText(q), "Does sleep affect grades in teenagers?\nFramework: PECO\n- population: teenagers\n- exposure: short sleep\n- outcome: school grades");
  assert.match(questionText(null), /no research question has been set/);
  assert.equal(workingQuestion({ question: "  ", questionFramework: null, questionStructure: null }), null);
  assert.deepEqual(workingQuestion({ question: "Q about sleep?", questionFramework: null, questionStructure: {} }), { text: "Q about sleep?", framework: null, structure: null });
});

test("the title follows the idea, then the confirmed question, unless the user renamed the review", () => {
  const idea = "I wonder whether teenagers who sleep less get worse grades at school";
  const question = "Do teenagers who sleep less than eight hours get lower school grades than those who sleep more?";
  assert.equal(question.length > 90, true);
  // Confirming the question: a title that is still the idea becomes the question, cut as titles are.
  assert.equal(retitle(clipTitle(idea), idea, question), question.slice(0, 90));
  // A renamed review keeps its name through a confirmed question and a later idea edit.
  assert.equal(retitle("My thesis review", idea, question), "My thesis review");
  assert.equal(retitle("My thesis review", idea, "Another idea about sleep"), "My thesis review");
  // Once the title is the question, editing the idea leaves it alone, and editing the question updates it.
  assert.equal(retitle(clipTitle(question), idea, "Another idea about sleep"), clipTitle(question));
  assert.equal(retitle(clipTitle(question), question, "Does sleep affect grades?"), "Does sleep affect grades?");
  assert.equal(retitle("", null, idea), clipTitle(idea));
});

test("stage 9 offers the working question unchanged as its first candidate, recognisable without the model", () => {
  const q = { text: "Does sleep affect grades in teenagers?", framework: "PECO", structure: { population: "teenagers" } };
  const c = workingQuestionCandidate(q);
  assert.equal(c.text, q.text);
  assert.equal(c.framework, "PECO");
  assert.deepEqual(c.structure, { population: "teenagers" });
  assert.equal(c.order, 0);
  assert.equal(c.gap, WORKING_QUESTION_GAP);
  assert.deepEqual([c.design, c.feasibility, c.weakness], ["", "", ""]);
  assert.ok(isWorkingQuestionCandidate(c));
  // A question in the user's own words has no framework: the candidate still fits the table's columns.
  assert.deepEqual({ ...workingQuestionCandidate({ text: "My own question?", framework: null, structure: null }) }.framework, "other");
  assert.deepEqual(workingQuestionCandidate({ text: "My own question?", framework: null, structure: null }).structure, {});
  // Revisions (order 1-3) and candidates made before working questions existed (order 0, another gap) are not it.
  assert.ok(!isWorkingQuestionCandidate({ order: 1, gap: WORKING_QUESTION_GAP }));
  assert.ok(!isWorkingQuestionCandidate({ order: 0, gap: "No study has followed nurses beyond six months." }));
});
