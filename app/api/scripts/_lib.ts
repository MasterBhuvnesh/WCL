/**
 * Shared helpers for the CSV/XLSX import scripts. Reads the first sheet of a
 * .csv or .xlsx file into trimmed string records with lowercased headers, so
 * "Username", "username " and "USERNAME" columns all work.
 */
import * as XLSX from "xlsx";

/** Excel's day zero (serial 0 = 1899-12-30) in UTC milliseconds. */
const EXCEL_EPOCH_MS = Date.UTC(1899, 11, 30);

/**
 * Convert an Excel date serial to ISO YYYY-MM-DD with pure UTC math. Rounds
 * to the nearest minute first: serials written by other tools can sit a few
 * seconds shy of midnight, which would otherwise land on the previous day.
 */
function serialToIso(serial: number): string {
  const ms = Math.round(serial * 1440) * 60_000;
  return new Date(EXCEL_EPOCH_MS + ms).toISOString().slice(0, 10);
}

export function readRows(path: string): Record<string, string>[] {
  // raw:true stops the CSV/text parser from converting date-looking strings
  // ("2001-03-14") into Excel date serials; cellNF keeps each cell's number
  // format so date cells can be recognised. Deliberately NOT cellDates:
  // SheetJS's serial->Date conversion goes through the local timezone and can
  // come out seconds before midnight, shifting the date back one day.
  const workbook = XLSX.readFile(path, { raw: true, cellNF: true });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  // Rewrite date-formatted cells to ISO text up front, so sheet_to_json below
  // can't fall back to rendering their serial number ("36964.22...") as the
  // display text.
  for (const [addr, cell] of Object.entries(sheet)) {
    if (
      !addr.startsWith("!") &&
      cell?.t === "n" &&
      cell.z &&
      XLSX.SSF.is_date(cell.z)
    ) {
      sheet[addr] = { t: "s", v: serialToIso(cell.v) };
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
 * Accepts YYYY-MM-DD, DD/MM/YYYY, DD-MM-YYYY or a bare 5-digit Excel date
 * serial (a date column whose formatting was stripped shows up as "32659")
 * and returns ISO YYYY-MM-DD, or null when malformed or not a real calendar
 * date. Serials are 5-digit only (1927-2173) so a stray year like "2001"
 * never converts silently.
 */
export function normalizeDob(input: string): string | null {
  if (/^\d{5}$/.test(input)) return serialToIso(Number(input));
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
