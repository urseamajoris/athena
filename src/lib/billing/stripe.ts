import "server-only";
import Stripe from "stripe";
import { createHash } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { db, schema } from "../db";
import { HttpError } from "../project";
import { audit } from "../auth/server";
import { billingConfig } from "./config";
import { addCredits, balanceOf } from "./credits";
import { CREDIT_CURRENCY, formatCredits, type CreditPack } from "./packs";
import { checkoutMetadata, creditsToRemove, decideCheckout, decideEvent, returnUrls, shownBalance, siteBase, type CheckoutDecision, type EventDecision } from "./rules";

// Buying credits with Stripe Checkout. A purchase is credited by whichever arrives first: Stripe's webhook, or
// the buyer landing back on the site (confirm). Both go through fulfil(), which credits a Checkout Session once.

export const PAYMENTS_OFF_MESSAGE = "Payments are not set up on this server yet.";
const NOT_FOUND_MESSAGE = "We could not find that purchase on this account.";

let cached: { key: string; client: Stripe } | null = null;

/** The Stripe client for STRIPE_SECRET_KEY; 503 when no key is set. */
function stripeClient(): Stripe {
  const key = billingConfig.stripeSecretKey;
  if (!key) throw new HttpError(503, PAYMENTS_OFF_MESSAGE);
  if (cached?.key !== key) cached = { key, client: new Stripe(key, { maxNetworkRetries: 1, timeout: 20_000, telemetry: false }) };
  return cached.client;
}

/** A Stripe failure as a plain message for the person. The log gets the error's type and code, never its text. */
function stripeFailure(e: unknown, doing: string): HttpError {
  if (e instanceof HttpError) return e;
  const s = e instanceof Stripe.errors.StripeError ? e : null;
  console.error(`[athena] Stripe ${doing} failed:`, s ? { type: s.type, code: s.code ?? null, status: s.statusCode ?? null, requestId: s.requestId ?? null } : { type: e instanceof Error ? e.name : typeof e });
  if (s instanceof Stripe.errors.StripeAuthenticationError || s instanceof Stripe.errors.StripePermissionError) {
    return new HttpError(503, "Payments are not working on this server right now. Please tell the administrator.");
  }
  return new HttpError(502, "The payment service did not respond. Please try again in a moment.");
}

/** Starts a Stripe Checkout for one pack and returns the address of Stripe's payment page. */
export async function createCheckout(user: { id: string; email: string }, pack: CreditPack, requestOrigin: string): Promise<string> {
  const stripe = stripeClient();
  const urls = returnUrls(siteBase(billingConfig.appUrl, requestOrigin));
  const metadata = checkoutMetadata(user.id, pack.id);
  try {
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      // Priced here from the pack table: nothing has to be created in the Stripe dashboard.
      line_items: [{ quantity: 1, price_data: { currency: CREDIT_CURRENCY, unit_amount: pack.priceCents, product_data: { name: `Athena credits: ${pack.name} pack`, description: `${formatCredits(pack.credits)} credits for AI steps` } } }],
      client_reference_id: user.id,
      customer_email: user.email,
      metadata,
      payment_intent_data: { metadata },
      // The pack's exact amount in US dollars is checked before credits are added, so no local-currency pricing.
      adaptive_pricing: { enabled: false },
      success_url: urls.success,
      cancel_url: urls.cancel,
    });
    if (!session.url) throw new Error("Checkout Session without a URL");
    return session.url;
  } catch (e) {
    throw stripeFailure(e, "checkout");
  }
}

export type StripeOutcome = "credited" | "already_credited" | "pending" | "rejected" | "unknown_account" | "refunded" | "refund_reversed" | "ignored";

/** One audit row per Stripe object and action, however often Stripe (or the buyer) reports it. */
async function auditOnce(action: string, stripeRef: string, opts: { actorId?: string | null; targetId?: string | null; detail: Record<string, unknown> }) {
  const A = schema.auditEvents;
  const seen = await db.select({ id: A.id }).from(A).where(and(eq(A.action, action), sql`json_extract(${A.detail}, '$.stripeRef') = ${stripeRef}`)).get();
  if (!seen) await audit("admin", action, { actorId: opts.actorId ?? null, targetId: opts.targetId ?? null, detail: { ...opts.detail, stripeRef } });
}

/** Acts on a Checkout decision: adds the pack's credits once, or records why nothing was added. */
async function fulfil(d: CheckoutDecision, via: "webhook" | "confirm"): Promise<{ outcome: StripeOutcome; credits: number }> {
  if (d.action === "ignore") return { outcome: "ignored", credits: 0 };
  if (d.action === "wait") return { outcome: "pending", credits: 0 };
  if (d.action === "reject") {
    await auditOnce("credit_purchase_rejected", d.sessionId, { targetId: d.userId, detail: { reason: d.reason, packId: d.packId, amountTotal: d.amountTotal, currency: d.currency } });
    return { outcome: "rejected", credits: 0 };
  }
  const account = await db.select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.id, d.userId)).get();
  if (!account) {
    // Paid, but the account was deleted in the meantime: nothing to credit. The administrator can refund it in Stripe.
    await auditOnce("credit_purchase_unmatched", d.sessionId, { detail: { reason: "the account no longer exists", packId: d.pack.id, amountUsd: d.amountUsd } });
    return { outcome: "unknown_account", credits: 0 };
  }
  const r = await addCredits(d.userId, d.credits, { kind: "purchase", amountUsd: d.amountUsd, packId: d.pack.id, stripeSessionId: d.sessionId, stripePaymentIntent: d.paymentIntent, note: `${d.pack.name} pack` });
  if (!r.added) return { outcome: "already_credited", credits: d.credits };
  await auditOnce("credits_purchased", d.sessionId, { actorId: d.userId, targetId: d.userId, detail: { via, packId: d.pack.id, credits: d.credits, amountUsd: d.amountUsd } });
  return { outcome: "credited", credits: d.credits };
}

