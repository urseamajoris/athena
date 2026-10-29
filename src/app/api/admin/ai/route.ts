import { NextResponse } from "next/server";
import { z } from "zod";
import { apiRoute } from "@/lib/http";
import { HttpError } from "@/lib/project";
import { requireAdmin } from "@/lib/auth/server";
import { setAi } from "@/lib/admin/actions";

export const dynamic = "force-dynamic";

export const POST = apiRoute("admin/ai", async (req) => {
  const admin = await requireAdmin();
  const b = z.object({ enabled: z.boolean() }).safeParse(await req.json().catch(() => ({})));
  if (!b.success) throw new HttpError(400, "Send { enabled: true | false }.");
  return NextResponse.json(await setAi(admin, b.data.enabled));
});
