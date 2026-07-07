"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Pager } from "@/components/ui/pager";
import { Tray, TrayInner, TrayLabel, TrayStrip } from "@/components/ui/tray";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { adminWsUrl, apiFetch, DEFAULT_EXAM_ID } from "@/lib/api";

interface Entry {
  rank: number;
  participantId: string;
  username: string;
  displayName: string | null;
  score: number;
}
interface Board {
  examId: string;
  total: number;
  entries: Entry[];
}

const PAGE = 50;

export default function LeaderboardPage() {
  const [examId, setExamId] = useState(DEFAULT_EXAM_ID);
  const [offset, setOffset] = useState(0);
  const [board, setBoard] = useState<Board | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [live, setLive] = useState(false);
  const [q, setQ] = useState("");

  const load = useCallback(async () => {
    try {
      const res = await apiFetch<Board>(
        `/admin/leaderboard?examId=${encodeURIComponent(examId)}&limit=${PAGE}&offset=${offset}`,
      );
      setBoard(res);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load leaderboard");
    }
  }, [examId, offset]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- setState happens only after await (data fetch); the sync path sets no state
    void load();
  }, [load]);

  // Live updates: the API publishes wcl:leaderboard:{examId} on every score
  // change. Refetch the current page whenever one arrives — boring but correct
  // for a paged view. ponytail: full refetch, not a client-side merge/re-sort.
  const loadRef = useRef(load);
  useEffect(() => {
    loadRef.current = load;
  }, [load]);
  useEffect(() => {
    const ws = new WebSocket(adminWsUrl());
    ws.onopen = () => setLive(true);
    ws.onclose = () => setLive(false);
    ws.onmessage = (ev) => {
      try {
        const frame = JSON.parse(ev.data) as { channel?: string };
        if (frame.channel === `wcl:leaderboard:${examId}`) void loadRef.current();
      } catch {
        // Ignore malformed frames.
      }
    };
    return () => ws.close();
  }, [examId]);

  const needle = q.trim().toLowerCase();
  const shownEntries = (board?.entries ?? []).filter(
    (e) =>
      !needle ||
      e.username.toLowerCase().includes(needle) ||
      (e.displayName ?? "").toLowerCase().includes(needle),
  );

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-6 py-10">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Leaderboard</h1>
          <p className="text-muted-foreground text-sm">Live standings · {board?.total ?? 0} ranked</p>
        </div>
        <div className="flex items-end gap-3">
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-muted-foreground">Exam ID</span>
            <Input value={examId} onChange={(e) => { setOffset(0); setExamId(e.target.value); }} className="w-44" />
          </label>
        </div>
      </header>

      {error && <p className="text-destructive text-sm">{error}</p>}

      <Tray>
        <TrayStrip className="flex items-center justify-between gap-3 px-3 py-2">
          <TrayLabel>Standings</TrayLabel>
          <div className="flex items-center gap-2">
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search this page…"
              className="h-7 w-48"
            />
            <Badge variant={live ? "secondary" : "outline"}>
              <span className={`size-1.5 rounded-full ${live ? "bg-emerald-500" : "bg-muted-foreground"}`} />
              {live ? "Live" : "Offline"}
            </Badge>
          </div>
        </TrayStrip>
        <TrayInner className="overflow-hidden p-0">
        {shownEntries.length > 0 ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-16 text-right">Rank</TableHead>
                <TableHead>Username</TableHead>
                <TableHead>Name</TableHead>
                <TableHead className="text-right">Score</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {shownEntries.map((e) => (
                <TableRow key={e.participantId}>
                  <TableCell className="text-right font-medium tabular-nums">{e.rank}</TableCell>
                  <TableCell className="font-medium">{e.username}</TableCell>
                  <TableCell className="text-muted-foreground">{e.displayName ?? "-"}</TableCell>
                  <TableCell className="text-right tabular-nums">{e.score}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <p className="text-muted-foreground px-6 py-16 text-center text-sm">
            {board && board.entries.length > 0 ? "No entries match the search on this page." : "No ranked results yet."}
          </p>
        )}
        </TrayInner>
        <TrayStrip className="flex items-center justify-between">
          <Pager offset={offset} total={board?.total ?? 0} page={PAGE} onOffset={setOffset} />
        </TrayStrip>
      </Tray>
    </main>
  );
}
