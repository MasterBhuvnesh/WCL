/**
 * Exact-match scoring primitive.
 *
 * Policy: a question scores its full marks only when the selected option set
 * EXACTLY equals the correct option set (uniform for SCQ and MCQ); a wrong
 * answer deducts 0.5 marks and an unanswered question scores zero. The policy
 * itself is applied in services/exam.ts (gradeAndPersist / buildResultReview);
 * this module only owns the exact-match comparison they share.
 */

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
