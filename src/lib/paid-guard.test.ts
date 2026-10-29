import { test } from "node:test";
import assert from "node:assert/strict";
import { countPaidCall, emptyPaidCalls, resolveMode } from "./paid-guard";

test("production is ATHENA_ENV=production only", () => {
  assert.deepEqual(resolveMode({}), { production: false });
  assert.equal(resolveMode({ ATHENA_ENV: "" }).production, false);
  assert.equal(resolveMode({ NODE_ENV: "production" }).production, false, "NODE_ENV alone is not production");
  assert.equal(resolveMode({ ATHENA_ENV: "production" }).production, true);
  assert.equal(resolveMode({ ATHENA_ENV: " Production " }).production, true);
});

test("paid calls are counted, never blocked", () => {
  const calls = emptyPaidCalls();
  assert.doesNotThrow(() => countPaidCall(calls, "ai"));
  countPaidCall(calls, "ai");
  countPaidCall(calls, "openalex");
  countPaidCall(calls, "keyTest");
  // The breakdown always adds up to the total, so the dashboard can say what the total includes.
  assert.deepEqual(calls, { attempted: 4, blocked: 0, byKind: { ai: 2, keyTest: 1, openalex: 1 } });
});
