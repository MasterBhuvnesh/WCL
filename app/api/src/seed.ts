/**
 * Database seed script for the WCL examination system.
 *
 * Populates a single demonstration exam ("WCL-DEMO") with a bank of one
 * hundred deterministically generated questions, seven hundred candidate
 * participants, and one administrator account. The script is idempotent: if
 * the demo exam already exists it exits without modifying anything, unless it
 * is invoked with the "--fresh" flag, in which case every table is cleared in
 * a foreign-key-safe order and the relevant Redis keys are flushed before
 * reseeding.
 *
 * Usage:
 *   bun run seed            Seed only if the demo exam is absent.
 *   bun run seed --fresh    Wipe all data and Redis state, then reseed.
 */

import { eq } from "drizzle-orm";
import { db, pgClient, schema } from "./db/index.ts";
import { redis } from "./redis.ts";

/**
 * Minimal ambient declaration for the Bun runtime password API. The project
 * does not depend on bun-types, so the global is declared locally to satisfy
 * the type checker without pulling in an additional dependency.
 */
declare const Bun: {
  password: { hash(password: string): Promise<string> };
};

const {
  exams,
  questions,
  options,
  participants,
  admins,
  auditLogs,
  answers,
  results,
  examSessions,
  integrityEvents,
} = schema;

type QuestionRow = typeof questions.$inferInsert;
type OptionRow = typeof options.$inferInsert;
type ParticipantRow = typeof participants.$inferInsert;

const EXAM_ID = "WCL-DEMO";
const QUESTION_COUNT = 100;
const PARTICIPANT_COUNT = 700;
const CHUNK_SIZE = 100;

/** A generated question independent of its final database identifiers. */
interface GeneratedQuestion {
  type: "SCQ" | "MCQ";
  text: string;
  options: Array<{ text: string; isCorrect: boolean }>;
}

/* ------------------------------------------------------------------------- */
/* Generic helpers                                                           */
/* ------------------------------------------------------------------------- */

/** Split an array into consecutive slices of at most `size` elements. */
function chunk<T>(array: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < array.length; i += size) {
    out.push(array.slice(i, i + size));
  }
  return out;
}

/**
 * Produce three distinct positive integers, all different from `correct`,
 * derived deterministically from `seed`.
 */
function distractors3(correct: number, seed: number): number[] {
  const out: number[] = [];
  let k = 1;
  while (out.length < 3) {
    const magnitude = ((seed * 3 + k * 7) % 17) + 1;
    const sign = k % 2 === 0 ? -1 : 1;
    let candidate = correct + sign * magnitude;
    if (candidate <= 0) {
      candidate = correct + magnitude + 1;
    }
    if (candidate !== correct && !out.includes(candidate)) {
      out.push(candidate);
    }
    k += 1;
  }
  return out;
}

/**
 * Build four single-correct numeric options: the true value plus three
 * distractors, with the correct answer placed at a seed-dependent position.
 */
function numericScqOptions(
  correct: number,
  seed: number,
): GeneratedQuestion["options"] {
  const ds = distractors3(correct, seed);
  const correctPos = seed % 4;
  const opts: GeneratedQuestion["options"] = [];
  let di = 0;
  for (let p = 0; p < 4; p += 1) {
    if (p === correctPos) {
      opts.push({ text: String(correct), isCorrect: true });
    } else {
      opts.push({ text: String(ds[di]), isCorrect: false });
      di += 1;
    }
  }
  return opts;
}

/**
 * Build four single-correct string options from one correct answer and
 * exactly three incorrect answers, placing the correct answer at a
 * seed-dependent position.
 */
function stringScqOptions(
  correct: string,
  wrong: string[],
  seed: number,
): GeneratedQuestion["options"] {
  const correctPos = seed % 4;
  const opts: GeneratedQuestion["options"] = [];
  let wi = 0;
  for (let p = 0; p < 4; p += 1) {
    if (p === correctPos) {
      opts.push({ text: correct, isCorrect: true });
    } else {
      opts.push({ text: String(wrong[wi]), isCorrect: false });
      wi += 1;
    }
  }
  return opts;
}

