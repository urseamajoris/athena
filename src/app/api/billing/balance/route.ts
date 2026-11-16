import { NextResponse } from "next/server";
import { apiRoute } from "@/lib/http";
import { requireUser } from "@/lib/auth/server";
import { balanceView } from "@/lib/billing/credits";

export const dynamic = "force-dynamic";

/** Just the balance, for the page header: one small read. */
export const GET = apiRoute("billing/balance", async () => NextResponse.json(await balanceView(await requireUser())));
