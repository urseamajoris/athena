"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { DropdownMenu } from "radix-ui";
import { UserRound } from "lucide-react";
import { useApi } from "./api";
import { applyThemePref, readThemePref, type ThemePref } from "@/lib/theme";

interface Status { mockMode: boolean; mockAi: boolean; production: boolean; spendUsd: number; budgetUsd: number }

const item = "flex min-h-11 cursor-default items-center gap-2 rounded-sm px-3 py-2 text-fg-0 outline-none data-[highlighted]:bg-bg-3";

/** The avatar menu: sessions, settings, theme, shortcuts, and the mock/spend status. */
export function AppMenu({ onShortcuts }: { onShortcuts?: () => void }) {
  const { data } = useApi<Status>("/api/status");
  const [theme, setTheme] = useState<ThemePref>("dark");
  useEffect(() => setTheme(readThemePref()), []);
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger className="inline-flex h-11 w-11 items-center justify-center rounded-full text-fg-1 hover:bg-bg-3 hover:text-fg-0" aria-label="Account and settings">
        <span className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-line-strong bg-bg-2">
          <UserRound className="h-4 w-4" strokeWidth={1.5} aria-hidden />
        </span>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content align="end" sideOffset={4} className="z-50 w-64 rounded-md border border-line-strong bg-bg-2 p-1">
          {data && (
            <DropdownMenu.Label className="px-3 py-2 text-12 text-fg-2">
              {data.mockMode ? "Mock mode" : data.mockAi ? "Mock AI · live databases" : "Live APIs"} · <span className="tabular-nums">${data.spendUsd.toFixed(2)} of ${data.budgetUsd.toFixed(2)}</span>
            </DropdownMenu.Label>
          )}
          <DropdownMenu.Item asChild className={item}><Link href="/sessions">All sessions</Link></DropdownMenu.Item>
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
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
