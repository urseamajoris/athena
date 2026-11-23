// Shared between server and client: supported AI providers, model catalogs, and pricing estimates.
export type AiProvider = "anthropic" | "gemini" | "xai";
export type ModelRole = "fast" | "summary" | "reasoning";

export const AI_PROVIDERS: readonly AiProvider[] = ["anthropic", "gemini", "xai"] as const;
export const MODEL_ROLES: readonly ModelRole[] = ["fast", "summary", "reasoning"] as const;

export interface ModelOption {
  id: string;
  label: string;
  tier: "fast" | "balanced" | "reasoning";
  note: string;
  pricing: { input: number; cachedInput: number; output: number };
}

export interface ProviderMeta {
  id: AiProvider;
  label: string;
  shortLabel: string;
  envVar: string;
  keyPrefixHint: string;
  keyPlaceholder: string;
  docsUrl: string;
  defaultModels: Record<ModelRole, string>;
  catalog: ModelOption[];
}

export const PROVIDER_META: Record<AiProvider, ProviderMeta> = {
  anthropic: {
    id: "anthropic",
    label: "Anthropic (Claude)",
    shortLabel: "Anthropic",
    envVar: "ANTHROPIC_API_KEY",
    keyPrefixHint: "Starts with sk-ant-",
    keyPlaceholder: "sk-ant-api03-...",
    docsUrl: "https://console.anthropic.com/settings/keys",
    defaultModels: {
      fast: "claude-haiku-4-5-20251001",
      summary: "claude-haiku-4-5-20251001",
      reasoning: "claude-sonnet-4-6",
    },
    catalog: [
      {
        id: "claude-sonnet-4-6",
        label: "Claude Sonnet 4.6",
        tier: "balanced",
        note: "Balanced speed & strong reasoning across all steps",
        pricing: { input: 3, cachedInput: 0.3, output: 15 },
      },
      {
        id: "claude-opus-4-6",
        label: "Claude Opus 4.6",
        tier: "reasoning",
        note: "Deepest reasoning for appraisal, synthesis & questions",
        pricing: { input: 15, cachedInput: 1.5, output: 75 },
      },
      {
        id: "claude-haiku-4-5-20251001",
        label: "Claude Haiku 4.5",
        tier: "fast",
        note: "Fastest & lowest cost for scoping, summaries & ranking",
        pricing: { input: 0.8, cachedInput: 0.08, output: 4 },
      },
      {
        id: "claude-sonnet-4-5-20250929",
        label: "Claude Sonnet 4.5",
        tier: "balanced",
        note: "Previous-generation balanced Claude Sonnet model",
        pricing: { input: 3, cachedInput: 0.3, output: 15 },
      },
    ],
  },
  gemini: {
    id: "gemini",
    label: "Google Gemini",
    shortLabel: "Gemini",
    envVar: "GEMINI_API_KEY",
    keyPrefixHint: "Starts with AIza",
    keyPlaceholder: "AIzaSy...",
    docsUrl: "https://aistudio.google.com/apikey",
    defaultModels: {
      fast: "gemini-2.5-flash",
      summary: "gemini-2.5-flash",
      reasoning: "gemini-2.5-pro",
    },
    catalog: [
      {
        id: "gemini-2.5-pro",
        label: "Gemini 2.5 Pro",
        tier: "reasoning",
        note: "Strongest Gemini reasoning for appraisal & synthesis",
        pricing: { input: 1.25, cachedInput: 0.31, output: 10 },
      },
      {
        id: "gemini-2.5-flash",
        label: "Gemini 2.5 Flash",
        tier: "balanced",
        note: "Fast, low-cost workhorse across the whole pipeline",
        pricing: { input: 0.15, cachedInput: 0.0375, output: 0.6 },
      },
      {
        id: "gemini-2.5-flash-lite",
        label: "Gemini 2.5 Flash-Lite",
        tier: "fast",
        note: "Ultra-fast, lowest cost for bulk summaries & ranking",
        pricing: { input: 0.1, cachedInput: 0.025, output: 0.4 },
      },
      {
        id: "gemini-2.0-flash",
        label: "Gemini 2.0 Flash",
        tier: "fast",
        note: "Stable fast Gemini model for structured extraction",
        pricing: { input: 0.1, cachedInput: 0.025, output: 0.4 },
      },
    ],
  },
  xai: {
    id: "xai",
    label: "xAI (Grok)",
    shortLabel: "xAI",
    envVar: "XAI_API_KEY",
    keyPrefixHint: "Starts with xai-",
    keyPlaceholder: "xai-...",
    docsUrl: "https://console.x.ai/",
    defaultModels: {
      fast: "grok-4.3",
      summary: "grok-4.3",
      reasoning: "grok-4.3",
    },
    catalog: [
      {
        id: "grok-4.3",
        label: "Grok 4.3",
        tier: "balanced",
        note: "Default Grok model for scoping, summaries & synthesis",
        pricing: { input: 1.25, cachedInput: 0.2, output: 2.5 },
      },
      {
        id: "grok-4.20-0309-reasoning",
        label: "Grok 4.20 Reasoning",
        tier: "reasoning",
        note: "Dedicated reasoning variant",
        pricing: { input: 1.25, cachedInput: 0.2, output: 2.5 },
      },
      {
        id: "grok-4.20-0309-non-reasoning",
        label: "Grok 4.20 Fast",
        tier: "fast",
        note: "Fast non-reasoning variant",
        pricing: { input: 1.25, cachedInput: 0.2, output: 2.5 },
      },
    ],
  },
};

export function isAiProvider(v: unknown): v is AiProvider {
  return v === "anthropic" || v === "gemini" || v === "xai";
}

export function providerLabel(p: AiProvider): string {
  return PROVIDER_META[p].shortLabel;
}

export function modelLabel(provider: AiProvider, modelId: string): string {
  return PROVIDER_META[provider].catalog.find((m) => m.id === modelId)?.label ?? modelId;
}

export function estimateProviderCost(provider: AiProvider, model: string, input: number, cached: number, output: number): number {
  const entry = PROVIDER_META[provider].catalog.find((m) => m.id === model) ?? PROVIDER_META[provider].catalog[0];
  const p = entry.pricing;
  const uncached = Math.max(0, input - cached);
  return (uncached * p.input + cached * p.cachedInput + output * p.output) / 1e6;
}

export interface ProviderKeyInfo {
  inUse: "admin" | "environment" | "none";
  masked: string | null;
  problem: string | null;
  admin: { masked: string; setAt: string; setBy: string | null } | null;
  environment: { present: boolean; masked: string | null };
  lastTest: { ok: boolean; at: string; message: string; source: "admin" | "environment" | "none" } | null;
}

export interface ProviderConfigStatus {
  activeProvider: AiProvider;
  activeModels: Record<ModelRole, string>;
  encryption: { ready: boolean; problem: string | null };
  providers: Record<
    AiProvider,
    {
      key: ProviderKeyInfo;
      models: Record<ModelRole, string>;
      customModels: Partial<Record<ModelRole, string>>;
    }
  >;
}
