import "./testing/env";
import { test } from "node:test";
import assert from "node:assert/strict";
import { and, eq, inArray } from "drizzle-orm";
import { db, schema } from "./db";
import { approvalBlockers, approveStage } from "./gates";
import { HttpError } from "./project";
import { dispatch } from "./api";
import { generateTopics, restartScoping, scopingState } from "./stages/scoping";
import { updateQuery } from "./stages/search";
import { appraisalsView, rankingView, synthesisView } from "./views";
import { startJob } from "./jobs";
import { newId } from "./util";
import { STAGES } from "./shared/stages";
import { seedReview, setStates, allStates, settleJobs, stateOf, type Seeded } from "./testing/seed";

/** Stages before n approved, n and later "needs review" (so approving n does not auto-start the next job). */
function atStage(projectId: string, n: number) {
  setStates(projectId, Object.fromEntries(STAGES.map((s) => [String(s.n), s.n < n ? "approved" : "needs_review"])), { status: "active" });
}
function blocks(projectId: string, n: number, pattern: RegExp, overrides: string[] = []) {
  assert.throws(
    () => approveStage(projectId, n, overrides),
    (e: unknown) => e instanceof HttpError && e.status === 409 && pattern.test(e.message),
    `stage ${n} should be blocked by ${pattern}`,
  );
  assert.notEqual(stateOf(projectId, n), "approved");
}
function overrideFor(projectId: string, n: number, pattern: RegExp) {
  const b = approvalBlockers(projectId, n).find((x) => pattern.test(x.message));
  assert.ok(b, `expected a blocker matching ${pattern}`);
  assert.ok(b.override, `blocker "${b.message}" should be waivable`);
  return b.override!;
}
async function call(s: Seeded, method: string, path: string, body?: unknown) {
  const res = await dispatch(new Request(`http://test/api/projects/${s.projectId}/${path}`, { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) }), s.projectId, path.split("/"));
  return { status: res.status, data: await res.json() };
}

test("a complete, consistent review passes every gate (no false blocks)", () => {
  const s = seedReview();
  for (const st of STAGES) {
    atStage(s.projectId, st.n);
    assert.deepEqual(approvalBlockers(s.projectId, st.n), [], `stage ${st.n}`);
  }
  approveStage(s.projectId, 9);
  assert.equal(stateOf(s.projectId, 9), "approved");
});

test("a stale stage cannot be approved until it is re-run or kept", () => {
  const s = seedReview();
  atStage(s.projectId, 5);
  setStates(s.projectId, { ...allStates("approved"), "5": "stale", "6": "needs_review", "7": "needs_review", "8": "needs_review", "9": "needs_review" });
  blocks(s.projectId, 5, /Re-run this step or keep/);
});

test("stage 2: an empty topic list is blocked; fewer than 4 topics is allowed", () => {
  const s = seedReview();
  atStage(s.projectId, 2);
  approveStage(s.projectId, 2); // one topic
  atStage(s.projectId, 2);
  db.delete(schema.topics).where(eq(schema.topics.projectId, s.projectId)).run();
  blocks(s.projectId, 2, /at least one search topic/);
});

test("stage 2: restarting the chat marks later steps stale and old topics need regenerating", async () => {
  const s = seedReview();
  await restartScoping(s.projectId);
  for (let n = 3; n <= 9; n++) assert.equal(stateOf(s.projectId, n), "stale", `stage ${n}`);
  assert.equal(scopingState(s.projectId).topicsFromEarlierChat, true);
  blocks(s.projectId, 2, /restarted the scoping conversation/);
  await generateTopics(s.projectId);
  assert.equal(scopingState(s.projectId).topicsFromEarlierChat, false);
  assert.deepEqual(approvalBlockers(s.projectId, 2), []);
});

