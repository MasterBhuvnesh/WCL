"use client";

import { useCallback, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/input";
import { Pager } from "@/components/ui/pager";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tray, TrayInner, TrayLabel, TrayStrip } from "@/components/ui/tray";
import { apiFetch } from "@/lib/api";

interface Participant {
  id: string;
  username: string;
  displayName: string | null;
  dob: string | null;
  createdAt: string | null;
}

function fmt(iso: string | null): string {
  if (!iso) return "-";
  return new Date(iso).toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

const SAMPLE = `[
  { "username": "roll-001", "secret": "s3cret-1", "displayName": "Asha R", "dob": "2001-05-14" },
  { "username": "roll-002", "dob": "2000-11-02" }
]`;

export default function ParticipantsPage() {
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ created: number; skipped: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [list, setList] = useState<Participant[]>([]);
  const [q, setQ] = useState("");
  const [offset, setOffset] = useState(0);
  const PAGE = 50;

  const load = useCallback(async () => {
    try {
      const rows = await apiFetch<Participant[]>("/admin/participants");
      setList(rows);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load participants");
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- setState happens only after await (data fetch); the sync path sets no state
    void load();
  }, [load]);

  async function submit() {
    setError(null);
    setResult(null);
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      setError("Not valid JSON");
      return;
    }
    if (!Array.isArray(parsed)) {
      setError("Expected a JSON array of participants");
      return;
    }
    setBusy(true);
    try {
      const res = await apiFetch<{ created: number; skipped: number }>(
        "/admin/participants/import",
        { method: "POST", body: JSON.stringify({ participants: parsed }) },
      );
      setResult(res);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Import failed");
    } finally {
      setBusy(false);
    }
  }

  const needle = q.trim().toLowerCase();
  const filtered = needle
    ? list.filter(
        (p) =>
          p.username.toLowerCase().includes(needle) ||
          (p.displayName ?? "").toLowerCase().includes(needle),
      )
    : list;
  const shown = filtered.slice(offset, offset + PAGE);

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-6 py-10">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Participant import</h1>
        <p className="text-muted-foreground text-sm">
          Paste a JSON array. Each row needs <code>username</code>; <code>secret</code>,{" "}
          <code>displayName</code>, and <code>dob</code> are optional. Rows without a{" "}
          <code>secret</code> get the common exam password. Existing usernames are skipped.
        </p>
      </header>

      <Tray>
        <TrayStrip className="flex items-center justify-between px-3 py-2">
          <TrayLabel>Bulk import</TrayLabel>
          <span className="text-xs text-muted-foreground">Secrets are hashed server-side on ingest</span>
        </TrayStrip>
        <TrayInner className="flex flex-col gap-3">
          <Textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={SAMPLE}
            className="min-h-64 font-mono text-xs"
          />
          {error && <p className="text-destructive text-sm">{error}</p>}
          {result && (
            <div className="flex gap-6 rounded-lg bg-muted/50 p-3 text-sm">
              <p>
                <span className="text-muted-foreground">Created: </span>
                <span className="font-medium tabular-nums">{result.created}</span>
              </p>
              <p>
                <span className="text-muted-foreground">Skipped: </span>
                <span className="font-medium tabular-nums">{result.skipped}</span>
              </p>
            </div>
          )}
          <div>
            <Button variant="cta" onClick={submit} disabled={busy || !text.trim()}>
              {busy ? "Importing…" : "Import participants"}
            </Button>
          </div>
        </TrayInner>
      </Tray>

      <Tray>
        <TrayStrip className="flex items-center justify-between gap-3 px-3 py-2">
          <TrayLabel>All participants ({list.length})</TrayLabel>
          <Input
            value={q}
            onChange={(e) => { setOffset(0); setQ(e.target.value); }}
            placeholder="Search username or name…"
            className="h-7 w-56"
          />
        </TrayStrip>
        <TrayInner className="overflow-hidden p-0">
          {shown.length === 0 ? (
            <p className="text-muted-foreground px-6 py-16 text-center text-sm">
              {list.length === 0 ? "No participants imported yet." : "No participants match the search."}
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Username</TableHead>
                  <TableHead>Display name</TableHead>
                  <TableHead>DOB</TableHead>
                  <TableHead className="text-right">Created</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {shown.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell className="font-medium">{p.username}</TableCell>
                    <TableCell className="text-muted-foreground">{p.displayName ?? "-"}</TableCell>
                    <TableCell className="text-muted-foreground tabular-nums">{p.dob ?? "-"}</TableCell>
                    <TableCell className="text-muted-foreground text-right">{fmt(p.createdAt)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </TrayInner>
        <TrayStrip className="flex items-center justify-between">
          <Pager offset={offset} total={filtered.length} page={PAGE} onOffset={setOffset} />
        </TrayStrip>
      </Tray>
    </main>
  );
}
