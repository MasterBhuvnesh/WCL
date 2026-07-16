import candidatesData from "@/data/candidates.json";
import type { Candidate } from "@/lib/types";

/**
 * Seeded candidate roster. Loaded from JSON for now; this module is the single
 * place that would later be swapped to query the participants table
 * (app/api/src/db/schema.ts) once the portal talks to the exam API.
 *
 * Import this only from server code (route handlers / server components) so the
 * full roster is never shipped to the browser.
 */
const candidates = candidatesData as Candidate[];

/**
 * Convert a dd/mm/yyyy date string into ISO YYYY-MM-DD, or return null when the
 * input is malformed or not a real calendar date (e.g. 31/02/2004). Requires a
 * 4-digit year.
 */
export function parseDob(input: string): string | null {
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(input.trim());
  if (!match) return null;

  const day = Number(match[1]);
  const month = Number(match[2]);
  const year = Number(match[3]);

  // Round-trip through a UTC Date so impossible dates (e.g. 31/02) are rejected
  // rather than silently rolling over into the next month.
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }

  return `${match[3]}-${match[2]}-${match[1]}`;
}

/**
 * Look up a candidate by employee ID (case-insensitive) and ISO date of birth.
 * Both must match; returns null otherwise. DOB acts as the shared secret, so it
 * is compared exactly.
 */
export function findCandidate(
  employeeId: string,
  dobIso: string,
): Candidate | null {
  const id = employeeId.trim().toLowerCase();
  return (
    candidates.find(
      (c) => c.employeeId.toLowerCase() === id && c.dob === dobIso,
    ) ?? null
  );
}
