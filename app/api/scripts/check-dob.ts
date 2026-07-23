/**
 * Self-check for the date parsing in _lib.ts. No test framework: run it with
 *   bun scripts/check-dob.ts
 * and it exits non-zero on the first failure.
 *
 * Worth keeping because the .xlsx date rounding is invisible until it silently
 * shifts every date of birth by a day. Run under a few timezones:
 *   TZ=Asia/Calcutta / TZ=UTC / TZ=America/New_York
 */
import assert from "node:assert/strict";

import { dateCellToIso, normalizeDob } from "./_lib.ts";

/** Dates arrive from SheetJS as local-time components, so build them that way. */
const local = (y: number, m: number, d: number, h = 0, min = 0, s = 0) =>
  new Date(y, m - 1, d, h, min, s);

// The observed SheetJS output for a cell displaying 31/05/1989.
assert.equal(dateCellToIso(local(1989, 5, 30, 23, 59, 50)), "1989-05-31");
// Exactly midnight, and just past it, must keep their own day.
assert.equal(dateCellToIso(local(1989, 5, 31)), "1989-05-31");
assert.equal(dateCellToIso(local(1989, 5, 31, 0, 0, 10)), "1989-05-31");
// Rounding has to cross month, year and leap-day boundaries.
assert.equal(dateCellToIso(local(1999, 12, 31, 23, 59, 50)), "2000-01-01");
assert.equal(dateCellToIso(local(1992, 2, 28, 23, 59, 50)), "1992-02-29");

assert.equal(normalizeDob("1989-05-31"), "1989-05-31");
assert.equal(normalizeDob("31/05/1989"), "1989-05-31");
assert.equal(normalizeDob("31-05-1989"), "1989-05-31");
assert.equal(normalizeDob("31/02/1989"), null);
assert.equal(normalizeDob("garbage"), null);

console.log(`All date checks passed (TZ=${Intl.DateTimeFormat().resolvedOptions().timeZone}).`);
