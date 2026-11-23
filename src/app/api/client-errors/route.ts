import { NextResponse } from "next/server";
import { z } from "zod";
import { apiRoute } from "@/lib/http";
import { HttpError } from "@/lib/project";
import { requireUser } from "@/lib/auth/server";
import { CLIENT_ERROR_KINDS, recordClientError } from "@/lib/admin/client-errors";

export const dynamic = "force-dynamic";

/** Page errors from signed-in users' browsers, for the admin dashboard (same-origin, rate-limited, no personal data). */
export const POST = apiRoute("client-errors", async (req) => {
  const user = await requireUser();
  const b = z.object({ kind: z.enum(CLIENT_ERROR_KINDS), message: z.string().max(2000), page: z.string().max(500) }).safeParse(await req.json().catch(() => ({})));
  if (!b.success) throw new HttpError(400, "Send { kind, message, page }.");
  await recordClientError(user.id, b.data);
  return new NextResponse(null, { status: 204 });
});
