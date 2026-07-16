import { formatDateLong } from "@/lib/format";
import type { Candidate, ExamMeta } from "@/lib/types";

/**
 * On-screen HTML replica of the hall ticket. Rendering the preview as real DOM
 * (rather than embedding the PDF in an iframe) means it always displays and is
 * responsive — the browser's PDF handling can't blank it out or auto-download
 * it. The downloadable PDF is produced separately from the same data, so the
 * two never diverge in content.
 */

function Field({
  label,
  value,
  className = "",
}: {
  label: string;
  value: string;
  className?: string;
}) {
  return (
    <div className={className}>
      <p className="text-[10px] font-medium uppercase tracking-wide text-slate-500">
        {label}
      </p>
      <p className="text-sm font-semibold text-slate-900">{value}</p>
    </div>
  );
}

function SectionBar({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-slate-900 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-white">
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
      {/* Header */}
      <div className="flex items-center justify-between gap-3 border-b border-slate-300 bg-slate-100 px-4 py-3">
        <img
          src="/assets/wcl.png"
          alt="Western Coalfields Limited"
          className="h-11 w-auto object-contain"
        />
        <div className="min-w-0 flex-1 text-center">
          <p className="text-sm font-bold sm:text-base">
            Western Coalfields Limited
          </p>
          <p className="text-sm font-bold tracking-wide text-blue-600 sm:text-base">
            EXAMINATION HALL TICKET
          </p>
          <p className="text-[11px] text-slate-500">
            {exam.title}, {exam.subtitle}
          </p>
        </div>
        <img
          src="/assets/rbu.png"
          alt="Ramdeobaba University"
          className="h-11 w-auto object-contain"
        />
      </div>

      {/* Candidate details */}
      <SectionBar>Candidate Details</SectionBar>
      <div className="grid grid-cols-1 gap-x-6 gap-y-3 px-4 py-4 sm:grid-cols-2">
        <Field label="Candidate Name" value={candidate.name} />
        <Field label="Employee ID" value={candidate.employeeId} />
      </div>

      {/* Venue, seating and schedule */}
      <SectionBar>Venue, Seating and Schedule</SectionBar>
      <div className="grid grid-cols-1 gap-x-6 gap-y-3 px-4 py-4 sm:grid-cols-2">
        <Field
          label="Examination Centre"
          value={candidate.venueName}
          className="sm:col-span-2"
        />
        <Field
          label="Address"
          value={candidate.venueAddress}
          className="sm:col-span-2"
        />
        <Field label="Building" value={candidate.blockNo} />
        <Field label="Floor" value={candidate.floorNo} />
        <Field label="Lab" value={candidate.labNo} />
        <Field label="Seat Number" value={candidate.seatNo} />
        <Field
          label="Examination Date"
          value={formatDateLong(candidate.examDate)}
        />
        <Field
          label="Pattern"
          value={`${exam.totalQuestions} questions, single choice, ${exam.durationMinutes} minutes`}
        />
        <Field label="Reporting Time" value={candidate.reportingTime} />
        <Field label="Gate Closes" value={candidate.gateClosesTime} />
        <Field label="Examination Begins" value={candidate.examTime} />
        <Field
          label="Marking"
          value={exam.markingScheme}
          className="sm:col-span-2"
        />
      </div>

      {/* Instructions */}
      <SectionBar>Instructions to Candidates</SectionBar>
      <div className="px-4 py-4">
        <ol className="flex flex-col gap-2">
          {exam.instructions.map((line, i) => (
            <li key={i} className="flex gap-2 text-[13px] leading-snug">
              <span className="font-semibold text-blue-600">{i + 1}.</span>
              <span className="text-slate-800">{line}</span>
            </li>
          ))}
        </ol>

        <div className="mt-10 flex justify-between gap-6 px-1">
          <div className="w-2/5 border-t border-slate-500 pt-1 text-center text-[11px] text-slate-500">
            Candidate&apos;s Signature
          </div>
          <div className="w-2/5 border-t border-slate-500 pt-1 text-center text-[11px] text-slate-500">
            Invigilator&apos;s Signature
          </div>
        </div>

        <p className="mt-6 border-t border-slate-300 pt-3 text-center text-[10px] leading-relaxed text-slate-500">
          This is a computer-generated hall ticket. Please verify all details and
          report any discrepancy before the examination date.
          <br />
          Western Coalfields Limited. Examination conducted at Ramdeobaba
          University, Nagpur.
        </p>
      </div>
    </div>
  );
}