/** The six ways to choose two of four option positions, indexed by seed. */
const CORRECT_PAIRS: ReadonlyArray<readonly [number, number]> = [
  [0, 1],
  [0, 2],
  [0, 3],
  [1, 2],
  [1, 3],
  [2, 3],
];

/**
 * Build four options with exactly two correct answers, distributing the two
 * correct and two incorrect values across positions deterministically.
 */
function mcqOptions(
  correctValues: Array<string | number>,
  wrongValues: Array<string | number>,
  seed: number,
): GeneratedQuestion["options"] {
  const pair = CORRECT_PAIRS[seed % CORRECT_PAIRS.length] as readonly [
    number,
    number,
  ];
  const opts: GeneratedQuestion["options"] = [];
  let ci = 0;
  let wi = 0;
  for (let p = 0; p < 4; p += 1) {
    if (pair[0] === p || pair[1] === p) {
      opts.push({ text: String(correctValues[ci]), isCorrect: true });
      ci += 1;
    } else {
      opts.push({ text: String(wrongValues[wi]), isCorrect: false });
      wi += 1;
    }
  }
  return opts;
}

/**
 * Ensure the supplied numbers are pairwise distinct while preserving each
 * value's parity, by repeatedly adding two to any duplicate.
 */
function dedupePreserveParity(nums: number[]): number[] {
  const seen = new Set<number>();
  return nums.map((original) => {
    let value = original;
    while (seen.has(value)) {
      value += 2;
    }
    seen.add(value);
    return value;
  });
}

/* ------------------------------------------------------------------------- */
/* Content pools for definition-style questions                              */
/* ------------------------------------------------------------------------- */

interface DefinitionEntry {
  q: string;
  correct: string;
  wrong: [string, string, string];
}

const CS_DEFINITIONS: DefinitionEntry[] = [
  {
    q: "Which data structure follows the Last In First Out principle?",
    correct: "Stack",
    wrong: ["Queue", "Array", "Linked list"],
  },
  {
    q: "Which data structure follows the First In First Out principle?",
    correct: "Queue",
    wrong: ["Stack", "Tree", "Graph"],
  },
  {
    q: "What does the abbreviation CPU stand for?",
    correct: "Central Processing Unit",
    wrong: [
      "Central Program Unit",
      "Computer Personal Unit",
      "Central Processor Utility",
    ],
  },
  {
    q: "Which of the following is a volatile form of memory?",
    correct: "RAM",
    wrong: ["ROM", "Hard disk", "Solid state drive"],
  },
  {
    q: "What is the base of the binary number system?",
    correct: "2",
    wrong: ["8", "10", "16"],
  },
  {
    q: "Which protocol is primarily used to transfer web pages?",
    correct: "HTTP",
    wrong: ["FTP", "SMTP", "SSH"],
  },
  {
    q: "What does the abbreviation SQL stand for?",
    correct: "Structured Query Language",
    wrong: [
      "Sequential Query Language",
      "Structured Question Language",
      "Simple Query Language",
    ],
  },
  {
    q: "Which data structure stores information as key and value pairs?",
    correct: "Hash map",
    wrong: ["Stack", "Queue", "Heap"],
  },
  {
    q: "What does the abbreviation API stand for?",
    correct: "Application Programming Interface",
    wrong: [
      "Applied Programming Interface",
      "Application Process Integration",
      "Automated Programming Interface",
    ],
  },
  {
    q: "Which unit measures the clock speed of a processor?",
    correct: "Hertz",
    wrong: ["Bytes", "Pixels", "Ohms"],
  },
];

interface MultiEntry {
  q: string;
  correct: [string, string];
  wrong: [string, string];
}

