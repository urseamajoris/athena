import "./testing/env";
import { test } from "node:test";
import assert from "node:assert/strict";
import { eq, inArray } from "drizzle-orm";
import { db, schema } from "./db";
import { dispatch } from "./api";
import { startJob, cancelStage } from "./jobs";
import { findExisting, mergeInto } from "./jobs/retrieval";
import { runNovelty } from "./jobs/questions";
import { adapters } from "./sources";
import { markdownReport, summaryCsv } from "./export";
import { scopingState } from "./stages/scoping";
import { markDownstreamStale } from "./project";
import { newId, normalizeTitle } from "./util";
import type { SourceRecord } from "./sources/types";
import type { Criteria } from "./db/schema";
import { seedReview, settleJobs, stateOf, setStates, allStates, type Seeded } from "./testing/seed";

async function call(s: Seeded, method: string, path: string, body?: unknown) {
  const res = await dispatch(new Request(`http://test/api/projects/${s.projectId}/${path}`, { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) }), s.projectId, path.split("/"));
  return { status: res.status, data: await res.json() };
}

/** Every claim cited anywhere in synthesis or questions still exists. */
function danglingCitations(projectId: string) {
  const claims = new Set(db.select({ id: schema.claims.id }).from(schema.claims).all().map((c) => c.id));
  const items = db.select().from(schema.synthesisItems).where(eq(schema.synthesisItems.projectId, projectId)).all();
  const qs = db.select().from(schema.researchQuestions).where(eq(schema.researchQuestions.projectId, projectId)).all();
  const links = db.select().from(schema.claimLinks).where(inArray(schema.claimLinks.ownerId, [...items, ...qs].map((x) => x.id).concat(["-"]))).all();
  const cells = db.select().from(schema.matrixCells).where(eq(schema.matrixCells.projectId, projectId)).all();
  const cx = db.select().from(schema.contradictions).where(eq(schema.contradictions.projectId, projectId)).all();
  return {
    uncitedProse: items.filter((i) => !links.some((l) => l.ownerId === i.id)).length + qs.filter((q) => !links.some((l) => l.ownerId === q.id)).length,
    dangling: [...links.map((l) => l.claimId), ...cells.flatMap((c) => c.claimIds), ...cx.flatMap((c) => c.claimIds)].filter((id) => !claims.has(id)).length,
    items: items.length,
    cells: cells.length,
    contradictions: cx.length,
    questions: qs.length,
  };
}

test("single-paper re-appraisal marks later stages stale before deleting, and leaves no prose citing removed claims", async () => {
  const s = seedReview();
  startJob(s.projectId, "appraisal", 7, { paperIds: [s.paperIds[0]] }, "re-appraised");
  // Synchronously, before the job's microtask has deleted anything:
  assert.equal(stateOf(s.projectId, 7), "running");
  assert.equal(stateOf(s.projectId, 8), "stale");
  assert.equal(stateOf(s.projectId, 9), "stale");
  assert.equal(db.select().from(schema.claims).where(eq(schema.claims.paperId, s.paperIds[0])).all().length, 2, "nothing deleted yet");
  await settleJobs(s.projectId);
  const d = danglingCitations(s.projectId);
  assert.equal(d.dangling, 0);
  assert.equal(d.uncitedProse, 0);
  // Both synthesis statements and the contradiction and the question cited paper 0's claims, so they went with them;
  // matrix cells of the other three papers did not.
  assert.equal(d.items, 0);
  assert.equal(d.contradictions, 0);
  assert.equal(d.questions, 0);
  assert.equal(d.cells, 3);
  const log = db.select().from(schema.decisionLog).where(eq(schema.decisionLog.action, "evidence_dependents_removed")).all().filter((r) => r.projectId === s.projectId);
  assert.equal(log.length, 1, "removed text is kept in the decision log");
});

test("a fresh retrieval marks 5–9 stale first and removes every synthesis/question built on the old papers", async () => {
  const s = seedReview();
  startJob(s.projectId, "retrieval", 4);
  for (let n = 5; n <= 9; n++) assert.equal(stateOf(s.projectId, n), "stale", `stage ${n}`);
  assert.equal(db.select().from(schema.papers).where(eq(schema.papers.projectId, s.projectId)).all().length, 4, "nothing deleted yet");
  await settleJobs(s.projectId);
  const d = danglingCitations(s.projectId);
  assert.deepEqual([d.dangling, d.uncitedProse, d.items, d.contradictions, d.questions], [0, 0, 0, 0, 0]);
  // A finished re-run does not undo the stale marks downstream.
  for (let n = 5; n <= 9; n++) assert.equal(stateOf(s.projectId, n), "stale");
});

