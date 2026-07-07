"use client";

import { useCallback, useEffect, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { apiFetch, DEFAULT_EXAM_ID } from "@/lib/api";

interface Event {
  id: string;
  sessionId: string;
  username: string;
  type: string;
  meta: unknown;
  createdAt: string;
}

function fmt(iso: string): string {
  return new Date(iso).toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export default function IntegrityPage() {
  const [examId, setExamId] = useState(DEFAULT_EXAM_ID);
  const [typeFilter, setTypeFilter] = useState("");
  const [events, setEvents] = useState<Event[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const rows = await apiFetch<Event[]>(
        `/admin/integrity-events?examId=${encodeURIComponent(examId)}&limit=500`,
      );
      setEvents(rows);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load events");
    }
  }, [examId]);

  useEffect(() => {
    void load();
  }, [load]);

  // Type filter is client-side (the endpoint has no type param).
  const shown = typeFilter ? events.filter((e) => e.type === typeFilter) : events;
  const types = Array.from(new Set(events.map((e) => e.type))).sort();

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 px-6 py-10">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Integrity events</h1>
          <p className="text-muted-foreground text-sm">Focus-loss, double-login, device-change and more</p>
        </div>
        <div className="flex items-end gap-3">
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-muted-foreground">Type</span>
            <select
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value)}
              className="h-8 rounded-lg border border-border bg-background px-2.5 text-sm"
            >
              <option value="">All</option>
              {types.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-muted-foreground">Exam ID</span>
            <Input value={examId} onChange={(e) => setExamId(e.target.value)} className="w-44" />
          </label>
        </div>
      </header>

      {error && <p className="text-destructive text-sm">{error}</p>}

      <Card className="overflow-hidden py-0">
        {shown.length > 0 ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Time</TableHead>
                <TableHead>Username</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Details</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {shown.map((e) => (
                <TableRow key={e.id}>
                  <TableCell className="text-muted-foreground whitespace-nowrap">{fmt(e.createdAt)}</TableCell>
                  <TableCell className="font-medium">{e.username}</TableCell>
                  <TableCell>
                    <Badge variant="outline">{e.type}</Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground font-mono text-xs">
                    {e.meta ? JSON.stringify(e.meta) : "-"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <p className="text-muted-foreground px-6 py-16 text-center text-sm">No integrity events recorded.</p>
        )}
      </Card>
    </main>
  );
}