const CS_MULTI: MultiEntry[] = [
  {
    q: "Select the two items that are programming languages.",
    correct: ["Python", "Java"],
    wrong: ["HTML", "CSS"],
  },
  {
    q: "Select the two items that are relational databases.",
    correct: ["PostgreSQL", "MySQL"],
    wrong: ["MongoDB", "Redis"],
  },
  {
    q: "Select the two items that are linear data structures.",
    correct: ["Array", "Queue"],
    wrong: ["Tree", "Graph"],
  },
  {
    q: "Select the two items that are valid HTTP request methods.",
    correct: ["GET", "POST"],
    wrong: ["SEND", "FETCHALL"],
  },
  {
    q: "Select the two items that are logic gates.",
    correct: ["AND", "OR"],
    wrong: ["ADD", "SUM"],
  },
  {
    q: "Select the two items that are object oriented programming concepts.",
    correct: ["Inheritance", "Polymorphism"],
    wrong: ["Compilation", "Indexing"],
  },
];

/** Prime and composite pools for the "select two primes" generator. */
const PRIMES = [7, 11, 13, 17, 19, 23, 29, 31, 37, 41, 43, 47, 53, 59];
const COMPOSITES = [8, 9, 12, 14, 15, 16, 18, 20, 21, 22, 24, 25, 26, 27];

/* ------------------------------------------------------------------------- */
/* Question generation                                                       */
/* ------------------------------------------------------------------------- */

/**
 * Generate a deterministic, self-consistent question for a one-based index.
 * Every fourth index produces a multiple-correct (MCQ) question; the rest are
 * single-correct (SCQ). Numeric answers are computed, never fabricated.
 */
function generateQuestion(i: number): GeneratedQuestion {
  const isMcq = i % 4 === 0;

  if (!isMcq) {
    const scqType = i % 5;
    switch (scqType) {
      case 0: {
        const pct = 5 + ((i * 7) % 90);
        const factor = 2 + (i % 9);
        const base = factor * 100;
        const correct = pct * factor;
        return {
          type: "SCQ",
          text: `What is ${pct} percent of ${base}?`,
          options: numericScqOptions(correct, i),
        };
      }
      case 1: {
        const speed = 20 + (i % 60);
        const time = 2 + (i % 5);
        const distance = speed * time;
        return {
          type: "SCQ",
          text: `A vehicle covers ${distance} km in ${time} hours. What is its average speed in km per hour?`,
          options: numericScqOptions(speed, i),
        };
      }
      case 2: {
        const n = 10 + (i % 40);
        const correct = (n * (n + 1)) / 2;
        return {
          type: "SCQ",
          text: `What is the sum of the first ${n} natural numbers?`,
          options: numericScqOptions(correct, i),
        };
      }
      case 3: {
        const start = 1 + (i % 9);
        const d = 2 + (i % 7);
        const terms = [start, start + d, start + 2 * d, start + 3 * d];
        const correct = start + 4 * d;
        return {
          type: "SCQ",
          text: `Find the next term in the arithmetic series: ${terms.join(", ")}, ...`,
          options: numericScqOptions(correct, i),
        };
      }
      default: {
        const entry = CS_DEFINITIONS[i % CS_DEFINITIONS.length] as DefinitionEntry;
        return {
          type: "SCQ",
          text: entry.q,
          options: stringScqOptions(entry.correct, entry.wrong, i),
        };
      }
    }
  }

  const mcqType = (i / 4) % 3;
  switch (mcqType) {
    case 0: {
      const evens = dedupePreserveParity([
        2 * (3 + (i % 20)),
        2 * (10 + (i % 15)),
      ]);
      const odds = dedupePreserveParity([
        2 * (4 + (i % 18)) + 1,
        2 * (7 + (i % 12)) + 1,
      ]);
      return {
        type: "MCQ",
        text: "Select the two even numbers from the following options.",
        options: mcqOptions(evens, odds, i),
      };
    }
    case 1: {
      const primeA = PRIMES[i % PRIMES.length] as number;
      const primeB = PRIMES[(i + 5) % PRIMES.length] as number;
      const compA = COMPOSITES[i % COMPOSITES.length] as number;
      const compB = COMPOSITES[(i + 5) % COMPOSITES.length] as number;
      return {
        type: "MCQ",
        text: "Select the two prime numbers from the following options.",
        options: mcqOptions([primeA, primeB], [compA, compB], i),
      };
    }
    default: {
      const entry = CS_MULTI[i % CS_MULTI.length] as MultiEntry;
      return {
        type: "MCQ",
        text: entry.q,
        options: mcqOptions(entry.correct, entry.wrong, i),
      };
    }
  }
}

