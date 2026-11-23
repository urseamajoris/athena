import type { Metadata } from "next";
import { SWRConfig } from "swr";
import { AccountView } from "@/components/auth/AccountView";
import { pageUser } from "@/lib/auth/server";
import { accountView } from "@/lib/auth/account";
import { plain } from "@/lib/preload";

export const metadata: Metadata = { title: "Account · Athena" };
export const dynamic = "force-dynamic";

export default async function AccountPage() {
  const user = await pageUser("/account");
  return (
    <SWRConfig value={{ fallback: { "/api/account": plain(await accountView(user)) } }}>
      <AccountView />
    </SWRConfig>
  );
}
