import { NextResponse } from "next/server";
import { z } from "zod";
import { apiRoute } from "@/lib/http";
import { HttpError } from "@/lib/project";
import { logIn } from "@/lib/auth/account";

export const dynamic = "force-dynamic";
const Body = z.object({ email: z.string().trim().min(1, "Enter your email.").max(200), password: z.string().min(1, "Enter your password.").max(400) });

export const POST = apiRoute("auth/login", async (req) => {
  const b = Body.safeParse(await req.json().catch(() => ({})));
  if (!b.success) throw new HttpError(400, b.error.issues[0].message);
  try {
    return NextResponse.json(await logIn(b.data));
  } catch (e) {
    const wait = (e as { retryAfter?: number }).retryAfter;
    if (e instanceof HttpError && wait) return NextResponse.json({ error: e.message }, { status: 429, headers: { "Retry-After": String(wait) } });
    throw e;
  }
});
