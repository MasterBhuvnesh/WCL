/**
 * Shared shapes for the hall-ticket portal. Kept free of any server-only
 * imports so both the login route handler and the client PDF components can
 * import these types.
 */

/**
 * One candidate's hall ticket. Per-candidate fields come from the exam
 * database (participants + hallticket_seats); the exam-wide fields (date,
 * timings, venue) are stamped in from data/exam.json at login.
 */
export interface Candidate {
  employeeId: string;
  name: string;
  /** Date of birth as ISO YYYY-MM-DD. */
  dob: string;
  /** Exam date as ISO YYYY-MM-DD. */
  examDate: string;
  reportingTime: string;
  gateClosesTime: string;
  examTime: string;
  venueName: string;
  venueAddress: string;
  /** Entry gate at the venue; exam-wide, stamped in from exam.json. */
  gateNo: string;
  blockNo: string;
  floorNo: string;
  labNo: string;
  seatNo: string;
}

/** Shared exam metadata and instructions (see data/exam.json). */
export interface ExamMeta {
  title: string;
  subtitle: string;
  durationMinutes: number;
  totalQuestions: number;
  markingScheme: string;
  /** ISO YYYY-MM-DD; same for every candidate. */
  examDate: string;
  reportingTime: string;
  gateClosesTime: string;
  examTime: string;
  venueName: string;
  venueAddress: string;
  /** Entry gate at the venue (e.g. "Gate 1"); same for every candidate. */
  gateNo: string;
  instructions: string[];
}
