import { test } from "node:test";
import assert from "node:assert/strict";
import { abandonment, cleanClientMessage, dailySeries, frontierOf, funnel, furthestOf, pagePattern, percentile, progressCounts, projectExhaustion, projectsPerUser, topRows, verdict, type VerdictInput } from "./metrics";
import type { StageState } from "../shared/stages";

const states = (approvedThrough: number, rest: StageState = "needs_review") =>
  Object.fromEntries(Array.from({ length: 9 }, (_, i) => [String(i + 1), i + 1 <= approvedThrough ? "approved" : i + 1 === approvedThrough + 1 ? rest : "not_started"])) as Record<string, StageState>;

test("percentiles", () => {
  assert.equal(percentile([], 50), null);
  assert.equal(percentile([5], 99), 5);
  assert.equal(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 50), 5);
  assert.equal(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 90), 9);
  assert.equal(percentile([10, 1, 100], 99), 100);
});

test("daily series fills missing days with zero", () => {
  const now = Date.parse("2026-10-29T12:00:00Z");
  const s = dailySeries([{ at: "2026-10-29T01:00:00Z", v: 2 }, { at: "2026-10-27T05:00:00Z", v: 3 }, { at: "2026-10-01T00:00:00Z", v: 99 }], 3, now, (r) => r.at, (r) => r.v);
  assert.deepEqual(s, [{ day: "2026-10-27", value: 3 }, { day: "2026-10-28", value: 0 }, { day: "2026-10-29", value: 2 }]);
});

test("funnel: reached and approved per stage; finished projects reach every stage", () => {
  const ps = [{ stageStates: states(0) }, { stageStates: states(3) }, { stageStates: states(9) }];
  assert.equal(frontierOf(states(9)), 10);
  const f = funnel(ps);
  assert.deepEqual(f.map((x) => x.reached), [3, 2, 2, 2, 1, 1, 1, 1, 1]);
  assert.deepEqual(f.map((x) => x.approved), [2, 2, 2, 1, 1, 1, 1, 1, 1]);
});

test("going back after finishing: reached, finished and the furthest step keep the high-water mark", () => {
  // Finished all nine, then deselected a paper at step 6: step 6 is open again and 7-9 are out of date.
  const back = { stageStates: { ...states(5), "6": "needs_review", "7": "stale", "8": "stale", "9": "stale" } as Record<string, StageState>, status: "complete" };
  const atFour = { stageStates: states(3), status: "active" };
  assert.equal(frontierOf(back.stageStates), 6, "now at step 6");
  assert.equal(furthestOf(back), 10, "finished once");
  assert.equal(furthestOf(atFour), 4);
  const f = funnel([back, atFour]);
  assert.deepEqual(f.map((x) => x.reached), [2, 2, 2, 2, 1, 1, 1, 1, 1], "a step stays reached when it goes out of date");
  assert.deepEqual(f.map((x) => x.approved), [2, 2, 2, 1, 1, 0, 0, 0, 0]);
  assert.deepEqual(f.map((x) => x.outOfDate), [0, 0, 0, 0, 0, 0, 1, 1, 1]);
  assert.deepEqual(progressCounts([back, atFour]), { finished: 1, finishedNow: 0, reopened: 1 });
  // Edited step 2 before ever finishing: the stale later steps were reached; the project is not finished.
  const edited = { stageStates: { ...states(1), "2": "needs_review", "3": "stale", "4": "stale" } as Record<string, StageState>, status: "active" };
  assert.equal(furthestOf(edited), 4);
  assert.deepEqual(progressCounts([edited]), { finished: 0, finishedNow: 0, reopened: 1 });
  // Step 1 approved but step 2 not started yet: step 2 is open, so it counts as reached.
  assert.equal(furthestOf({ stageStates: { ...states(1), "2": "not_started" } }), 2);
});

