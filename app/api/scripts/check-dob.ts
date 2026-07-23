/**
 * Self-check for the date parsing in _lib.ts. No test framework: run it with
 *   bun scripts/check-dob.ts
 * and it exits non-zero on the first failure.
 *
 * Worth keeping because the .xlsx date handling is invisible until it silently
 * shifts every date of birth by a day. The conversion is pure UTC math, so the
 * result must not depend on the machine timezone; run it under a couple of
 * zones to prove that:
 *   TZ=Asia/Calcutta / TZ=UTC / TZ=America/New_York
 */
import assert from "node:assert/strict";

import { normalizeDob } from "./_lib.ts";

/* Excel date serials, which reach normalizeDob when a date column's number
   formatting has been stripped. 32659 is the row that exposed the original
   off-by-one; 33592 is the serial named in the fix that replaced it. */
assert.equal(normalizeDob("32659"), "1989-05-31");
assert.equal(normalizeDob("33592"), "1991-12-20");
assert.equal(normalizeDob("25569"), "1970-01-01");

/* The serial branch is deliberately 5-digit only, so a bare year is still
   rejected rather than silently becoming a date in 1975. */
assert.equal(normalizeDob("2001"), null);
assert.equal(normalizeDob("123456"), null);

/* The documented text formats. */
assert.equal(normalizeDob("1989-05-31"), "1989-05-31");
assert.equal(normalizeDob("31/05/1989"), "1989-05-31");
assert.equal(normalizeDob("31-05-1989"), "1989-05-31");

/* Impossible and malformed dates stay rejected: an import must abort rather
   than store a rolled-over date. */
assert.equal(normalizeDob("31/02/1989"), null);
assert.equal(normalizeDob("29/02/1989"), null); // 1989 is not a leap year
assert.equal(normalizeDob("29/02/1992"), "1992-02-29");
assert.equal(normalizeDob("garbage"), null);
assert.equal(normalizeDob(""), null);

console.log(`All date checks passed (TZ=${Intl.DateTimeFormat().resolvedOptions().timeZone}).`);
