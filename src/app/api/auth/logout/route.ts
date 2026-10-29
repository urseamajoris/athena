import { NextResponse } from "next/server";
import { apiRoute } from "@/lib/http";
import { currentUser } from "@/lib/auth/server";
import { logOut } from "@/lib/auth/account";

export const dynamic = "force-dynamic";

export const POST = apiRoute("auth/logout", async () => {
  await logOut(await currentUser());
  return NextResponse.json({ ok: true });
});
