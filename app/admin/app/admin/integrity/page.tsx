"use client";

import { type ReactNode, useCallback, useEffect, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Tray, TrayInner, TrayLabel, TrayStrip } from "@/components/ui/tray";
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

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col">
      <span className="text-muted-foreground text-xs">{label}</span>
      <span>{children}</span>
    </div>
  );
}

export default function IntegrityPage() {
  const [examId, setExamId] = useState(DEFAULT_EXAM_ID);
  const [typeFilter, setTypeFilter] = useState("");
  const [events, setEvents] = useState<Event[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");

  const load = useCallback(async () => {
    try {
      const rows = await apiFetch<Event[]>(
        `/admin/integrity-events?examId=${encodeURIComponent(examId)}&limit=500`,
      );
      setEvents(rows);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load events");
    }
  }, [examId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- setState happens only after await (data fetch); the sync path sets no state
    void load();
  }, [load]);

  // Type and username filters are client-side (the endpoint has no type param).
  const needle = q.trim().toLowerCase();
  const shown = events.filter(
    (e) =>
      (!typeFilter || e.type === typeFilter) &&
      (!needle || e.username.toLowerCase().includes(needle)),
  );
  const types = Array.from(new Set(events.map((e) => e.type))).sort();

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 px-4 py-8 sm:px-6 sm:py-10">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Integrity events</h1>
          <p className="text-muted-foreground text-sm">Focus loss, double logins, device changes, and other proctoring flags.</p>
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

      <Tray>
        <TrayStrip className="flex flex-wrap items-center justify-between gap-3 px-3 py-2">
          <TrayLabel>Events</TrayLabel>
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search username…"
            className="h-7 w-full sm:w-56"
          />
        </TrayStrip>
        <TrayInner className="overflow-hidden p-0">
        {shown.length > 0 ? (
          <>
          <div className="hidden lg:block">
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
          </div>
          <div className="flex flex-col gap-2 p-3 lg:hidden">
            {shown.map((e) => (
              <div key={e.id} className="flex flex-col gap-2 rounded-xl border border-border p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium">{e.username}</span>
                  <Badge variant="outline">{e.type}</Badge>
                </div>
                <Field label="Time">{fmt(e.createdAt)}</Field>
                <Field label="Details">
                  <span className="font-mono text-xs break-all">
                    {e.meta ? JSON.stringify(e.meta) : "-"}
                  </span>
                </Field>
              </div>
            ))}
          </div>
          </>
        ) : (
          <p className="text-muted-foreground px-6 py-16 text-center text-sm">No integrity events recorded.</p>
        )}
        </TrayInner>
      </Tray>
    </main>
  );
}
