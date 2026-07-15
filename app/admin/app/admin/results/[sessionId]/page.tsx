"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, Check, Download, Minus, X } from "lucide-react";

import { OutcomePie } from "@/components/outcome-pie";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tray, TrayInner, TrayLabel, TrayStrip } from "@/components/ui/tray";
import { apiFetch } from "@/lib/api";
import { cn } from "@/lib/utils";

interface ReviewOption {
  id: string;
  text: string;
  isCorrect: boolean;
}
interface ReviewAnswer {
  questionId: string;
  type: "SCQ" | "MCQ" | null;
  text: string;
  imageUrl?: string | null;
  options: ReviewOption[];
  selectedOptionIds: string[];
  outcome: "correct" | "wrong" | "unanswered";
}
interface Review {
  sessionId: string;
  username: string;
  examId: string;
  status: string;
  score: number | null;
  maxScore: number | null;
  startedAt: string | null;
  submittedAt: string | null;
  answers: ReviewAnswer[];
}

function fmt(iso: string | null): string {
  if (!iso) return "-";
  return new Date(iso).toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function OutcomeBadge({ outcome }: { outcome: ReviewAnswer["outcome"] }) {
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

export default function ResultReviewPage() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const [review, setReview] = useState<Review | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await apiFetch<Review>(`/admin/results/${encodeURIComponent(sessionId)}`);
      setReview(res);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load result");
    }
  }, [sessionId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- setState happens only after await (data fetch); the sync path sets no state
    void load();
  }, [load]);

  // Per-question CSV built client-side from the already-loaded review.
  function exportCsv() {
    if (!review) return;
    const esc = (v: string | number) => {
      const t = String(v ?? "");
      return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
    };
    const lines = [["Question", "Type", "Outcome", "Marked options", "Correct options"].join(",")];
    for (const a of review.answers) {
      const byId = new Map(a.options.map((o) => [o.id, o.text]));
      lines.push(
        [
          a.text,
          a.type ?? "-",
          a.outcome,
          a.selectedOptionIds.map((id) => byId.get(id) ?? id).join("; "),
          a.options.filter((o) => o.isCorrect).map((o) => o.text).join("; "),
        ]
          .map(esc)
          .join(","),
      );
    }
    const url = URL.createObjectURL(new Blob([lines.join("\r\n")], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `result-${review.username}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const answers = review?.answers ?? [];
  const counts = {
    correct: answers.filter((a) => a.outcome === "correct").length,
    wrong: answers.filter((a) => a.outcome === "wrong").length,
    unanswered: answers.filter((a) => a.outcome === "unanswered").length,
  };

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-6 px-6 py-10">
      <div>
        <Link
          href="/admin/results"
          className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5 text-sm"
        >
          <ArrowLeft className="size-4" /> Back to results
        </Link>
      </div>

      {error && <p className="text-destructive text-sm">{error}</p>}

      {review && (
        <>
          <header className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <h1 className="text-2xl font-semibold tracking-tight">{review.username}</h1>
              <p className="text-muted-foreground text-sm">
                {review.examId} · submitted {fmt(review.submittedAt)}
              </p>
            </div>
            <div className="flex items-center gap-3">
              <Badge variant={review.status === "submitted" ? "secondary" : "outline"}>
                {review.status === "submitted" ? "Submitted" : "Auto submitted"}
              </Badge>
              <p className="font-mono text-xl font-semibold tabular-nums">
                {review.score ?? "-"} / {review.maxScore ?? "-"}
              </p>
              {answers.length > 0 && (
                <Button variant="outline" size="sm" onClick={exportCsv}>
                  <Download /> Export CSV
                </Button>
              )}
            </div>
          </header>

          <OutcomePie correct={counts.correct} wrong={counts.wrong} unanswered={counts.unanswered} />

          {answers.length === 0 ? (
            <Tray>
              <TrayInner className="text-muted-foreground py-12 text-center text-sm">
                No per-question data recorded for this session.
              </TrayInner>
            </Tray>
          ) : (
            <section className="flex flex-col gap-4">
              {answers.map((answer, index) => {
                const selected = new Set(answer.selectedOptionIds);
                return (
                  <Tray key={answer.questionId}>
                    <TrayStrip className="flex items-center justify-between gap-3 px-3 py-2">
                      <TrayLabel>
                        Question {index + 1} · {answer.type ?? "?"}
                      </TrayLabel>
                      <OutcomeBadge outcome={answer.outcome} />
                    </TrayStrip>
                    <TrayInner className="flex flex-col gap-3">
                      <p className="text-sm font-medium">{answer.text}</p>
                      {answer.imageUrl && (
                        // plain img: external emulator host, next/image would need remote-pattern config
                        <img src={answer.imageUrl} alt="Question image" className="max-h-72 rounded-lg border object-contain" />
                      )}
                      <ul className="flex flex-col gap-1.5">
                        {answer.options.map((option) => {
                          const isSelected = selected.has(option.id);
                          return (
                            <li
                              key={option.id}
                              className={cn(
                                "flex items-center gap-2 rounded-md border px-3 py-2 text-sm",
                                option.isCorrect && "border-emerald-500/40 bg-emerald-500/5",
                                isSelected && !option.isCorrect && "border-destructive/40 bg-destructive/5",
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
                    </TrayInner>
                  </Tray>
                );
              })}
            </section>
          )}
        </>
      )}
    </main>
  );
}