test("stage 3: every query must be dry-run; zero hits or a failed dry run needs an explicit keep", () => {
  const s = seedReview();
  atStage(s.projectId, 3);
  const [q0, q1] = s.queryIds;
  db.update(schema.queries).set({ dryRunAt: null, dryRunCount: null }).where(eq(schema.queries.id, q0)).run();
  blocks(s.projectId, 3, /Dry-run the PubMed query/);
  assert.equal(approvalBlockers(s.projectId, 3)[0].override, undefined, "an unchecked query cannot be waived");
  db.update(schema.queries).set({ dryRunAt: "2026-11-02T00:00:00.000Z", dryRunCount: 0 }).where(eq(schema.queries.id, q0)).run();
  db.update(schema.queries).set({ dryRunError: "HTTP 400", dryRunCount: null }).where(eq(schema.queries.id, q1)).run();
  blocks(s.projectId, 3, /matched 0 records/);
  const keep0 = overrideFor(s.projectId, 3, /matched 0 records/);
  const keep1 = overrideFor(s.projectId, 3, /failed its dry run/);
  blocks(s.projectId, 3, /failed its dry run/, [keep0]);
  approveStage(s.projectId, 3, [keep0, keep1]);
  assert.equal(stateOf(s.projectId, 3), "approved");
  const log = db.select().from(schema.decisionLog).where(and(eq(schema.decisionLog.projectId, s.projectId), eq(schema.decisionLog.action, "stage_approved"))).all().pop()!;
  assert.equal((log.after as { waived: unknown[] }).waived.length, 2, "waivers are logged");
});

test("stage 4: no papers, all queries failed, or results that no longer match the stored searches are blocked", () => {
  let s = seedReview();
  atStage(s.projectId, 4);
  db.delete(schema.papers).where(eq(schema.papers.projectId, s.projectId)).run();
  blocks(s.projectId, 4, /found no papers/);

  s = seedReview();
  atStage(s.projectId, 4);
  db.update(schema.searchRuns).set({ status: "failed", error: "HTTP 503" }).where(eq(schema.searchRuns.projectId, s.projectId)).run();
  blocks(s.projectId, 4, /Every query failed/);

  s = seedReview();
  atStage(s.projectId, 4);
  updateQuery(s.projectId, s.queryIds[0], "telemedicine[tiab] AND Vietnam[tiab]");
  atStage(s.projectId, 4);
  blocks(s.projectId, 4, /edited after retrieval ran/);

  s = seedReview();
  atStage(s.projectId, 4);
  const crit = db.select().from(schema.projects).where(eq(schema.projects.id, s.projectId)).get()!.criteria!;
  db.update(schema.projects).set({ criteria: { ...crit, inclusion: ["Rural settings only"] } }).where(eq(schema.projects.id, s.projectId)).run();
  assert.deepEqual(approvalBlockers(s.projectId, 4), [], "inclusion text is not a database filter");
  db.update(schema.projects).set({ criteria: { ...crit, yearFrom: 2010 } }).where(eq(schema.projects.id, s.projectId)).run();
  blocks(s.projectId, 4, /year or language limits changed/);

  s = seedReview();
  atStage(s.projectId, 4);
  db.update(schema.searchRuns).set({ status: "failed", error: "HTTP 503" }).where(eq(schema.searchRuns.id, s.runIds[1])).run();
  blocks(s.projectId, 4, /1 query failed/);
  approveStage(s.projectId, 4, [overrideFor(s.projectId, 4, /query failed/)]);
  assert.equal(stateOf(s.projectId, 4), "approved");
});

test("stage 5: a missing summary row blocks approval", () => {
  const s = seedReview();
  atStage(s.projectId, 5);
  db.delete(schema.paperSummaries).where(eq(schema.paperSummaries.paperId, s.paperIds[2])).run();
  blocks(s.projectId, 5, /1 paper has no summary row/);
});

test("stage 6: empty selection blocks; 1–2 or >5 needs an override; unscored candidates block", () => {
  let s = seedReview();
  atStage(s.projectId, 6);
  db.update(schema.scores).set({ selected: false }).where(inArray(schema.scores.id, s.scoreIds)).run();
  blocks(s.projectId, 6, /Select at least one paper/);
  assert.ok(approvalBlockers(s.projectId, 6).every((b) => !b.override), "an empty topic cannot be waived");

  db.update(schema.scores).set({ selected: true }).where(inArray(schema.scores.id, s.scoreIds.slice(0, 2))).run();
  blocks(s.projectId, 6, /2 selected papers; the target is 3–5/);
  approveStage(s.projectId, 6, [overrideFor(s.projectId, 6, /target is 3–5/)]);
  assert.equal(stateOf(s.projectId, 6), "approved");

  s = seedReview();
  atStage(s.projectId, 6);
  db.delete(schema.scores).where(eq(schema.scores.id, s.scoreIds[3])).run(); // as if its scoring batch failed
  assert.equal(rankingView(s.projectId).topics[0].unscored, 1);
  blocks(s.projectId, 6, /1 of 4 candidate papers .* could not be scored/);
});

