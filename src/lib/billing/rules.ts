// Billing rules with no database and no network, so they can be unit-tested directly (billing.test.ts).
// Server side only: this file loads the Stripe library. The browser imports packs.ts, never this.
import Stripe from "stripe";
import { CREDIT_PACKS, packById, paidForPack, type CreditPack } from "./packs";

/** A number from an environment variable, or the default when it is missing, not a number or below `min`. */
export function envNumber(v: string | undefined, fallback: number, min = 0): number {
  const n = Number(v);
  return v !== undefined && v.trim() !== "" && Number.isFinite(n) && n >= min ? n : fallback;
}

/** Credits for a model cost: cost in US dollars x credits per dollar, rounded to 3 decimals. Never negative. */
export function creditsFor(costUsd: number, creditsPerUsd: number): number {
  if (!Number.isFinite(costUsd) || !Number.isFinite(creditsPerUsd) || costUsd <= 0 || creditsPerUsd <= 0) return 0;
  return Math.round(costUsd * creditsPerUsd * 1000) / 1000;
}

/** A balance as it is shown and reported: never below zero (calls that finish together can dip slightly under). */
export const shownBalance = (balance: number) => Math.max(0, Math.round(balance * 1000) / 1000);

// ---------- Checkout ----------

/** Marks a Checkout Session as a credit purchase made by this app (the Stripe account may be used for other things). */
export const CHECKOUT_APP = "athena";

/** What a Checkout Session carries so the payment can be matched to an account and a pack. */
export function checkoutMetadata(userId: string, packId: string): Record<string, string> {
  return { app: CHECKOUT_APP, userId, packId };
}

/** The site's address for return links: APP_URL when it is a valid http(s) address, else where the request came in. */
export function siteBase(appUrl: string | undefined, requestOrigin: string): string {
  const raw = appUrl?.trim();
  if (raw) {
    try {
      const u = new URL(raw);
      if (u.protocol === "https:" || u.protocol === "http:") return `${u.origin}${u.pathname}`.replace(/\/+$/, "");
    } catch {}
  }
  return requestOrigin.replace(/\/+$/, "");
}

/** Where Stripe sends the buyer afterwards. Stripe replaces {CHECKOUT_SESSION_ID} with the session's ID. */
export function returnUrls(base: string) {
  return { success: `${base}/credits?purchase=success&session_id={CHECKOUT_SESSION_ID}`, cancel: `${base}/credits?purchase=cancelled` };
}

/** The fields of a Checkout Session the rules read (a webhook event's object or a retrieved session). */
export type CheckoutSessionLike = Pick<Stripe.Checkout.Session, "id" | "mode" | "status" | "payment_status" | "amount_total" | "currency" | "client_reference_id" | "metadata" | "payment_intent">;

export type CheckoutDecision =
  /** Paid in full for a known pack: add the credits (once). */
  | { action: "credit"; userId: string; pack: CreditPack; credits: number; amountUsd: number; sessionId: string; paymentIntent: string | null }
  /** Ours, but not paid yet (still open, or a bank payment that settles later): nothing to add for now. */
  | { action: "wait"; userId: string }
  /** Not a credit purchase of this app, or one that expired unpaid. */
  | { action: "ignore"; reason: string }
  /** Ours, but something does not add up: add nothing and record it for the administrator. */
  | { action: "reject"; reason: string; userId: string; packId: string; sessionId: string; amountTotal: number | null; currency: string | null };

/**
 * What a Checkout Session is worth. The credits come from the server's pack table, never from the session; the
 * amount paid and the currency must be exactly the pack's.
 */
