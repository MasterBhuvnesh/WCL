/**
 * Presentation helpers for dates. Candidate records store dates as ISO
 * YYYY-MM-DD; these render them for humans without pulling in a date library.
 */

/** "2026-08-10" -> "10/08/2026". */
export function isoToDdmmyyyy(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

/** "2026-08-10" -> "Monday, 10 August 2026". */
export function formatDateLong(iso: string): string {
  const date = new Date(`${iso}T00:00:00`);
  return new Intl.DateTimeFormat("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(date);
}
