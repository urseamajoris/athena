import { NextResponse } from "next/server";
import { z } from "zod";
import { apiRoute } from "@/lib/http";
import { HttpError } from "@/lib/project";
import { requireUser } from "@/lib/auth/server";
import { stripeReady } from "@/lib/billing/config";
import { packById } from "@/lib/billing/packs";
import { PAYMENTS_OFF_MESSAGE, createCheckout } from "@/lib/billing/stripe";

export const dynamic = "force-dynamic";
const Body = z.object({ packId: z.string().max(40) });

/** The address this request came in on, as the browser sees it (behind a proxy: the forwarded host and scheme). */
function requestOrigin(req: Request): string {
  const url = new URL(req.url);
  const host = req.headers.get("x-forwarded-host")?.split(",")[0].trim() || req.headers.get("host") || url.host;
  const proto = req.headers.get("x-forwarded-proto")?.split(",")[0].trim() || url.protocol.replace(":", "");
  return `${proto === "https" ? "https" : "http"}://${host}`;
}

/** Starts a purchase of one credit pack: answers with the address of Stripe's payment page. */
export const POST = apiRoute("billing/checkout", async (req) => {
  // A disabled account has no session, so it cannot get this far.
  const user = await requireUser();
  const b = Body.safeParse(await req.json().catch(() => ({})));
  const pack = b.success ? packById(b.data.packId) : undefined;
  if (!pack) throw new HttpError(400, "Choose a credit pack.");
  if (!stripeReady()) throw new HttpError(503, PAYMENTS_OFF_MESSAGE);
  return NextResponse.json({ url: await createCheckout(user, pack, requestOrigin(req)) });
});
