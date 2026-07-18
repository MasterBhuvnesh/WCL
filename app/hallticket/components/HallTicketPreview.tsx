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

const LABEL_TD =
  "w-[22%] border border-slate-300 bg-slate-50 px-2 py-1.5 align-middle text-[10px] font-medium uppercase tracking-wide text-slate-500";
const VALUE_TD =
  "border border-slate-300 px-2 py-1.5 align-middle text-sm font-semibold text-slate-900";

function DetailTable({ rows }: { rows: RowSpec[] }) {
  return (
    <table className="w-full border-collapse">
      <tbody>
        {rows.map((cells, i) => (
          <tr key={i}>
            {cells.length === 2 ? (
              <>
                <td className={LABEL_TD}>{cells[0]}</td>
                <td className={VALUE_TD} colSpan={3}>
                  {cells[1]}
                </td>
              </>
            ) : (
              <>
                <td className={LABEL_TD}>{cells[0]}</td>
                <td className={`${VALUE_TD} w-[28%]`}>{cells[1]}</td>
                <td className={LABEL_TD}>{cells[2]}</td>
                <td className={`${VALUE_TD} w-[28%]`}>{cells[3]}</td>
              </>
            )}
          </tr>
        ))}
      </tbody>
    </table>
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
          src="/assets/wcl.logo.png"
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
        {/* <img
          src="/assets/rbu.png"
          alt="Ramdeobaba University"
          className="h-11 w-auto object-contain"
        /> */}
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
