"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Check, Minus, X } from "lucide-react";


import { OutcomePie } from "@/components/outcome-pie";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tray, TrayInner, TrayLabel, TrayStrip } from "@/components/ui/tray";
import { clearResult, loadResult } from "@/lib/session";
import type { CandidateResult, Outcome } from "@/lib/types";
import { cn } from "@/lib/utils";

function fmt(iso: string | null): string {
  if (!iso) return "-";
  return new Date(iso).toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Scores are stored as reals (a wrong answer deducts 0.5), so trim the ".0". */
function fmtScore(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

function OutcomeBadge({ outcome }: { outcome: Outcome }) {
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

/** One KPI cell in the summary strip. */
function Stat({
  label,
  value,
  className,
}: {
  label: string;
  value: string;
  className?: string;
}) {
  return (
    <div className="flex flex-col gap-1">
      <TrayLabel>{label}</TrayLabel>
      <p className={cn("font-mono text-2xl font-semibold tabular-nums", className)}>
        {value}
      </p>
    </div>
  );
}

/**
 * The scorecard. Rendered client-only (see app/result/page.tsx), so the
 * scorecard can be read straight out of sessionStorage during the first render
 * — there is no server pass to disagree with, and no effect that would flash an
 * empty page first.
 */
export function ResultView() {
  const router = useRouter();
  const [result] = useState<CandidateResult | null>(loadResult);

  // Nothing in storage means the tab was opened directly, or the session was
  // cleared; send them back to sign in. No setState here, so no cascading render.
  useEffect(() => {
    if (!result) router.replace("/");
  }, [result, router]);

  function signOut() {
    clearResult();
    router.replace("/");
  }

  if (!result) return null;

  const answers = result.answers;

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-6 px-4 py-6 sm:px-6 sm:py-8">
      <header className="flex items-center justify-between gap-3 border-b pb-4">
        <img
          src="/assets/wcl.logo.png"
          alt="Western Coalfields Limited"
          className="h-14 object-contain"
        />
        <div className="flex items-center gap-3">
          <div className="hidden text-right text-sm sm:block">
            <p className="font-medium">{result.name}</p>
            <p className="text-muted-foreground">{result.employeeId}</p>
          </div>
          <Button variant="outline" onClick={signOut}>
            Sign out
          </Button>
        </div>
      </header>

      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-heading text-xl font-medium">Your result</h1>
          <p className="text-sm text-muted-foreground">
            {result.examTitle} · submitted {fmt(result.submittedAt)}
          </p>
        </div>
        <Badge variant={result.status === "submitted" ? "secondary" : "outline"}>
          {result.status === "submitted" ? "Submitted" : "Auto submitted"}
        </Badge>
      </div>

      <Tray>
        <TrayStrip className="px-3 py-2">
          <TrayLabel>Score summary</TrayLabel>
        </TrayStrip>
        <TrayInner className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Stat
            label="Score"
            value={`${fmtScore(result.score)} / ${result.maxScore}`}
          />
          <Stat
            label="Correct"
            value={String(result.correct)}
            className="text-emerald-700 dark:text-emerald-400"
          />
          <Stat
            label="Wrong"
            value={String(result.wrong)}
            className="text-destructive"
          />
          <Stat
            label="Unanswered"
            value={String(result.unanswered)}
            className="text-muted-foreground"
          />
        </TrayInner>
        <TrayStrip className="py-2 text-xs text-muted-foreground">
          Marking scheme: a question scores its full marks only when the selected
          option set exactly matches the correct one; a wrong answer deducts 0.5
          marks and an unanswered question scores zero.
        </TrayStrip>
      </Tray>

      <OutcomePie
        correct={result.correct}
        wrong={result.wrong}
        unanswered={result.unanswered}
      />

      {answers.length === 0 ? (
        <Tray>
          <TrayInner className="text-muted-foreground py-12 text-center text-sm">
            No per-question data was recorded for your session.
          </TrayInner>
        </Tray>
      ) : (
        <section className="flex flex-col gap-4">
          <h2 className="font-heading text-lg font-medium">Answer breakdown</h2>
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
                    // plain img: S3 object host, next/image would need remote-pattern config
                    <img
                      src={answer.imageUrl}
                      alt="Question image"
                      className="max-h-72 max-w-full rounded-lg border object-contain"
                    />
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
                            isSelected &&
                              !option.isCorrect &&
                              "border-destructive/40 bg-destructive/5",
                          )}
                        >
                          <span className="flex-1">{option.text}</span>
                          {isSelected && (
                            <Badge variant="outline" className="shrink-0">
                              Your answer
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
    </main>
  );
}
