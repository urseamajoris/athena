import { NextResponse } from "next/server";
import { apiRoute } from "@/lib/http";
import { requireAdmin } from "@/lib/auth/server";
import { adminOverview } from "@/lib/admin/overview";

export const dynamic = "force-dynamic";

export const GET = apiRoute("admin/overview", async () => {
  await requireAdmin();
  return NextResponse.json(await adminOverview());
});
