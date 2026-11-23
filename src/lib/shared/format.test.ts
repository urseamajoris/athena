import { test } from "node:test";
import assert from "node:assert/strict";
import { fmtInt, relTime } from "./format";

test("fmtInt groups thousands", () => {
  assert.equal(fmtInt(0), "0");
  assert.equal(fmtInt(999), "999");
  assert.equal(fmtInt(1234), "1,234");
  assert.equal(fmtInt(1234567), "1,234,567");
  assert.equal(fmtInt(-1234), "-1,234");
});

test("relTime reads naturally", () => {
  const now = Date.parse("2026-10-28T12:00:00Z");
  assert.equal(relTime("2026-10-28T11:59:50Z", now), "just now");
  assert.equal(relTime("2026-10-28T11:59:00Z", now), "1 minute ago");
  assert.equal(relTime("2026-10-28T11:15:00Z", now), "45 minutes ago");
  assert.equal(relTime("2026-10-28T09:00:00Z", now), "3 hours ago");
  assert.equal(relTime("2026-10-25T12:00:00Z", now), "3 days ago");
  assert.equal(relTime("2026-10-28T14:00:00Z", now), "in 2 hours");
});
