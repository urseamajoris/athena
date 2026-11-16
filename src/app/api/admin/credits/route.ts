import { NextResponse } from "next/server";
import { apiRoute } from "@/lib/http";
import { requireAdmin } from "@/lib/auth/server";
import { adminCredits } from "@/lib/admin/credits";

export const dynamic = "force-dynamic";

/** Credit totals for the dashboard and every account's balance. */
export const GET = apiRoute("admin/credits", async () => {
  await requireAdmin();
  return NextResponse.json(await adminCredits());
});
