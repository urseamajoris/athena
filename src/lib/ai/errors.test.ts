import { test } from "node:test";
import assert from "node:assert/strict";
import { AiDeclinedError, AiPausedError, AiUnavailableError, BudgetError, CreditsError, aiRefusal, isAiStop } from "./errors";

test("no key: the call is refused before it is sent, logged as paused, and stops the job like the AI switch", () => {
  const r = aiRefusal({ enabled: true, key: "" });
  assert.ok(r);
  assert.deepEqual(r.row, { status: "paused", error: "no API key configured" });
  assert.ok(r.error instanceof AiUnavailableError);
  assert.ok(r.error instanceof AiPausedError, "pauses the job and answers 503 ai_paused, like the switch");
  assert.equal(isAiStop(r.error), true);
  assert.equal(r.error.message, "AI is not set up on this server yet: no API key is configured. An administrator can add one in the dashboard. Your work is saved.");
});

test("AI switched off is reported first, with or without a key or credits", () => {
  for (const key of ["", "sk-ant-real-looking-key"]) {
    for (const canSpend of [true, false, undefined]) {
      const r = aiRefusal({ enabled: false, key, canSpend });
      assert.deepEqual(r?.row, { status: "paused", error: "AI switched off by an administrator" });
      assert.ok(r?.error instanceof AiPausedError);
      assert.ok(!(r?.error instanceof AiUnavailableError));
      assert.ok(!(r?.error instanceof CreditsError));
      assert.match(r!.error.message, /paused by the administrator/);
    }
  }
});

test("out of credits: refused before it is sent, logged as paused with no cost, and pauses the job", () => {
  const r = aiRefusal({ enabled: true, key: "sk-ant-real-looking-key", canSpend: false });
  assert.ok(r);
  assert.deepEqual(r.row, { status: "paused", error: "out of credits" });
  assert.ok(r.error instanceof CreditsError);
  assert.ok(r.error instanceof AiPausedError, "a job pauses on it and resumes later");
  assert.ok(!(r.error instanceof AiUnavailableError));
  assert.equal(isAiStop(r.error), true);
  assert.equal(r.error.message, "You are out of credits. Buy more to continue. Your work is saved.");
});

test("a missing key is reported before missing credits", () => {
  const r = aiRefusal({ enabled: true, key: "", canSpend: false });
  assert.ok(r?.error instanceof AiUnavailableError);
  assert.deepEqual(r?.row, { status: "paused", error: "no API key configured" });
});

test("a key with AI on and credits lets the call go ahead (the budget is checked next)", () => {
  assert.equal(aiRefusal({ enabled: true, key: "sk-ant-real-looking-key" }), null);
  assert.equal(aiRefusal({ enabled: true, key: "sk-ant-real-looking-key", canSpend: true }), null);
  assert.equal(isAiStop(new BudgetError("budget reached")), true);
  assert.equal(isAiStop(new Error("network")), false);
});

test("a declined request is an ordinary failure with a plain message, not a pause", () => {
  const e = new AiDeclinedError();
  assert.equal(e.message, "The AI declined this request. Your work is saved; try again or edit the text.");
  assert.equal(isAiStop(e), false);
});