/**
 * Validate the structural invariants of a generated question. Throws when an
 * invariant is violated so that a faulty generator cannot silently corrupt the
 * seeded bank.
 */
function assertQuestionValid(id: string, q: GeneratedQuestion): void {
  if (q.options.length !== 4) {
    throw new Error(`${id}: expected 4 options, found ${q.options.length}`);
  }
  const correctCount = q.options.filter((o) => o.isCorrect).length;
  const expected = q.type === "SCQ" ? 1 : 2;
  if (correctCount !== expected) {
    throw new Error(
      `${id}: ${q.type} must have ${expected} correct option(s), found ${correctCount}`,
    );
  }
  const texts = new Set(q.options.map((o) => o.text));
  if (texts.size !== 4) {
    throw new Error(`${id}: option texts must be distinct`);
  }
}

/* ------------------------------------------------------------------------- */
/* Redis maintenance                                                         */
/* ------------------------------------------------------------------------- */

/**
 * Delete every Redis key matching `pattern` using non-blocking SCAN iteration.
 * FLUSHALL is deliberately avoided so unrelated keys are left untouched.
 */
async function flushPattern(pattern: string): Promise<number> {
  let cursor = "0";
  let removed = 0;
  do {
    const [next, keys] = await redis.scan(
      cursor,
      "MATCH",
      pattern,
      "COUNT",
      100,
    );
    cursor = next;
    if (keys.length > 0) {
      await redis.del(...keys);
      removed += keys.length;
    }
  } while (cursor !== "0");
  return removed;
}

/* ------------------------------------------------------------------------- */
/* Orchestration                                                             */
/* ------------------------------------------------------------------------- */

const EXAM_INSTRUCTIONS: string[] = [
  "The examination duration is 60 minutes, measured from the moment you begin.",
  "You will be served 60 questions, each carrying 1 mark, for a total of 60 marks.",
  "There is no negative marking; questions left unanswered simply score zero.",
  "Questions are of two types: single correct answer (SCQ) and multiple correct answer (MCQ).",
  "For multiple correct questions, the mark is awarded only when your selection exactly matches the correct set of options.",
  "Your responses are saved automatically and synchronised with the server at regular intervals.",
  "Use the question palette to navigate between questions and to review your progress at any time.",
  "The server clock is authoritative; the timer shown on your screen is provided only for guidance.",
  "Do not switch browser tabs, minimise the window, or leave full screen, as such actions are recorded.",
  "Results are published by the administrator and will not be available immediately upon submission.",
];

/** Delete every table row in a foreign-key-safe order. */
async function wipeDatabase(): Promise<void> {
  await db.delete(integrityEvents);
  await db.delete(auditLogs);
  await db.delete(answers);
  await db.delete(results);
  await db.delete(examSessions);
  await db.delete(options);
  await db.delete(questions);
  await db.delete(participants);
  await db.delete(admins);
  await db.delete(exams);
}

/** Close database and Redis connections, then terminate the process. */
async function shutdown(code: number): Promise<never> {
  await pgClient.end({ timeout: 5 });
  try {
    await redis.quit();
  } catch {
    redis.disconnect();
  }
  process.exit(code);
}

