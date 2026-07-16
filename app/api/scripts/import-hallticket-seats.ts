/**
 * Import hall-ticket seat allocations from a .csv or .xlsx file into the
 * hallticket_seats table. The external hall-ticket portal (app/hallticket)
 * reads these rows joined with participants to render each admit card.
 *
 * Usage:
 *   bun scripts/import-hallticket-seats.ts <file.csv|file.xlsx> [--dry-run]
 *
 * Columns (case-insensitive, order-free): username, block_no, floor_no,
 * lab_no, seat_no - all five required on every row. Every username must
 * already exist in participants (run import-participants first).
 *
 * One row is written per participant, upserted on participant_id, so
 * RE-IMPORTING REALLOCATES: a participant's existing seat is overwritten with
 * the new file's values. --dry-run validates everything and prints the planned
 * insert/update split without touching the database.
 */

import { inArray, sql } from "drizzle-orm";
import { db, pgClient, schema } from "../src/db/index.ts";
import { bail, readRows } from "./_lib.ts";

const { hallticketSeats, participants } = schema;

type SeatRow = typeof hallticketSeats.$inferInsert;

const REQUIRED = ["username", "block_no", "floor_no", "lab_no", "seat_no"] as const;

/** Close the database connection, then terminate the process. */
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
      "Usage: bun scripts/import-hallticket-seats.ts <file.csv|file.xlsx> [--dry-run]",
    );
    process.exit(1);
  }

  const rows = readRows(file);
  if (rows.length === 0) {
    console.error(`No data rows found in ${file}.`);
    process.exit(1);
  }

  /* Row validation: collect every problem before writing anything. Spreadsheet
     lines are 1-based with the header on line 1, so data starts at line 2. */
  const errors: string[] = [];
  const seenUser = new Map<string, number>();
  const seenSeat = new Map<string, number>();

  rows.forEach((row, i) => {
    const line = i + 2;

    const missing = REQUIRED.filter((c) => !row[c]);
    if (missing.length > 0) {
      errors.push(`row ${line}: missing ${missing.join(", ")}`);
      return;
    }

    const firstUser = seenUser.get(row.username);
    if (firstUser) {
      errors.push(
        `row ${line}: duplicate username "${row.username}" (already on row ${firstUser})`,
      );
    } else {
      seenUser.set(row.username, line);
    }

    const seatKey = `${row.block_no}|${row.floor_no}|${row.lab_no}|${row.seat_no}`;
    const firstSeat = seenSeat.get(seatKey);
    if (firstSeat) {
      errors.push(
        `row ${line}: duplicate seat ${row.block_no} / ${row.floor_no} / ${row.lab_no} / ${row.seat_no} (already on row ${firstSeat})`,
      );
    } else {
      seenSeat.set(seatKey, line);
    }
  });

  /* Every username in the file must resolve to a participant. */
  const usernames = [...seenUser.keys()];
  const found = usernames.length
    ? await db
        .select({ id: participants.id, username: participants.username })
        .from(participants)
        .where(inArray(participants.username, usernames))
    : [];
  const idByUsername = new Map(found.map((p) => [p.username, p.id] as const));

  const missingUsers = usernames.filter((u) => !idByUsername.has(u));
  if (missingUsers.length > 0) {
    for (const u of missingUsers) {
      errors.push(`username "${u}" not found in participants`);
    }
    errors.push(
      "hint: import these candidates first - bun scripts/import-participants.ts <file>",
    );
  }

  if (errors.length > 0) bail(errors);

  /* All rows are valid and every username resolved, so a direct map is safe. */
  const seatRows: SeatRow[] = rows.map((row) => ({
    participantId: idByUsername.get(row.username)!,
    blockNo: row.block_no,
    floorNo: row.floor_no,
    labNo: row.lab_no,
    seatNo: row.seat_no,
  }));

  /* Split insert vs update for the summary: which participants already sit. */
  const ids = seatRows.map((r) => r.participantId);
  const existing = await db
    .select({ participantId: hallticketSeats.participantId })
    .from(hallticketSeats)
    .where(inArray(hallticketSeats.participantId, ids));
  const existingIds = new Set(existing.map((e) => e.participantId));
  const updateCount = seatRows.filter((r) => existingIds.has(r.participantId)).length;
  const insertCount = seatRows.length - updateCount;

  if (dryRun) {
    console.log(
      `Dry run: ${seatRows.length} row(s) valid - ${insertCount} to insert, ${updateCount} to reallocate. Nothing written.`,
    );
    await shutdown(0);
  }

  // ponytail: one statement, ~5 params/row, so it tops out near Postgres'
  // 65535-param limit (~13k rows). Chunk if seat files ever get that large.
  await db.transaction(async (tx) => {
    await tx
      .insert(hallticketSeats)
      .values(seatRows)
      .onConflictDoUpdate({
        target: hallticketSeats.participantId,
        set: {
          blockNo: sql`excluded.block_no`,
          floorNo: sql`excluded.floor_no`,
          labNo: sql`excluded.lab_no`,
          seatNo: sql`excluded.seat_no`,
        },
      });
  });

  console.log("");
  console.log(`Imported ${seatRows.length} seat allocation(s) into hallticket_seats.`);
  console.log(`  inserted: ${insertCount}`);
  console.log(`  updated:  ${updateCount}`);

  await shutdown(0);
}

main().catch(async (error) => {
  console.error("Import failed:", error);
  await shutdown(1);
});