test("abandonment counts only idle unfinished projects, by the stage they stopped at", () => {
  const now = Date.parse("2026-10-29T00:00:00Z");
  const old = "2026-10-01T00:00:00Z";
  const a = abandonment([
    { stageStates: states(3), status: "active", updatedAt: old },
    { stageStates: states(3), status: "active", updatedAt: "2026-10-28T00:00:00Z" },
    { stageStates: states(9), status: "complete", updatedAt: old },
  ], now);
  assert.equal(a.find((x) => x.stage === 4)!.projects, 1);
  assert.equal(a.reduce((s, x) => s + x.projects, 0), 1);
});

test("projects per user buckets", () => {
  assert.deepEqual(projectsPerUser([0, 1, 1, 3, 7]), [{ bucket: "0", users: 1 }, { bucket: "1", users: 2 }, { bucket: "2–5", users: 1 }, { bucket: "6+", users: 1 }]);
});

test("budget exhaustion projection", () => {
  const now = Date.parse("2026-10-29T00:00:00Z");
  const calls = [{ createdAt: "2026-10-22T00:00:00Z", costUsd: 3.5 }, { createdAt: "2026-10-28T00:00:00Z", costUsd: 3.5 }];
  const p = projectExhaustion(calls, 7, 15, now);
  assert.equal(p.perDay.toFixed(2), "1.00");
  assert.equal(p.daysLeft!.toFixed(1), "8.0");
  assert.equal(projectExhaustion([], 0, 15, now).exhaustedAt, null);
  assert.equal(projectExhaustion(calls, 15, 15, now).daysLeft, 0);
});

test("budget forecast: a burst of a few hours is not a daily rate", () => {
  // Run 3: $2.46 spent within two hours on one day, limit $10. No forecast until there are 3 days of history.
  const now = Date.parse("2026-10-29T14:30:00Z");
  const burst = [{ createdAt: "2026-10-29T12:12:00Z", costUsd: 1.2 }, { createdAt: "2026-10-29T14:01:00Z", costUsd: 1.26 }];
  const p = projectExhaustion(burst, 2.46, 10, now);
  assert.equal(p.enoughHistory, false);
  assert.equal(p.daysLeft, null);
  assert.equal(p.exhaustedAt, null);
  assert.equal(projectExhaustion(burst, 10, 10, now).daysLeft, 0, "a reached limit is always reported");
  // Four days of history: the rate is averaged over those days, not over the hours with calls.
  const later = Date.parse("2026-11-02T14:30:00Z");
  const q = projectExhaustion(burst, 2.46, 10, later);
  assert.equal(q.enoughHistory, true);
  assert.equal(q.windowDays.toFixed(2), "4.10");
  assert.equal(q.perDay.toFixed(2), (2.46 / 4.1).toFixed(2));
});

test("breakdowns keep their total when rows are grouped", () => {
  const rows = Array.from({ length: 15 }, (_, i) => ({ key: `p${i}`, calls: i + 1, cost: (i + 1) / 100, failed: i === 3 ? 1 : 0 }));
  const top = topRows(rows, 9);
  assert.equal(top.length, 9);
  assert.equal(top.at(-1)!.key, "other (7 more)");
  assert.equal(top.reduce((a, r) => a + r.calls, 0), rows.reduce((a, r) => a + r.calls, 0));
  assert.equal(top.reduce((a, r) => a + r.cost, 0).toFixed(6), rows.reduce((a, r) => a + r.cost, 0).toFixed(6));
  assert.deepEqual(topRows(rows.slice(0, 5), 9), rows.slice(0, 5));
});

