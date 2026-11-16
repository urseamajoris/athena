import { test } from "node:test";
import assert from "node:assert/strict";
import Stripe from "stripe";
import { CREDIT_CURRENCY, CREDIT_PACKS, creditsPerDollar, formatCredits, packById, paidForPack, type CreditPack } from "./packs";
import { CHECKOUT_APP, WebhookSignatureError, checkoutMetadata, creditsFor, creditsToRemove, decideCheckout, decideEvent, envNumber, returnUrls, shownBalance, siteBase, verifiedEvent, type CheckoutSessionLike } from "./rules";

const starter = packById("starter")!;

/** A paid Checkout Session for a pack, as Stripe reports it; `over` changes fields. */
function session(over: Partial<CheckoutSessionLike> = {}, pack: CreditPack = starter): CheckoutSessionLike {
  return {
    id: "cs_test_a1b2c3",
    mode: "payment",
    status: "complete",
    payment_status: "paid",
    amount_total: pack.priceCents,
    currency: "usd",
    client_reference_id: "usr_1",
    metadata: checkoutMetadata("usr_1", pack.id),
    payment_intent: "pi_test_1",
    ...over,
  };
}

/** A Stripe event carrying `object`, as the webhook body would hold it. */
function event(type: string, object: unknown): Stripe.Event {
  return { id: "evt_test_1", object: "event", api_version: "2026-10-28.endive", created: 1_800_000_000, livemode: false, pending_webhooks: 1, request: null, type, data: { object } } as unknown as Stripe.Event;
}

test("packs: looked up by id; larger packs give the stated bonus over the Starter rate", () => {
  assert.equal(packById("plus")?.credits, 1650);
  assert.equal(packById("nope"), undefined);
  assert.equal(packById(undefined), undefined);
  assert.equal(packById("starter", []), undefined, "the pack table passed in is the one used");
  const base = creditsPerDollar(starter);
  for (const p of CREDIT_PACKS) {
    assert.ok(Number.isInteger(p.priceCents) && p.priceCents > 0 && Number.isInteger(p.credits) && p.credits > 0, p.id);
    assert.equal(p.credits, Math.round((p.priceCents / 100) * base * (1 + p.bonusPercent / 100)), `${p.id} bonus`);
  }
  assert.equal(new Set(CREDIT_PACKS.map((p) => p.id)).size, CREDIT_PACKS.length);
});

test("packs: a payment matches a pack only at its exact price in US dollars", () => {
  assert.equal(paidForPack(starter, 500, "usd"), true);
  assert.equal(paidForPack(starter, 500, "USD"), true);
  assert.equal(paidForPack(starter, 499, "usd"), false);
  assert.equal(paidForPack(starter, 1500, "usd"), false);
  assert.equal(paidForPack(starter, 500, "eur"), false);
  assert.equal(paidForPack(starter, null, "usd"), false);
  assert.equal(paidForPack(starter, 500, null), false);
  assert.equal(CREDIT_CURRENCY, "usd");
});

test("credits for a model cost: cost x rate, 3 decimals, never negative", () => {
  assert.equal(creditsFor(0.01, 150), 1.5);
  assert.equal(creditsFor(1, 150), 150);
  assert.equal(creditsFor(0.0123456, 150), 1.852);
  assert.equal(creditsFor(0.000001, 150), 0, "below a thousandth of a credit rounds to nothing");
  assert.equal(creditsFor(0, 150), 0);
  assert.equal(creditsFor(-1, 150), 0);
  assert.equal(creditsFor(Number.NaN, 150), 0);
  assert.equal(creditsFor(1, 0), 0);
  assert.equal(creditsFor(0.5, 100), 50);
});

test("settings from the environment fall back on a missing or bad value", () => {
  assert.equal(envNumber(undefined, 100), 100);
  assert.equal(envNumber("", 100), 100);
  assert.equal(envNumber("abc", 100), 100);
  assert.equal(envNumber("-5", 100), 100);
  assert.equal(envNumber("0", 100), 0);
  assert.equal(envNumber("250", 100), 250);
});

test("a balance is shown at zero or above", () => {
  assert.equal(shownBalance(-0.4), 0);
  assert.equal(shownBalance(12.34567), 12.346);
  assert.equal(formatCredits(-3), "0");
  assert.equal(formatCredits(1650.9), "1,650");
});

