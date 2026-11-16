"use client";
import { useApi } from "./api";

/** The signed-in account's computing credits. `exempt` accounts (administrators) are never charged. */
export interface Credits { balance: number; exempt: boolean }

export const BALANCE_PATH = "/api/billing/balance";

/**
 * The account's credits from GET /api/billing/balance (one small read), or null while loading or when the request
 * fails. A failure is not shown and not retried: pages work without the number.
 */
export function useCredits(): Credits | null {
  const { data, error } = useApi<Partial<Credits>>(BALANCE_PATH, { shouldRetryOnError: false });
  if (error || !data || typeof data.balance !== "number") return null;
  return { balance: data.balance, exempt: !!data.exempt };
}

/** Out of credits: an account that pays, with nothing left. */
export const noCredits = (c: Credits | null) => !!c && !c.exempt && c.balance <= 0;