/** The ledger row ID for a refund: fixed per refund, so each refund is counted once. */
const refundRowId = (refundId: string, what: "refund" | "reversal") => `cl_${createHash("sha256").update(`${what}:${refundId}`).digest("hex").slice(0, 16)}`;

/** A refund removes the refunded share of that purchase's credits. The balance may go below zero; it is shown as 0. */
async function applyRefund(d: Extract<EventDecision, { kind: "refund" }>): Promise<StripeOutcome> {
  const L = schema.creditLedger;
  const purchase = await db.select().from(L).where(and(eq(L.kind, "purchase"), eq(L.stripePaymentIntent, d.paymentIntent))).get();
  if (!purchase) return "ignored"; // a payment this app did not credit
  const credits = creditsToRemove(purchase, d.amountCents);
  if (credits <= 0) return "ignored";
  const amountUsd = d.amountCents / 100;
  const r = await addCredits(purchase.userId, -credits, { kind: "refund", id: refundRowId(d.refundId, "refund"), amountUsd: -amountUsd, packId: purchase.packId, stripePaymentIntent: d.paymentIntent, note: "Refund" });
  if (r.added) await auditOnce("credits_refunded", d.refundId, { targetId: purchase.userId, detail: { credits: -credits, amountUsd: -amountUsd, packId: purchase.packId } });
  return "refunded";
}

/** A counted refund that then failed at the bank: the credits it removed come back. */
async function reverseRefund(d: Extract<EventDecision, { kind: "refund_failed" }>): Promise<StripeOutcome> {
  const L = schema.creditLedger;
  const refund = await db.select().from(L).where(eq(L.id, refundRowId(d.refundId, "refund"))).get();
  if (!refund || refund.credits >= 0) return "ignored";
  const r = await addCredits(refund.userId, -refund.credits, { kind: "refund", id: refundRowId(d.refundId, "reversal"), amountUsd: refund.amountUsd === null ? null : -refund.amountUsd, packId: refund.packId, stripePaymentIntent: d.paymentIntent, note: "Refund did not go through" });
  if (r.added) await auditOnce("credit_refund_reversed", `${d.refundId}:failed`, { targetId: refund.userId, detail: { credits: -refund.credits, packId: refund.packId } });
  return "refund_reversed";
}

/** Acts on a verified webhook event. Event types this app does not use are ignored. */
export async function handleStripeEvent(event: Stripe.Event): Promise<StripeOutcome> {
  const d = decideEvent(event);
  switch (d.kind) {
    case "checkout":
      return (await fulfil(d.decision, "webhook")).outcome;
    case "refund":
      return applyRefund(d);
    case "refund_failed":
      return reverseRefund(d);
    default:
      return "ignored";
  }
}

export interface ConfirmResult {
  /** credited: added just now. already_credited: added earlier (usually by the webhook). pending: not paid yet. */
  status: "credited" | "already_credited" | "pending";
  /** Credits this purchase gives (0 while pending). */
  credits: number;
  /** The account's balance now, never below 0. */
  balance: number;
}

/**
 * The buyer is back from Stripe: looks the Checkout Session up at Stripe and, if it is paid and belongs to this
 * account, credits it (once). Covers a webhook that is late or was never set up.
 */
export async function confirmCheckout(user: { id: string }, sessionId: string): Promise<ConfirmResult> {
  const stripe = stripeClient();
  let decision: CheckoutDecision;
  try {
    decision = decideCheckout(await stripe.checkout.sessions.retrieve(sessionId));
  } catch (e) {
    if (e instanceof Stripe.errors.StripeInvalidRequestError && (e.statusCode === 404 || e.code === "resource_missing")) throw new HttpError(404, NOT_FOUND_MESSAGE);
    throw stripeFailure(e, "confirm");
  }
  // Someone else's session answers exactly like one that does not exist.
  if (decision.action === "ignore" || decision.userId !== user.id) throw new HttpError(404, NOT_FOUND_MESSAGE);
  const r = await fulfil(decision, "confirm");
  if (r.outcome === "rejected") throw new HttpError(409, "This payment does not match a credit pack, so no credits were added. Please contact the administrator.");
  if (r.outcome !== "credited" && r.outcome !== "already_credited" && r.outcome !== "pending") throw new HttpError(404, NOT_FOUND_MESSAGE);
  return { status: r.outcome, credits: r.credits, balance: shownBalance(await balanceOf(user.id)) };
}
