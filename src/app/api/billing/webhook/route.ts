import { NextResponse } from "next/server";
import { apiRoute } from "@/lib/http";
import { HttpError } from "@/lib/project";
import { billingConfig } from "@/lib/billing/config";
import { WebhookSignatureError, verifiedEvent } from "@/lib/billing/rules";
import { PAYMENTS_OFF_MESSAGE, handleStripeEvent } from "@/lib/billing/stripe";

export const dynamic = "force-dynamic";
/** Stripe's events are a few kilobytes; anything much larger is not one. */
const MAX_BODY = 512 * 1024;

/**
 * Stripe posts payment events here. There is no session: the request is trusted only if Stripe's signature over
 * the exact body checks out against STRIPE_WEBHOOK_SECRET. The answer never repeats anything from the body.
 * 200 = handled or not needed (Stripe stops); 400 = bad signature; 5xx = try again later (Stripe retries).
 */
export const POST = apiRoute("billing/webhook", async (req) => {
  const secret = billingConfig.stripeWebhookSecret;
  if (!secret) throw new HttpError(503, PAYMENTS_OFF_MESSAGE);
  if (Number(req.headers.get("content-length") ?? 0) > MAX_BODY) throw new HttpError(413, "Request too large.");
  // The body is read as text, untouched: the signature covers its exact bytes.
  const body = await req.text();
  if (body.length > MAX_BODY) throw new HttpError(413, "Request too large.");
  let event;
  try {
    event = verifiedEvent(body, req.headers.get("stripe-signature"), secret);
  } catch (e) {
    if (e instanceof WebhookSignatureError) throw new HttpError(400, e.message);
    throw e;
  }
  return NextResponse.json({ received: true, outcome: await handleStripeEvent(event) });
});
