"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
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

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await apiFetch<Board>(
        `/admin/leaderboard?examId=${encodeURIComponent(examId)}&limit=${PAGE}&offset=${offset}`,
      );
      setBoard(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load leaderboard");
    }
  }, [examId, offset]);

  useEffect(() => {
    void load();
  }, [load]);

  // Live updates: the API publishes wcl:leaderboard:{examId} on every score
  // change. Refetch the current page whenever one arrives — boring but correct
  // for a paged view. ponytail: full refetch, not a client-side merge/re-sort.
  const loadRef = useRef(load);
  loadRef.current = load;
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

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-6 py-10">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Leaderboard</h1>
          <p className="text-muted-foreground text-sm">Live standings · {board?.total ?? 0} ranked</p>
        </div>
        <div className="flex items-end gap-3">
          <Badge variant={live ? "secondary" : "outline"}>
            <span className={`size-1.5 rounded-full ${live ? "bg-emerald-500" : "bg-muted-foreground"}`} />
            {live ? "Live" : "Offline"}
          </Badge>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-muted-foreground">Exam ID</span>
            <Input value={examId} onChange={(e) => { setOffset(0); setExamId(e.target.value); }} className="w-44" />
          </label>
        </div>
      </header>

      {error && <p className="text-destructive text-sm">{error}</p>}

      <Card className="overflow-hidden py-0">
        {board && board.entries.length > 0 ? (
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
              {board.entries.map((e) => (
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
          <p className="text-muted-foreground px-6 py-16 text-center text-sm">No ranked results yet.</p>
        )}
      </Card>

      <div className="flex items-center justify-between text-sm">
        <Button variant="outline" size="sm" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE))}>
          Previous
        </Button>
        <span className="text-muted-foreground tabular-nums">
          {board ? `${offset + 1}–${Math.min(offset + PAGE, board.total)} of ${board.total}` : ""}
        </span>
        <Button
          variant="outline"
          size="sm"
          disabled={!board || offset + PAGE >= board.total}
          onClick={() => setOffset(offset + PAGE)}
        >
          Next
        </Button>
      </div>
    </main>
  );
}
