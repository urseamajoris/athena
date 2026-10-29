import { NextResponse } from "next/server";
import { statusView } from "@/lib/preload";
import { apiRoute } from "@/lib/http";
import { requireUser } from "@/lib/auth/server";

export const dynamic = "force-dynamic";

export const GET = apiRoute("status", async () => NextResponse.json(await statusView(await requireUser())));
