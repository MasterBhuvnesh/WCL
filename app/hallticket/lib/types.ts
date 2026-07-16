/**
 * Shared shapes for the hall-ticket portal. Kept free of any server-only
 * imports so both the login route handler and the client PDF components can
 * import these types.
 */

/** One seeded candidate record (see data/candidates.json). */
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
  instructions: string[];
}
