import type { Metadata } from "next";
import { SessionPage } from "@/components/session/SessionPage";
import { TableView } from "@/components/table/TableView";

export const metadata: Metadata = { title: "Summary and ranking · Athena" };

export default async function TablePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <SessionPage projectId={id} node="table" title="Summary and ranking">
      <TableView />
    </SessionPage>
  );
}
