import { NextResponse } from "next/server";
import { apiRoute } from "@/lib/http";
import { requireAdmin } from "@/lib/auth/server";
import { adminUsers } from "@/lib/admin/overview";

export const dynamic = "force-dynamic";

export const GET = apiRoute("admin/users", async () => {
  await requireAdmin();
  return NextResponse.json({ users: await adminUsers() });
});
