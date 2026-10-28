import type { Metadata } from "next";
import { SessionPage } from "@/components/session/SessionPage";
import { ExportView } from "@/components/panels/ExportPanel";

export const metadata: Metadata = { title: "Export · Athena" };

export default async function ExportPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <SessionPage projectId={id} node="export" title="Export" showAction={false}>
      <div className="h-full overflow-y-auto">
        <div className="mx-auto max-w-3xl px-4 py-6">
          <ExportView full />
        </div>
      </div>
    </SessionPage>
  );
}
