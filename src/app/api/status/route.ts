import { NextResponse } from "next/server";
import { statusView } from "@/lib/preload";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(await statusView());
}
