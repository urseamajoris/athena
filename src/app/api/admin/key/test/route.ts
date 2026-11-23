import { NextResponse } from "next/server";
import { apiRoute } from "@/lib/http";
import { requireAdmin } from "@/lib/auth/server";
import { runKeyTest } from "@/lib/admin/actions";
import { isAiProvider } from "@/lib/shared/ai-providers";

export const dynamic = "force-dynamic";

export const POST = apiRoute("admin/key/test", async (req) => {
  const admin = await requireAdmin();
  const body = await req.json().catch(() => ({})) as { provider?: unknown };
  const provider = isAiProvider(body?.provider) ? body.provider : undefined;
  return NextResponse.json(await runKeyTest(admin, provider));
});