test("return links use APP_URL when it is a web address, else the request's own address", () => {
  assert.equal(siteBase("https://athena.example.org/", "http://localhost:3000"), "https://athena.example.org");
  assert.equal(siteBase("https://example.org/athena/", "http://localhost:3000"), "https://example.org/athena");
  assert.equal(siteBase("", "http://localhost:3000"), "http://localhost:3000");
  assert.equal(siteBase(undefined, "http://localhost:3000/"), "http://localhost:3000");
  assert.equal(siteBase("javascript:alert(1)", "http://localhost:3000"), "http://localhost:3000");
  assert.equal(siteBase("not a url", "http://localhost:3000"), "http://localhost:3000");
  assert.deepEqual(returnUrls("https://a.example"), { success: "https://a.example/credits?purchase=success&session_id={CHECKOUT_SESSION_ID}", cancel: "https://a.example/credits?purchase=cancelled" });
});

test("checkout: a paid session for a pack credits that pack's credits to the account in its metadata", () => {
  const d = decideCheckout(session());
  assert.deepEqual(d, { action: "credit", userId: "usr_1", pack: starter, credits: 500, amountUsd: 5, sessionId: "cs_test_a1b2c3", paymentIntent: "pi_test_1" });
  const pro = packById("pro")!;
  const p = decideCheckout(session({ payment_intent: { id: "pi_obj" } as Stripe.PaymentIntent }, pro));
  assert.equal(p.action === "credit" && p.credits, 4800);
  assert.equal(p.action === "credit" && p.paymentIntent, "pi_obj");
});

test("checkout: the credits come from the server's pack table, never from the session", () => {
  const d = decideCheckout(session({ metadata: { ...checkoutMetadata("usr_1", "starter"), credits: "999999" } }));
  assert.equal(d.action === "credit" && d.credits, 500);
  const cheaper: CreditPack[] = [{ ...starter, credits: 42 }];
  const e = decideCheckout(session(), cheaper);
  assert.equal(e.action === "credit" && e.credits, 42);
});

test("checkout: an amount or currency that is not the pack's credits nothing and is reported", () => {
  for (const over of [{ amount_total: 100 }, { amount_total: 1500 }, { amount_total: null }, { currency: "eur" }, { currency: null }] as Partial<CheckoutSessionLike>[]) {
    const d = decideCheckout(session(over));
    assert.equal(d.action, "reject", JSON.stringify(over));
    assert.equal(d.action === "reject" && d.reason, "the amount or currency does not match the pack");
    assert.equal(d.action === "reject" && d.userId, "usr_1");
  }
  // Paying the Starter price while naming the Pro pack.
  assert.equal(decideCheckout(session({ metadata: checkoutMetadata("usr_1", "pro") })).action, "reject");
});

test("checkout: other reasons to add nothing", () => {
  const reason = (over: Partial<CheckoutSessionLike>) => {
    const d = decideCheckout(session(over));
    return d.action === "reject" || d.action === "ignore" ? `${d.action}: ${d.reason}` : d.action;
  };
  assert.equal(reason({ metadata: null }), "ignore: not a credit purchase");
  assert.equal(reason({ metadata: { userId: "usr_1", packId: "starter" } }), "ignore: not a credit purchase", "no app marker");
  assert.equal(reason({ metadata: { app: CHECKOUT_APP, packId: "starter" } }), "ignore: not a credit purchase", "no account");
  assert.equal(reason({ metadata: checkoutMetadata("usr_1", "mega") }), "reject: unknown pack");
  assert.equal(reason({ client_reference_id: "usr_2" }), "reject: the account reference does not match");
  assert.equal(reason({ client_reference_id: null }), "reject: the account reference does not match");
  assert.equal(reason({ mode: "subscription" }), "reject: not a one-off payment");
  assert.equal(reason({ payment_status: "no_payment_required", amount_total: 0 }), "reject: nothing was paid");
  assert.equal(reason({ status: "expired", payment_status: "unpaid" }), "ignore: checkout expired");
});

test("checkout: not paid yet means wait (still open, or a bank payment that settles later)", () => {
  assert.deepEqual(decideCheckout(session({ payment_status: "unpaid" })), { action: "wait", userId: "usr_1" });
  assert.deepEqual(decideCheckout(session({ status: "open", payment_status: "unpaid" })), { action: "wait", userId: "usr_1" });
});