test("cancelling a re-run keeps earlier results reviewable; failed only when nothing ever finished", () => {
  const live = (s: Seeded, status: "queued" | "running") => {
    db.insert(schema.jobs).values({ id: newId("job"), projectId: s.projectId, kind: "ranking", stage: 6, status, startedAt: status === "running" ? new Date().toISOString() : null }).run();
    setStates(s.projectId, { ...allStates("approved"), "6": "running" });
  };
  let s = seedReview(); // has a finished ranking job
  live(s, "running");
  assert.equal(cancelStage(s.projectId, 6), 1);
  assert.equal(stateOf(s.projectId, 6), "stale");

  s = seedReview();
  live(s, "queued");
  cancelStage(s.projectId, 6);
  assert.equal(stateOf(s.projectId, 6), "needs_review");

  s = seedReview();
  db.delete(schema.jobs).where(eq(schema.jobs.projectId, s.projectId)).run();
  live(s, "running");
  cancelStage(s.projectId, 6);
  assert.equal(stateOf(s.projectId, 6), "failed");

  s = seedReview();
  assert.equal(cancelStage(s.projectId, 6), 0, "nothing running: no state change");
  assert.equal(stateOf(s.projectId, 6), "approved");
});

function rec(p: Partial<SourceRecord>): SourceRecord {
  return { database: "openalex", doi: null, pmid: null, pmcid: null, openalexId: null, title: "", authors: [], year: 2021, journal: null, abstract: null, language: "en", publicationTypes: [], citationCount: null, oaUrl: null, oaStatus: null, license: null, ...p };
}

test("dedup never title-merges records whose DOI, PMID or OpenAlex ID disagree", () => {
  const s = seedReview(2);
  const title = "Telemedicine in Southeast Asia: a scoping review of implementation";
  const pid = newId("p");
  db.insert(schema.papers).values({ id: pid, projectId: s.projectId, doi: "10.1/aaa", pmid: "111", openalexId: "W1", title, normTitle: normalizeTitle(title) }).run();
  const existing = db.select().from(schema.papers).where(eq(schema.papers.id, pid)).get()!;
  assert.equal(findExisting(s.projectId, rec({ title }))?.id, pid, "same title, no identifiers: duplicate");
  assert.equal(findExisting(s.projectId, rec({ title, doi: "10.1/aaa" }))?.id, pid);
  assert.equal(findExisting(s.projectId, rec({ title, doi: "10.1/bbb" })), undefined, "different DOI: different paper");
  assert.equal(findExisting(s.projectId, rec({ title, pmid: "222" })), undefined, "different PMID");
  assert.equal(findExisting(s.projectId, rec({ title, openalexId: "W2" })), undefined, "different OpenAlex ID");
  assert.deepEqual(mergeInto(existing, rec({ title, doi: "10.1/bbb", abstract: "x".repeat(500) }), "openalex"), {}, "conflicting records are never merged");
  assert.ok(Object.keys(mergeInto(existing, rec({ title, abstract: "x".repeat(500) }), "openalex")).includes("abstract"));
});

test("the novelty search runs with year and language limits cleared and keeps the rest", async () => {
  const s = seedReview(2);
  const seen: (Criteria | null)[] = [];
  const orig = adapters.pubmed.search;
  adapters.pubmed.search = async (q, c, cap, o) => {
    seen.push(c);
    return orig.call(adapters.pubmed, q, c, cap, o);
  };
  try {
    await runNovelty(s.questionId, new Set(), () => {});
  } finally {
    adapters.pubmed.search = orig;
  }
  assert.equal(seen.length, 1);
  assert.deepEqual([seen[0]!.yearFrom, seen[0]!.yearTo, seen[0]!.languages], [null, null, []]);
  assert.deepEqual(seen[0]!.inclusion, ["Southeast Asia"]);
});

