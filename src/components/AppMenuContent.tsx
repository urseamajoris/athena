"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api } from "./api";
import { DropdownMenu } from "radix-ui";
import { AvatarButton } from "./AppMenu";
import { useApi } from "./api";
import { applyThemePref, readThemePref, type ThemePref } from "@/lib/theme";

interface Status { production: boolean; ai?: { enabled: boolean; budgetReached: boolean; keyMissing: boolean }; spendUsd?: number; budgetUsd?: number; user: { email: string; name: string; role: "user" | "admin" } }

const item = "flex min-h-11 cursor-default items-center gap-2 rounded-sm px-3 py-2 text-fg-0 outline-none data-[highlighted]:bg-bg-3";

/** The avatar menu: who is signed in, projects, account, admin, settings, theme, shortcuts, log out. */
export function AppMenuContent({ onShortcuts }: { onShortcuts?: () => void }) {
  const { data } = useApi<Status>("/api/status");
  const router = useRouter();
  const [theme, setTheme] = useState<ThemePref>("dark");
  useEffect(() => setTheme(readThemePref()), []);
  return (
    <DropdownMenu.Root defaultOpen>
      <DropdownMenu.Trigger asChild>
        <AvatarButton />
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content align="end" sideOffset={4} className="z-50 w-64 rounded-md border border-line-strong bg-bg-2 p-1">
          {data && (
            <DropdownMenu.Label className="px-3 py-2 text-12 text-fg-2">
              <span className="block truncate text-14 text-fg-0">{data.user.name || data.user.email}</span>
              {data.user.name && <span className="block truncate">{data.user.email}</span>}
              {data.ai?.keyMissing ? "AI not set up (no key)" : data.ai && !data.ai.enabled ? "AI switched off" : data.ai?.budgetReached ? "AI budget reached" : "Live AI and databases"}
              {data.spendUsd !== undefined && data.budgetUsd !== undefined && <> · <span className="tabular-nums">${data.spendUsd.toFixed(2)} of ${data.budgetUsd.toFixed(2)}</span></>}
            </DropdownMenu.Label>
          )}
          <DropdownMenu.Item asChild className={item}><Link href="/sessions">My projects</Link></DropdownMenu.Item>
          <DropdownMenu.Item asChild className={item}><Link href="/account">Account</Link></DropdownMenu.Item>
          {data?.user.role === "admin" && <DropdownMenu.Item asChild className={item}><Link href="/admin">Admin dashboard</Link></DropdownMenu.Item>}
          <DropdownMenu.Item asChild className={item}><Link href="/settings">Settings</Link></DropdownMenu.Item>
          {onShortcuts && <DropdownMenu.Item className={item} onSelect={onShortcuts}>Keyboard shortcuts <span className="ml-auto text-12 text-fg-2">?</span></DropdownMenu.Item>}
          <DropdownMenu.Separator className="my-1 h-px bg-line" />
          <DropdownMenu.Label className="px-3 pt-2 text-12 text-fg-2">Theme</DropdownMenu.Label>
          <DropdownMenu.RadioGroup value={theme} onValueChange={(v) => { setTheme(v as ThemePref); applyThemePref(v as ThemePref); }}>
            {(["dark", "light", "system"] as const).map((t) => (
              <DropdownMenu.RadioItem key={t} value={t} className={item}>
                <span aria-hidden className="inline-flex h-4 w-4 items-center justify-center rounded-full border border-line-control">
                  <DropdownMenu.ItemIndicator className="h-2 w-2 rounded-full bg-fg-0" />
                </span>
                {t === "dark" ? "Dark" : t === "light" ? "Light" : "Match the system"}
              </DropdownMenu.RadioItem>
            ))}
          </DropdownMenu.RadioGroup>
          <DropdownMenu.Separator className="my-1 h-px bg-line" />
          <DropdownMenu.Item className={item} onSelect={async () => { await api("/api/auth/logout", { body: {} }); router.replace("/login"); router.refresh(); }}>Log out</DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
