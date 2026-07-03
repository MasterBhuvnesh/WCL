import Link from "next/link";
import { Download } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

import { formatDateTime, loadResults } from "@/lib/results";

/** Re-read the results file on every request; never prerender a stale copy. */
export const dynamic = "force-dynamic";

function formatDuration(startedAt: string | null, submittedAt: string | null): string {
  if (!startedAt || !submittedAt) return "-";
  const totalSeconds = Math.max(
    0,
    Math.round((new Date(submittedAt).getTime() - new Date(startedAt).getTime()) / 1000),
  );
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}m ${seconds.toString().padStart(2, "0")}s`;
}

export default function Home() {
  const results = loadResults().sort((a, b) =>
    (b.submittedAt ?? "").localeCompare(a.submittedAt ?? ""),
  );

  const total = results.length;
  const averageScore =
    total === 0
      ? "-"
      : (results.reduce((sum, r) => sum + r.score, 0) / total).toFixed(1);
  const highestScore =
    total === 0 ? "-" : Math.max(...results.map((r) => r.score)).toString();
  const autoSubmitted = results.filter((r) => r.status === "auto_submitted").length;

  const stats = [
    { label: "Completed exams", value: total.toString() },
    { label: "Average score", value: averageScore },
    { label: "Highest score", value: highestScore },
    { label: "Auto submitted", value: autoSubmitted.toString() },
  ];

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 px-6 py-10">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">WCL Admin</h1>
          <p className="text-muted-foreground text-sm">
            Completed examination results
          </p>
        </div>
        {results.length > 0 && (
          <a
            href="/export/results"
            download
            className={buttonVariants({ variant: "outline", size: "sm" })}
          >
            <Download /> Export CSV
          </a>
        )}
      </header>

      <section className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {stats.map((stat) => (
          <Card key={stat.label}>
            <CardHeader>
              <CardDescription>{stat.label}</CardDescription>
              <CardTitle className="text-3xl tabular-nums">{stat.value}</CardTitle>
            </CardHeader>
          </Card>
        ))}
      </section>

      <Card className="overflow-hidden py-0">
        {results.length === 0 ? (
          <p className="text-muted-foreground px-6 py-16 text-center text-sm">
            No completed examinations yet. Results appear here as candidates
            submit.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Username</TableHead>
                  <TableHead>Exam</TableHead>
                  <TableHead className="text-right">Score</TableHead>
                  <TableHead className="text-right">Correct</TableHead>
                  <TableHead className="text-right">Wrong</TableHead>
                  <TableHead className="text-right">Unanswered</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Submitted at</TableHead>
                  <TableHead className="text-right">Duration</TableHead>
                  <TableHead className="text-right">Answers</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {results.map((result) => (
                  <TableRow key={result.sessionId}>
                    <TableCell className="font-medium">{result.username}</TableCell>
                    <TableCell className="text-muted-foreground">{result.examId}</TableCell>
                    <TableCell className="text-right font-medium tabular-nums">
                      {result.score} / {result.maxScore}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{result.correct}</TableCell>
                    <TableCell className="text-right tabular-nums">{result.wrong}</TableCell>
                    <TableCell className="text-right tabular-nums">{result.unanswered}</TableCell>
                    <TableCell>
                      <Badge variant={result.status === "submitted" ? "secondary" : "outline"}>
                        {result.status === "submitted" ? "Submitted" : "Auto submitted"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {formatDateTime(result.submittedAt)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatDuration(result.startedAt, result.submittedAt)}
                    </TableCell>
                    <TableCell className="text-right">
                      <Link
                        href={`/session/${result.sessionId}`}
                        className="text-foreground underline underline-offset-4 hover:no-underline"
                      >
                        View
                      </Link>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </Card>
    </main>
  );
}
