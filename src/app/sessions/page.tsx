import type { Metadata } from "next";
import { SWRConfig } from "swr";
import { SessionsList } from "@/components/SessionsList";
import { plain, projectsList } from "@/lib/preload";

export const metadata: Metadata = { title: "Sessions · Athena" };
export const dynamic = "force-dynamic";

export default function SessionsPage() {
  return (
    <SWRConfig value={{ fallback: { "/api/projects": plain(projectsList()) } }}>
      <SessionsList />
    </SWRConfig>
  );
}
