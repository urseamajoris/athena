import { NextResponse } from "next/server";
import { config } from "@/lib/config";
import { findCreditPack } from "@/lib/shared/credits";
import { verifyStripeSignature } from "@/lib/credits/stripe";
import { applyStripeTopUp } from "@/lib/credits";
import { resumePausedJobsForUser } from "@/lib/jobs/runner";

export const dynamic = "force-dynamic";

interface StripeWebhookEvent {
  id: string;
  type: string;
  data?: {
    object?: {
      id?: string;
      payment_status?: string;
      amount_total?: number | null;
      client_reference_id?: string | null;
      metadata?: Record<string, string>;
    };
  };
}

/**
 * Stripe webhook endpoint for `checkout.session.completed`.
 * Verified via Stripe-Signature HMAC-SHA256 (does not use browser same-origin checks).
 */
export async function POST(req: Request) {
  const secret = config.stripeWebhookSecret.trim();
  if (!secret) {
    return NextResponse.json({ error: "Stripe webhook secret is not configured." }, { status: 503 });
  }
  const rawBody = await req.text();
  const sig = req.headers.get("stripe-signature");
  if (!verifyStripeSignature(rawBody, sig, secret)) {
    return NextResponse.json({ error: "Invalid Stripe signature." }, { status: 400 });
  }

  let event: StripeWebhookEvent;
  try {
    event = JSON.parse(rawBody) as StripeWebhookEvent;
  } catch {
    return NextResponse.json({ error: "Invalid JSON payload." }, { status: 400 });
  }

  if (event.type === "checkout.session.completed") {
    const session = event.data?.object;
    if (session?.id && session.payment_status === "paid") {
      const userId = session.metadata?.userId || session.client_reference_id;
      const pack = session.metadata?.packId ? findCreditPack(session.metadata.packId) : undefined;
      const credits = Number(session.metadata?.credits) || pack?.credits || 0;
      if (userId && Number.isFinite(credits) && credits > 0) {
        const result = await applyStripeTopUp({
          userId,
          credits,
          stripeSessionId: session.id,
          amountCents: session.amount_total ?? null,
          packName: pack?.name,
        });
        if (!result.alreadyApplied) {
          await resumePausedJobsForUser(userId);
        }
      }
    }
  }

  return NextResponse.json({ received: true });
}