test("stage 7: failed appraisals and undecided unverified quotes block; rejecting clears the count", () => {
  let s = seedReview();
  atStage(s.projectId, 7);
  db.update(schema.appraisals).set({ status: "failed", error: "model timeout" }).where(eq(schema.appraisals.id, s.appraisalIds[1])).run();
  blocks(s.projectId, 7, /appraisal of .* failed/);

  s = seedReview();
  atStage(s.projectId, 7);
  const cid = s.claimIds[2][1];
  db.update(schema.claims).set({ verified: false }).where(eq(schema.claims.id, cid)).run();
  blocks(s.projectId, 7, /1 unverified quote still needs your decision/);
  db.update(schema.claims).set({ userRejected: true }).where(eq(schema.claims.id, cid)).run();
  const row = appraisalsView(s.projectId).appraisals.find((a) => a.id === s.appraisalIds[2])!;
  assert.equal(row.counts.undecided, 0, "a rejected quote is no longer awaiting a decision");
  assert.equal(row.counts.rejected, 1);
  assert.deepEqual(approvalBlockers(s.projectId, 7), []);

  s = seedReview();
  atStage(s.projectId, 7);
  db.update(schema.scores).set({ selected: false }).where(eq(schema.scores.id, s.scoreIds[3])).run();
  blocks(s.projectId, 7, /papers you have since deselected/);
});

test("stage 8: a skipped topic shows why and must be acknowledged; citing a rejected quote blocks", async () => {
  const s = seedReview();
  const t2 = newId("t");
  db.insert(schema.topics).values({ id: t2, projectId: s.projectId, name: "Policy and regulation", sortOrder: 1 }).run();
  atStage(s.projectId, 8);
  startJob(s.projectId, "synthesis", 8);
  await settleJobs(s.projectId);
  const view = synthesisView(s.projectId);
  assert.match(view.topics.find((t) => t.id === t2)!.skipped ?? "", /No papers are selected for this topic/);
  blocks(s.projectId, 8, /“Policy and regulation” has no synthesis: No papers are selected/);
  approveStage(s.projectId, 8, [overrideFor(s.projectId, 8, /Policy and regulation/)]);
  assert.equal(stateOf(s.projectId, 8), "approved");

  const s2 = seedReview();
  atStage(s2.projectId, 8);
  db.update(schema.claims).set({ verified: false, userRejected: true }).where(eq(schema.claims.id, s2.claimIds[0][0])).run();
  blocks(s2.projectId, 8, /cites 1 quote that you have since rejected/);
});

test("stage 9: editing the chosen question outdates its novelty check and gap until re-checked", async () => {
  const s = seedReview();
  atStage(s.projectId, 9);
  // The question and the searches written for it are saved together, so one re-run checks the new wording.
  const r = await call(s, "PATCH", `questions/${s.questionId}`, {
    text: "Among rural clinics in Vietnam, does connectivity investment increase uptake?",
    noveltyQueries: [{ database: "pubmed", query: "telemedicine AND connectivity AND Vietnam" }],
  });
  assert.equal(r.status, 200);
  const q = r.data.questions.find((x: { id: string }) => x.id === s.questionId);
  assert.equal(q.noveltyStatus, "outdated");
  assert.equal(q.gapOutdated, true);
  blocks(s.projectId, 9, /novelty check ran/);
  await call(s, "POST", `questions/${s.questionId}/novelty`, {});
  blocks(s.projectId, 9, /gap was written for the earlier version/);
  await call(s, "POST", `questions/${s.questionId}/gap-confirm`, {});
  assert.deepEqual(approvalBlockers(s.projectId, 9), []);
  const fin = await call(s, "POST", "stages/9/approve", {});
  assert.equal(fin.status, 200);
  assert.equal(fin.data.project.status, "complete");
});

test("approve over HTTP returns the outstanding blockers", async () => {
  const s = seedReview();
  atStage(s.projectId, 5);
  db.delete(schema.paperSummaries).where(eq(schema.paperSummaries.paperId, s.paperIds[0])).run();
  const r = await call(s, "POST", "stages/5/approve", {});
  assert.equal(r.status, 409);
  assert.match(r.data.blockers[0].message, /no summary row/);
  const b = await call(s, "GET", "stages/5/blockers");
  assert.equal(b.data.blockers.length, 1);
});
