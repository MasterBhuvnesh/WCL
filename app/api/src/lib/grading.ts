/**
 * All-or-nothing grading.
 *
 * Policy (locked in the system plan): no negative marking. A question scores its
 * full marks only when the selected option set EXACTLY equals the correct option
 * set. Anything else, including a partial MCQ match or an unanswered question,
 * scores zero. This applies uniformly to SCQ and MCQ.
 */

import type { Question } from "../data/questions.ts";
import type { Session, SessionResult, StoredAnswer } from "../store.ts";

/**
 * Compare two sets of option IDs for exact equality, independent of order.
 */
export function isExactMatch(selected: readonly string[], correct: readonly string[]): boolean {
  if (selected.length !== correct.length) {
    return false;
  }
  const correctSet = new Set(correct);
  for (const id of selected) {
    if (!correctSet.has(id)) {
      return false;
    }
  }
  return true;
}

/**
 * Grade a single served question against its stored answer.
 * Returns the marks earned (full marks or zero).
 */
function gradeQuestion(question: Question, answer: StoredAnswer | undefined): number {
  if (!answer || answer.selectedOptionIds.length === 0) {
    return 0;
  }
  const correctOptionIds = question.options
    .filter((option) => option.isCorrect)
    .map((option) => option.id);
  return isExactMatch(answer.selectedOptionIds, correctOptionIds) ? question.marks : 0;
}

/**
 * Grade an entire session over its frozen served subset only. The result is
 * returned for server-side storage and is NEVER serialized to any client.
 *
 * @param session The session to grade.
 * @param questionsById Lookup of the full bank by question ID.
 */
export function gradeSession(
  session: Session,
  questionsById: Map<string, Question>,
): SessionResult {
  let score = 0;
  let maxScore = 0;
  let correct = 0;
  let wrong = 0;
  let unanswered = 0;

  for (const questionId of session.servedQuestionIds) {
    const question = questionsById.get(questionId);
    if (!question) {
      continue;
    }
    maxScore += question.marks;

    const answer = session.answers.get(questionId);
    const hasSelection = !!answer && answer.selectedOptionIds.length > 0;

    if (!hasSelection) {
      unanswered += 1;
      continue;
    }

    const earned = gradeQuestion(question, answer);
    if (earned > 0) {
      score += earned;
      correct += 1;
    } else {
      wrong += 1;
    }
  }

  return {
    score,
    maxScore,
    correct,
    wrong,
    unanswered,
    gradedAt: new Date().toISOString(),
  };
}
