"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Check, FlaskConical, PauseCircle, Sparkles } from "lucide-react";
import { RadioGroup } from "radix-ui";
import { useApi } from "./api";
import { ErrorState, Loading, cx } from "./ui";
import { Disclosure } from "./disclosure";
import { AppMenu } from "./AppMenu";
import { applyThemePref, readThemePref, type ThemePref } from "@/lib/theme";

interface Status {
  production: boolean;
  mockMode: boolean;
  mockAi: boolean;
  models: Record<string, { resolved: string; status: string; note: string }>;
  maxResultsPerQuery: number;
  user: { email: string; role: "user" | "admin" };
  ai: { enabled: boolean; budgetReached: boolean };
  // Admins only:
  spendUsd?: number;
  budgetUsd?: number;
  paidCalls?: { attempted: number; blocked: number };
  keys?: { xai: boolean; openalex: boolean; contactEmail: boolean };
  simulatedFailures?: string[];
}

/** Settings: how this browser shows Athena (theme), and how the server runs it (demo mode, AI on/off). */
export function SettingsView() {
  const { data, error, mutate } = useApi<Status>("/api/status");
  const [theme, setTheme] = useState<ThemePref>("dark");
  useEffect(() => setTheme(readThemePref()), []);
  return (
    <div className="min-h-screen bg-bg-0">
      <header className="flex h-12 items-center justify-between gap-3 border-b border-line px-2 md:px-4">
        <Link href="/sessions" className="btn-ghost h-11"><ArrowLeft className="h-4 w-4" strokeWidth={1.5} aria-hidden /> My projects</Link>
        <AppMenu />
      </header>
      <main id="main" className="mx-auto max-w-2xl px-4 py-8">
        <h1 className="text-28 font-semibold">Settings</h1>
        <p className="mt-1 text-fg-1">Choose how Athena looks, and see how this server runs it.</p>
        {!data && !error && <Loading />}
        {error && <div className="mt-4"><ErrorState error={error} onRetry={() => mutate()} title="Settings could not load" /></div>}
        {data && (
          <div className="mt-6 space-y-4">
            <section aria-labelledby="theme-title" className="rounded-md border border-line bg-bg-1 p-4">
              <h2 id="theme-title" className="font-semibold">Appearance</h2>
              <RadioGroup.Root value={theme} onValueChange={(v) => { setTheme(v as ThemePref); applyThemePref(v as ThemePref); }} aria-labelledby="theme-title" className="mt-3 grid gap-2 sm:grid-cols-3">
                {(["dark", "light", "system"] as const).map((t) => (
                  <RadioGroup.Item key={t} value={t} className={cx("flex min-h-11 items-center gap-3 rounded-sm border px-3 text-left", theme === t ? "border-fg-1 bg-bg-2" : "border-line hover:bg-bg-2")}>
                    <span aria-hidden className="inline-flex h-4 w-4 items-center justify-center rounded-full border border-line-control">
                      <RadioGroup.Indicator className="h-2 w-2 rounded-full bg-fg-0" />
                    </span>
                    {t === "dark" ? "Dark" : t === "light" ? "Light" : "Match my device"}
                  </RadioGroup.Item>
                ))}
              </RadioGroup.Root>
            </section>

            <section aria-labelledby="run-title" className="rounded-md border border-line bg-bg-1 p-4">
              <h2 id="run-title" className="font-semibold">How this server runs Athena</h2>
              <ul className="mt-3 space-y-3">
                <li className="flex items-start gap-3">
                  {data.mockMode ? <FlaskConical className="mt-0.5 h-4 w-4 shrink-0 text-fg-1" strokeWidth={1.5} aria-hidden /> : <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-fg-1" strokeWidth={1.5} aria-hidden />}
                  <span>
                    <strong className="font-medium">{data.mockMode ? "Demo mode" : data.mockAi ? "Scripted AI, live databases" : "Live AI and databases"}</strong>
                    <span className="block text-fg-1">
                      {data.mockMode
                        ? "A scripted AI and recorded sample papers, so you can try every step without cost. Results will not match your topic."
                        : "Searches run on PubMed and OpenAlex, and the AI reads the papers you choose."}
                    </span>
                  </span>
                </li>
                <li className="flex items-start gap-3">
                  {data.ai.enabled && !data.ai.budgetReached ? <Check className="mt-0.5 h-4 w-4 shrink-0 text-ok" strokeWidth={2} aria-hidden /> : <PauseCircle className="mt-0.5 h-4 w-4 shrink-0 text-warn" strokeWidth={2} aria-hidden />}
                  <span>
                    <strong className="font-medium">{data.ai.budgetReached ? "AI budget reached" : data.ai.enabled ? "AI is on" : "AI is paused by the administrator"}</strong>
                    <span className="block text-fg-1">{data.ai.enabled && !data.ai.budgetReached ? "AI steps run when you start them." : "Your work is saved; AI steps continue when it is back on."}</span>
                  </span>
                </li>
              </ul>
              <p className="mt-3 text-12 text-fg-2">Your own AI use is on the <Link href="/account" className="link">Account</Link> page. Each search fetches up to {data.maxResultsPerQuery} papers.</p>
            </section>

            {data.user.role === "admin" && data.keys && (
              <Disclosure title="Server details (admins)">
                <ul className="space-y-1 text-fg-1">
                  <li>Spend: <span className="tabular-nums">${data.spendUsd?.toFixed(2)}</span> of <span className="tabular-nums">${data.budgetUsd?.toFixed(2)}</span></li>
                  <li>Paid API calls since this instance started: {data.paidCalls?.attempted ?? 0} ({data.paidCalls?.blocked ?? 0} blocked)</li>
                  <li>Keys in the environment: xAI {data.keys.xai ? "set" : "not set"}, OpenAlex {data.keys.openalex ? "set" : "not set"}, contact email {data.keys.contactEmail ? "set" : "not set"}</li>
                  <li>Models: {Object.entries(data.models).map(([r, m]) => `${r} ${m.resolved}`).join(", ")}</li>
                  {data.simulatedFailures?.length ? <li>Simulated source failures: {data.simulatedFailures.join(", ")}</li> : null}
                </ul>
                <p className="mt-2"><Link href="/admin" className="link">Open the admin dashboard</Link> to change AI, the key or the budget.</p>
              </Disclosure>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
