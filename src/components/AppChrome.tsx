"use client";
// The chrome of every signed-in page: the Athena mark (to "My reviews"), the credits chip, the account menu.
// Nothing else goes in the top bar.
import type { ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { DropdownMenu } from "radix-ui";
import { Coins, UserRound } from "lucide-react";
import { api, useApi } from "./api";
import { useCredits } from "./credits";
import { LogoMark } from "./Logo";
import { menuContentClass, menuItemClass } from "./overlays";
import { cx } from "./ui";
import { formatCredits } from "@/lib/billing/packs";

interface Status { user?: { email: string; name: string; role: "user" | "admin" } }

/** "320 credits", going to the page where credits are bought. Renders nothing until the balance is known. */
export function CreditsChip() {
  const credits = useCredits();
  if (!credits) return null;
  return (
    <Link href="/credits" data-credits-chip className="btn-secondary btn-sm rounded-full" title="Credits pay for AI steps. Open to buy more.">
      <Coins className="h-4 w-4 text-fg-2" strokeWidth={2} aria-hidden />
      <span className="tabular-nums">{credits.exempt ? "Unlimited credits" : `${formatCredits(credits.balance)} ${Math.floor(credits.balance) === 1 ? "credit" : "credits"}`}</span>
    </Link>
  );
}

/** The account avatar: a menu of text items. */
export function AccountMenu() {
  const { data } = useApi<Status>("/api/status");
  const router = useRouter();
  const user = data?.user;
  const initial = (user?.name || user?.email || "").trim().charAt(0).toUpperCase();
  const item = cx(menuItemClass, "text-fg-0");
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger className="inline-flex h-11 w-11 items-center justify-center rounded-full hover:bg-bg-3" aria-label="Account menu" title="Account menu">
        <span className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-line-control bg-bg-1 text-small font-semibold text-fg-0">
          {initial || <UserRound className="h-4 w-4" strokeWidth={2} aria-hidden />}
        </span>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content align="end" sideOffset={4} className={cx(menuContentClass, "w-64")}>
          {user && (
            <DropdownMenu.Label className="border-b border-line px-3 pb-2 pt-2 text-small text-fg-2">
              <span className="block truncate font-semibold text-fg-0">{user.name || user.email}</span>
              {user.name && <span className="block truncate">{user.email}</span>}
            </DropdownMenu.Label>
          )}
          <DropdownMenu.Item asChild className={item}><Link href="/account">Account</Link></DropdownMenu.Item>
          <DropdownMenu.Item asChild className={item}><Link href="/settings">Settings</Link></DropdownMenu.Item>
          {user?.role === "admin" && <DropdownMenu.Item asChild className={item}><Link href="/admin">Admin</Link></DropdownMenu.Item>}
          <DropdownMenu.Separator className="my-1 h-px bg-line" />
          <DropdownMenu.Item
            className={item}
            onSelect={async () => {
              await api("/api/auth/logout", { body: {} });
              router.replace("/login");
              router.refresh();
            }}
          >
            Log out
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

/** The top bar of every signed-in page. It stays in view; `stick="wide"` lets it scroll away on phones. */
export function TopBar({ stick = "always" }: { stick?: "always" | "wide" }) {
  return (
    <header data-topbar className={cx("top-0 z-40 flex h-[var(--topbar-h)] items-center justify-between gap-3 border-b border-line bg-bg-1 px-3 md:px-6 short:static", stick === "wide" ? "lg:sticky" : "sticky")}>
      <Link href="/sessions" className="inline-flex h-11 items-center gap-2.5 rounded-sm pr-2 font-semibold text-fg-0" aria-label="Athena: my reviews">
        <LogoMark />
        Athena
      </Link>
      <div className="flex items-center gap-2">
        <CreditsChip />
        <AccountMenu />
      </div>
    </header>
  );
}

/** The top bar of the pages before sign-in: the mark (to the landing page) and, where it helps, one plain link. */
export function PublicBar({ link }: { link?: { href: string; label: string } }) {
  return (
    <header className="mx-auto flex h-[var(--topbar-h)] w-full max-w-5xl items-center justify-between px-4 md:px-6">
      <Link href="/" className="inline-flex h-11 items-center gap-2.5 rounded-sm pr-2 font-semibold text-fg-0" aria-label="Athena: home">
        <LogoMark />
        Athena
      </Link>
      {link && <Link href={link.href} className="link inline-flex h-11 items-center px-2 font-medium">{link.label}</Link>}
    </header>
  );
}

const WIDTH = { narrow: "max-w-2xl", medium: "max-w-4xl", wide: "max-w-6xl" } as const;

/** A signed-in page outside the review workspace: the top bar and one centred column. */
export function PageShell({ children, width = "medium" }: { children: ReactNode; width?: keyof typeof WIDTH }) {
  return (
    <div className="min-h-screen bg-bg-0">
      <TopBar />
      <main id="main" className={cx("mx-auto w-full px-4 py-8 md:px-6 md:py-12", WIDTH[width])}>{children}</main>
    </div>
  );
}

/** The title block of a page: one headline, one sentence, and the page's one primary action beside it. */
export function PageHeader({ title, lead, action }: { title: string; lead?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
      <div className="min-w-0 max-w-2xl">
        <h1 className="text-headline font-semibold">{title}</h1>
        {lead && <p className="mt-2 text-fg-1">{lead}</p>}
      </div>
      {action}
    </div>
  );
}
