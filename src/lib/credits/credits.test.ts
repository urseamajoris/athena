import "../testing/env";
import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { eq } from "drizzle-orm";
import { db, ready, schema } from "../db";
import { newId } from "../util";
import { initialStageStates } from "../project";
import { calculateReviewCredits } from "../shared/credits";
import { InsufficientCreditsError } from "../ai/errors";
import { parseStripeSignatureHeader, verifyStripeSignature } from "./stripe-signature";
import { applyStripeTopUp, chargeCreditsForJob, ensureCreditsForStage, getUserCredits } from "./index";

test("verifyStripeSignature validates HMAC-SHA256 signatures and rejects tampering or stale timestamps", () => {
  const secret = "whsec_test_secret_123456";
  const body = JSON.stringify({ id: "evt_1", type: "checkout.session.completed" });
  const now = 1_700_000_000;
  const sig = createHmac("sha256", secret).update(`${now}.${body}`, "utf8").digest("hex");
  const header = `t=${now},v1=${sig}`;

  assert.deepEqual(parseStripeSignatureHeader(header), { timestamp: now, signatures: [sig] });
  assert.equal(verifyStripeSignature(body, header, secret, now + 10), true);
  assert.equal(verifyStripeSignature(body + " ", header, secret, now + 10), false);
  assert.equal(verifyStripeSignature(body, header, "whsec_wrong", now + 10), false);
  assert.equal(verifyStripeSignature(body, header, secret, now + 600), false);
  assert.equal(verifyStripeSignature(body, null, secret, now), false);
});

test("credit enforcement, idempotent job charging, and idempotent Stripe top-ups", async () => {
  await ready();
  const userId = newId("usr");
  const projectId = newId("prj");

  await db.insert(schema.users).values({
    id: userId,
    email: `${userId}@example.test`,
    name: "Credit Tester",
    passwordHash: "hash",
    role: "user",
    creditsBalance: 10,
  }).run();

  await db.insert(schema.projects).values({
    id: projectId,
    ownerId: userId,
    title: "Credit test review",
    idea: "Testing literature review credits",
    stageStates: initialStageStates(),
  }).run();

  assert.equal(await getUserCredits(userId), 10);

  // Small quote (fits in 10 credits)
  const smallQuote = calculateReviewCredits("summaries", [
    { title: "Paper A", abstract: "A".repeat(1200) },
    { title: "Paper B", abstract: "B".repeat(1200) },
  ]);
  assert.ok(smallQuote.credits > 0 && smallQuote.credits <= 10);
  await ensureCreditsForStage(projectId, "summaries", smallQuote);

  // Charge for a job — idempotent on the same jobId
  const jobId = newId("job");
  const firstCharge = await chargeCreditsForJob({ projectId, jobId, operation: "summaries", quote: smallQuote });
  assert.equal(firstCharge.charged, smallQuote.credits);
  assert.equal(firstCharge.balanceAfter, 10 - smallQuote.credits);
  assert.equal(await getUserCredits(userId), 10 - smallQuote.credits);

  const duplicateCharge = await chargeCreditsForJob({ projectId, jobId, operation: "summaries", quote: smallQuote });
  assert.equal(duplicateCharge.charged, smallQuote.credits);
  assert.equal(await getUserCredits(userId), 10 - smallQuote.credits);

  // Large quote exceeds remaining balance -> throws InsufficientCreditsError
  const bigQuote = calculateReviewCredits(
    "appraisal",
    Array.from({ length: 15 }, (_, i) => ({ title: `Big Paper ${i}`, fullTextChars: 10_000 })),
  );
  assert.ok(bigQuote.credits > (await getUserCredits(userId)));
  await assert.rejects(
    () => ensureCreditsForStage(projectId, "appraisal", bigQuote),
    (err: unknown) => err instanceof InsufficientCreditsError && err.required === bigQuote.credits,
  );

  // Top up via Stripe — idempotent on stripeSessionId
  const stripeSessionId = `cs_test_${newId("s")}`;
  const topUp1 = await applyStripeTopUp({
    userId,
    credits: 1000,
    stripeSessionId,
    amountCents: 1500,
    packName: "Researcher",
  });
  assert.equal(topUp1.alreadyApplied, false);
  assert.equal(topUp1.creditsAdded, 1000);
  assert.equal(await getUserCredits(userId), 10 - smallQuote.credits + 1000);

  // Replay of the same Stripe session does NOT double-credit
  const topUp2 = await applyStripeTopUp({
    userId,
    credits: 1000,
    stripeSessionId,
    amountCents: 1500,
    packName: "Researcher",
  });
  assert.equal(topUp2.alreadyApplied, true);
  assert.equal(topUp2.creditsAdded, 0);
  assert.equal(await getUserCredits(userId), 10 - smallQuote.credits + 1000);

  // Now the large stage passes credit check!
  await ensureCreditsForStage(projectId, "appraisal", bigQuote);

  // Ledger has exactly 2 rows (1 deduction + 1 top_up)
  const txRows = await db.select().from(schema.creditTransactions).where(eq(schema.creditTransactions.userId, userId)).all();
  assert.equal(txRows.length, 2);
});
