import { test } from "node:test";
import assert from "node:assert/strict";
import { familyOf, resolveModel, type KnownModel } from "./resolve";

const m = (id: string, createdAt: string, extra: Partial<KnownModel> = {}): KnownModel => ({ id, line: null, createdAt, retired: false, ...extra });
const LISTED = [
  m("claude-opus-5-5", "2026-10-01T00:00:00Z", { line: "opus" }),
  m("claude-opus-5", "2026-06-01T00:00:00Z", { line: "opus" }),
  m("claude-opus-4-8", "2026-03-01T00:00:00Z", { line: "opus" }),
  m("claude-sonnet-5-5", "2026-10-01T00:00:00Z", { line: "sonnet" }),
  m("claude-sonnet-5", "2026-05-01T00:00:00Z"),
  m("claude-haiku-4-5-20251001", "2025-10-01T00:00:00Z", { line: "haiku" }),
  m("claude-opus-9", "2027-01-01T00:00:00Z", { line: "opus", retired: true }),
];

test("the family is read from the model ID", () => {
  assert.equal(familyOf("claude-opus-5-5"), "opus");
  assert.equal(familyOf("claude-3-5-sonnet-20241022"), "sonnet");
  assert.equal(familyOf("claude-haiku-4-5"), "haiku");
  assert.equal(familyOf("claude-fable-5-2"), "fable");
  assert.equal(familyOf("some-other-model"), null);
});

test("a listed model is used as configured", () => {
  assert.deepEqual(resolveModel("claude-opus-5-5", LISTED), { resolved: "claude-opus-5-5", status: "ok", note: "confirmed with the model list" });
  const short = resolveModel("claude-haiku-4-5", LISTED);
  assert.equal(short.status, "ok", "the short name of a listed dated ID");
  assert.equal(short.resolved, "claude-haiku-4-5");
  assert.match(short.note, /claude-haiku-4-5-20251001/);
});

test("a model that is not listed is replaced by the newest listed model of its family, and the note says so", () => {
  const r = resolveModel("claude-opus-4-1", LISTED);
  assert.equal(r.status, "substituted");
  assert.equal(r.resolved, "claude-opus-5-5", "newest by release date; a retired model is never chosen");
  assert.equal(r.note, "claude-opus-4-1 is not in this key's model list; using claude-opus-5-5, the newest opus model listed");
  const s = resolveModel("claude-sonnet-4-5", LISTED.filter((x) => x.id !== "claude-sonnet-5-5"));
  assert.equal(s.resolved, "claude-sonnet-5", "the family comes from the ID when the API states no line");
  const retired = resolveModel("claude-opus-9", LISTED);
  assert.equal(retired.status, "substituted");
  assert.match(retired.note, /^claude-opus-9 has been retired; using claude-opus-5-5/);
});

test("no model of the family listed, or no family in the name: left unchecked with the reason", () => {
  const r = resolveModel("claude-fable-5-2", LISTED);
  assert.deepEqual(r, { resolved: "claude-fable-5-2", status: "unchecked", note: "claude-fable-5-2 is not in this key's model list, and no other fable model is listed" });
  const odd = resolveModel("my-model", LISTED);
  assert.equal(odd.status, "unchecked");
  assert.equal(odd.resolved, "my-model");
  assert.match(odd.note, /does not say which model family/);
  assert.equal(resolveModel("claude-opus-5-5", []).status, "unchecked");
});
