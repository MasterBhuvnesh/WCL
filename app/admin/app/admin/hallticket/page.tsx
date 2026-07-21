"use client";

import { type ReactNode, useCallback, useEffect, useState } from "react";

import { Input } from "@/components/ui/input";
import { Pager } from "@/components/ui/pager";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tray, TrayInner, TrayLabel, TrayStrip } from "@/components/ui/tray";
import { apiFetch } from "@/lib/api";

interface HallTicketRow {
  id: string;
  username: string;
  displayName: string | null;
  dob: string | null;
  blockNo: string;
  floorNo: string;
  labNo: string;
  seatNo: string;
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col">
      <span className="text-muted-foreground text-xs">{label}</span>
      <span>{children}</span>
    </div>
  );
}

export default function HallTicketPage() {
  const [list, setList] = useState<HallTicketRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [offset, setOffset] = useState(0);
  const PAGE = 50;

  const load = useCallback(async () => {
    try {
      const rows = await apiFetch<HallTicketRow[]>("/admin/hallticket");
      setList(rows);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load hall tickets");
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- setState happens only after await (data fetch); the sync path sets no state
    void load();
  }, [load]);

  const needle = q.trim().toLowerCase();
  const filtered = needle
    ? list.filter(
        (r) =>
          r.username.toLowerCase().includes(needle) ||
          (r.displayName ?? "").toLowerCase().includes(needle) ||
          r.labNo.toLowerCase().includes(needle) ||
          r.seatNo.toLowerCase().includes(needle),
      )
    : list;
  const shown = filtered.slice(offset, offset + PAGE);

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-6 px-4 py-8 sm:px-6 sm:py-10">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Hall tickets</h1>
        <p className="text-muted-foreground text-sm">
          Seat allocations for the hall-ticket portal, where candidates sign in with their
          username and date of birth. Import allocations with{" "}
          <code>bun run import:seats</code>; exam-wide details such as date, timings, and venue
          live in the portal&apos;s <code>exam.json</code>.
        </p>
      </header>

      {error && <p className="text-destructive text-sm">{error}</p>}

      <Tray>
        <TrayStrip className="flex flex-wrap items-center justify-between gap-3 px-3 py-2">
          <TrayLabel>Allocated seats ({list.length})</TrayLabel>
          <Input
            value={q}
            onChange={(e) => { setOffset(0); setQ(e.target.value); }}
            placeholder="Search username, name, lab, seat…"
            className="h-7 w-full sm:w-64"
          />
        </TrayStrip>
        <TrayInner className="overflow-hidden p-0">
          {shown.length === 0 ? (
            <p className="text-muted-foreground px-6 py-16 text-center text-sm">
              {list.length === 0
                ? "No seat allocations yet. Import them with bun run import:seats."
                : "No allocations match the search."}
            </p>
          ) : (
            <>
            <div className="hidden lg:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Username</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>DOB</TableHead>
                  <TableHead>Building</TableHead>
                  <TableHead>Floor</TableHead>
                  <TableHead>Lab</TableHead>
                  <TableHead className="text-right">Seat</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {shown.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-medium">{r.username}</TableCell>
                    <TableCell className="text-muted-foreground">{r.displayName ?? "-"}</TableCell>
                    <TableCell className="text-muted-foreground tabular-nums">{r.dob ?? "-"}</TableCell>
                    <TableCell className="text-muted-foreground">{r.blockNo}</TableCell>
                    <TableCell className="text-muted-foreground">{r.floorNo}</TableCell>
                    <TableCell className="text-muted-foreground">{r.labNo}</TableCell>
                    <TableCell className="text-right font-medium tabular-nums">{r.seatNo}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            </div>
            <div className="flex flex-col gap-2 p-3 lg:hidden">
              {shown.map((r) => (
                <div key={r.id} className="flex flex-col gap-2 rounded-xl border border-border p-3">
                  <div className="flex items-start justify-between gap-2 border-b border-border pb-2">
                    <div className="min-w-0">
                      <p className="font-medium">{r.username}</p>
                      <p className="text-muted-foreground text-sm">{r.displayName ?? "-"}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-muted-foreground text-xs">Seat</p>
                      <p className="font-medium tabular-nums">{r.seatNo}</p>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm">
                    <Field label="DOB"><span className="tabular-nums">{r.dob ?? "-"}</span></Field>
                    <Field label="Building">{r.blockNo}</Field>
                    <Field label="Floor">{r.floorNo}</Field>
                    <Field label="Lab">{r.labNo}</Field>
                  </div>
                </div>
              ))}
            </div>
            </>
          )}
        </TrayInner>
        <TrayStrip className="flex items-center justify-between">
          <Pager offset={offset} total={filtered.length} page={PAGE} onOffset={setOffset} />
        </TrayStrip>
      </Tray>
    </main>
  );
}
