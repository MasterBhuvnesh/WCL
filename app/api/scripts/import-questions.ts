/**
 * Import exam questions (with optional images) from a .csv or .xlsx file.
 *
 * Usage:
 *   bun scripts/import-questions.ts <file.csv|file.xlsx> [examId] [--dry-run]
 *
 * examId defaults to env.EXAM_ID. --dry-run validates everything (including that
 * local image files exist) and prints what would happen, writing nothing and
 * uploading nothing.
 *
 * Columns (headers matched case-insensitively; see data/questions.sample.xlsx):
 *   type          SCQ or MCQ (case-insensitive)
 *   text          question text (required)
 *   marks         positive integer (optional, default 1)
 *   image         optional: an http(s) URL stored as-is, or a path RELATIVE TO
 *                 THE FILE'S DIRECTORY, uploaded to S3 (png/jpg/jpeg/webp/gif)
 *   option_a..f   the non-empty cells become options in order (at least 2)
 *   correct       letters of the correct options, e.g. "A", "a,c" or "A;C";
 *                 SCQ needs exactly one, MCQ at least one
 *
 * All-or-nothing: every row is validated first and all errors are reported at
 * once; if any row is bad, nothing is written or uploaded.
 */

import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, extname, resolve } from "node:path";
import { eq } from "drizzle-orm";
import { db, pgClient, schema } from "../src/db/index.ts";
import { env, s3PublicUrl } from "../src/env.ts";
import { redis } from "../src/redis.ts";
import { bail, readRows } from "./_lib.ts";

const { exams, questions, options } = schema;

type QuestionRow = typeof questions.$inferInsert;
type OptionRow = typeof options.$inferInsert;

/** Bun runtime S3 client (built-in). Declared locally like the admin router. */
declare const Bun: {
  S3Client: new (options: {
    endpoint: string;
    bucket: string;
    accessKeyId: string;
    secretAccessKey: string;
  }) => {
    write(key: string, data: Uint8Array | Buffer, opts?: { type?: string }): Promise<number>;
  };
};

const s3 = new Bun.S3Client({
  endpoint: env.S3_ENDPOINT,
  bucket: env.S3_BUCKET,
  accessKeyId: env.S3_ACCESS_KEY_ID,
  secretAccessKey: env.S3_SECRET_ACCESS_KEY,
});

/** Accepted image file extensions mapped to their upload content type. */
const IMAGE_CONTENT_TYPE: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
};

const OPTION_LETTERS = ["a", "b", "c", "d", "e", "f"] as const;

type ImageSpec =
  | { kind: "url"; url: string }
  | { kind: "file"; absPath: string; rel: string; ext: string };

interface ParsedQuestion {
  type: "SCQ" | "MCQ";
  text: string;
  marks: number;
  image: ImageSpec | null;
  options: Array<{ text: string; isCorrect: boolean }>;
}

/**
 * Validate one spreadsheet row. Pushes any problems to `errors` (prefixed with
 * the row number) and returns null if the row is bad, so the caller can collect
 * every error before deciding to write anything.
 */
function parseRow(
  row: Record<string, string>,
  rowNo: number,
  fileDir: string,
  errors: string[],
): ParsedQuestion | null {
  const before = errors.length;
  const err = (msg: string) => errors.push(`Row ${rowNo}: ${msg}`);

  const type = (row.type ?? "").toUpperCase();
  if (type !== "SCQ" && type !== "MCQ") {
    err(`type must be SCQ or MCQ (got "${row.type ?? ""}")`);
  }

  const text = row.text ?? "";
  if (!text) err("text is required");

  let marks = 1;
  const rawMarks = row.marks ?? "";
  if (rawMarks) {
    const n = Number(rawMarks);
    if (!Number.isInteger(n) || n <= 0) {
      err(`marks must be a positive integer (got "${rawMarks}")`);
    } else {
      marks = n;
    }
  }

  // Non-empty option cells become options in order, keyed by their letter.
  const present: Array<{ letter: string; text: string }> = [];
  for (const letter of OPTION_LETTERS) {
    const value = row[`option_${letter}`] ?? "";
    if (value) present.push({ letter, text: value });
  }
  if (present.length < 2) err(`needs at least 2 options (found ${present.length})`);

  const correctLetters = new Set<string>();
  for (const raw of (row.correct ?? "").split(/[,;]/)) {
    const letter = raw.trim().toLowerCase();
    if (!letter) continue;
    if (correctLetters.has(letter)) {
      err(`duplicate correct letter "${letter}"`);
      continue;
    }
    correctLetters.add(letter);
    if (!present.some((p) => p.letter === letter)) {
      err(`correct letter "${letter}" does not match a non-empty option`);
    }
  }
  if (type === "SCQ" && correctLetters.size !== 1) {
    err(`SCQ must have exactly one correct option (found ${correctLetters.size})`);
  }
  if (type === "MCQ" && correctLetters.size < 1) {
    err(`MCQ must have at least one correct option (found ${correctLetters.size})`);
  }

  let image: ImageSpec | null = null;
  const rawImage = row.image ?? "";
  if (rawImage) {
    if (/^https?:\/\//i.test(rawImage)) {
      image = { kind: "url", url: rawImage };
    } else {
      const absPath = resolve(fileDir, rawImage);
      const ext = extname(rawImage).slice(1).toLowerCase();
      if (!IMAGE_CONTENT_TYPE[ext]) {
        err(`image "${rawImage}" must end in png/jpg/jpeg/webp/gif`);
      } else if (!existsSync(absPath)) {
        err(`image file not found: ${absPath}`);
      } else {
        image = { kind: "file", absPath, rel: rawImage, ext };
      }
    }
  }

  if (errors.length !== before) return null;
  return {
    type: type as "SCQ" | "MCQ",
    text,
    marks,
    image,
    options: present.map((p) => ({ text: p.text, isCorrect: correctLetters.has(p.letter) })),
  };
}

