import type { Metadata } from "next";
import { Suspense } from "react";
import { SWRConfig } from "swr";
import { SessionShell } from "@/components/canvas/SessionShell";
import { sessionFallback } from "@/lib/preload";
import { pageUser } from "@/lib/auth/server";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Session · Athena" };

export default async function SessionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <SWRConfig value={{ fallback: await sessionFallback(await pageUser(`/s/${id}`), id, ["canvas"], { status: true }) }}>
      <Suspense>
        <SessionShell projectId={id} />
      </Suspense>
    </SWRConfig>
  );
}
