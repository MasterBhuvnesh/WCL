import postgres from "postgres";

import examData from "@/data/exam.json";
import type { Candidate, ExamMeta } from "@/lib/types";

/**
 * Candidate lookup against the exam database: participants (username =
 * employeeId, display_name = name, dob) joined with hallticket_seats
 * (block/floor/lab/seat). Exam-wide fields (date, timings, venue) come from
 * data/exam.json.
 *
 * Import this only from server code (route handlers / server components) —
 * it opens a database connection.
 */
const exam = examData as ExamMeta;

const sql = postgres(
  process.env.DATABASE_URL ?? "postgres://wcl:wcl@localhost:5432/wcl",
  // ponytail: tiny pool; this portal only does point lookups at login.
  { max: 5 },
);

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
 * Entry gate, derived from the floor: floors 1-3 enter by Gate 1, floors 4-5 by
 * Gate 2. floor_no arrives as "Floor 3", so the digit is pulled out; anything
 * unparseable falls back to Gate 1 rather than printing a blank gate.
 */
export function gateForFloor(floorNo: string): string {
  const floor = Number(/\d+/.exec(floorNo)?.[0]);
  return floor >= 4 ? "Gate 2" : "Gate 1";
}

/**
 * Look up a candidate by employee ID (case-insensitive) and ISO date of birth.
 * Both must match; returns null otherwise. DOB acts as the shared secret, so it
 * is compared exactly.
 */
export async function findCandidate(
  employeeId: string,
  dobIso: string,
): Promise<Candidate | null> {
  const rows = await sql`
    select p.username, p.display_name, p.dob::text as dob,
           h.block_no, h.floor_no, h.lab_no, h.seat_no
    from participants p
    join hallticket_seats h on h.participant_id = p.id
    where lower(p.username) = ${employeeId.trim().toLowerCase()}
      and p.dob = ${dobIso}
    limit 1
  `;
  const row = rows[0];
  if (!row) return null;

  return {
    employeeId: row.username,
    name: row.display_name ?? row.username,
    dob: row.dob,
    examDate: exam.examDate,
    reportingTime: exam.reportingTime,
    gateClosesTime: exam.gateClosesTime,
    examTime: exam.examTime,
    venueName: exam.venueName,
    venueAddress: exam.venueAddress,
    gateNo: gateForFloor(row.floor_no),
    blockNo: row.block_no,
    floorNo: row.floor_no,
    labNo: row.lab_no,
    seatNo: row.seat_no,
  };
}