const ok: VerdictInput = { dbOk: true, requestsLastHour: 100, errors5xxLastHour: 0, stuckJobs: 0, pausedJobs: 0, aiEnabled: true, spent: 1, limit: 15, sourceErrorRates: [], keyProblem: null, modelProblems: [] };
test("verdict: green, amber and red rules", () => {
  assert.equal(verdict(ok).level, "green");
  assert.equal(verdict({ ...ok, aiEnabled: false }).level, "amber");
  assert.equal(verdict({ ...ok, spent: 12 }).level, "amber");
  assert.equal(verdict({ ...ok, spent: 15 }).level, "red");
  assert.equal(verdict({ ...ok, errors5xxLastHour: 6 }).level, "red");
  assert.equal(verdict({ ...ok, requestsLastHour: 10, errors5xxLastHour: 6 }).level, "amber", "too few requests to call it an outage");
  assert.equal(verdict({ ...ok, dbOk: false }).level, "red");
  assert.equal(verdict({ ...ok, sourceErrorRates: [{ source: "openalex", requests: 40, errorRate: 0.5 }] }).level, "amber");
  assert.match(verdict({ ...ok, spent: 12 }).reasons[0].text, /80%/);
});

test("verdict: source failures that are expected are worth a look, not 'no problems'", () => {
  // Run 3: Europe PMC 10 of 61 failed, PDF downloads 2 of 5 (papers that are not open access).
  const v = verdict({ ...ok, sourceErrorRates: [{ source: "europepmc", requests: 61, errors: 10, errorRate: 10 / 61 }, { source: "pdf", requests: 5, errors: 2, errorRate: 0.4 }, { source: "pubmed", requests: 46, errors: 0, errorRate: 0 }] });
  assert.equal(v.level, "green");
  assert.equal(v.worthALook, true);
  assert.equal(v.reasons.length, 2);
  assert.match(v.reasons[0].text, /Europe PMC.*10 of 61 requests, 16%.*not open access.*abstract/);
  assert.ok(!v.reasons.some((r) => r.text === "No problems found."));
  // Most full-text lookups failing means something broke.
  assert.equal(verdict({ ...ok, sourceErrorRates: [{ source: "europepmc", requests: 40, errorRate: 0.8 }] }).level, "amber");
  // A search source failing 16% is worth a look; over 25% needs attention.
  assert.equal(verdict({ ...ok, sourceErrorRates: [{ source: "pubmed", requests: 40, errorRate: 0.16 }] }).worthALook, true);
  assert.equal(verdict({ ...ok, sourceErrorRates: [{ source: "pubmed", requests: 40, errorRate: 0.3 }] }).level, "amber");
  assert.equal(verdict(ok).worthALook, false);
});

test("browser error messages keep the error, not the user's data", () => {
  assert.equal(cleanClientMessage("Failed to execute 'removeChild' on 'Node': The node to be removed is not a child of this node."), "Failed to execute 'removeChild' on 'Node': The node to be removed is not a child of this node.");
  assert.equal(cleanClientMessage("Failed to fetch https://x.test/api/projects/prj_acb566aca05548da/papers"), "Failed to fetch <url>");
  assert.equal(cleanClientMessage("No paper prj_acb566aca05548da for mai@example.com"), "No paper <id> for <email>");
  assert.equal(cleanClientMessage('Unexpected token in "my research idea about sleep and grades in UK students"'), 'Unexpected token in "…"');
  assert.equal(cleanClientMessage("chunk 4f9a8c7d6e5b4a39 failed after 1234567 ms"), "chunk <id> failed after <id> ms");
  assert.equal(cleanClientMessage("   "), "Unknown error");
  assert.equal(cleanClientMessage("x".repeat(500)).length, 160);
});

test("browser error pages are patterns without IDs or query strings", () => {
  assert.equal(pagePattern("/s/prj_acb566aca05548da/export?x=1"), "/s/:id/export");
  assert.equal(pagePattern("/s/new"), "/s/new");
  assert.equal(pagePattern("/admin"), "/admin");
  assert.equal(pagePattern("/"), "/");
  assert.equal(pagePattern("/a/b/c/d/e/f/g"), "/a/b/c/d/e");
});

test("verdict: errors in users' browsers are not 'healthy'", () => {
  const v = verdict({ ...ok, clientErrorsLastHour: 3, topClientError: { page: "/s/:id", message: "Failed to execute 'removeChild'" } });
  assert.equal(v.level, "amber");
  assert.match(v.reasons[0].text, /3 errors in users' browsers in the last hour.*\/s\/:id.*removeChild/);
});
