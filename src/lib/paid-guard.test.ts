import { test } from "node:test";
import assert from "node:assert/strict";
import { assertPaidAllowed, PaidApiBlockedError, resolveMode, startupProblem } from "./paid-guard";

test("mock mode is the default outside production", () => {
  assert.deepEqual(resolveMode({}), { production: false, mockMode: true, mockAi: true });
  assert.deepEqual(resolveMode({ MOCK_MODE: "" }), { production: false, mockMode: true, mockAi: true });
  assert.equal(resolveMode({ NODE_ENV: "production" }).mockMode, true, "NODE_ENV alone is not production");
});

test("production defaults to real mode but can still opt into mock mode", () => {
  assert.equal(resolveMode({ ATHENA_ENV: "production" }).mockMode, false);
  assert.equal(resolveMode({ ATHENA_ENV: "Production", MOCK_MODE: "true" }).mockMode, true);
});

test("the server refuses to start in a paid configuration outside production", () => {
  assert.match(startupProblem(resolveMode({ MOCK_MODE: "false" })) ?? "", /ATHENA_ENV/);
  assert.match(startupProblem(resolveMode({ MOCK_MODE: "false", MOCK_AI: "true" })) ?? "", /OpenAlex/);
  assert.equal(startupProblem(resolveMode({})), null);
  assert.equal(startupProblem(resolveMode({ ATHENA_ENV: "production" })), null);
});

test("paid calls throw outside production, even if the keys are set", () => {
  const dev = resolveMode({ MOCK_MODE: "true", XAI_API_KEY: "xai-real-looking-key" });
  assert.throws(() => assertPaidAllowed(dev, "xai", "synthesis v3"), PaidApiBlockedError);
  assert.throws(() => assertPaidAllowed(dev, "openalex", "works?search=x"), /outside production/);
  assert.doesNotThrow(() => assertPaidAllowed(resolveMode({ ATHENA_ENV: "production" }), "xai", "x"));
});