test("the report and CSV do not look final or AI-only when they are not", async () => {
  const s = seedReview();
  let md = markdownReport(s.projectId);
  assert.ok(!md.includes("DRAFT"), "an all-approved review is not a draft");
  db.update(schema.projects).set({ stageStates: { ...allStates("approved"), "4": "stale", "9": "needs_review" }, staleReasons: { "4": "A search query was edited" } }).where(eq(schema.projects.id, s.projectId)).run();
  md = markdownReport(s.projectId);
  assert.ok(md.startsWith("# DRAFT Literature review"));
  assert.match(md.slice(0, 600), /Step 4 \(Retrieval\): \*\*stale\*\* — A search query was edited/);
  assert.match(md.slice(0, 600), /Step 9 \(Research question\): \*\*needs review\*\*/);

  // A rejected checklist quote withdraws the answer.
  const cl = s.claimIds[1][1];
  db.update(schema.claims).set({ verified: false, userRejected: true }).where(eq(schema.claims.id, cl)).run();
  md = markdownReport(s.projectId);
  const paper1 = md.slice(md.indexOf("cohort 2 ("));
  const line = paper1.split("\n").find((l) => l.startsWith("- Was the sample representative?"))!;
  assert.match(line, /~~yes~~ \*\*answer rejected by user\*\*/);
  assert.ok(!line.includes("**yes**"));

  // A corrected summary cell is labelled as corrected, not only abstract-derived.
  const r = await call(s, "PATCH", `papers/${s.paperIds[0]}/summary`, { setting: "Rural Vietnam" });
  assert.equal(r.data.changed, true);
  const csv = summaryCsv(s.projectId).split("\n");
  assert.ok(!csv[0].includes("abstract-derived"));
  const row = csv.find((l) => l.startsWith(s.paperIds[0]))!;
  assert.match(row, /AI-derived from the abstract; corrected by the researcher: setting/);
  assert.match(csv.find((l) => l.startsWith(s.paperIds[1]))!, /,AI-derived from the abstract,/);
});

test("a summary 'edit' that changes nothing does not mark later steps stale", async () => {
  const s = seedReview();
  const r = await call(s, "PATCH", `papers/${s.paperIds[0]}/summary`, { studyType: "cross_sectional" });
  assert.equal(r.data.changed, false);
  assert.equal(stateOf(s.projectId, 6), "approved");
  await call(s, "PATCH", `papers/${s.paperIds[0]}/summary`, { studyType: "cohort" });
  assert.equal(stateOf(s.projectId, 6), "stale");
});

test("the scoping summary is an editable checkpoint that marks later steps stale", async () => {
  const s = seedReview();
  const summary = { population: "Older adults", setting: "Southeast Asia", phenomenon: "Telemedicine", outcome: "Adoption", timeframe: "2015 onwards", studyTypes: "Any" };
  const r = await call(s, "PATCH", "scoping/summary", summary);
  assert.equal(r.status, 200);
  assert.equal(scopingState(s.projectId).summary?.population, "Older adults");
  assert.equal(stateOf(s.projectId, 2), "needs_review");
  for (let n = 3; n <= 9; n++) assert.equal(stateOf(s.projectId, n), "stale");
  const p = db.select().from(schema.projects).where(eq(schema.projects.id, s.projectId)).get()!;
  assert.equal(p.status, "active", "a review with stale steps is no longer complete");
});

test("retrying unscored papers scores only the missing ones and keeps the researcher's selection", async () => {
  const s = seedReview();
  // The researcher deselected paper 0 and picked paper 1 by hand; paper 3's scoring batch had failed.
  db.update(schema.scores).set({ selected: false, userChanged: true }).where(eq(schema.scores.id, s.scoreIds[0])).run();
  db.delete(schema.scores).where(eq(schema.scores.id, s.scoreIds[3])).run();
  startJob(s.projectId, "ranking", 6, { retryMissing: true });
  await settleJobs(s.projectId);
  const scores = db.select().from(schema.scores).where(eq(schema.scores.topicId, s.topicId)).all();
  assert.equal(scores.length, 4, "the missing paper was scored");
  assert.equal(scores.find((x) => x.id === s.scoreIds[0])?.selected, false, "deselection kept");
  assert.equal(scores.find((x) => x.paperId === s.paperIds[3])?.selected, false, "a retried paper is not silently added to a topic that has a selection");
  assert.equal(stateOf(s.projectId, 7), "stale");
});

test("a job whose stage was marked stale while it ran (upstream edited mid-run) finishes as stale, not needs-review", async () => {
  const s = seedReview();
  startJob(s.projectId, "ranking", 6);
  assert.equal(stateOf(s.projectId, 6), "running");
  markDownstreamStale(s.projectId, 5, "A summary-table cell was corrected");
  await settleJobs(s.projectId);
  assert.equal(stateOf(s.projectId, 6), "stale");
});
