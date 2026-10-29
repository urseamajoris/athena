import { test } from "node:test";
import assert from "node:assert/strict";
import { hashPassword, passwordProblem, verifyPassword } from "./password";
import { decryptSecret, encryptSecret, fingerprint, keyId, redactSecrets, settingsKey } from "./secrets";
import { MAX_FAILS_PER_EMAIL, MAX_FAILS_PER_IP, loginRetryAfter, maskEmail, normEmail, sameOrigin } from "./policy";
import { safeNext } from "../shared/nav";

test("passwords: scrypt hash round-trips, never stores the password, salts every hash", async () => {
  const h = await hashPassword("correct horse battery");
  assert.match(h, /^scrypt\$16384\$8\$1\$/);
  assert.ok(!h.includes("correct horse"));
  assert.equal(await verifyPassword("correct horse battery", h), true);
  assert.equal(await verifyPassword("correct horse batterY", h), false);
  assert.notEqual(h, await hashPassword("correct horse battery"));
  assert.equal(await verifyPassword("x", "plain-text-password"), false);
});

test("passwords: policy", () => {
  assert.ok(passwordProblem("short"));
  assert.ok(passwordProblem("aaaaaaaaaaaa"));
  assert.ok(passwordProblem("jane.doe-secret-1", "jane.doe@example.org"));
  assert.equal(passwordProblem("a long enough passphrase", "jane@example.org"), null);
});

test("settings key: hex, base64 or a long passphrase; refuses short or missing", () => {
  assert.equal(settingsKey(undefined), null);
  assert.equal(settingsKey("too-short"), null);
  assert.equal(settingsKey("0".repeat(64))?.length, 32);
  assert.equal(settingsKey(Buffer.alloc(32, 7).toString("base64"))?.length, 32);
  assert.equal(settingsKey("a passphrase that is at least thirty-two chars")?.length, 32);
});

test("secrets: AES-256-GCM round-trip, tamper detection, wrong key fails", () => {
  const key = settingsKey("0123456789abcdef".repeat(4))!;
  const blob = encryptSecret("xai-SAMPLEKEY1234567890abcd", key);
  assert.ok(!blob.includes("SAMPLEKEY"));
  assert.equal(decryptSecret(blob, key), "xai-SAMPLEKEY1234567890abcd");
  const parts = blob.split(":");
  const tampered = [...parts.slice(0, 3), Buffer.from("x" + Buffer.from(parts[3], "base64").toString("latin1")).toString("base64")].join(":");
  assert.throws(() => decryptSecret(tampered, key));
  assert.throws(() => decryptSecret(blob, settingsKey("f".repeat(64))!));
  assert.equal(fingerprint("a").length, 8);
  // The key id shown on the dashboard is the start of the fingerprint, not any part of the key.
  const sample = "xai-SAMPLEKEY1234567890abcd";
  const id = keyId({ key: sample });
  assert.match(id, /^[0-9a-f]{6}$/);
  assert.equal(id, fingerprint(sample).slice(0, 6));
  assert.equal(keyId({ fingerprint: fingerprint(sample) }), id);
  for (let i = 0; i + 4 <= sample.length; i++) assert.ok(!id.includes(sample.slice(i, i + 4)));
});

test("redaction removes known keys and key-shaped strings", () => {
  const msg = "401 Incorrect API key provided: xai-SAMPLEKEY1234567890abcd. Authorization: Bearer abcdefghijklmnopqrstuv";
  const out = redactSecrets(msg, ["my-secret-value-123"]);
  assert.ok(!out.includes("SAMPLEKEY"));
  assert.ok(!out.includes("abcdefghijklmnop"));
  assert.equal(redactSecrets("token my-secret-value-123 here", ["my-secret-value-123"]), "token [redacted] here");
});

test("login rate limit: per email and per IP, inside the window only", () => {
  const now = Date.parse("2026-10-29T12:00:00Z");
  const ago = (min: number) => new Date(now - min * 60_000).toISOString();
  assert.equal(loginRetryAfter({ email: [], ip: [] }, now), 0);
  assert.equal(loginRetryAfter({ email: Array.from({ length: MAX_FAILS_PER_EMAIL - 1 }, () => ago(1)), ip: [] }, now), 0);
  assert.ok(loginRetryAfter({ email: Array.from({ length: MAX_FAILS_PER_EMAIL }, () => ago(1)), ip: [] }, now) > 0);
  assert.equal(loginRetryAfter({ email: Array.from({ length: MAX_FAILS_PER_EMAIL }, () => ago(20)), ip: [] }, now), 0);
  assert.ok(loginRetryAfter({ email: [], ip: Array.from({ length: MAX_FAILS_PER_IP }, () => ago(2)) }, now) > 0);
});

test("origin check, email masking, safe ?next=", () => {
  assert.equal(sameOrigin(null, "athena.app"), true);
  assert.equal(sameOrigin("https://athena.app", "athena.app"), true);
  assert.equal(sameOrigin("https://evil.example", "athena.app"), false);
  assert.equal(sameOrigin("not a url", "athena.app"), false);
  assert.equal(normEmail("  Jane@Example.ORG "), "jane@example.org");
  assert.equal(maskEmail("Jane@example.org"), "j•••@example.org");
  assert.equal(safeNext("/s/abc"), "/s/abc");
  assert.equal(safeNext("//evil.example"), "/sessions");
  assert.equal(safeNext("/\\evil.example"), "/sessions");
  assert.equal(safeNext("https://evil.example"), "/sessions");
});
