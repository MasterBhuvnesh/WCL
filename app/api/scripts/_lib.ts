/**
 * Shared helpers for the CSV/XLSX import scripts. Reads the first sheet of a
 * .csv or .xlsx file into trimmed string records with lowercased headers, so
 * "Username", "username " and "USERNAME" columns all work.
 */
import * as XLSX from "xlsx";

/**
 * ISO date for an .xlsx date cell, which is a whole day and carries no time.
 *
 * SheetJS converts Excel serials to a Date with visible float error: a cell
 * showing 31/05/1989 comes back as 30/05/1989 23:59:50 local, so reading the
 * local day components alone loses a day on every row. Shift the instant so
 * local midnight lands on UTC midnight, then round to the nearest day to
 * absorb that error.
 */
export function dateCellToIso(d: Date): string {
  const DAY = 86_400_000;
  const local = d.getTime() - d.getTimezoneOffset() * 60_000;
  return new Date(Math.round(local / DAY) * DAY).toISOString().slice(0, 10);
}

export function readRows(path: string): Record<string, string>[] {
  // Parse raw:true stops the CSV/text parser from converting date-looking
  // strings ("2001-03-14") into Excel date serials; cellDates surfaces real
  // .xlsx date cells as Date objects instead of raw serial numbers.
  const workbook = XLSX.readFile(path, { raw: true, cellDates: true });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  // Rewrite date cells to ISO text up front, so sheet_to_json below can't fall
  // back to rendering their serial number ("36964.22...") as the display text.
  for (const [addr, cell] of Object.entries(sheet)) {
    if (!addr.startsWith("!") && cell?.t === "d" && cell.v instanceof Date) {
      sheet[addr] = { t: "s", v: dateCellToIso(cell.v) };
    }
  }
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
    defval: "",
  });
  
  return rows
    .map((row) => {
      const out: Record<string, string> = {};
      for (const [key, value] of Object.entries(row)) {
        out[key.trim().toLowerCase()] = String(value).trim();
      }
      return out;
    })
    .filter((row) => Object.values(row).some((v) => v !== ""));
}

/**
 * Accepts YYYY-MM-DD, DD/MM/YYYY or DD-MM-YYYY and returns ISO YYYY-MM-DD,
 * or null when malformed or not a real calendar date.
 */
export function normalizeDob(input: string): string | null {
  let y: number, m: number, d: number;
  let match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(input);
  if (match) {
    [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
  } else {
    match = /^(\d{2})[/-](\d{2})[/-](\d{4})$/.exec(input);
    if (!match) return null;
    [d, m, y] = [Number(match[1]), Number(match[2]), Number(match[3])];
  }
  const date = new Date(Date.UTC(y, m - 1, d));
  if (
    date.getUTCFullYear() !== y ||
    date.getUTCMonth() !== m - 1 ||
    date.getUTCDate() !== d
  ) {
    return null;
  }
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** Print collected row errors and exit non-zero. Nothing gets written. */
export function bail(errors: string[]): never {
  console.error(`Import aborted - ${errors.length} problem(s), nothing written:`);
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}
