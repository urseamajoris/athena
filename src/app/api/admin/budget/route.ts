import { NextResponse } from "next/server";
import { z } from "zod";
import { apiRoute } from "@/lib/http";
import { HttpError } from "@/lib/project";
import { requireAdmin } from "@/lib/auth/server";
import { changeBudget } from "@/lib/admin/actions";

export const dynamic = "force-dynamic";

// limitUsd: dollars; 0 = no limit; null = use the server's setting (AI_BUDGET_USD) again.
export const PUT = apiRoute("admin/budget", async (req) => {
  const admin = await requireAdmin();
  const b = z.object({ limitUsd: z.number().min(0).max(10_000).nullable(), confirmAboveEnv: z.boolean().optional() }).safeParse(await req.json().catch(() => ({})));
  if (!b.success) throw new HttpError(400, "Send { limitUsd: number | null }: 0 means no limit, null means the server's setting.");
  try {
    return NextResponse.json(await changeBudget(admin, b.data.limitUsd, !!b.data.confirmAboveEnv));
  } catch (e) {
    if ((e as { kind?: string }).kind === "confirm_needed") return NextResponse.json({ error: (e as Error).message, kind: "confirm_needed" }, { status: 409 });
    throw e;
  }
});