test("events: completed and delayed-success checkout events credit; everything else is ignored", () => {
  for (const type of ["checkout.session.completed", "checkout.session.async_payment_succeeded"]) {
    const d = decideEvent(event(type, session()));
    assert.equal(d.kind === "checkout" && d.decision.action, "credit", type);
  }
  // A bank debit completes unpaid: nothing yet. Its later success event credits it.
  const delayed = decideEvent(event("checkout.session.completed", session({ payment_status: "unpaid" })));
  assert.equal(delayed.kind === "checkout" && delayed.decision.action, "wait");
  for (const type of ["checkout.session.async_payment_failed", "checkout.session.expired", "payment_intent.succeeded", "charge.succeeded", "customer.created", "charge.refunded"]) {
    assert.equal(decideEvent(event(type, session())).kind, "ignore", type);
  }
  const wrong = decideEvent(event("checkout.session.completed", session({ amount_total: 1 })));
  assert.equal(wrong.kind === "checkout" && wrong.decision.action, "reject");
  const custom = decideEvent(event("checkout.session.completed", session()), [{ ...starter, priceCents: 700 }]);
  assert.equal(custom.kind === "checkout" && custom.decision.action, "reject", "the pack table passed in decides");
});

test("events: a refund removes credits once per refund; a failed refund gives them back", () => {
  const refund = { id: "re_1", object: "refund", amount: 250, currency: "usd", status: "succeeded", payment_intent: "pi_test_1" };
  assert.deepEqual(decideEvent(event("refund.created", refund)), { kind: "refund", refundId: "re_1", paymentIntent: "pi_test_1", amountCents: 250 });
  assert.deepEqual(decideEvent(event("refund.created", { ...refund, status: "pending", payment_intent: { id: "pi_obj" } })), { kind: "refund", refundId: "re_1", paymentIntent: "pi_obj", amountCents: 250 });
  assert.equal(decideEvent(event("refund.created", { ...refund, status: "failed" })).kind, "ignore");
  assert.equal(decideEvent(event("refund.created", { ...refund, payment_intent: null })).kind, "ignore");
  assert.equal(decideEvent(event("refund.created", { ...refund, amount: 0 })).kind, "ignore");
  assert.deepEqual(decideEvent(event("refund.failed", { ...refund, status: "failed" })), { kind: "refund_failed", refundId: "re_1", paymentIntent: "pi_test_1" });
  assert.equal(decideEvent(event("refund.updated", refund)).kind, "ignore");
});

test("refunds: the refunded share of the payment, of the credits that purchase gave", () => {
  const purchase = { credits: 1650, amountUsd: 15 };
  assert.equal(creditsToRemove(purchase, 1500), 1650);
  assert.equal(creditsToRemove(purchase, 750), 825);
  assert.equal(creditsToRemove(purchase, 100), 110);
  assert.equal(creditsToRemove(purchase, 5000), 1650, "never more than the purchase gave");
  assert.equal(creditsToRemove(purchase, 0), 0);
  assert.equal(creditsToRemove({ credits: 100, amountUsd: null }, 500), 0);
  assert.equal(creditsToRemove({ credits: 500, amountUsd: 5 }, 167), 167);
});

test("webhook signature: only a body signed with the endpoint's secret, recently, is accepted", () => {
  const secret = "whsec_test_made_up_for_this_unit_test";
  const body = JSON.stringify(event("checkout.session.completed", session()));
  const header = Stripe.webhooks.generateTestHeaderString({ payload: body, secret });
  const ev = verifiedEvent(body, header, secret);
  assert.equal(ev.type, "checkout.session.completed");
  assert.equal(ev.id, "evt_test_1");
  const d = decideEvent(ev);
  assert.equal(d.kind === "checkout" && d.decision.action === "credit" && d.decision.credits, 500);

  assert.throws(() => verifiedEvent(body, header, "whsec_another_secret"), WebhookSignatureError);
  assert.throws(() => verifiedEvent(body.replace("usr_1", "usr_2"), header, secret), WebhookSignatureError, "a changed body");
  assert.throws(() => verifiedEvent(body, null, secret), WebhookSignatureError);
  assert.throws(() => verifiedEvent(body, "", secret), WebhookSignatureError);
  assert.throws(() => verifiedEvent(body, "t=1,v1=deadbeef", secret), WebhookSignatureError);
  assert.throws(() => verifiedEvent(body, header, ""), WebhookSignatureError, "no secret configured");
  const old = Stripe.webhooks.generateTestHeaderString({ payload: body, secret, timestamp: Math.floor(Date.now() / 1000) - 3600 });
  assert.throws(() => verifiedEvent(body, old, secret), WebhookSignatureError, "an hour-old signature is a replay");
  // The error says nothing about the body or the secret.
  try {
    verifiedEvent(body, "t=1,v1=deadbeef", secret);
    assert.fail("should have thrown");
  } catch (e) {
    assert.equal((e as Error).message, "The webhook signature is not valid.");
  }
});
