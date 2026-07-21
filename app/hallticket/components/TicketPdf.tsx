"use client";

import { usePDF } from "@react-pdf/renderer";
import { useEffect } from "react";

import { HallTicketDocument } from "@/components/HallTicketDocument";
import { HallTicketPreview } from "@/components/HallTicketPreview";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { Candidate, ExamMeta } from "@/lib/types";

/**
 * Browser-only wrapper around @react-pdf/renderer. Imported with `ssr: false`
 * from the ticket page so react-pdf's browser build never runs during SSR.
 *
 * The on-screen preview is rendered as real DOM (<HallTicketPreview>), so it
 * always displays regardless of the browser's PDF settings. react-pdf is used
 * only to produce the downloadable file, from the same candidate/exam data.
 */
export function TicketPdf({
  candidate,
  exam,
}: {
  candidate: Candidate;
  exam: ExamMeta;
}) {
  const [instance, updateInstance] = usePDF({
    document: <HallTicketDocument candidate={candidate} exam={exam} />,
  });
  const fileName = `hall-ticket-${candidate.employeeId}.pdf`;

  // Regenerate the PDF if the candidate changes within the same mounted view.
  useEffect(() => {
    updateInstance(<HallTicketDocument candidate={candidate} exam={exam} />);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [candidate, exam]);

  const ready = !instance.loading && !instance.error && !!instance.url;

  return (
    <div className="flex w-full flex-col gap-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-end">
        {instance.error && (
          <span className="text-sm text-destructive">
            Could not prepare the PDF for download.
          </span>
        )}
        <a
          href={ready ? instance.url! : undefined}
          download={fileName}
          aria-disabled={!ready}
          className={cn(
            buttonVariants({ variant: "cta", size: "lg" }),
            "w-full sm:w-auto",
            !ready && "pointer-events-none opacity-50",
          )}
        >
          {ready ? "Download hall ticket (PDF)" : "Preparing PDF…"}
        </a>
      </div>

      <div className="mx-auto w-full max-w-3xl">
        <HallTicketPreview candidate={candidate} exam={exam} />
      </div>
    </div>
  );
}
