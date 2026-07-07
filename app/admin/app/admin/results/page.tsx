"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Download } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Pager } from "@/components/ui/pager";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tray, TrayInner, TrayLabel, TrayStrip } from "@/components/ui/tray";
import { API_BASE, apiFetch, DEFAULT_EXAM_ID, getToken } from "@/lib/api";

interface ResultRow {
  sessionId: string;
  username: string;
  examId: string;
  status: "submitted" | "auto_submitted";
  score: number;
  maxScore: number;
  correct: number;
  wrong: number;
  unanswered: number;
  startedAt: string | null;
  submittedAt: string | null;
  gradedAt: string | null;
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

function duration(startedAt: string | null, submittedAt: string | null): string {
  if (!startedAt || !submittedAt) return "-";
  const s = Math.max(0, Math.round((Date.parse(submittedAt) - Date.parse(startedAt)) / 1000));
  return `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, "0")}s`;
}

const PAGE = 50;

export default function ResultsPage() {
  const [examId, setExamId] = useState(DEFAULT_EXAM_ID);
  const [rows, setRows] = useState<ResultRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [offset, setOffset] = useState(0);

  const load = useCallback(async () => {
    try {
      const res = await apiFetch<ResultRow[]>(
        `/admin/results?examId=${encodeURIComponent(examId)}`,
      );
      setRows(res);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load results");
    }
  }, [examId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- setState happens only after await (data fetch); the sync path sets no state
    void load();
  }, [load]);

  async function exportCsv() {
    try {
      const res = await fetch(
        `${API_BASE}/admin/export/results.csv?examId=${encodeURIComponent(examId)}`,
        { headers: { authorization: `Bearer ${getToken() ?? ""}` } },
      );
      if (!res.ok) throw new Error(`Export failed (${res.status})`);
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement("a");
      a.href = url;
      a.download = `results-${examId}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Export failed");
    }
  }

  const total = rows.length;
  const stats = [
    { label: "Completed exams", value: String(total) },
    {
      label: "Average score",
      value: total ? (rows.reduce((s, r) => s + r.score, 0) / total).toFixed(1) : "-",
    },
    { label: "Highest score", value: total ? String(Math.max(...rows.map((r) => r.score))) : "-" },
    { label: "Auto submitted", value: String(rows.filter((r) => r.status === "auto_submitted").length) },
  ];

  const needle = q.trim().toLowerCase();
  const filtered = needle ? rows.filter((r) => r.username.toLowerCase().includes(needle)) : rows;
  const shown = filtered.slice(offset, offset + PAGE);

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 px-6 py-10">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Results</h1>
          <p className="text-muted-foreground text-sm">Completed examination results</p>
        </div>
        <div className="flex items-end gap-3">
          {rows.length > 0 && (
            <Button variant="outline" size="sm" onClick={exportCsv}>
              <Download /> Export CSV
            </Button>
          )}
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-muted-foreground">Exam ID</span>
            <Input value={examId} onChange={(e) => { setOffset(0); setExamId(e.target.value); }} className="w-44" />
          </label>
        </div>
      </header>

      {error && <p className="text-destructive text-sm">{error}</p>}

      <section className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {stats.map((stat) => (
          <Tray key={stat.label}>
            <TrayInner className="space-y-2">
              <TrayLabel>{stat.label}</TrayLabel>
              <p className="font-mono text-[28px] leading-none font-medium tracking-tight tabular-nums">
                {stat.value}
              </p>
            </TrayInner>
          </Tray>
        ))}
      </section>

      <Tray>
        <TrayStrip className="flex items-center justify-between gap-3 px-3 py-2">
          <TrayLabel>Results</TrayLabel>
          <Input
            value={q}
            onChange={(e) => { setOffset(0); setQ(e.target.value); }}
            placeholder="Search username…"
            className="h-7 w-56"
          />
        </TrayStrip>
        <TrayInner className="overflow-hidden p-0">
          {shown.length === 0 ? (
            <p className="text-muted-foreground px-6 py-16 text-center text-sm">
              {rows.length === 0
                ? "No completed examinations yet. Results appear here as candidates submit."
                : "No results match the search."}
            </p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Username</TableHead>
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
                  {shown.map((r) => (
                    <TableRow key={r.sessionId}>
                      <TableCell className="font-medium">{r.username}</TableCell>
                      <TableCell className="text-right font-medium tabular-nums">
                        {r.score} / {r.maxScore}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{r.correct}</TableCell>
                      <TableCell className="text-right tabular-nums">{r.wrong}</TableCell>
                      <TableCell className="text-right tabular-nums">{r.unanswered}</TableCell>
                      <TableCell>
                        <Badge variant={r.status === "submitted" ? "secondary" : "outline"}>
                          {r.status === "submitted" ? "Submitted" : "Auto submitted"}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-muted-foreground">{fmt(r.submittedAt)}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {duration(r.startedAt, r.submittedAt)}
                      </TableCell>
                      <TableCell className="text-right">
                        <Link
                          href={`/admin/results/${r.sessionId}`}
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
        </TrayInner>
        <TrayStrip className="flex items-center justify-between">
          <Pager offset={offset} total={filtered.length} page={PAGE} onOffset={setOffset} />
        </TrayStrip>
      </Tray>
    </main>
  );
}
