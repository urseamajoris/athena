import { NextResponse } from "next/server";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { apiRoute } from "@/lib/http";
import { HttpError } from "@/lib/project";
import { requireUser } from "@/lib/auth/server";
import { accountView, deleteOwnAccount } from "@/lib/auth/account";

export const dynamic = "force-dynamic";

export const GET = apiRoute("account", async () => NextResponse.json(await accountView(await requireUser())));

export const PATCH = apiRoute("account", async (req) => {
  const user = await requireUser();
  const b = z.object({ name: z.string().trim().max(80) }).safeParse(await req.json().catch(() => ({})));
  if (!b.success) throw new HttpError(400, b.error.issues[0].message);
  await db.update(schema.users).set({ name: b.data.name }).where(eq(schema.users.id, user.id)).run();
  return NextResponse.json({ ok: true });
});

export const DELETE = apiRoute("account", async (req) => {
  const user = await requireUser();
  const b = z.object({ password: z.string().min(1, "Enter your password to confirm."), confirm: z.literal("DELETE", { error: 'Type DELETE to confirm.' }) }).safeParse(await req.json().catch(() => ({})));
  if (!b.success) throw new HttpError(400, b.error.issues[0].message);
  return NextResponse.json(await deleteOwnAccount(user, b.data.password));
});
