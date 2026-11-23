"use client";
import { useState } from "react";
import Link from "next/link";
import { AlertTriangle, CheckCircle2, Cpu, ExternalLink, KeyRound, ShieldCheck, Sparkles } from "lucide-react";
import { api, useApi } from "../api";
import { Spinner, cx } from "../ui";
import { Disclosure } from "../disclosure";
import { AI_PROVIDERS, MODEL_ROLES, PROVIDER_META, type AiProvider, type ModelRole, type ProviderConfigStatus } from "@/lib/shared/ai-providers";
import { relTime } from "@/lib/shared/format";

const ROLE_INFO: Record<ModelRole, { label: string; hint: string }> = {
  fast: { label: "Fast role", hint: "Scoping chat, search query building, ranking" },
  summary: { label: "Summary role", hint: "Abstract-to-table per-paper summaries" },
  reasoning: { label: "Reasoning role", hint: "Full-text appraisal, synthesis, research questions" },
};

/**
 * Reusable Admin AI Provider, API Key Workflow & Model Toggle box.
 * Used both in the Canvas FocusPanel (admin:ai box) and inside the /admin dashboard.
 */
export function AiProviderWorkflow({
  config,
  onUpdated,
  compact = false,
}: {
  config: ProviderConfigStatus;
  onUpdated: () => Promise<unknown> | void;
  compact?: boolean;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [keyInput, setKeyInput] = useState("");
  const [showKeyForm, setShowKeyForm] = useState(false);

  const active = config.activeProvider;
  const meta = PROVIDER_META[active];
  const entry = config.providers[active];
  const k = entry.key;
  const allSameModel = entry.models.fast === entry.models.summary && entry.models.summary === entry.models.reasoning;
  const unifiedModel = allSameModel ? entry.models.reasoning : null;

  async function runAction(tag: string, fn: () => Promise<{ resumedJobs?: number } | unknown>, okMsg?: string) {
    setBusy(tag);
    setErr(null);
    setNotice(null);
    try {
      const res = (await fn()) as { resumedJobs?: number } | undefined;
      await onUpdated();
      const resumed = res?.resumedJobs ? ` Resumed ${res.resumedJobs} paused job${res.resumedJobs === 1 ? "" : "s"}.` : "";
      if (okMsg) setNotice(`${okMsg}${resumed}`);
      return true;
    } catch (e) {
      setErr((e as Error).message);
      return false;
    } finally {
      setBusy(null);
    }
  }

  const selectProvider = (p: AiProvider) => {
    if (p === active) return;
    setKeyInput("");
    setShowKeyForm(false);
    void runAction(
      `provider:${p}`,
      () => api("/api/admin/provider", { method: "PUT", body: { provider: p } }),
      `Switched active AI provider to ${PROVIDER_META[p].label}.`,
    );
  };

  const selectPipelineModel = (modelId: string) =>
    runAction(
      `model:${modelId}`,
      () => api("/api/admin/provider", { method: "PUT", body: { provider: active, model: modelId } }),
      `Pipeline model set to ${modelId}.`,
    );

  const selectRoleModel = (role: ModelRole, modelId: string) =>
    runAction(
      `role:${role}`,
      () => api("/api/admin/provider", { method: "PUT", body: { provider: active, models: { [role]: modelId } } }),
      `Updated ${ROLE_INFO[role].label.toLowerCase()} to ${modelId}.`,
    );

  const resetRoleModels = () =>
    runAction(
      "reset-models",
      () => api("/api/admin/provider", { method: "PUT", body: { provider: active, models: { fast: null, summary: null, reasoning: null } } }),
      `Restored default ${meta.shortLabel} models.`,
    );

  const step1Done = true;
  const step2Done = k.inUse !== "none";
  const step3Done = !!k.lastTest?.ok;

  return (
    <div className="space-y-4">
      {/* Workflow checklist */}
      <ol aria-label="AI API key setup workflow" className="grid grid-cols-3 gap-2 text-12">
        {[
          { n: 1, title: "Choose API", done: step1Done, sub: meta.shortLabel },
          { n: 2, title: "API key", done: step2Done, sub: step2Done ? (k.masked ?? "Set") : "Missing" },
          { n: 3, title: "Verify & model", done: step3Done && step2Done, sub: step3Done ? "Verified" : "Ready to test" },
        ].map((st) => (
          <li
            key={st.n}
            className={cx(
              "rounded-sm border px-2.5 py-2",
              st.done ? "border-ok-line bg-ok-soft/60" : "border-warn-line bg-warn-soft/50",
            )}
          >
            <p className="flex items-center gap-1.5 font-medium text-fg-0">
              {st.done ? <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-ok" aria-hidden /> : <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-warn" aria-hidden />}
              <span className="truncate">{st.n}. {st.title}</span>
            </p>
            <p className="mt-0.5 truncate text-fg-1">{st.sub}</p>
          </li>
        ))}
      </ol>

      {err && <p role="alert" className="rounded-sm border border-err-line bg-err-soft px-3 py-2 text-12 text-err">{err}</p>}
      {notice && <p role="status" className="rounded-sm border border-ok-line bg-ok-soft px-3 py-2 text-12 text-ok">{notice}</p>}

      {/* 1. Provider selector */}
      <section aria-label="Choose AI provider">
        <p className="text-12 font-medium text-fg-2">1. Active AI API provider</p>
        <div className={cx("mt-2 grid gap-2", compact ? "grid-cols-1 sm:grid-cols-3" : "grid-cols-1 md:grid-cols-3")}>
          {AI_PROVIDERS.map((p) => {
            const pm = PROVIDER_META[p];
            const pk = config.providers[p].key;
            const isActive = p === active;
            return (
              <button
                key={p}
                type="button"
                aria-pressed={isActive}
                disabled={!!busy}
                onClick={() => selectProvider(p)}
                className={cx(
                  "flex flex-col rounded-md border p-3 text-left transition-colors",
                  isActive ? "border-fg-0 bg-bg-2 ring-1 ring-fg-1" : "border-line bg-bg-0 hover:bg-bg-2",
                )}
              >
                <span className="flex items-center justify-between gap-2">
                  <span className="font-semibold text-fg-0">{pm.label}</span>
                  {isActive && <span className="rounded-sm border border-ok-line bg-ok-soft px-1.5 py-0.5 text-12 font-medium text-ok">Active</span>}
                </span>
                <span className="mt-1 flex items-center gap-1.5 text-12">
                  <span className={cx("inline-block h-2 w-2 rounded-full", pk.inUse !== "none" ? "bg-ok" : "bg-warn")} aria-hidden />
                  <span className={pk.inUse !== "none" ? "text-fg-1" : "text-warn"}>
                    {pk.inUse !== "none" ? `Key ${pk.masked} (${pk.inUse})` : "No API key"}
                  </span>
                </span>
                <span className="mt-1 truncate font-mono text-12 text-fg-2">{config.providers[p].models.reasoning}</span>
              </button>
            );
          })}
        </div>
      </section>

      {/* 2. API Key workflow for the active provider */}
      <section aria-label={`${meta.shortLabel} API key`} className="rounded-md border border-line bg-bg-0/60 p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="flex items-center gap-1.5 text-12 font-semibold text-fg-0">
            <KeyRound className="h-3.5 w-3.5 text-fg-2" aria-hidden /> 2. {meta.label} API key
          </h3>
          <a href={meta.docsUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-12 text-fg-2 hover:text-fg-0">
            Get key <ExternalLink className="h-3 w-3" aria-hidden />
          </a>
        </div>

        <p className="mt-1.5 text-14 font-semibold text-fg-0">
          {k.inUse === "none" ? "No key configured" : <span className="font-mono">{k.masked}</span>}
        </p>
        <p className="mt-0.5 text-12 text-fg-1">
          {k.inUse === "admin" ? (
            <>Stored encrypted{k.admin && <span suppressHydrationWarning> {relTime(k.admin.setAt)} by {k.admin.setBy ?? "an admin"}</span>}. Overrides {meta.envVar}.</>
          ) : k.inUse === "environment" ? (
            <>Loaded from server environment (<code className="font-mono">{meta.envVar}</code>).</>
          ) : (
            <>Add a {meta.shortLabel} API key below or set <code className="font-mono">{meta.envVar}</code> on the server. AI steps pause safely until a key is set.</>
          )}
        </p>

        {k.problem && <p className="mt-1.5 text-12 text-warn">{k.problem}</p>}

        {k.lastTest && (
          <p className={cx("mt-2 flex items-start gap-1.5 text-12", k.lastTest.ok ? "text-ok" : "text-warn")}>
            {k.lastTest.ok ? <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden /> : <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />}
            <span>
              Last test <span suppressHydrationWarning>{relTime(k.lastTest.at)}</span>: {k.lastTest.message}
            </span>
          </p>
        )}

        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            className="btn-secondary btn-sm min-h-9"
            disabled={!!busy || k.inUse === "none"}
            onClick={() => runAction("test", () => api("/api/admin/key/test", { body: { provider: active } }), `Tested ${meta.shortLabel} API key.`)}
          >
            {busy === "test" && <Spinner className="h-3 w-3" />} Test connection
          </button>
          <button
            type="button"
            className="btn-secondary btn-sm min-h-9"
            onClick={() => setShowKeyForm((v) => !v)}
            aria-expanded={showKeyForm}
          >
            {k.admin ? "Replace key" : "Set API key"}
          </button>
          {k.admin && (
            <button
              type="button"
              className="btn-ghost btn-sm min-h-9"
              disabled={!!busy}
              onClick={() =>
                runAction(
                  "clear",
                  () => api(`/api/admin/key?provider=${active}`, { method: "DELETE" }),
                  `Cleared stored ${meta.shortLabel} key.`,
                )
              }
            >
              Clear stored key
            </button>
          )}
        </div>

        {(showKeyForm || k.inUse === "none") && (
          <form
            className="mt-3 space-y-2 border-t border-line pt-3"
            onSubmit={async (e) => {
              e.preventDefault();
              if (
                await runAction(
                  "save-key",
                  () => api("/api/admin/key", { method: "PUT", body: { provider: active, key: keyInput } }),
                  `Saved encrypted ${meta.shortLabel} API key.`,
                )
              ) {
                setKeyInput("");
                setShowKeyForm(false);
              }
            }}
          >
            <label className="label block">
              {meta.shortLabel} API key ({meta.keyPrefixHint})
              <input
                className="input mt-1 w-full font-mono text-12"
                type="password"
                autoComplete="off"
                spellCheck={false}
                placeholder={meta.keyPlaceholder}
                value={keyInput}
                onChange={(e) => setKeyInput(e.target.value)}
                disabled={!config.encryption.ready}
              />
            </label>
            <p className="flex items-start gap-1.5 text-12 text-fg-2">
              <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
              <span>
                {config.encryption.ready
                  ? "Encrypted at rest (AES-256-GCM). Never shown again after saving — only the last 4 characters."
                  : config.encryption.problem}
              </span>
            </p>
            <button
              type="submit"
              className="btn-primary btn-sm min-h-9"
              disabled={!config.encryption.ready || keyInput.trim().length < 16 || busy === "save-key"}
            >
              {busy === "save-key" && <Spinner className="h-3 w-3" />} Save {meta.shortLabel} key
            </button>
          </form>
        )}
      </section>

      {/* 3. Pipeline model toggle */}
      <section aria-label="Pipeline AI model">
        <div className="flex items-center justify-between gap-2">
          <p className="flex items-center gap-1.5 text-12 font-medium text-fg-2">
            <Cpu className="h-3.5 w-3.5" aria-hidden /> 3. Model for the pipeline ({meta.shortLabel})
          </p>
          {!allSameModel && <span className="text-12 text-fg-2">Custom per-role mix</span>}
        </div>
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          {meta.catalog.map((m) => {
            const selected = unifiedModel === m.id;
            return (
              <button
                key={m.id}
                type="button"
                aria-pressed={selected}
                disabled={!!busy}
                onClick={() => void selectPipelineModel(m.id)}
                className={cx(
                  "flex flex-col rounded-md border px-3 py-2 text-left transition-colors",
                  selected ? "border-fg-0 bg-bg-2 ring-1 ring-fg-1" : "border-line bg-bg-0 hover:bg-bg-2",
                )}
              >
                <span className="flex items-center justify-between gap-2">
                  <span className="text-13 font-semibold text-fg-0">{m.label}</span>
                  <span className="rounded-sm border border-line-strong bg-bg-1 px-1.5 py-0.5 text-12 text-fg-2">{m.tier}</span>
                </span>
                <span className="mt-0.5 font-mono text-12 text-fg-2">{m.id}</span>
                <span className="mt-1 text-12 text-fg-1">{m.note}</span>
              </button>
            );
          })}
        </div>

        <div className="mt-3">
          <Disclosure title="Per-role model overrides" meta={`${entry.models.fast} / ${entry.models.reasoning}`}>
            <p className="mb-3 text-12 text-fg-2">Use a cheaper fast model for bulk summaries &amp; ranking while keeping a stronger reasoning model for appraisal &amp; synthesis.</p>
            <div className="space-y-2.5">
              {MODEL_ROLES.map((role) => (
                <label key={role} className="block text-12">
                  <span className="font-medium text-fg-0">{ROLE_INFO[role].label}</span>
                  <span className="ml-1.5 text-fg-2">— {ROLE_INFO[role].hint}</span>
                  <select
                    className="input mt-1 font-mono text-12"
                    value={entry.models[role]}
                    disabled={!!busy}
                    onChange={(e) => void selectRoleModel(role, e.target.value)}
                  >
                    {meta.catalog.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.label} ({m.id})
                      </option>
                    ))}
                    {!meta.catalog.some((m) => m.id === entry.models[role]) && (
                      <option value={entry.models[role]}>{entry.models[role]}</option>
                    )}
                  </select>
                </label>
              ))}
            </div>
            <button type="button" className="btn-ghost btn-sm mt-3" disabled={!!busy} onClick={() => void resetRoleModels()}>
              Restore {meta.shortLabel} role defaults
            </button>
          </Disclosure>
        </div>
      </section>
    </div>
  );
}

/** FocusPanel body when an admin opens the AI Engine box on the Canvas. */
export function AiConfigPanel() {
  const { data, error, mutate } = useApi<ProviderConfigStatus>("/api/admin/provider");
  const { mutate: mutateStatus } = useApi("/api/status");

  async function onUpdated() {
    await Promise.all([mutate(), mutateStatus()]);
  }

  if (error) return <p role="alert" className="text-err">Could not load AI provider settings: {(error as Error).message}</p>;
  if (!data) return <p className="flex items-center gap-2 text-fg-2"><Spinner /> Loading AI settings…</p>;

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-2 rounded-md border border-line bg-bg-0/60 px-3 py-2 text-12 text-fg-1">
        <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-fg-0" aria-hidden />
        <p>Changes apply immediately to every AI step across the pipeline (scoping, search writing, summaries, ranking, appraisal, synthesis, and research questions). Only administrators see this box.</p>
      </div>
      <AiProviderWorkflow config={data} onUpdated={onUpdated} compact />
      <p className="border-t border-line pt-3 text-12 text-fg-2">
        Need the spend limit, AI on/off kill switch, or audit log? Open the <Link href="/admin" className="link">Admin dashboard</Link>.
      </p>
    </div>
  );
}
