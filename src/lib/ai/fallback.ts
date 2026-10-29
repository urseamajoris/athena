// What a structured call falls back on when its retry fails (pure; unit-tested in fallback.test.ts).

/**
 * The first reply when it failed only the preference (CallOpts.prefer). It passed the schema and every rule, so
 * when the retry fails a rule, or never comes (budget reached, AI switched off, a network error), the call returns
 * it rather than failing a turn that had a usable answer.
 */
export class PreferenceFallback<T> {
  private kept: { data: T } | null = null;
  /** Records a reply's check: kept when it is the first reply and failed only the preference (`data` is set). */
  note(attempt: number, v: { ok: boolean; data?: T }) {
    if (attempt === 1 && !v.ok && v.data !== undefined) this.kept = { data: v.data };
  }
  /** The kept reply, or `error` thrown when there is none. */
  or(error: unknown): T {
    if (this.kept) return this.kept.data;
    throw error;
  }
}
