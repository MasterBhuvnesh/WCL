import { csvResponse, loadResults, toCsv } from "@/lib/results";

/** Re-read the results file on every request; never serve a stale copy. */
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ sessionId: string }> },
): Promise<Response> {
  const { sessionId } = await params;
  const result = loadResults().find((entry) => entry.sessionId === sessionId);
  if (!result) {
    return new Response("Not found", { status: 404 });
  }

  const rows: (string | number)[][] = [
    ["No", "Question ID", "Type", "Question", "Marked options", "Correct options", "Outcome"],
    ...(result.answers ?? []).map((answer, index) => [
      index + 1,
      answer.questionId,
      answer.type,
      answer.text,
      answer.options
        .filter((option) => answer.selectedOptionIds.includes(option.id))
        .map((option) => option.text)
        .join("; "),
      answer.options
        .filter((option) => option.isCorrect)
        .map((option) => option.text)
        .join("; "),
      answer.outcome,
    ]),
  ];

  const safeName = result.username.replace(/[^A-Za-z0-9_-]+/g, "_");
  return csvResponse(toCsv(rows), `wcl-answers-${safeName}.csv`);
}
