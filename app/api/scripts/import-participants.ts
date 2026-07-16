/**
 * Import participants from a .csv or .xlsx file into Postgres.
 *
 * Columns (headers matched case-insensitively): username, display_name, dob, secret.
 *   username      required; must be unique within the file.
 *   display_name  optional.
 *   dob           optional; YYYY-MM-DD, DD/MM/YYYY or DD-MM-YYYY (stored as ISO).
 *   secret        optional; when absent the row gets the common exam password
 *                 (env PARTICIPANT_PASSWORD). Plaintext is never stored.
 *
 * The whole file is validated first: a single bad row aborts with nothing
 * written. Usernames already present in the database are skipped (never
 * updated); the rest are inserted in one transaction.
 *
 * Usage:
 *   bun scripts/import-participants.ts <file.csv|file.xlsx>
 *   bun scripts/import-participants.ts <file> --dry-run   Validate and report only.
 */

import { inArray } from "drizzle-orm";
import { db, pgClient, schema } from "../src/db/index.ts";
import { env } from "../src/env.ts";
import { bail, normalizeDob, readRows } from "./_lib.ts";

/** Ambient Bun password API (project does not depend on bun-types). */
declare const Bun: {
  password: { hash(password: string): Promise<string> };
};

const { participants } = schema;
type ParticipantRow = typeof participants.$inferInsert;

/** A validated row, minus the secret hash which is computed only for inserts. */
interface Parsed {
  username: string;
  displayName: string | null;
  dob: string | null;
  /** Empty means "use the common exam password". */
  secret: string;
}

/** Close the database connection, then terminate. Import never touches Redis. */
async function shutdown(code: number): Promise<never> {
  await pgClient.end({ timeout: 5 });
  process.exit(code);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const file = args.find((a) => !a.startsWith("--"));
  if (!file) {
    console.error(
      "Usage: bun scripts/import-participants.ts <file.csv|file.xlsx> [--dry-run]",
    );
    process.exit(1);
  }

  /* Parse + validate the whole file, collecting every problem before failing. */
  const parsed: Parsed[] = [];
  const errors: string[] = [];
  const seen = new Set<string>();

  readRows(file).forEach((row, i) => {
    const rowNo = i + 2; // header is row 1, first data row is 2
    const username = row.username ?? "";
    if (!username) {
      errors.push(`row ${rowNo}: username is required`);
      return;
    }
    if (seen.has(username)) {
      errors.push(`row ${rowNo}: duplicate username "${username}" (already used on an earlier row)`);
      return;
    }
    seen.add(username);

    let dob: string | null = null;
    const dobRaw = row.dob ?? "";
    if (dobRaw) {
      dob = normalizeDob(dobRaw);
      if (dob === null) {
        errors.push(`row ${rowNo}: invalid dob "${dobRaw}" for username "${username}" (use YYYY-MM-DD, DD/MM/YYYY or DD-MM-YYYY)`);
        return;
      }
    }

    parsed.push({
      username,
      displayName: row.display_name || null,
      dob,
      secret: row.secret ?? "",
    });
  });

  if (errors.length > 0) bail(errors); // nothing written

  if (parsed.length === 0) {
    console.log(`No data rows found in ${file}. Nothing to do.`);
    await shutdown(0);
  }

  /* Skip usernames that already exist; never update them. */
  const existingRows = await db
    .select({ username: participants.username })
    .from(participants)
    .where(inArray(participants.username, parsed.map((r) => r.username)));
  const existing = new Set(existingRows.map((r) => r.username));
  const toInsert = parsed.filter((r) => !existing.has(r.username));
  const skipped = parsed.filter((r) => existing.has(r.username));

  /* Hash the common exam password at most once, and only when actually needed. */
  let commonHash: string | undefined;
  const commonSecretHash = async () =>
    (commonHash ??= await Bun.password.hash(env.PARTICIPANT_PASSWORD));

  if (!dryRun && toInsert.length > 0) {
    const rows: ParticipantRow[] = [];
    for (const r of toInsert) {
      rows.push({
        username: r.username,
        secretHash: r.secret ? await Bun.password.hash(r.secret) : await commonSecretHash(),
        displayName: r.displayName,
        dob: r.dob,
      });
    }
    await db.transaction(async (tx) => {
      // ponytail: one multi-row insert; if a file exceeds ~16k rows
      // (pg 65535-param limit / 4 cols) split into chunks inside this transaction.
      await tx.insert(participants).values(rows);
    });
  }

  /* Summary. */
  const noSecretCount = toInsert.filter((r) => !r.secret).length;
  console.log("");
  console.log(dryRun ? "Dry run - nothing written." : "Import complete.");
  console.log("--------------------------------------------------");
  console.log(`${dryRun ? "Would insert" : "Inserted"}: ${toInsert.length}`);
  if (skipped.length > 0) {
    console.warn(`Skipped (already exist): ${skipped.length} - ${skipped.map((r) => r.username).join(", ")}`);
  } else {
    console.log("Skipped (already exist): 0");
  }
  if (noSecretCount > 0) {
    console.log(`${noSecretCount} row(s) without a secret use the common exam password (env PARTICIPANT_PASSWORD).`);
  }
  console.log("--------------------------------------------------");

  await shutdown(0);
}

main().catch(async (error) => {
  console.error("Import failed:", error);
  await shutdown(1);
});
