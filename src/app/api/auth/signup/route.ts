import { NextResponse } from "next/server";
import { z } from "zod";
import { apiRoute } from "@/lib/http";
import { HttpError } from "@/lib/project";
import { signUp } from "@/lib/auth/account";

export const dynamic = "force-dynamic";
const Body = z.object({ email: z.string().trim().email("Enter a valid email address.").max(200), password: z.string().max(400), name: z.string().trim().max(80).optional() });

export const POST = apiRoute("auth/signup", async (req) => {
  const b = Body.safeParse(await req.json().catch(() => ({})));
  if (!b.success) throw new HttpError(400, b.error.issues[0].message);
  await signUp(b.data);
  return NextResponse.json({ ok: true });
});