export function decideCheckout(s: CheckoutSessionLike, packs: readonly CreditPack[] = CREDIT_PACKS): CheckoutDecision {
  const userId = s.metadata?.userId;
  const packId = s.metadata?.packId;
  if (s.metadata?.app !== CHECKOUT_APP || !userId || !packId) return { action: "ignore", reason: "not a credit purchase" };
  const reject = (reason: string): CheckoutDecision => ({ action: "reject", reason, userId, packId, sessionId: s.id, amountTotal: s.amount_total ?? null, currency: s.currency ?? null });
  if (s.mode !== "payment") return reject("not a one-off payment");
  if (s.client_reference_id !== userId) return reject("the account reference does not match");
  if (s.status === "expired") return { action: "ignore", reason: "checkout expired" };
  if (s.status !== "complete" || s.payment_status === "unpaid") return { action: "wait", userId };
  if (s.payment_status !== "paid") return reject("nothing was paid");
  const pack = packById(packId, packs);
  if (!pack) return reject("unknown pack");
  if (!paidForPack(pack, s.amount_total, s.currency)) return reject("the amount or currency does not match the pack");
  const pi = s.payment_intent;
  return { action: "credit", userId, pack, credits: pack.credits, amountUsd: pack.priceCents / 100, sessionId: s.id, paymentIntent: typeof pi === "string" ? pi : pi?.id ?? null };
}

// ---------- webhook events ----------

export type EventDecision =
  | { kind: "checkout"; decision: CheckoutDecision }
  /** Money went back to the buyer: remove the matching share of that purchase's credits (once per refund). */
  | { kind: "refund"; refundId: string; paymentIntent: string; amountCents: number }
  /** A refund that was counted did not go through after all: give those credits back (once). */
  | { kind: "refund_failed"; refundId: string; paymentIntent: string }
  | { kind: "ignore"; reason: string };

const idOf = (x: string | { id: string } | null | undefined) => (typeof x === "string" ? x : x?.id ?? null);

/** What a verified Stripe event changes, if anything. Every other event type is ignored. */
export function decideEvent(event: Stripe.Event, packs: readonly CreditPack[] = CREDIT_PACKS): EventDecision {
  switch (event.type) {
    // Card payments are paid when Checkout completes. Bank debits and similar complete unpaid and report later.
    case "checkout.session.completed":
    case "checkout.session.async_payment_succeeded":
      return { kind: "checkout", decision: decideCheckout(event.data.object, packs) };
    case "refund.created": {
      const r = event.data.object;
      const pi = idOf(r.payment_intent);
      if (!pi) return { kind: "ignore", reason: "refund without a payment" };
      if (r.status === "failed" || r.status === "canceled") return { kind: "ignore", reason: `refund ${r.status}` };
      if (!(r.amount > 0)) return { kind: "ignore", reason: "empty refund" };
      return { kind: "refund", refundId: r.id, paymentIntent: pi, amountCents: r.amount };
    }
    case "refund.failed": {
      const r = event.data.object;
      const pi = idOf(r.payment_intent);
      return pi ? { kind: "refund_failed", refundId: r.id, paymentIntent: pi } : { kind: "ignore", reason: "refund without a payment" };
    }
    default:
      return { kind: "ignore", reason: `event type ${event.type}` };
  }
}

/** Credits to take back for a refund: the refunded share of what was paid, of the credits that purchase gave. */
export function creditsToRemove(purchase: { credits: number; amountUsd: number | null }, refundCents: number): number {
  const paidCents = Math.round((purchase.amountUsd ?? 0) * 100);
  if (paidCents <= 0 || refundCents <= 0 || purchase.credits <= 0) return 0;
  return Math.round(purchase.credits * Math.min(1, refundCents / paidCents) * 1000) / 1000;
}

// ---------- webhook signature ----------

export class WebhookSignatureError extends Error {
  constructor() {
    super("The webhook signature is not valid.");
  }
}

/**
 * The event in a webhook request, after checking Stripe's signature over the raw body (and that it is recent:
 * the library refuses timestamps more than five minutes old). Throws WebhookSignatureError for anything else.
 */
export function verifiedEvent(rawBody: string, signatureHeader: string | null | undefined, secret: string): Stripe.Event {
  if (!signatureHeader || !secret) throw new WebhookSignatureError();
  try {
    return Stripe.webhooks.constructEvent(rawBody, signatureHeader, secret);
  } catch {
    throw new WebhookSignatureError();
  }
}
