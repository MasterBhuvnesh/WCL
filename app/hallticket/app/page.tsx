"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tray, TrayInner, TrayLabel, TrayStrip } from "@/components/ui/tray";
import { cn } from "@/lib/utils";
import { storeCandidate } from "@/lib/session";
import type { Candidate } from "@/lib/types";

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

// Birth years spanning the last 100 years, newest first.
const CURRENT_YEAR = new Date().getFullYear();
const YEARS = Array.from({ length: 100 }, (_, i) => CURRENT_YEAR - i);
const DAYS = Array.from({ length: 31 }, (_, i) => i + 1);

const selectClass = cn(
  "flex h-8 w-full min-w-0 rounded-lg border border-border bg-background px-2 text-sm shadow-xs outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30",
);

const pad2 = (n: string) => n.padStart(2, "0");

export default function LoginPage() {
  const router = useRouter();
  const [employeeId, setEmployeeId] = useState("");
  const [day, setDay] = useState("");
  const [month, setMonth] = useState("");
  const [year, setYear] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!day || !month || !year) {
      setError("Please select your full date of birth.");
      return;
    }

    // The API expects dd/mm/yyyy and validates that it is a real calendar date.
    const dob = `${pad2(day)}/${pad2(month)}/${year}`;

    setBusy(true);
    try {
      const res = await fetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ employeeId: employeeId.trim(), dob }),
      });
      const data = (await res.json()) as { candidate?: Candidate; error?: string };
      if (!res.ok || !data.candidate) {
        setError(data.error ?? "Login failed. Please try again.");
        return;
      }
      storeCandidate(data.candidate);
      router.push("/ticket");
    } catch {
      setError("Could not reach the server. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="flex flex-1 items-center justify-center px-6 py-10">
      <div className="flex w-full max-w-sm flex-col gap-6">
        <div className="flex items-center justify-center gap-5">
          <img
            src="/assets/wcl.png"
            alt="Western Coalfields Limited"
            className="h-12 object-contain"
          />
          <img
            src="/assets/rbu.png"
            alt="Ramdeobaba University"
            className="h-12 object-contain"
          />
        </div>

        <div className="text-center">
          <h1 className="font-heading text-lg font-medium">
            Examination Hall Ticket
          </h1>
          <p className="text-sm text-muted-foreground">
            Sign in to download your admit card
          </p>
        </div>

        <Tray className="w-full">
          <TrayStrip className="px-3 py-2">
            <TrayLabel>Candidate sign in</TrayLabel>
          </TrayStrip>
          <TrayInner>
            <form onSubmit={onSubmit} className="flex flex-col gap-3">
              <label className="flex flex-col gap-1 text-sm">
                <span className="text-muted-foreground">Employee ID</span>
                <Input
                  value={employeeId}
                  onChange={(e) => setEmployeeId(e.target.value)}
                  autoComplete="username"
                  placeholder="e.g. user001"
                  required
                />
              </label>

              <div className="flex flex-col gap-1 text-sm">
                <span className="text-muted-foreground">Date of birth</span>
                <div className="grid grid-cols-[1fr_1.4fr_1fr] gap-2">
                  <select
                    aria-label="Day"
                    className={selectClass}
                    value={day}
                    onChange={(e) => setDay(e.target.value)}
                    required
                  >
                    <option value="">Day</option>
                    {DAYS.map((d) => (
                      <option key={d} value={String(d)}>
                        {d}
                      </option>
                    ))}
                  </select>
                  <select
                    aria-label="Month"
                    className={selectClass}
                    value={month}
                    onChange={(e) => setMonth(e.target.value)}
                    required
                  >
                    <option value="">Month</option>
                    {MONTHS.map((name, i) => (
                      <option key={name} value={String(i + 1)}>
                        {name}
                      </option>
                    ))}
                  </select>
                  <select
                    aria-label="Year"
                    className={selectClass}
                    value={year}
                    onChange={(e) => setYear(e.target.value)}
                    required
                  >
                    <option value="">Year</option>
                    {YEARS.map((y) => (
                      <option key={y} value={String(y)}>
                        {y}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {error && <p className="text-destructive text-sm">{error}</p>}
              <Button type="submit" variant="cta" disabled={busy} className="mt-1">
                {busy ? "Signing in…" : "View hall ticket"}
              </Button>
            </form>
          </TrayInner>
          <TrayStrip className="py-2 text-xs text-muted-foreground">
            WCL computer-based examination
          </TrayStrip>
        </Tray>
      </div>
    </main>
  );
}
