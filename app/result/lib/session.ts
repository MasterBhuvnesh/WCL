import type { CandidateResult } from "@/lib/types";

/**
 * The signed-in candidate's scorecard is held in sessionStorage for the tab's
 * lifetime. This is the same deliberately lightweight, stopgap auth the
 * hall-ticket portal uses — the login route does the real check server-side and
 * hands back the whole payload, so nothing here is trusted for authorisation.
 * Swap for an httpOnly cookie + server session if this portal ever needs one.
 */
const KEY = "wcl-result-candidate";

export function storeResult(result: CandidateResult): void {
  sessionStorage.setItem(KEY, JSON.stringify(result));
}

export function loadResult(): CandidateResult | null {
  const raw = sessionStorage.getItem(KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as CandidateResult;
  } catch {
    return null;
  }
}

export function clearResult(): void {
  sessionStorage.removeItem(KEY);
}
