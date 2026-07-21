"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ListChecks, ShieldAlert, ShieldCheck, Trophy, UploadCloud, Users } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Tray, TrayInner, TrayLabel, TrayStrip } from "@/components/ui/tray";
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
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    apiFetch<{ enabled: boolean }>("/admin/mfa")
      .then((r) => setEnabled(r.enabled))
      .catch(() => setEnabled(false));
  }, []);

  async function setupMfa() {
    setError(null);
    setBusy(true);
    try {
      const res = await apiFetch<{ secret: string; otpauthUrl: string }>("/admin/mfa/setup", {
        method: "POST",
      });
      setMfa(res);
      setEnabled(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "MFA setup failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 px-4 py-8 sm:px-6 sm:py-10">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Overview</h1>
        <p className="text-muted-foreground text-sm">Prepare, invigilate, and review the WCL examination from one console.</p>
      </header>

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {SCREENS.map(({ href, label, desc, icon: Icon }) => (
          <Link key={href} href={href}>
            <Tray className="h-full transition-colors hover:bg-muted">
              <TrayInner className="flex flex-1 flex-col gap-2">
                <Icon className="size-5 text-muted-foreground" />
                <TrayLabel className="text-foreground">{label}</TrayLabel>
              </TrayInner>
              <TrayStrip className="text-xs text-muted-foreground">{desc}</TrayStrip>
            </Tray>
          </Link>
        ))}
      </section>

      <Tray>
        <TrayStrip className="flex items-center justify-between px-3 py-2">
          <TrayLabel>Multi-factor authentication</TrayLabel>
          {enabled && (
            <span className="flex items-center gap-1 text-xs text-muted-foreground">
              <ShieldCheck className="size-3.5" /> Enabled
            </span>
          )}
        </TrayStrip>
        <TrayInner className="flex flex-col gap-3">
          <p className="text-muted-foreground text-sm">
            {enabled
              ? "A TOTP secret is already set up for this account, so a code is required at every sign-in. Regenerating replaces it and invalidates the old one."
              : "Generate a TOTP secret for this admin account. Add it to an authenticator app, then a code is required at every future sign-in."}
          </p>
          <div>
            <Button onClick={setupMfa} disabled={busy || enabled === null} variant="cta" size="sm">
              {busy ? "Generating…" : enabled ? "Regenerate secret" : "Set up MFA"}
            </Button>
          </div>
          {error && <p className="text-destructive text-sm">{error}</p>}
          {mfa && (
            <div className="flex flex-col gap-1 rounded-lg bg-muted/50 p-3 text-sm">
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
        </TrayInner>
      </Tray>
    </main>
  );
}
