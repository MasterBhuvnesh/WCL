/**
 * Repair participant dates of birth that were imported a day early.
 *
 * SheetJS returned .xlsx date cells 10 seconds short of midnight, so the old
 * importer stored the previous day for every row (see dateCellToIso in
 * _lib.ts). import-participants.ts never updates existing usernames, so
 * re-running it cannot repair them; this does.
 *
 * Re-reads the source file with the fixed parser and updates only the rows
 * whose stored dob differs. Usernames absent from the database are reported
 * and left alone. Redis caches no dob, so nothing needs invalidating.
 *
 * Usage:
 *   bun scripts/fix-participant-dob.ts <file.csv|file.xlsx>            Dry run.
 *   bun scripts/fix-participant-dob.ts <file.csv|file.xlsx> --apply    Write.
 */

import { inArray, sql } from "drizzle-orm";
import { db, pgClient, schema } from "../src/db/index.ts";
import { bail, normalizeDob, readRows } from "./_lib.ts";

const { participants } = schema;

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const apply = args.includes("--apply");
  const file = args.find((a) => !a.startsWith("--"));
  if (!file) {
    console.error("Usage: bun scripts/fix-participant-dob.ts <file.csv|file.xlsx> [--apply]");
    process.exit(1);
  }

  /* Parse the file first: a single bad row aborts before anything is written. */
  const wanted = new Map<string, string>();
  const errors: string[] = [];
  readRows(file).forEach((row, i) => {
    const rowNo = i + 2; // header is row 1, first data row is 2
    const username = row.username ?? "";
    const dobRaw = row.dob ?? "";
    if (!username || !dobRaw) return; // nothing to repair without both
    const dob = normalizeDob(dobRaw);
    if (dob === null) {
      errors.push(`row ${rowNo}: invalid dob "${dobRaw}" for username "${username}"`);
      return;
    }
    wanted.set(username, dob);
  });
  if (errors.length > 0) bail(errors);

  const usernames = [...wanted.keys()];
  const rows = await db
    .select({ username: participants.username, dob: participants.dob })
    .from(participants)
    .where(inArray(participants.username, usernames));

  const found = new Set(rows.map((r) => r.username));
  const missing = usernames.filter((u) => !found.has(u));
  const changes = rows
    .map((r) => ({ username: r.username, from: r.dob, to: wanted.get(r.username)! }))
    .filter((c) => c.from !== c.to);

  console.log(`File rows with a dob: ${wanted.size}`);
  console.log(`Matched in database:  ${rows.length}`);
  console.log(`Need updating:        ${changes.length}`);
  if (missing.length > 0) {
    console.warn(`Not in database (left alone): ${missing.length} - ${missing.join(", ")}`);
  }
  for (const c of changes.slice(0, 10)) {
    console.log(`  ${c.username}: ${c.from} -> ${c.to}`);
  }
  if (changes.length > 10) console.log(`  ... and ${changes.length - 10} more`);

  if (changes.length > 0 && apply) {
    // One statement: a CASE over the changed usernames, so the whole repair is
    // atomic without shipping one UPDATE per row.
    const cases = sql.join(
      changes.map((c) => sql`when ${c.username} then ${c.to}::date`),
      sql` `,
    );
    await db
      .update(participants)
      .set({ dob: sql`case ${participants.username} ${cases} end` })
      .where(inArray(participants.username, changes.map((c) => c.username)));
  }

  console.log("");
  console.log(apply ? `Updated ${changes.length} participant(s).` : "Dry run - nothing written. Re-run with --apply to write.");

  await pgClient.end({ timeout: 5 });
}

main().catch(async (error) => {
  console.error(error);
  await pgClient.end({ timeout: 5 });
  process.exit(1);
});
