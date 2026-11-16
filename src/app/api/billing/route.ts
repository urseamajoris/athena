import { NextResponse } from "next/server";
import { apiRoute } from "@/lib/http";
import { requireUser } from "@/lib/auth/server";
import { billingView } from "@/lib/billing/credits";

export const dynamic = "force-dynamic";

/** The signed-in account's credits: balance, packs, history and usage. */
export const GET = apiRoute("billing", async () => NextResponse.json(await billingView(await requireUser())));
