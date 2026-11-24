import { NextResponse } from "next/server";
import { apiRoute } from "@/lib/http";
import { requireUser } from "@/lib/auth/server";
import { creditsView } from "@/lib/credits";

export const dynamic = "force-dynamic";

export const GET = apiRoute("credits", async () => {
  const user = await requireUser();
  return NextResponse.json(await creditsView(user));
});