/** Close database and Redis connections, then terminate the process (as seed.ts). */
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
  const argv = process.argv.slice(2);
  const dryRun = argv.includes("--dry-run");
  const [file, examIdArg] = argv.filter((a) => !a.startsWith("--"));
  if (!file) {
    console.error("usage: bun scripts/import-questions.ts <file.csv|file.xlsx> [examId] [--dry-run]");
    process.exit(1);
  }
  const examId = examIdArg ?? env.EXAM_ID;
  const fileDir = dirname(resolve(file));

  const rows = readRows(file);
  if (rows.length === 0) bail([`No data rows found in ${file}.`]);

  const errors: string[] = [];
  const parsed: ParsedQuestion[] = [];
  // Header is row 1, so the first data row is row 2.
  rows.forEach((row, i) => {
    const q = parseRow(row, i + 2, fileDir, errors);
    if (q) parsed.push(q);
  });
  if (errors.length > 0) bail(errors);

  // questions.exam_id is a foreign key; the exam must already exist.
  const [exam] = await db.select({ id: exams.id }).from(exams).where(eq(exams.id, examId)).limit(1);
  if (!exam) {
    bail([`Exam "${examId}" does not exist. Seed it first or pass an existing examId.`]);
  }

  const optionTotal = parsed.reduce((sum, q) => sum + q.options.length, 0);
  const localImages = parsed.filter((q) => q.image?.kind === "file").length;

  if (dryRun) {
    console.log("DRY RUN - nothing written, nothing uploaded.");
    console.log(`  Exam:             ${examId}`);
    console.log(`  Questions:        ${parsed.length}`);
    console.log(`  Options:          ${optionTotal}`);
    console.log(`  Images to upload: ${localImages}`);
    await shutdown(0);
  }

  // Upload local images before opening the transaction, so a storage outage
  // aborts the import before any database rows are written.
  let uploaded = 0;
  for (const q of parsed) {
    if (q.image?.kind !== "file") continue;
    const key = `q/${randomUUID()}.${q.image.ext}`;
    try {
      await s3.write(key, readFileSync(q.image.absPath), { type: IMAGE_CONTENT_TYPE[q.image.ext] });
    } catch (cause) {
      throw new Error(
        `Failed to upload image "${q.image.rel}". Is the Floci/S3 container running? ` +
          `Start it with: docker compose up -d\n  ${(cause as Error).message}`,
      );
    }
    q.image = { kind: "url", url: `${s3PublicUrl}/${key}` };
    uploaded += 1;
  }

  const questionRows: QuestionRow[] = [];
  const optionRows: OptionRow[] = [];
  for (const q of parsed) {
    const qid = `Q-${randomUUID().slice(0, 8)}`;
    questionRows.push({
      id: qid,
      examId,
      type: q.type,
      text: q.text,
      marks: q.marks,
      imageUrl: q.image?.kind === "url" ? q.image.url : null,
    });
    for (const opt of q.options) {
      optionRows.push({
        id: `O-${randomUUID().slice(0, 8)}`,
        questionId: qid,
        text: opt.text,
        isCorrect: opt.isCorrect,
      });
    }
  }

  // ponytail: one bulk insert per table; postgres' 65535-param cap limits this
  // to ~16k option rows - chunk like seed.ts if banks ever get that large.
  await db.transaction(async (tx) => {
    await tx.insert(questions).values(questionRows);
    await tx.insert(options).values(optionRows);
  });

  // The API caches each exam's question bank in Redis for 600s (key bank:<examId>).
  // Drop it so the freshly imported questions are served without waiting for TTL.
  await redis.del(`bank:${examId}`);

  console.log("Import complete.");
  console.log(`  Exam:               ${examId}`);
  console.log(`  Questions inserted: ${questionRows.length}`);
  console.log(`  Options inserted:   ${optionRows.length}`);
  console.log(`  Images uploaded:    ${uploaded}`);
  console.log(`  Bank cache flushed: bank:${examId}`);

  await shutdown(0);
}

main().catch(async (error) => {
  console.error("Import failed:", error instanceof Error ? error.message : error);
  await shutdown(1);
});
