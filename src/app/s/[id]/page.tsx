import type { Metadata } from "next";
import { Suspense } from "react";
import { SWRConfig } from "swr";
import { Workspace } from "@/components/workspace/Workspace";
import { sessionFallback } from "@/lib/preload";
import { pageUser } from "@/lib/auth/server";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Review · Athena" };

/** A review: /s/[id], optionally ?step=<StepKey>. With no ?step it opens the screen that needs the user. */
export default async function ReviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <SWRConfig value={{ fallback: await sessionFallback(await pageUser(`/s/${id}`), id, ["canvas"], { status: true }) }}>
      <Suspense>
        <Workspace projectId={id} />
      </Suspense>
    </SWRConfig>
  );
}
