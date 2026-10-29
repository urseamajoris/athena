import { NextResponse } from "next/server";
import { z } from "zod";
import { apiRoute } from "@/lib/http";
import { HttpError } from "@/lib/project";
import { requireAdmin } from "@/lib/auth/server";
import { clearKey, setKey } from "@/lib/admin/actions";
import { keyStatus } from "@/lib/settings";

export const dynamic = "force-dynamic";

// The key travels browser → server once, in this request body. It is never logged (apiRoute records the route,
// status and duration only), never stored in plain text, and never sent back: responses carry the masked status.
const Key = z.object({ key: z.string().trim().min(20, "That does not look like an xAI API key.").max(300).regex(/^\S+$/, "The key cannot contain spaces.") });

export const GET = apiRoute("admin/key", async () => {
  await requireAdmin();
  return NextResponse.json(await keyStatus());
});

export const PUT = apiRoute("admin/key", async (req) => {
  const admin = await requireAdmin();
  const b = Key.safeParse(await req.json().catch(() => ({})));
  if (!b.success) throw new HttpError(400, b.error.issues[0].message);
  return NextResponse.json(await setKey(admin, b.data.key));
});

export const DELETE = apiRoute("admin/key", async () => NextResponse.json(await clearKey(await requireAdmin())));
