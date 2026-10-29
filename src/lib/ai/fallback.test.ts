import { test } from "node:test";
import assert from "node:assert/strict";
import { PreferenceFallback } from "./fallback";
import { AiValidationError, BudgetError } from "./errors";

// Review of run 3: the search builder's first reply failed only the setting-block preference; when the retry then
// failed a rule (or the budget ran out before it), the turn failed although the first reply was usable.
test("a first reply that failed only the preference is returned when the retry fails or never comes", () => {
  const first = { queries: ["q1"], settingBlocks: [] };
  for (const error of [new AiValidationError("Missing a query for: t_1/openalex", "{}"), new BudgetError("AI budget reached"), new Error("network")]) {
    const f = new PreferenceFallback<typeof first>();
    f.note(1, { ok: false, data: first }); // valid, preference failed
    f.note(2, { ok: false }); // the retry failed a rule
    assert.equal(f.or(error), first);
  }
});

test("without such a reply the failure stands", () => {
  const f = new PreferenceFallback<string>();
  f.note(1, { ok: false }); // failed a rule, not only the preference
  assert.throws(() => f.or(new BudgetError("AI budget reached")), BudgetError);
  // The second reply is never the fallback: it is kept anyway when it passes the rules.
  const g = new PreferenceFallback<string>();
  g.note(2, { ok: false, data: "second" });
  assert.throws(() => g.or(new Error("x")), /x/);
});
