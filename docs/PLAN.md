# WCL: candidate results, negative marking, always-kiosk, DOB, common password, question images

## Context

Six requirements from WCL for the exam build:
1. **Candidate result screen** — after submit, the client shows the final mark and per-question right/wrong. Decisions: shown **immediately after submit** (no publish gating), review shows **only outcome + marks, never the correct answers**.
2. **Negative marking** — −0.5 per wrong answer; totals **may go negative**.
3. **Always fullscreen/kiosk** — from launch (login screen included), but integrity events must not fire until the exam starts. (Recording is already gated on `examLock`/`in_progress`, so this is window-options work only.)
4. **Participant DOB** — stored + shown in admin only (feeds a future external hall-ticket site; login unchanged).
5. **Common password** `wclrbu2026` for all participants.
6. **Question images** — stored in S3-compatible storage: **Floci** locally (LocalStack-style emulator, S3 API at `http://localhost:4566`, any creds), real S3 later via env vars. Zero new deps: **Bun's built-in `S3Client`**.

Everything runs Windows-side: `powershell.exe -Command '...'` for bun/docker/curl (WSL localhost doesn't cross). Never `bun run build` in app/admin while its dev server runs.

## Validated design notes (from recon)

- Live grading is **only** `gradeAndPersist()` in `app/api/src/services/exam.ts` (~393–489). `lib/grading.ts`'s `gradeSession`/`gradeQuestion` are dead (only `isExactMatch` is imported) → delete them, keep `isExactMatch`, update docstring.
- Admin panel score rendering is already float/negative-safe (checked results, leaderboard, sessions, CSV, results.json, k6 — zero edits). Only integer assumption is the already-commented-out editScore block.
- **Flaw fix:** `submitExam()` calls `buffer.clearSession()` (ExamProvider.tsx:446) which would wipe the token and break "relaunch → see results". Delete that line; `finalizeSubmitted` already persists status, `/exam/resume` works for submitted sessions.
- **Race:** status flips before grading completes → `GET /exam/result` returns 409 "Result not ready"; client retry button covers it.
- Client CSP (`app/client/src/renderer/index.html`, the only CSP, ships into packaged builds) blocks S3 images → widen `img-src`.
- `express.raw` route-level parser coexists fine with global `express.json` (json only parses application/json).
- Redis `bank:{examId}` cache lacks `imageUrl` until reseed/upsert/600s TTL — reseed step covers it.

## Steps

### 0. Floci container (one-time, Windows side)
`docker run -d --name wcl-floci -p 4566:4566 -v floci-data:/app/data floci/floci:latest`
Create bucket: `curl -X PUT http://localhost:4566/wcl-images`

### 1. Schema (`app/api/src/db/schema.ts`) + one migration
- `results.score`: `integer` → `real` (halves exact; maxScore/correct/wrong/unanswered stay integer).
- `participants`: add nullable `dob: date("dob", { mode: "string" })`.
- `questions`: add nullable `imageUrl: text("image_url")`.
- `bun run db:generate` → `bun run db:migrate` (one migration, Windows side).

### 2. Env (`app/api/src/env.ts` + `.env.example`)
- `PARTICIPANT_PASSWORD` default `"wclrbu2026"` (mirrors ADMIN_PASSWORD pattern).
- `S3_ENDPOINT` (default `http://localhost:4566`), `S3_BUCKET` (`wcl-images`), `S3_ACCESS_KEY_ID`/`S3_SECRET_ACCESS_KEY` (`"test"`), `S3_PUBLIC_URL` optional + derived export `s3PublicUrl = env.S3_PUBLIC_URL ?? ${S3_ENDPOINT}/${S3_BUCKET}` (zod defaults can't cross-reference).

### 3. Negative marking (API)
- `services/exam.ts` wrong branch (~425): `score -= 0.5`.
- `admin.ts:340` PATCH finalScore: `z.number().int().min(0)` → `z.number()`.
- Instruction strings → "Each wrong answer deducts 0.5 marks; unanswered questions score zero." in `index.ts:66`, `seed.ts:476`, `store.ts:~112`. Also (feature B) `seed.ts:483` + `store.ts:~119` → "Your score is displayed immediately after submission."
- `lib/grading.ts`: delete dead `gradeQuestion`/`gradeSession` + dev-store imports, keep `isExactMatch`, docstring states −0.5 policy.

### 4. Candidate result endpoint (API)
- `services/exam.ts`: new exported `buildResultReview(session)` beside `gradeAndPersist`: reads `results` row (null → not ready); per `servedQuestionIds` recomputes outcome like grading does; options shuffled with the session seed (served order = what the candidate saw); per question `{questionId, type, text, imageUrl, marks, options:[{optionId,text}], selectedOptionIds, outcome, marksAwarded(+marks|−0.5|0)}` — **no isCorrect anywhere**. Top: `{sessionId, examId, status, submittedAt, score, maxScore, correct, wrong, unanswered, questions}`.
- `routes/exam.ts`: `GET /exam/result` (requireParticipant, exam rate bucket): 409 "Exam not submitted" unless submitted/auto_submitted; 409 "Result not ready" on null. Login-409 for submitted sessions stays; `resultsPublished` stays unenforced.

### 5. Upload route + imageUrl threading (API)
- `admin.ts`: `POST /upload` (after requireAdmin) with route-level `express.raw({ type: "image/*", limit: "5mb" })`; content-type whitelist png/jpeg/webp/gif → ext; key `q/${randomUUID()}.<ext>`; module-scope `new Bun.S3Client({ endpoint, bucket, accessKeyId, secretAccessKey })` (extend existing `declare const Bun` block); `s3.write(key, body, { type })`; audit `image-upload`; return `{ url: s3PublicUrl/key }`.
- Thread `imageUrl`: `questionsUpsertBody` (+`z.string().max(2048).nullable().optional()`), upsert values/set, `GET /admin/questions` projection, admin review `GET /admin/results/:sessionId` per-answer object.
- `services/exam.ts`: `BankQuestion` + `getBank` mapping + manifest projection gain `imageUrl`.

### 6. DOB + common password (API + seed)
- `admin.ts` importBody: `secret` → optional; `dob: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional()`. Import loop: lazily hoist ONE `Bun.password.hash(env.PARTICIPANT_PASSWORD)` for secret-less rows; insert `dob`.
- `GET /admin/participants` projection + `dob`.
- `seed.ts`: hash `env.PARTICIPANT_PASSWORD` (line 593); deterministic DOBs for the 700 demo users; updated credentials summary.

### 7. Reseed
`bun run seed --fresh` (Windows side) — also flushes stale `bank:*`.

### 8. Admin panel (Next.js)
- `participants/page.tsx`: DOB column + sample JSON (one row without `secret`, with `dob`) + helper text "secret/dob optional; missing secrets default to the common exam password".
- `questions/page.tsx`: `Question`/`Draft` gain `imageUrl`; QuestionEditor gets file input → raw `fetch(API_BASE + "/admin/upload", { headers: { authorization, "content-type": file.type }, body: file })` (apiFetch forces JSON — follow exportCsv pattern) → preview `<img>` + Remove; saveDraft sends it.
- `results/[sessionId]/page.tsx`: `ReviewAnswer.imageUrl` + render `<img>` under question text.

### 9. Client (Electron)
- **Results:** `types/exam.ts` `ManifestQuestion.imageUrl` + `ExamResult` types; `lib/api.ts` `result(token)`; ExamProvider: delete `buffer.clearSession()` in submitExam; `SubmittedPage.tsx` rewrite — fetch `api.result(token)` on mount (token from `useExam()`), score summary + per-question review (selections marked, outcome badge, marksAwarded, image), error → Retry button.
- **Kiosk:** `main/index.ts` BrowserWindow + `kiosk: true, resizable: false`; `lockdown.ts` `applyEnforcement()` three states — devMode: release all; enforcing: strict (unchanged); neither: kiosk+fullscreen asserted, no alwaysOnTop/shortcuts; `handleLeaveFullScreen`/`handleMinimize` guard `isEnforcing()` → `!devMode`, but `recordIntegrity` wrapped in `if (isEnforcing())`. `App.tsx:83` `showControls = devMode || isSubmitted`. Do NOT touch examLock at login; renderer visibility gate already exam-only. Dev escape Ctrl+Shift+Alt+X unchanged.
- **Images:** `QuestionView.tsx` after prompt `<p>`: `{question.imageUrl && <img src={...} className="mt-4 max-h-72 rounded-lg border object-contain" />}`; `index.html` CSP `img-src 'self' data: http: https:`.

### 10. Docs
- `docs/API.md`: GET /exam/result, POST /admin/upload, manifest/questions/review `imageUrl`, PATCH finalScore any number, import body (`secret` optional, `dob`), negative-marking notes.
- `docs/NEW_EXAM.md`: Floci setup + bucket creation, S3 env vars, common password, dob in import.

## Verification (per feature, Windows-side)

1. Migration generates one SQL file; migrate + `seed --fresh` clean.
2. **A:** login user001/wclrbu2026 → begin → answer one question wrong → submit → `GET /admin/results` shows −0.5 (or n−0.5); `PATCH finalScore: -1.5` and `2.5` both 200; admin Results/Leaderboard render/sort negatives.
3. **B:** same token → `GET /exam/result` has outcomes/marksAwarded and **zero** `isCorrect` occurrences; 409 before submit; client shows score screen after submit; relaunch client → results still there; API down → Retry works.
4. **C:** login screen is kiosk with no window buttons; Integrity page shows zero events pre-begin; events appear after begin; close button back after submit; dev shortcut still frees.
5. **D/E:** import `[{username, dob}]` without secret → login with wclrbu2026 works; explicit secret still works; DOB shows in admin.
6. **F:** upload curl returns Floci URL that serves 200; text/plain upload → 400; image attaches in admin editor, survives reload, renders in client QuestionView (CSP), in `GET /exam/result`, and in admin review.
