import { NextResponse } from "next/server";
import { z } from "zod";
import { apiRoute } from "@/lib/http";
import { HttpError } from "@/lib/project";
import { requireUser } from "@/lib/auth/server";
import { stripeReady } from "@/lib/billing/config";
import { PAYMENTS_OFF_MESSAGE, confirmCheckout } from "@/lib/billing/stripe";

export const dynamic = "force-dynamic";
const Body = z.object({ sessionId: z.string().regex(/^cs_[A-Za-z0-9_]{8,250}$/) });

/** The buyer is back from Stripe with a session ID: credit the purchase now if it is paid and theirs. */
export const POST = apiRoute("billing/confirm", async (req) => {
  const user = await requireUser();
  const b = Body.safeParse(await req.json().catch(() => ({})));
  if (!b.success) throw new HttpError(400, "That purchase reference is not valid.");
  if (!stripeReady()) throw new HttpError(503, PAYMENTS_OFF_MESSAGE);
  return NextResponse.json(await confirmCheckout(user, b.data.sessionId));
});
