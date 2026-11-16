import { test } from "node:test";
import assert from "node:assert/strict";
import { allowsMoreThan, budgetReached, countPaidCall, hasCap, parseBudget, resolveMode, type PaidCalls } from "./paid-guard";

test("production is ATHENA_ENV=production only", () => {
  assert.deepEqual(resolveMode({}), { production: false });
  assert.equal(resolveMode({ ATHENA_ENV: "" }).production, false);
  assert.equal(resolveMode({ NODE_ENV: "production" }).production, false, "NODE_ENV alone is not production");
  assert.equal(resolveMode({ ATHENA_ENV: "production" }).production, true);
  assert.equal(resolveMode({ ATHENA_ENV: " Production " }).production, true);
});

test("paid calls are counted, never blocked", () => {
  const calls: PaidCalls = { attempted: 0, blocked: 0 };
  assert.doesNotThrow(() => countPaidCall(calls));
  countPaidCall(calls);
  assert.deepEqual(calls, { attempted: 2, blocked: 0 });
});

test("AI_BUDGET_USD: empty, 0 or nonsense means no cap", () => {
  for (const v of [undefined, null, "", "  ", "0", "0.0", "-3", "abc", 0, -1, NaN, Infinity]) assert.equal(parseBudget(v), 0, String(v));
  assert.equal(parseBudget("5"), 5);
  assert.equal(parseBudget(" 12.50 "), 12.5);
  assert.equal(parseBudget(7), 7);
  assert.equal(hasCap(0), false);
  assert.equal(hasCap(0.01), true);
});

test("the budget is reached only when a cap is set and spend has met it", () => {
  assert.equal(budgetReached(0, 0), false, "no cap, nothing spent");
  assert.equal(budgetReached(1_000_000, 0), false, "no cap: never reached");
  assert.equal(budgetReached(4.99, 5), false);
  assert.equal(budgetReached(5, 5), true);
  assert.equal(budgetReached(5.01, 5), true);
});

test("comparing limits: no cap allows more than any cap", () => {
  assert.equal(allowsMoreThan(0, 5), true, "removing a cap");
  assert.equal(allowsMoreThan(10, 5), true);
  assert.equal(allowsMoreThan(5, 5), false);
  assert.equal(allowsMoreThan(3, 5), false);
  assert.equal(allowsMoreThan(5, 0), false, "any cap is tighter than none");
  assert.equal(allowsMoreThan(0, 0), false);
});
