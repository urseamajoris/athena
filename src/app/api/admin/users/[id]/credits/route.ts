import { NextResponse } from "next/server";
import { z } from "zod";
import { apiRoute } from "@/lib/http";
import { HttpError } from "@/lib/project";
import { requireAdmin } from "@/lib/auth/server";
import { MAX_GRANT, grantCredits } from "@/lib/admin/credits";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };
const Body = z.object({
  credits: z.number().int("Enter a whole number of credits.").min(-MAX_GRANT, `At most ${MAX_GRANT.toLocaleString("en-US")} credits at a time.`).max(MAX_GRANT, `At most ${MAX_GRANT.toLocaleString("en-US")} credits at a time.`).refine((n) => n !== 0, "Enter a number of credits to add or remove."),
  note: z.string().trim().max(200, "Keep the note under 200 characters.").optional(),
});

/** An administrator adds credits to an account (positive) or removes them (negative). */
export const POST = apiRoute("admin/users/:id/credits", async (req, ctx: Ctx) => {
  const admin = await requireAdmin();
  const b = Body.safeParse(await req.json().catch(() => ({})));
  if (!b.success) throw new HttpError(400, b.error.issues[0].path[0] === "credits" && b.error.issues[0].code === "invalid_type" ? "Enter a whole number of credits." : b.error.issues[0].message);
  return NextResponse.json(await grantCredits(admin, (await ctx.params).id, b.data.credits, b.data.note ?? ""));
});
