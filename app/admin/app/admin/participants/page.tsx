"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/input";
import { apiFetch } from "@/lib/api";

const SAMPLE = `[
  { "username": "roll-001", "secret": "s3cret-1", "displayName": "Asha R" },
  { "username": "roll-002", "secret": "s3cret-2" }
]`;

export default function ParticipantsPage() {
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ created: number; skipped: number } | null>(null);
  const [busy, setBusy] = useState(false);

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
    } catch (err) {
      setError(err instanceof Error ? err.message : "Import failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-6 py-10">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Participant import</h1>
        <p className="text-muted-foreground text-sm">
          Paste a JSON array. Each row needs <code>username</code> and <code>secret</code>;{" "}
          <code>displayName</code> is optional. Existing usernames are skipped.
        </p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>Bulk import</CardTitle>
          <CardDescription>Secrets are hashed server-side on ingest.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <Textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={SAMPLE}
            className="min-h-64 font-mono text-xs"
          />
          {error && <p className="text-destructive text-sm">{error}</p>}
          {result && (
            <div className="flex gap-6 rounded-lg border border-border bg-muted/40 p-3 text-sm">
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
            <Button onClick={submit} disabled={busy || !text.trim()}>
              {busy ? "Importing…" : "Import participants"}
            </Button>
          </div>
        </CardContent>
      </Card>
    </main>
  );
}
