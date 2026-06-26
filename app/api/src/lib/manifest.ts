/**
 * Manifest construction.
 *
 * Builds the client-facing question manifest for a session: the served subset,
 * ordered deterministically by the session seed, with each question's options
 * also ordered by the seed. The `isCorrect` flag is stripped here and never
 * leaves the server.
 */

import type { Question } from "../data/questions.ts";
import { seededShuffle } from "./shuffle.ts";
import type { Session } from "../store.ts";

export interface ManifestOption {
  optionId: string;
  text: string;
}

export interface ManifestQuestion {
  questionId: string;
  type: Question["type"];
  text: string;
  marks: number;
  options: ManifestOption[];
}

/**
 * Project a stored question into its client-safe manifest form, with options
 * shuffled by a seed derived from the session seed and the question ID. Deriving
 * a per-question option seed keeps option order stable for the session while
 * differing between questions.
 */
function toManifestQuestion(question: Question, seed: string): ManifestQuestion {
  const optionSeed = `${seed}:${question.id}`;
  const shuffledOptions = seededShuffle(question.options, optionSeed);
  return {
    questionId: question.id,
    type: question.type,
    text: question.text,
    marks: question.marks,
    options: shuffledOptions.map((option) => ({
      optionId: option.id,
      text: option.text,
    })),
  };
}

/**
 * Build the full ordered manifest for a session. Question order follows the
 * frozen `servedQuestionIds` (already in served order), and each question's
 * options are shuffled by the seed. Returns an empty array if a served question
 * cannot be resolved, which should not happen in practice.
 */
export function buildManifest(
  session: Session,
  questionsById: Map<string, Question>,
): ManifestQuestion[] {
  const seed = session.shuffleSeed;
  if (!seed) {
    return [];
  }
  const manifest: ManifestQuestion[] = [];
  for (const questionId of session.servedQuestionIds) {
    const question = questionsById.get(questionId);
    if (question) {
      manifest.push(toManifestQuestion(question, seed));
    }
  }
  return manifest;
}
