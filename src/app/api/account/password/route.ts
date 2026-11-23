import { NextResponse } from "next/server";
import { z } from "zod";
import { apiRoute } from "@/lib/http";
import { HttpError } from "@/lib/project";
import { requireUser } from "@/lib/auth/server";
import { changePassword } from "@/lib/auth/account";

export const dynamic = "force-dynamic";

export const POST = apiRoute("account/password", async (req) => {
  const user = await requireUser();
  const b = z.object({ current: z.string().min(1, "Enter your current password.").max(400), next: z.string().max(400) }).safeParse(await req.json().catch(() => ({})));
  if (!b.success) throw new HttpError(400, b.error.issues[0].message);
  await changePassword(user, b.data.current, b.data.next);
  return NextResponse.json({ ok: true });
});
