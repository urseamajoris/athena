import { NextResponse } from "next/server";
import { apiRoute } from "@/lib/http";
import { requireAdmin } from "@/lib/auth/server";
import { runKeyTest } from "@/lib/admin/actions";

export const dynamic = "force-dynamic";

export const POST = apiRoute("admin/key/test", async () => NextResponse.json(await runKeyTest(await requireAdmin())));
