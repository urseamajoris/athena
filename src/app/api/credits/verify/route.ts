import { NextResponse } from "next/server";
import { z } from "zod";
import { apiRoute } from "@/lib/http";
import { requireUser } from "@/lib/auth/server";
import { HttpError } from "@/lib/project";
import { findCreditPack } from "@/lib/shared/credits";
import { fetchStripeCheckoutSession } from "@/lib/credits/stripe";
import { applyStripeTopUp } from "@/lib/credits";
import { resumePausedJobsForUser } from "@/lib/jobs/runner";

export const dynamic = "force-dynamic";

export const POST = apiRoute("credits/verify", async (req) => {
  const user = await requireUser();
  const body = z.object({ sessionId: z.string().min(5).max(200) }).safeParse(await req.json().catch(() => ({})));
  if (!body.success) throw new HttpError(400, "Missing Stripe checkout session ID.");

  const session = await fetchStripeCheckoutSession(body.data.sessionId);
  const ownerId = session.metadata.userId || session.clientReferenceId;
  if (ownerId !== user.id) {
    throw new HttpError(403, "This payment session does not belong to your account.");
  }
  if (session.paymentStatus !== "paid") {
    return NextResponse.json({ paid: false, paymentStatus: session.paymentStatus });
  }

  const pack = session.metadata.packId ? findCreditPack(session.metadata.packId) : undefined;
  const credits = Number(session.metadata.credits) || pack?.credits || 0;
  if (!Number.isFinite(credits) || credits <= 0) {
    throw new HttpError(400, "Payment session does not contain a valid credit amount.");
  }

  const result = await applyStripeTopUp({
    userId: user.id,
    credits,
    stripeSessionId: session.id,
    amountCents: session.amountTotal,
    packName: pack?.name,
  });
  const resumedJobs = result.alreadyApplied ? 0 : await resumePausedJobsForUser(user.id);
  return NextResponse.json({ paid: true, ...result, resumedJobs });
});
