import { test } from "node:test";
import assert from "node:assert/strict";
import { countPaidCall, resolveMode, type PaidCalls } from "./paid-guard";

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
