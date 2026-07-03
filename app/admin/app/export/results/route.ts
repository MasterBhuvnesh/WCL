import { csvResponse, loadResults, toCsv } from "@/lib/results";

/** Re-read the results file on every request; never serve a stale copy. */
export const dynamic = "force-dynamic";

export function GET(): Response {
  const results = loadResults();
  const rows: (string | number)[][] = [
    [
      "Username",
      "Exam",
      "Status",
      "Score",
      "Max score",
      "Correct",
      "Wrong",
      "Unanswered",
      "Started at",
      "Submitted at",
    ],
    ...results.map((result) => [
      result.username,
      result.examId,
      result.status,
      result.score,
      result.maxScore,
      result.correct,
      result.wrong,
      result.unanswered,
      result.startedAt ?? "",
      result.submittedAt ?? "",
    ]),
  ];
  return csvResponse(toCsv(rows), "wcl-results.csv");
}
