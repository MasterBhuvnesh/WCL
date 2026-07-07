import { readFileSync } from "node:fs";
import { join } from "node:path";

export interface ResultOption {
  id: string;
  text: string;
  isCorrect: boolean;
}

export interface ResultAnswer {
  questionId: string;
  type: "SCQ" | "MCQ";
  text: string;
  options: ResultOption[];
  selectedOptionIds: string[];
  outcome: "correct" | "wrong" | "unanswered";
}

export interface ExamResult {
  sessionId: string;
  username: string;
  examId: string;
  status: "submitted" | "auto_submitted";
  startedAt: string | null;
  submittedAt: string | null;
  score: number;
  maxScore: number;
  correct: number;
  wrong: number;
  unanswered: number;
  gradedAt: string;
  /** Absent on records written before per-question capture was added. */
  answers?: ResultAnswer[];
}

// ponytail: reads the API's JSON file straight from disk; replace with a
// backend endpoint when the real database lands.
const RESULTS_FILE = join(process.cwd(), "..", "api", "data", "results.json");

export function loadResults(): ExamResult[] {
  try {
    const parsed = JSON.parse(readFileSync(RESULTS_FILE, "utf8"));
    return Array.isArray(parsed) ? (parsed as ExamResult[]) : [];
  } catch {
    return [];
  }
}

/** Serialize rows to CSV with RFC 4180 quoting. */
export function toCsv(rows: (string | number)[][]): string {
  return rows
    .map((row) =>
      row
        .map((cell) => {
          const text = String(cell ?? "");
          return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
        })
        .join(","),
    )
    .join("\r\n");
}

export function csvResponse(csv: string, filename: string): Response {
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}

export function formatDateTime(iso: string | null): string {
  if (!iso) return "-";
  return new Date(iso).toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}
