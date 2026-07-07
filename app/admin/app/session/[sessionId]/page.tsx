import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Check, Download, Minus, X } from "lucide-react";

import { OutcomePie } from "@/components/outcome-pie";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { formatDateTime, loadResults, type ResultAnswer } from "@/lib/results";

/** Re-read the results file on every request; never prerender a stale copy. */
export const dynamic = "force-dynamic";

function OutcomeBadge({ outcome }: { outcome: ResultAnswer["outcome"] }) {
  if (outcome === "correct") {
    return (
      <Badge className="border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400">
        <Check /> Correct
      </Badge>
    );
  }
  if (outcome === "wrong") {
    return (
      <Badge className="border-destructive/40 bg-destructive/10 text-destructive">
        <X /> Wrong
      </Badge>
    );
  }
  return (
    <Badge variant="secondary">
      <Minus /> Unanswered
    </Badge>
  );
}

export default async function SessionPage({
  params,
}: {
  params: Promise<{ sessionId: string }>;
}) {
  const { sessionId } = await params;
  const result = loadResults().find((entry) => entry.sessionId === sessionId);
  if (!result) notFound();

  const answers = result.answers ?? [];

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-6 px-6 py-10">
      <div>
        <Link
          href="/"
          className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5 text-sm"
        >
          <ArrowLeft className="size-4" /> Back to results
        </Link>
      </div>

      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{result.username}</h1>
          <p className="text-muted-foreground text-sm">
            {result.examId} · submitted {formatDateTime(result.submittedAt)}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Badge variant={result.status === "submitted" ? "secondary" : "outline"}>
            {result.status === "submitted" ? "Submitted" : "Auto submitted"}
          </Badge>
          <p className="text-xl font-semibold tabular-nums">
            {result.score} / {result.maxScore}
          </p>
          {answers.length > 0 && (
            <a
              href={`/export/results/${result.sessionId}`}
              download
              className={buttonVariants({ variant: "outline", size: "sm" })}
            >
              <Download /> Export CSV
            </a>
          )}
        </div>
      </header>

      <OutcomePie
        correct={result.correct}
        wrong={result.wrong}
        unanswered={result.unanswered}
      />

      {answers.length === 0 ? (
        <Card>
          <CardContent className="text-muted-foreground py-12 text-center text-sm">
            No per-question data was recorded for this session. It predates
            answer capture.
          </CardContent>
        </Card>
      ) : (
        <section className="flex flex-col gap-4">
          {answers.map((answer, index) => {
            const selected = new Set(answer.selectedOptionIds);
            return (
              <Card key={answer.questionId} className="gap-3 py-4">
                <CardContent className="flex flex-col gap-3 px-4">
                  <div className="flex items-start justify-between gap-3">
                    <p className="text-muted-foreground text-xs font-medium">
                      Question {index + 1}{" "}
                      <span className="font-normal">· {answer.type}</span>
                    </p>
                    <OutcomeBadge outcome={answer.outcome} />
                  </div>
                  <p className="text-sm font-medium">{answer.text}</p>
                  <ul className="flex flex-col gap-1.5">
                    {answer.options.map((option) => {
                      const isSelected = selected.has(option.id);
                      return (
                        <li
                          key={option.id}
                          className={cn(
                            "flex items-center gap-2 rounded-md border px-3 py-2 text-sm",
                            option.isCorrect &&
                              "border-emerald-500/40 bg-emerald-500/5",
                            isSelected &&
                              !option.isCorrect &&
                              "border-destructive/40 bg-destructive/5",
                          )}
                        >
                          <span className="flex-1">{option.text}</span>
                          {isSelected && (
                            <Badge variant="outline" className="shrink-0">
                              Marked
                            </Badge>
                          )}
                          {option.isCorrect && (
                            <Badge className="shrink-0 border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400">
                              <Check /> Correct answer
                            </Badge>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </CardContent>
              </Card>
            );
          })}
        </section>
      )}
    </main>
  );
}
