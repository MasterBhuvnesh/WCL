import type { Candidate } from "@/lib/types";

/**
 * The signed-in candidate is held in sessionStorage for the tab's lifetime.
 * This is a deliberately lightweight, stopgap auth for the seeded/demo phase —
 * the same trade-off noted for the admin app's token storage. Swap for an
 * httpOnly cookie + server session if this portal ever goes public.
 */
const KEY = "wcl-hallticket-candidate";

export function storeCandidate(candidate: Candidate): void {
  sessionStorage.setItem(KEY, JSON.stringify(candidate));
}

export function loadCandidate(): Candidate | null {
  const raw = sessionStorage.getItem(KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Candidate;
  } catch {
    return null;
  }
}

export function clearCandidate(): void {
  sessionStorage.removeItem(KEY);
}
