import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { z } from "zod";
import { apiRoute } from "@/lib/http";
import { requireUser } from "@/lib/auth/server";
import { HttpError } from "@/lib/project";
import { findCreditPack } from "@/lib/shared/credits";
import { createStripeCheckoutSession } from "@/lib/credits/stripe";

export const dynamic = "force-dynamic";

async function resolveOrigin(req: Request): Promise<string> {
  const h = await headers();
  const origin = h.get("origin");
  if (origin && /^https?:\/\//i.test(origin)) return origin.replace(/\/$/, "");
  const proto = (h.get("x-forwarded-proto") ?? "").split(",")[0].trim() || "http";
  const host = (h.get("x-forwarded-host") ?? h.get("host") ?? "").split(",")[0].trim();
  if (host) return `${proto}://${host}`;
  return new URL(req.url).origin;
}

export const POST = apiRoute("credits/checkout", async (req) => {
  const user = await requireUser();
  const body = z.object({ packId: z.string().min(1) }).safeParse(await req.json().catch(() => ({})));
  if (!body.success) throw new HttpError(400, "Choose a valid credit pack.");
  const pack = findCreditPack(body.data.packId);
  if (!pack) throw new HttpError(400, "Unknown credit pack.");
  const origin = await resolveOrigin(req);
  const session = await createStripeCheckoutSession({ pack, user, origin });
  return NextResponse.json(session);
});
