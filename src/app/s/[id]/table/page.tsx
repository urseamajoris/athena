import type { Metadata } from "next";
import { SWRConfig } from "swr";
import { SessionPage } from "@/components/session/SessionPage";
import { TableView } from "@/components/table/TableView";
import { sessionFallback } from "@/lib/preload";

export const metadata: Metadata = { title: "Summary and ranking · Athena" };

export default async function TablePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <SWRConfig value={{ fallback: await sessionFallback(id, ["canvas", "papers", "ranking"]) }}>
      <SessionPage projectId={id} node="table" title="Summary and ranking">
        <TableView />
      </SessionPage>
    </SWRConfig>
  );
}