async function main(): Promise<void> {
  const fresh = process.argv.includes("--fresh");

  const existing = await db
    .select({ id: exams.id })
    .from(exams)
    .where(eq(exams.id, EXAM_ID));

  if (existing.length > 0 && !fresh) {
    console.log(
      `Exam "${EXAM_ID}" already exists. Nothing to do. Re-run with --fresh to reset and reseed.`,
    );
    await shutdown(0);
  }

  if (fresh) {
    console.log("Fresh reseed requested: clearing all tables...");
    await wipeDatabase();
    const patterns = ["leaderboard:*", "session:*", "deadline:*", "bank:*"];
    let redisRemoved = 0;
    for (const pattern of patterns) {
      redisRemoved += await flushPattern(pattern);
    }
    console.log(`Cleared database rows and ${redisRemoved} Redis key(s).`);
  }

  /* Exam ------------------------------------------------------------------ */
  await db.insert(exams).values({
    id: EXAM_ID,
    title: "WCL Practice Examination",
    durationSeconds: 3600,
    questionsToServe: 60,
    isOpen: true,
    instructions: EXAM_INSTRUCTIONS,
  });

  /* Questions and options ------------------------------------------------- */
  const questionRows: QuestionRow[] = [];
  const optionRows: OptionRow[] = [];
  let scqCount = 0;
  let mcqCount = 0;

  for (let i = 1; i <= QUESTION_COUNT; i += 1) {
    const qid = `Q${String(i).padStart(3, "0")}`;
    const generated = generateQuestion(i);
    assertQuestionValid(qid, generated);

    if (generated.type === "SCQ") {
      scqCount += 1;
    } else {
      mcqCount += 1;
    }

    questionRows.push({
      id: qid,
      examId: EXAM_ID,
      type: generated.type,
      text: generated.text,
      marks: 1,
    });

    const letters = ["A", "B", "C", "D"];
    generated.options.forEach((opt, idx) => {
      optionRows.push({
        id: `${qid}-${letters[idx]}`,
        questionId: qid,
        text: opt.text,
        isCorrect: opt.isCorrect,
      });
    });
  }

  for (const part of chunk(questionRows, CHUNK_SIZE)) {
    await db.insert(questions).values(part);
  }
  for (const part of chunk(optionRows, CHUNK_SIZE)) {
    await db.insert(options).values(part);
  }

  /* Participants ---------------------------------------------------------- */
  // Every candidate shares the same secret; the hash is computed exactly once
  // and reused across all rows.
  const participantSecretHash = await Bun.password.hash("password");
  const participantRows: ParticipantRow[] = [];
  for (let n = 1; n <= PARTICIPANT_COUNT; n += 1) {
    const suffix = String(n).padStart(3, "0");
    participantRows.push({
      username: `user${suffix}`,
      secretHash: participantSecretHash,
      displayName: `Candidate ${suffix}`,
    });
  }
  for (const part of chunk(participantRows, CHUNK_SIZE)) {
    await db.insert(participants).values(part);
  }

  /* Administrator --------------------------------------------------------- */
  const adminPasswordHash = await Bun.password.hash("adminpass");
  await db.insert(admins).values({
    email: "admin@wcl.local",
    passwordHash: adminPasswordHash,
    totpSecret: null,
  });

  /* Summary --------------------------------------------------------------- */
  console.log("");
  console.log("Seed complete.");
  console.log("--------------------------------------------------");
  console.log(`Exam:          ${EXAM_ID} (WCL Practice Examination)`);
  console.log(`Questions:     ${questionRows.length} (${scqCount} SCQ, ${mcqCount} MCQ)`);
  console.log(`Options:       ${optionRows.length}`);
  console.log(`Participants:  ${participantRows.length}`);
  console.log(`Admins:        1`);
  console.log("--------------------------------------------------");
  console.log("Development credentials:");
  console.log("  Candidates: user001 .. user700  / password  (examId WCL-DEMO)");
  console.log("  Admin:      admin@wcl.local      / adminpass");
  console.log("--------------------------------------------------");

  await shutdown(0);
}

main().catch(async (error) => {
  console.error("Seed failed:", error);
  await shutdown(1);
});
