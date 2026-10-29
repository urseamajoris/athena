import type { Metadata } from "next";
import { SWRConfig } from "swr";
import { SessionPage } from "@/components/session/SessionPage";
import { ExportView } from "@/components/panels/ExportPanel";
import { sessionFallback } from "@/lib/preload";
import { pageUser } from "@/lib/auth/server";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Export · Athena" };

export default async function ExportPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <SWRConfig value={{ fallback: await sessionFallback(await pageUser(`/s/${id}/export`), id, ["canvas", "questions", "export/markdown?preview=1"]) }}>
      <SessionPage projectId={id} node="export" title="Export" showAction={false}>
        <div className="h-full overflow-y-auto">
          <div className="mx-auto max-w-3xl px-4 py-6">
            <ExportView full />
          </div>
        </div>
      </SessionPage>
    </SWRConfig>
  );
}
