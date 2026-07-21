"use client";

import { type ReactNode, useCallback, useEffect, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Pager } from "@/components/ui/pager";
import { Tray, TrayInner, TrayLabel, TrayStrip } from "@/components/ui/tray";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { apiFetch, DEFAULT_EXAM_ID } from "@/lib/api";

type Status = "not_started" | "in_progress" | "submitted" | "auto_submitted";
interface Session {
  sessionId: string;
  username: string;
  status: Status;
  startedAt: string | null;
  deadlineAt: string | null;
  submittedAt: string | null;
  deviceId: string | null;
}
interface SessionsResponse {
  counts: Record<Status, number>;
  sessions: Session[];
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

const PAGE = 50;

const STATUS_LABEL: Record<Status, string> = {
  not_started: "Not started",
  in_progress: "In progress",
  submitted: "Submitted",
  auto_submitted: "Auto submitted",
};

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex justify-between gap-2 text-sm">
      <span className="text-muted-foreground text-xs">{label}</span>
      <span className="text-muted-foreground">{children}</span>
    </div>
  );
}

export default function SessionsPage() {
  const [examId, setExamId] = useState(DEFAULT_EXAM_ID);
  const [data, setData] = useState<SessionsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [offset, setOffset] = useState(0);

  const load = useCallback(async () => {
    try {
      const res = await apiFetch<SessionsResponse>(
        `/admin/sessions?examId=${encodeURIComponent(examId)}`,
      );
      setData(res);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load sessions");
    }
  }, [examId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- setState happens only after await (data fetch); the sync path sets no state
    void load();
  }, [load]);

  async function act(fn: () => Promise<unknown>, ok: string) {
    setError(null);
    setNotice(null);
    try {
      await fn();
      setNotice(ok);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Action failed");
    }
  }

  function reset(s: Session) {
    if (!confirm(`Reset ${s.username}'s session? All their answers are cleared.`)) return;
    void act(
      () => apiFetch(`/admin/sessions/${encodeURIComponent(s.sessionId)}/reset`, { method: "POST" }),
      "Session reset",
    );
  }

  function releaseDevice(s: Session) {
    if (
      !confirm(
        `Release ${s.username}'s device binding? They can then log in from another machine and resume with all their answers intact.`,
      )
    )
      return;
    void act(
      () =>
        apiFetch(`/admin/sessions/${encodeURIComponent(s.sessionId)}/release-device`, {
          method: "POST",
        }),
      "Device binding released. The participant can now log in from a new machine.",
    );
  }

  function addTime(s: Session) {
    const mins = prompt(`Add how many minutes to ${s.username}?`, "10");
    if (!mins) return;
    const seconds = Math.round(Number(mins) * 60);
    if (!Number.isFinite(seconds) || seconds < 1) return;
    void act(
      () =>
        apiFetch(`/admin/sessions/${encodeURIComponent(s.sessionId)}/add-time`, {
          method: "POST",
          body: JSON.stringify({ seconds }),
        }),
      "Time added",
    );
  }

  function addTimeAll() {
    const mins = prompt("Add how many minutes to every in-progress session? (also extends the exam's available_until)", "10");
    if (!mins) return;
    const seconds = Math.round(Number(mins) * 60);
    if (!Number.isFinite(seconds) || seconds < 1) return;
    void act(
      () =>
        apiFetch(`/admin/exams/${encodeURIComponent(examId)}/add-time`, {
          method: "POST",
          body: JSON.stringify({ seconds }),
        }),
      "Time added to all in-progress sessions",
    );
  }

  /* Edit score — Bhuvnesh has told to comment it out for now.
  function editScore(s: Session) {
    const raw = prompt(`New final score for ${s.username}?`);
    if (raw === null) return;
    const finalScore = Number(raw);
    if (!Number.isInteger(finalScore) || finalScore < 0) {
      setError("Score must be a non-negative integer");
      return;
    }
    const reason = prompt("Reason for the change? (optional)") ?? undefined;
    void act(
      () =>
        apiFetch(`/admin/results/${encodeURIComponent(s.sessionId)}`, {
          method: "PATCH",
          body: JSON.stringify({ finalScore, reason: reason || undefined }),
        }),
      "Score updated",
    );
  }
  */

  const counts = data?.counts;
  const statOrder: Status[] = ["not_started", "in_progress", "submitted", "auto_submitted"];
  const needle = q.trim().toLowerCase();
  const filteredSessions = (data?.sessions ?? []).filter(
    (s) =>
      (!needle || s.username.toLowerCase().includes(needle)) && (!status || s.status === status),
  );
  const shownSessions = filteredSessions.slice(offset, offset + PAGE);

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 px-4 py-8 sm:px-6 sm:py-10">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Sessions</h1>
          <p className="text-muted-foreground text-sm">Watch live sessions and add time, release devices, or reset attempts.</p>
        </div>
        <div className="flex items-end gap-3">
          <Button variant="cta" size="sm" onClick={addTimeAll}>
            Add time to all
          </Button>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-muted-foreground">Exam ID</span>
            <Input value={examId} onChange={(e) => { setOffset(0); setExamId(e.target.value); }} className="w-44" />
          </label>
        </div>
      </header>

      {error && <p className="text-destructive text-sm">{error}</p>}
      {notice && <p className="text-emerald-600 text-sm dark:text-emerald-400">{notice}</p>}

      <section className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {statOrder.map((s) => (
          <Tray key={s}>
            <TrayInner className="space-y-2">
              <TrayLabel>{STATUS_LABEL[s]}</TrayLabel>
              <p className="font-mono text-[28px] leading-none font-medium tracking-tight tabular-nums">
                {counts?.[s] ?? 0}
              </p>
            </TrayInner>
          </Tray>
        ))}
      </section>

      <Tray>
        <TrayStrip className="flex flex-wrap items-center justify-between gap-3 px-3 py-2">
          <TrayLabel>Recent sessions</TrayLabel>
          <div className="flex w-full items-center gap-2 sm:w-auto">
            <select
              value={status}
              onChange={(e) => { setOffset(0); setStatus(e.target.value); }}
              className="h-7 rounded-lg border border-border bg-background px-2.5 text-sm"
            >
              <option value="">All statuses</option>
              {statOrder.map((s) => (
                <option key={s} value={s}>
                  {STATUS_LABEL[s]}
                </option>
              ))}
            </select>
            <Input
              value={q}
              onChange={(e) => { setOffset(0); setQ(e.target.value); }}
              placeholder="Search username…"
              className="h-7 w-full min-w-0 flex-1 sm:w-56 sm:flex-none"
            />
          </div>
        </TrayStrip>
        <TrayInner className="overflow-hidden p-0">
        {shownSessions.length > 0 ? (
          <>
          <div className="hidden lg:block">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Username</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Started</TableHead>
                <TableHead>Deadline</TableHead>
                <TableHead>Submitted</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {shownSessions.map((s) => {
                return (
                  <TableRow key={s.sessionId}>
                    <TableCell className="font-medium">{s.username}</TableCell>
                    <TableCell>
                      <Badge variant={s.status === "in_progress" ? "default" : "outline"}>
                        {STATUS_LABEL[s.status]}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground">{fmt(s.startedAt)}</TableCell>
                    <TableCell className="text-muted-foreground">{fmt(s.deadlineAt)}</TableCell>
                    <TableCell className="text-muted-foreground">{fmt(s.submittedAt)}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1.5">
                        {s.status === "in_progress" && (
                          <Button size="xs" variant="outline" onClick={() => addTime(s)}>
                            Add time
                          </Button>
                        )}
                        {s.deviceId && (s.status === "not_started" || s.status === "in_progress") && (
                          <Button size="xs" variant="outline" onClick={() => releaseDevice(s)}>
                            Release device
                          </Button>
                        )}
                        {/* Edit score — Bhuvnesh has told to comment it out for now.
                        {(s.status === "submitted" || s.status === "auto_submitted") && (
                          <Button size="xs" variant="outline" onClick={() => editScore(s)}>
                            Edit score
                          </Button>
                        )}
                        */}
                        <Button size="xs" variant="destructive" onClick={() => reset(s)}>
                          Reset
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
          </div>
          <div className="flex flex-col gap-2 p-3 lg:hidden">
            {shownSessions.map((s) => (
              <div key={s.sessionId} className="flex flex-col gap-2 rounded-xl border border-border p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium">{s.username}</span>
                  <Badge variant={s.status === "in_progress" ? "default" : "outline"}>
                    {STATUS_LABEL[s.status]}
                  </Badge>
                </div>
                <div className="flex flex-col gap-1">
                  <Field label="Started">{fmt(s.startedAt)}</Field>
                  <Field label="Deadline">{fmt(s.deadlineAt)}</Field>
                  <Field label="Submitted">{fmt(s.submittedAt)}</Field>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {s.status === "in_progress" && (
                    <Button size="xs" variant="outline" onClick={() => addTime(s)}>
                      Add time
                    </Button>
                  )}
                  {s.deviceId && (s.status === "not_started" || s.status === "in_progress") && (
                    <Button size="xs" variant="outline" onClick={() => releaseDevice(s)}>
                      Release device
                    </Button>
                  )}
                  <Button size="xs" variant="destructive" onClick={() => reset(s)}>
                    Reset
                  </Button>
                </div>
              </div>
            ))}
          </div>
          </>
        ) : (
          <p className="text-muted-foreground px-6 py-16 text-center text-sm">
            {data && data.sessions.length > 0 ? "No sessions match the filter." : "No sessions for this exam yet."}
          </p>
        )}
        </TrayInner>
        <TrayStrip className="flex items-center justify-between">
          <Pager offset={offset} total={filteredSessions.length} page={PAGE} onOffset={setOffset} />
        </TrayStrip>
      </Tray>
    </main>
  );
}
