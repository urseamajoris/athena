import { test } from "node:test";
import assert from "node:assert/strict";
import { STEP_BY_KEY } from "@/lib/shared/flow";
import type { StageState } from "@/lib/shared/stages";
import { pickBanner, stopKindOf, type BannerInput } from "./banner";

function upTo(n: number, ...rest: StageState[]): Record<string, StageState> {
  const s: Record<string, StageState> = {};
  for (let i = 1; i <= 9; i++) s[String(i)] = i <= n ? "approved" : rest[i - n - 1] ?? "not_started";
  return s;
}
const OK_AI = { enabled: true, budgetReached: false, keyMissing: false };
const base = (over: Partial<BannerInput>): BannerInput => ({ step: STEP_BY_KEY.question, states: upTo(1, "needs_review"), staleReasons: {}, jobs: {}, ai: OK_AI, credits: { balance: 50, exempt: false }, ...over });
const job = (status: string, error: string | null = null, done = 3, total = 10, message = "") => ({ status, error, progress: { done, total, message } });

test("nothing to say when the screen is ready and AI can run", () => {
  assert.equal(pickBanner(base({})), null);
});

test("no API key: AI is not set up, on a screen that needs AI", () => {
  assert.deepEqual(pickBanner(base({ ai: { ...OK_AI, keyMissing: true } })), { kind: "ai-not-set-up" });
  // The idea screen needs no AI, and a finished screen has no AI work left.
  assert.equal(pickBanner(base({ step: STEP_BY_KEY.idea, states: upTo(0, "needs_review"), ai: { ...OK_AI, keyMissing: true } })), null);
  assert.equal(pickBanner(base({ step: STEP_BY_KEY.question, states: upTo(2), ai: { ...OK_AI, keyMissing: true } })), null);
});

test("AI switched off, and the server budget", () => {
  assert.deepEqual(pickBanner(base({ ai: { ...OK_AI, enabled: false } })), { kind: "ai-paused" });
  assert.deepEqual(pickBanner(base({ ai: { ...OK_AI, budgetReached: true } })), { kind: "budget" });
});

test("out of credits: a balance of 0 for an account that pays", () => {
  assert.deepEqual(pickBanner(base({ credits: { balance: 0, exempt: false } })), { kind: "credits" });
  assert.equal(pickBanner(base({ credits: { balance: 0, exempt: true } })), null);
  // Unknown balance never blocks.
  assert.equal(pickBanner(base({ credits: null })), null);
  // Credits come before the server's own states: it is the one the user can fix.
  assert.deepEqual(pickBanner(base({ credits: { balance: -0.2, exempt: false }, ai: { ...OK_AI, keyMissing: true } })), { kind: "credits" });
});

test("out of credits: a paused job or a failed action whose message says so", () => {
  const msg = "You are out of credits. Buy more to continue. Your work is saved.";
  const states = upTo(6, "running");
  assert.deepEqual(pickBanner(base({ step: STEP_BY_KEY.articles, states, jobs: { "7": job("paused", msg) } })), { kind: "credits" });
  assert.deepEqual(pickBanner(base({ actionError: { message: msg, kind: "ai_paused" } })), { kind: "credits" });
  assert.equal(stopKindOf(msg), "credits");
});

test("a paused job says why it waits", () => {
  const states = upTo(6, "running");
  const noKey = "AI is not set up on this server yet: no API key is configured. An administrator can add one in the dashboard. Your work is saved.";
  assert.deepEqual(pickBanner(base({ step: STEP_BY_KEY.articles, states, jobs: { "7": job("paused", noKey) } })), { kind: "ai-not-set-up" });
  assert.deepEqual(pickBanner(base({ step: STEP_BY_KEY.articles, states, jobs: { "7": job("paused", "AI is paused by the administrator. Your work is saved.") } })), { kind: "ai-paused" });
});

test("working: live progress from the job", () => {
  const b = pickBanner(base({ step: STEP_BY_KEY.found, states: upTo(3, "running"), jobs: { "4": job("running", null, 3, 16, "Searching PubMed") } }));
  assert.deepEqual(b, { kind: "working", title: "Searching PubMed", done: 3, total: 16, stage: 4 });
  // `choose` covers two stages: the banner follows the one that is running.
  const c = pickBanner(base({ step: STEP_BY_KEY.choose, states: upTo(5, "running"), jobs: { "5": job("done"), "6": job("running", null, 1, 4, "Ranking") } }));
  assert.equal(c?.kind === "working" && c.stage, 6);
  // One long request (no job): the tracked label.
  assert.deepEqual(pickBanner(base({ pending: { label: "Building your search plan" } })), { kind: "working", title: "Building your search plan…" });
});

test("stopped: what went wrong", () => {
  const b = pickBanner(base({ step: STEP_BY_KEY.found, states: upTo(3, "failed"), jobs: { "4": job("failed", "PubMed did not answer") } }));
  assert.deepEqual(b, { kind: "failed", message: "PubMed did not answer", stage: 4 });
  assert.deepEqual(pickBanner(base({ actionError: { message: "Write your idea first." } })), { kind: "failed", message: "Write your idea first.", fromAction: true });
});

test("out of date: why, and the screen to finish first if there is one", () => {
  const states = { ...upTo(2), "3": "stale" as const, "4": "stale" as const };
  const b = pickBanner(base({ step: STEP_BY_KEY.search, states, staleReasons: { "3": "The research question changed" } }));
  assert.deepEqual(b, { kind: "stale", reason: "The research question changed", stage: 3, blocker: null });
  const later = pickBanner(base({ step: STEP_BY_KEY.found, states }));
  assert.equal(later?.kind === "stale" && later.blocker?.key, "search");
});

test("locked and finished screens show no banner", () => {
  assert.equal(pickBanner(base({ step: STEP_BY_KEY.report, ai: { ...OK_AI, keyMissing: true } })), null);
  assert.equal(pickBanner(base({ step: STEP_BY_KEY.idea })), null);
});
