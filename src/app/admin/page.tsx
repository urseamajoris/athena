import type { Metadata } from "next";
import { SWRConfig } from "swr";
import { AdminDashboard } from "@/components/admin/AdminDashboard";
import { pageAdmin } from "@/lib/auth/server";
import { adminOverview } from "@/lib/admin/overview";
import { plain } from "@/lib/preload";

export const metadata: Metadata = { title: "Admin · Athena" };
export const dynamic = "force-dynamic";

export default async function AdminPage() {
  await pageAdmin("/admin");
  return (
    <SWRConfig value={{ fallback: { "/api/admin/overview": plain(await adminOverview()) } }}>
      <AdminDashboard />
    </SWRConfig>
  );
}
