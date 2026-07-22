import { formatDateLong, isoToDdmmyyyy } from "@/lib/format";
import type { Candidate, ExamMeta } from "@/lib/types";

/**
 * On-screen HTML replica of the hall ticket. Rendering the preview as real DOM
 * (rather than embedding the PDF in an iframe) means it always displays and is
 * responsive — the browser's PDF handling can't blank it out or auto-download
 * it. The downloadable PDF is produced separately from the same data
 * (HallTicketDocument.tsx); keep the two layouts in step.
 */

/**
 * One table row: [label, value] renders the value across the full width;
 * [label, value, label, value] renders two label/value pairs side by side.
 */
type RowSpec = [string, string] | [string, string, string, string];

function Pair({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-w-0 flex-1">
      <div className="w-28 shrink-0 border-r border-slate-300 px-2 py-1.5 text-[11px] font-medium text-slate-500">
        {label}
      </div>
      <div className="min-w-0 flex-1 break-words px-2 py-1.5 text-sm font-semibold text-slate-900">
        {value}
      </div>
    </div>
  );
}

// Two-value rows sit side by side on desktop and stack to full-width rows on
// mobile, so long values (e.g. a long employee id) are never crammed.
function DetailTable({ rows }: { rows: RowSpec[] }) {
  return (
    <div className="divide-y divide-slate-300 border border-slate-300">
      {rows.map((cells, i) => (
        <div
          key={i}
          className="flex flex-col divide-y divide-slate-300 sm:flex-row sm:divide-x sm:divide-y-0"
        >
          <Pair label={cells[0]} value={cells[1]} />
          {cells.length === 4 && <Pair label={cells[2]} value={cells[3]} />}
        </div>
      ))}
    </div>
  );
}

function SectionBar({ children }: { children: React.ReactNode }) {
  return (
    <div className="border-b border-slate-300 bg-slate-100 px-3 py-1.5 text-[12px] font-semibold text-slate-900">
      {children}
    </div>
  );
}

export function HallTicketPreview({
  candidate,
  exam,
}: {
  candidate: Candidate;
  exam: ExamMeta;
}) {
  return (
    <div className="overflow-hidden rounded-lg border border-slate-300 bg-white text-slate-900 shadow-sm">
      {/* Header: logo, organisation, document badge */}
      <div className="flex items-center justify-between gap-3 border-b border-slate-300 bg-slate-100 px-4 py-3">
        <img
          src="/assets/wcl.logo.png"
          alt="Western Coalfields Limited"
          className="h-11 w-auto object-contain"
        />
        <div className="min-w-0 flex-1 text-center">
          <p className="text-lg font-bold sm:text-xl">
            Western Coalfields Limited
          </p>
          <p className="text-[15px] text-slate-500">
            {exam.title}, {exam.subtitle}
          </p>
        </div>
        <div className="flex flex-col items-end">
          <span className="text-[10px] text-slate-500">Examination</span>
          <span className="text-sm font-bold text-slate-900 sm:text-base">
            Hall Ticket
          </span>
        </div>
      </div>

      {/* Candidate details */}
      <SectionBar>Candidate Details</SectionBar>
      <div className="px-4 py-3">
        <DetailTable
          rows={[
            ["Candidate Name", candidate.name, "Employee ID", candidate.employeeId],
            ["Date of Birth", isoToDdmmyyyy(candidate.dob)],
          ]}
        />
      </div>

      {/* Venue, seating and schedule */}
      <SectionBar>Venue, Seating and Schedule</SectionBar>
      <div className="px-4 py-3">
        <DetailTable
          rows={[
            ["Examination Centre", candidate.venueName],
            ["Address", candidate.venueAddress],
            ["Building", candidate.blockNo, "Floor", candidate.floorNo],
            ["Lab", candidate.labNo, "Seat Number", candidate.seatNo],
            [
              "Examination Date",
              formatDateLong(candidate.examDate),
              "Reporting Time",
              candidate.reportingTime,
            ],
            [
              "Gate Closes",
              candidate.gateClosesTime,
              "Examination Begins",
              candidate.examTime,
            ],
            [
              "Pattern",
              `${exam.totalQuestions} questions, single choice, ${exam.durationMinutes} minutes`,
            ],
            ["Marking", exam.markingScheme],
          ]}
        />
      </div>

      {/* Instructions */}
      <SectionBar>Instructions to Candidates</SectionBar>
      <div className="px-4 py-4">
        <ol className="flex flex-col gap-2">
          {exam.instructions.map((line, i) => (
            <li key={i} className="flex gap-2 text-[13px] leading-snug">
              <span className="font-semibold text-slate-500">{i + 1}.</span>
              <span className="text-slate-800">{line}</span>
            </li>
          ))}
        </ol>

        <div className="mt-24 flex justify-between gap-6 px-1">
          <div className="w-2/5 border-t border-slate-500 pt-1 text-center text-[11px] text-slate-500">
            Candidate&apos;s Signature
          </div>
          <div className="w-2/5 border-t border-slate-500 pt-1 text-center text-[11px] text-slate-500">
            Invigilator&apos;s Signature
          </div>
        </div>

        <p className="mt-6 border-t border-slate-300 pt-3 text-center text-[10px] leading-relaxed text-slate-500">
          This is a computer-generated hall ticket. Please verify all details
          and report any discrepancy before the examination date.
          <br />
          Western Coalfields Limited. Examination conducted at Ramdeobaba
          University, Nagpur.
        </p>
      </div>
    </div>
  );
}
