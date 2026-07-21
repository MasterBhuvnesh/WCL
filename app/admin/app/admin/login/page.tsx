"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tray, TrayInner, TrayLabel, TrayStrip } from "@/components/ui/tray";
import { apiFetch, setToken } from "@/lib/api";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [totp, setTotp] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const res = await apiFetch<{ token: string }>("/admin/login", {
        method: "POST",
        body: JSON.stringify({
          email,
          password,
          totp: totp.trim() || undefined,
        }),
      });
      setToken(res.token);
      router.replace("/admin");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="flex flex-1 items-center justify-center px-4 py-8 sm:px-6 sm:py-10">
      <div className="flex w-full max-w-sm flex-col gap-6">
        <div className="flex items-center justify-center gap-5">
          <img src="/assets/wcl.logo.png" alt="Western Coalfields Limited" className="h-12 object-contain" />
          <img src="/assets/rbu.png" alt="Ramdeobaba University" className="h-12 object-contain" />
        </div>
        <Tray className="w-full">
        <TrayStrip className="px-3 py-2">
          <TrayLabel>Admin sign in</TrayLabel>
        </TrayStrip>
        <TrayInner>
          <form onSubmit={onSubmit} className="flex flex-col gap-3">
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-muted-foreground">Email</span>
              <Input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="username"
                required
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-muted-foreground">Password</span>
              <Input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                required
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-muted-foreground">
                TOTP code <span className="text-xs">(if MFA enabled)</span>
              </span>
              <Input
                inputMode="numeric"
                value={totp}
                onChange={(e) => setTotp(e.target.value)}
                placeholder="123456"
              />
            </label>
            {error && <p className="text-destructive text-sm">{error}</p>}
            <Button type="submit" variant="cta" disabled={busy} className="mt-1">
              {busy ? "Signing in…" : "Sign in"}
            </Button>
          </form>
        </TrayInner>
        <TrayStrip className="py-2 text-xs text-muted-foreground">
          WCL examination administration
        </TrayStrip>
        </Tray>
      </div>
    </main>
  );
}
