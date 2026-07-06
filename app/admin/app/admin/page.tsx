"use client";

import Link from "next/link";
import { useState } from "react";
import { ListChecks, ShieldAlert, Trophy, UploadCloud, Users } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { apiFetch } from "@/lib/api";

const SCREENS = [
  { href: "/admin/questions", label: "Exam & questions", desc: "Question bank CRUD, open/close, publish results", icon: ListChecks },
  { href: "/admin/participants", label: "Participants", desc: "Bulk import from a JSON array", icon: Users },
  { href: "/admin/leaderboard", label: "Leaderboard", desc: "Live standings over WebSocket", icon: Trophy },
  { href: "/admin/sessions", label: "Sessions", desc: "Monitor, reset, add time, edit score", icon: UploadCloud },
  { href: "/admin/integrity", label: "Integrity events", desc: "Focus-loss, double-login, device-change", icon: ShieldAlert },
];

export default function OverviewPage() {
  const [mfa, setMfa] = useState<{ secret: string; otpauthUrl: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function setupMfa() {
    setError(null);
    setBusy(true);
    try {
      const res = await apiFetch<{ secret: string; otpauthUrl: string }>("/admin/mfa/setup", {
        method: "POST",
      });
      setMfa(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : "MFA setup failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 px-6 py-10">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Overview</h1>
        <p className="text-muted-foreground text-sm">Administration for the WCL examination system</p>
      </header>

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {SCREENS.map(({ href, label, desc, icon: Icon }) => (
          <Link key={href} href={href}>
            <Card className="h-full transition-colors hover:bg-muted/40">
              <CardHeader>
                <Icon className="size-5 text-muted-foreground" />
                <CardTitle className="mt-2">{label}</CardTitle>
                <CardDescription>{desc}</CardDescription>
              </CardHeader>
            </Card>
          </Link>
        ))}
      </section>

      <Card>
        <CardHeader>
          <CardTitle>Multi-factor authentication</CardTitle>
          <CardDescription>
            Generate a TOTP secret for this admin account. Add it to an authenticator app, then a
            code is required at every future sign-in.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div>
            <Button onClick={setupMfa} disabled={busy} variant="outline" size="sm">
              {busy ? "Generating…" : mfa ? "Regenerate secret" : "Set up MFA"}
            </Button>
          </div>
          {error && <p className="text-destructive text-sm">{error}</p>}
          {mfa && (
            <div className="flex flex-col gap-1 rounded-lg border border-border bg-muted/40 p-3 text-sm">
              <p>
                <span className="text-muted-foreground">Secret: </span>
                <code className="font-mono">{mfa.secret}</code>
              </p>
              <p className="break-all">
                <span className="text-muted-foreground">otpauth URL: </span>
                <code className="font-mono text-xs">{mfa.otpauthUrl}</code>
              </p>
              <p className="text-muted-foreground text-xs">
                Store this now — it is shown only once. Sign in with a generated code next time.
              </p>
            </div>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
