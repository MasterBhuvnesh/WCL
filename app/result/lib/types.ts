/**
 * Shared shapes for the result portal. Kept free of any server-only imports so
 * both the login route handler and the client result page can import these.
 *
 * The per-question shape mirrors the admin panel's session review
 * (GET /admin/results/:sessionId) so the candidate sees exactly the same
 * breakdown an administrator does.
 */

export type Outcome = "correct" | "wrong" | "unanswered";

export interface ResultOption {
  id: string;
  text: string;
  /** Revealed to the candidate only once results are published. */
  isCorrect: boolean;
}

export interface ResultAnswer {
  questionId: string;
  type: "SCQ" | "MCQ" | null;
  text: string;
  imageUrl: string | null;
  options: ResultOption[];
  selectedOptionIds: string[];
  outcome: Outcome;
}

/**
 * One candidate's scorecard. Headline figures (score, counts) come from the
 * `results` row written at grading time — the official record — while
 * `answers` is rebuilt from the session's served questions.
 */
export interface CandidateResult {
  employeeId: string;
  name: string;
  examId: string;
  examTitle: string;
  /** "submitted" or "auto_submitted". */
  status: string;
  submittedAt: string | null;
  score: number;
  maxScore: number;
  correct: number;
  wrong: number;
  unanswered: number;
  answers: ResultAnswer[];
}
