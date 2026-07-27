import postgres from "postgres";

import type { CandidateResult, Outcome, ResultAnswer } from "@/lib/types";

/**
 * Result lookup against the exam database. The candidate authenticates with
 * employee ID + date of birth (same shared secret as the hall-ticket portal),
 * and we rebuild the same per-question review the admin panel shows at
 * GET /admin/results/:sessionId.
 *
 * Import this only from server code (route handlers / server components) — it
 * opens a database connection, and it reads `options.is_correct`, which must
 * never reach a candidate's browser before results are published.
 */

const sql = postgres(
  process.env.DATABASE_URL ?? "postgres://wcl:wcl@localhost:5432/wcl",
  // ponytail: tiny pool; this portal only does point lookups at login.
  { max: 5 },
);

/** Exam used when a candidate has no session yet (see DEFAULT_EXAM_ID in the API). */
const DEFAULT_EXAM_ID = process.env.EXAM_ID ?? "WCL-EXAM";

/**
 * Convert a dd/mm/yyyy date string into ISO YYYY-MM-DD, or return null when the
 * input is malformed or not a real calendar date (e.g. 31/02/2004). Requires a
 * 4-digit year. Same contract as the hall-ticket portal's parseDob.
 */
export function parseDob(input: string): string | null {
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(input.trim());
  if (!match) return null;

  const day = Number(match[1]);
  const month = Number(match[2]);
  const year = Number(match[3]);

  // Round-trip through a UTC Date so impossible dates (e.g. 31/02) are rejected
  // rather than silently rolling over into the next month.
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }

  return `${match[3]}-${match[2]}-${match[1]}`;
}

/**
 * Outcome of a lookup. The three failure states are distinguished so the login
 * screen can explain what happened: bad credentials, results still embargoed,
 * or an authenticated candidate with nothing graded.
 */
export type ResultLookup =
  | { status: "ok"; result: CandidateResult }
  | { status: "not-found" }
  | { status: "unpublished" }
  | { status: "no-result" };

interface ParticipantRow {
  id: string;
  username: string;
  display_name: string | null;
}

/**
 * Look up a candidate by employee ID (case-insensitive) and ISO date of birth.
 * Both must match; DOB acts as the shared secret, so it is compared exactly.
 */
async function findParticipant(
  employeeId: string,
  dobIso: string,
): Promise<ParticipantRow | null> {
  const rows = await sql<ParticipantRow[]>`
    select id, username, display_name
    from participants
    where lower(username) = ${employeeId.trim().toLowerCase()}
      and dob = ${dobIso}
    limit 1
  `;
  return rows[0] ?? null;
}

/**
 * Fetch and assemble one candidate's scorecard.
 *
 * The publication gate is checked before anything else is revealed: while
 * `exams.results_published` is false the portal must not disclose scores, nor
 * even whether a session was graded. Admins flip it from the admin panel
 * (Exam & questions → Publish results).
 */
export async function findResult(
  employeeId: string,
  dobIso: string,
): Promise<ResultLookup> {
  const participant = await findParticipant(employeeId, dobIso);
  if (!participant) return { status: "not-found" };

  // Latest session for this candidate, graded or not — it names the exam whose
  // publication flag governs what we may show.
  const [session] = await sql<
    {
      id: string;
      exam_id: string;
      status: string;
      submitted_at: Date | null;
      served_question_ids: string[];
      exam_title: string;
      results_published: boolean;
    }[]
  >`
    select s.id, s.exam_id, s.status, s.submitted_at, s.served_question_ids,
           e.title as exam_title, e.results_published
    from exam_sessions s
    join exams e on e.id = s.exam_id
    where s.participant_id = ${participant.id}
    order by s.created_at desc
    limit 1
  `;

  if (!session) {
    // No session at all: fall back to the default exam's flag so an unpublished
    // exam still reports "not published" rather than "you have no result".
    const [exam] = await sql<{ results_published: boolean }[]>`
      select results_published from exams where id = ${DEFAULT_EXAM_ID} limit 1
    `;
    return exam?.results_published ? { status: "no-result" } : { status: "unpublished" };
  }

  if (!session.results_published) return { status: "unpublished" };

  const [result] = await sql<
    {
      score: number;
      max_score: number;
      correct: number;
      wrong: number;
      unanswered: number;
    }[]
  >`
    select score, max_score, correct, wrong, unanswered
    from results
    where session_id = ${session.id}
    limit 1
  `;
  if (!result) return { status: "no-result" };

  return {
    status: "ok",
    result: {
      employeeId: participant.username,
      name: participant.display_name ?? participant.username,
      examId: session.exam_id,
      examTitle: session.exam_title,
      status: session.status,
      submittedAt: session.submitted_at?.toISOString() ?? null,
      score: result.score,
      maxScore: result.max_score,
      correct: result.correct,
      wrong: result.wrong,
      unanswered: result.unanswered,
      answers: await buildAnswers(session.id, session.served_question_ids),
    },
  };
}

interface QuestionRow {
  id: string;
  type: "SCQ" | "MCQ";
  text: string;
  image_url: string | null;
}

interface OptionRow {
  id: string;
  question_id: string;
  text: string;
  is_correct: boolean;
}

interface AnswerRow {
  question_id: string;
  selected_option_ids: string[];
}

/**
 * Rebuild the per-question review in served order. Mirrors the admin API's
 * buildResultReview: a question is correct only when the selected option set
 * exactly equals the correct set (uniform for SCQ and MCQ), and an empty
 * selection is "unanswered" rather than wrong.
 */
async function buildAnswers(
  sessionId: string,
  served: string[],
): Promise<ResultAnswer[]> {
  if (served.length === 0) return [];

  const [questionRows, optionRows, answerRows] = await Promise.all([
    sql<QuestionRow[]>`
      select id, type, text, image_url
      from questions
      where id = any(${served}::text[])
    `,
    sql<OptionRow[]>`
      select id, question_id, text, is_correct
      from options
      where question_id = any(${served}::text[])
      order by id
    `,
    sql<AnswerRow[]>`
      select question_id, selected_option_ids
      from answers
      where session_id = ${sessionId}
    `,
  ]);

  const questionById = new Map(questionRows.map((q) => [q.id, q]));
  const optionsByQuestion = new Map<string, OptionRow[]>();
  for (const option of optionRows) {
    const list = optionsByQuestion.get(option.question_id) ?? [];
    list.push(option);
    optionsByQuestion.set(option.question_id, list);
  }
  const selectedByQuestion = new Map(
    answerRows.map((a) => [a.question_id, a.selected_option_ids]),
  );

  return served.map((questionId) => {
    const question = questionById.get(questionId);
    const opts = optionsByQuestion.get(questionId) ?? [];
    const selected = selectedByQuestion.get(questionId) ?? [];
    const correctIds = new Set(opts.filter((o) => o.is_correct).map((o) => o.id));

    let outcome: Outcome;
    if (selected.length === 0) {
      outcome = "unanswered";
    } else {
      const sel = new Set(selected);
      outcome =
        sel.size === correctIds.size && [...sel].every((id) => correctIds.has(id))
          ? "correct"
          : "wrong";
    }

    return {
      questionId,
      type: question?.type ?? null,
      text: question?.text ?? "",
      imageUrl: question?.image_url ?? null,
      options: opts.map((o) => ({ id: o.id, text: o.text, isCorrect: o.is_correct })),
      selectedOptionIds: selected,
      outcome,
    };
  });
}
