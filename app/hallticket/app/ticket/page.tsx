"use client";

import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import examData from "@/data/exam.json";
import { Button } from "@/components/ui/button";
import { clearCandidate, loadCandidate } from "@/lib/session";
import type { Candidate, ExamMeta } from "@/lib/types";

const exam = examData as ExamMeta;

// react-pdf touches browser-only APIs, so load the viewer/download UI client-side only.
const TicketPdf = dynamic(
  () => import("@/components/TicketPdf").then((m) => m.TicketPdf),
  {
    ssr: false,
    loading: () => (
      <p className="py-20 text-center text-sm text-muted-foreground">
        Loading your hall ticket…
      </p>
    ),
  },
);

export default function TicketPage() {
  const router = useRouter();
  const [candidate, setCandidate] = useState<Candidate | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const c = loadCandidate();
    if (!c) {
      router.replace("/");
      return;
    }
    setCandidate(c);
    setReady(true);
  }, [router]);

  function signOut() {
    clearCandidate();
    router.replace("/");
  }

  if (!ready || !candidate) return null;

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-6 px-6 py-8">
      <header className="flex items-center justify-between gap-4 border-b pb-4">
        <div className="flex items-center gap-4">
          <img
            src="/assets/wcl.logo.png"
            alt="Western Coalfields Limited"
            className="h-10 object-contain"
          />
          <img
            src="/assets/rbu.png"
            alt="Ramdeobaba University"
            className="h-10 object-contain"
          />
        </div>
        <div className="flex items-center gap-4">
          <div className="text-right text-sm">
            <p className="font-medium">{candidate.name}</p>
            <p className="text-muted-foreground">{candidate.employeeId}</p>
          </div>
          <Button variant="outline" size="lg" onClick={signOut}>
            Sign out
          </Button>
        </div>
      </header>

      <div>
        <h1 className="font-heading text-xl font-medium">Your hall ticket</h1>
        <p className="text-sm text-muted-foreground">
          Review the details below and download a copy to carry to the
          examination centre.
        </p>
      </div>

      <TicketPdf candidate={candidate} exam={exam} />
    </main>
  );
}
