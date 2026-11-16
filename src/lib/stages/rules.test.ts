import { test } from "node:test";
import assert from "node:assert/strict";
import { approvalBlock, clipTitle, keepTogether, normalizeQuestion, questionText, rankAfterSummaries, retitle, sameQuestion, storedStageState, summariesStep, topicsWithoutQueries, upstreamBlock, workingQuestion, workingQuestionCandidate, type ApprovalFacts } from "./rules";
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

test("stage 5 never waits for a review while stages 1-4 are confirmed: 'needs review' is stored as confirmed", () => {
  // What the job runner writes when a summaries job finishes.
  assert.equal(storedStageState(states(4, { 5: "running" }), 5, "needs_review"), "approved");
  // Keeping out-of-date summaries.
  assert.equal(storedStageState(states(4, { 5: "stale", 6: "stale" }), 5, "needs_review"), "approved");
  // With an earlier stage open, nothing after it is confirmed: the summaries wait.
  assert.equal(storedStageState(states(3, { 4: "needs_review", 5: "running" }), 5, "needs_review"), "needs_review");
  assert.equal(storedStageState(states(1, { 2: "needs_review", 3: "stale", 4: "stale", 5: "running" }), 5, "needs_review"), "needs_review");
  // Every other state of stage 5, and every other stage, is stored as given.
  for (const st of ["running", "failed", "stale", "approved", "not_started"] as StageState[]) assert.equal(storedStageState(states(4), 5, st), st);
  for (const n of [1, 2, 3, 4, 6, 7, 8, 9]) assert.equal(storedStageState(states(n - 1), n, "needs_review"), "needs_review", `stage ${n}`);
});

test("when a summaries job has done its work, ranking starts at once", () => {
  // First run: 1-4 confirmed, stage 5 still running (the runner has not recorded the job yet), ranking never ran.
  assert.equal(rankAfterSummaries(states(4, { 5: "running" })), true);
  // Re-run of out-of-date summaries: the ranking made from the old ones runs again, whatever state it is in.
  for (const six of ["stale", "needs_review", "approved", "failed"] as StageState[]) assert.equal(rankAfterSummaries(states(4, { 5: "running", 6: six, 7: "stale" })), true, six);
  // Ranking already running: never started twice.
  assert.equal(rankAfterSummaries(states(4, { 5: "running", 6: "running" })), false);
});

test("a cancelled summaries job, or one overtaken by an earlier edit, does not start ranking", () => {
  // Cancelled: the stage route has set stage 5 to "failed". Edited upstream meanwhile: stage 5 is "stale".
  for (const five of ["failed", "stale", "not_started", "needs_review", "approved"] as StageState[]) assert.equal(rankAfterSummaries(states(4, { 5: five })), false, five);
  // An earlier stage was reopened while the summaries ran.
  assert.equal(rankAfterSummaries(states(3, { 4: "needs_review", 5: "running" })), false);
  assert.equal(rankAfterSummaries(states(1, { 2: "needs_review", 3: "stale", 4: "stale", 5: "running" })), false);
  // (A failed or paused job never reaches this rule: its handler throws. At rest it leaves stage 5 "failed" or
  // "running", and the at-rest rule below does nothing for either.)
  for (const five of ["failed", "running", "stale", "not_started"] as StageState[]) assert.deepEqual(summariesStep(states(4, { 5: five })), { approve: false, rank: false }, five);
});

test("at rest: summaries left waiting are confirmed, and ranking starts only if it never ran", () => {
  // Stages 1-4 confirmed again after the summaries had to wait: confirm, and rank because ranking never ran.
  assert.deepEqual(summariesStep(states(4, { 5: "needs_review" })), { approve: true, rank: true });
  // Ranking has results (even out-of-date ones): confirm the summaries, leave the ranking for the user.
  for (const six of ["stale", "needs_review", "approved", "failed", "running"] as StageState[]) assert.deepEqual(summariesStep(states(4, { 5: "needs_review", 6: six })), { approve: true, rank: false }, six);
  // Summaries confirmed but ranking never started (kept summaries, or a start that failed): start it.
  assert.deepEqual(summariesStep(states(5)), { approve: false, rank: true });
  assert.deepEqual(summariesStep(states(5, { 6: "needs_review" })), { approve: false, rank: false });
  // An earlier stage is open: nothing happens until it is confirmed.
  assert.deepEqual(summariesStep(states(3, { 4: "needs_review", 5: "needs_review" })), { approve: false, rank: false });
  assert.deepEqual(summariesStep({ ...states(3, { 4: "stale" }), "5": "approved" }), { approve: false, rank: false });
});

test("the choose screen (stages 5 and 6) reads as one checkpoint through the chain", () => {
  const choose = STEPS.find((s) => s.key === "choose")!;
  assert.equal(stepStatus(choose, states(4, { 5: "running" })), "working");
  // Ranking starts while the summaries job is still being recorded, then stage 5 is confirmed: the screen reads
  // "working" all the way through and never "your turn" before the ranking is ready.
  assert.equal(stepStatus(choose, states(4, { 5: "running", 6: "running" })), "working");
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
