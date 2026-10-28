import type { Metadata } from "next";
import { Suspense } from "react";
import { SessionShell } from "@/components/canvas/SessionShell";

export const metadata: Metadata = { title: "Session · Athena" };

export default async function SessionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <Suspense>
      <SessionShell projectId={id} />
    </Suspense>
  );
}
