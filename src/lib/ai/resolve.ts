// Which model a role really uses, given the IDs configured and the models the API key can see.
// Dependency-free, so the rules are unit-tested directly.

export type ModelStatus = "ok" | "substituted" | "unchecked";

/** A model as the API lists it (the fields the rules need). */
export interface KnownModel {
  id: string;
  /** The model line the API states (opus, sonnet, haiku, fable, mythos), or null. */
  line: string | null;
  createdAt: string;
  retired: boolean;
}

const FAMILIES = ["opus", "sonnet", "haiku", "fable", "mythos"] as const;

/** The family named in a model ID ("claude-opus-5-5" → "opus"), or null. */
export function familyOf(id: string): string | null {
  const parts = id.toLowerCase().split(/[^a-z0-9]+/);
  return FAMILIES.find((f) => parts.includes(f)) ?? null;
}

/**
 * The model to use for a configured ID:
 * - listed (or the short name of a listed dated ID): use it, status "ok";
 * - not listed: the newest listed model of the same family, status "substituted", named in the note;
 * - no model of that family listed: keep the configured ID, status "unchecked", with the reason.
 */
export function resolveModel(configured: string, listed: KnownModel[]): { resolved: string; status: ModelStatus; note: string } {
  const live = listed.filter((m) => !m.retired);
  if (live.some((m) => m.id === configured)) return { resolved: configured, status: "ok", note: "confirmed with the model list" };
  const dated = live.find((m) => new RegExp(`^${configured.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}-\\d{8}$`).test(m.id));
  if (dated) return { resolved: configured, status: "ok", note: `confirmed with the model list (as ${dated.id})` };

  const why = listed.some((m) => m.id === configured) ? `${configured} has been retired` : `${configured} is not in this key's model list`;
  const family = familyOf(configured);
  if (!family) return { resolved: configured, status: "unchecked", note: `${why}, and its name does not say which model family to pick another from` };
  const newest = live
    .filter((m) => (m.line ?? familyOf(m.id)) === family)
    .sort((a, b) => (Date.parse(b.createdAt) || 0) - (Date.parse(a.createdAt) || 0) || b.id.localeCompare(a.id))[0];
  if (!newest) return { resolved: configured, status: "unchecked", note: `${why}, and no other ${family} model is listed` };
  return { resolved: newest.id, status: "substituted", note: `${why}; using ${newest.id}, the newest ${family} model listed` };
}
