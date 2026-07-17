# WCL API Reference

Every route, as plain request → response. Base URL in dev: `http://localhost:4000`.

Two kinds of auth token, both sent as a header:

```
Authorization: Bearer <token>
```

- **Participant token** — returned by `POST /auth/login`. Works on `/exam/*`.
- **Admin token** — returned by `POST /admin/login`. Works on `/admin/*`.

Every error response has the same shape:

```json
{ "error": "human-readable message" }
```

Rate limits: login routes 10/min per IP, all `/exam/*` routes 300/min, everything else unlimited.

---

## Public

### GET /health

Liveness probe. No auth.

**Response `200`**

```json
{ "status": "ok", "service": "wcl-api", "time": "2026-07-07T10:00:00.000Z" }
```

### GET /time

Server time, used by the client to compute its clock offset. No auth.

**Response `200`**

```json
{ "serverTime": "2026-07-07T10:00:00.000Z" }
```

---

## Candidate flow

The client calls these in order: login → begin → manifest → (answer/heartbeat loop) → submit → result. `resume` replaces begin+manifest after a relaunch.

### POST /auth/login

Authenticate a participant and create (or reuse) their exam session. No auth needed.

**Request**

```json
{
  "username": "user001",
  "password": "password",
  "examId": "WCL-EXAM",
  "deviceId": "3f9c...ab"
}
```

`examId` optional (defaults to `WCL-EXAM`). `deviceId` optional — the Electron client always sends its hardware fingerprint; the session becomes bound to it.

**Response `200`**

```json
{
  "token": "eyJhbGciOi...",
  "sessionId": "d3b0...",
  "sessionStatus": "not_started",
  "exam": {
    "examId": "WCL-EXAM",
    "title": "WCL Practice Examination",
    "durationSeconds": 3600,
    "questionsToServe": 60,
    "instructions": ["...", "..."]
  }
}
```

`sessionStatus` is one of `not_started | in_progress | submitted | auto_submitted`.

**Errors**

| Status | When |
|---|---|
| `401` | Wrong username/password, or the exam doesn't exist |
| `403` | Exam is closed or outside its availability window |
| `409` | Already submitted, **or** session is bound to a different device (`"Session is bound to another device. Ask a proctor to release the device binding."`) |

### POST /exam/begin

Start the clock. Idempotent — calling it again returns the same deadline. Participant token required. Empty body.

**Response `200`**

```json
{
  "startedAt": "2026-07-07T10:00:00.000Z",
  "deadlineAt": "2026-07-07T11:00:00.000Z",
  "serverTime": "2026-07-07T10:00:00.100Z",
  "durationSeconds": 3600,
  "status": "in_progress"
}
```

### GET /exam/manifest

The candidate's served questions (subset of the bank, shuffled per session; options shuffled per question). Each question may carry an `imageUrl` (an admin-uploaded URL) or `null`. **Never contains `isCorrect`.** Participant token required.

**Response `200`**

```json
{
  "examId": "WCL-EXAM",
  "shuffleSeed": "6f0e...",
  "questions": [
    {
      "questionId": "Q-001",
      "type": "SCQ",
      "text": "Which planet is known as the Red Planet?",
      "imageUrl": null,
      "marks": 1,
      "options": [
        { "optionId": "O-003", "text": "Mars" },
        { "optionId": "O-001", "text": "Venus" }
      ]
    }
  ]
}
```

**Errors:** `409` if `/exam/begin` hasn't been called yet.

### POST /exam/answer

Save one answer. Idempotent upsert — a replay of the same `clientSeq` or an older one is ignored (returned un-acked), so the offline buffer can resend freely. Participant token required.

**Request**

```json
{
  "questionId": "Q-001",
  "selectedOptionIds": ["O-003"],
  "status": "answered",
  "clientSeq": 17,
  "answeredAt": "2026-07-07T10:05:30.000Z"
}
```

`status` is the palette state: `not_answered | answered | marked_for_review | answered_marked`. `clientSeq` must increase with every local change — the server rejects stale writes. `answeredAt` is when the candidate answered (client clock), not when the request arrived; deadline enforcement judges this timestamp.

**Response `200`**

```json
{ "acked": ["Q-001"] }
```

`acked` is empty when the write was rejected (stale `clientSeq`, or `answeredAt` past deadline + 10s grace).

### POST /exam/heartbeat

Periodic sync: pushes any buffered answers, gets the authoritative clock back. Also the trigger that auto-submits a session past its deadline. Participant token required.

**Request** (both fields optional — `{}` is a pure clock check)

```json
{
  "answers": [
    { "questionId": "Q-002", "selectedOptionIds": ["O-007"], "status": "answered", "clientSeq": 18, "answeredAt": "2026-07-07T10:06:00.000Z" }
  ],
  "integrityEvents": [
    { "type": "focus_lost", "meta": { "count": 3 } }
  ]
}
```

`integrityEvents` (max 50) lets queued proctoring events piggyback on the heartbeat instead of costing their own requests; the client coalesces repeats of the same type into one entry with a `count`.

**Response `200`**

```json
{
  "serverTime": "2026-07-07T10:06:01.000Z",
  "remainingSeconds": 3239,
  "deadlineAt": "2026-07-07T11:00:00.000Z",
  "status": "in_progress",
  "acked": ["Q-002"]
}
```

If the deadline has passed, `status` comes back `auto_submitted` and `remainingSeconds` is `0` — the client shows the locked screen.

### POST /exam/submit

Finish the exam. Idempotent — a second call returns the already-final status. Grades server-side; **never returns the score**. Participant token required. Empty body.

**Response `200`**

```json
{ "status": "submitted", "submittedAt": "2026-07-07T10:45:12.000Z" }
```

### GET /exam/result

The candidate's own graded result: the final score plus a per-question review of
what they picked and how it scored. Available **immediately after submit** —
results publishing is not enforced here. **Never exposes the correct answers** —
only the outcome and marks per question. Options are listed in the same shuffled
order the candidate saw. Participant token required.

**Response `200`**

```json
{
  "sessionId": "d3b0...",
  "examId": "WCL-EXAM",
  "status": "submitted",
  "submittedAt": "2026-07-07T10:45:12.000Z",
  "score": 41.5,
  "maxScore": 60,
  "correct": 42,
  "wrong": 10,
  "unanswered": 8,
  "questions": [
    {
      "questionId": "Q-001",
      "type": "SCQ",
      "text": "Which planet is known as the Red Planet?",
      "imageUrl": null,
      "marks": 1,
      "options": [
        { "optionId": "O-003", "text": "Mars" },
        { "optionId": "O-001", "text": "Venus" }
      ],
      "selectedOptionIds": ["O-003"],
      "outcome": "correct",
      "marksAwarded": 1
    }
  ]
}
```

`outcome` is `correct | wrong | unanswered`; `marksAwarded` is `+marks` when
correct, `-0.5` when wrong, and `0` when unanswered (so `score` can be negative).

**Errors**

| Status | When |
|---|---|
| `409` | Exam not submitted yet (`"Exam not submitted"`) |
| `409` | Submitted but grading hasn't landed yet (`"Result not ready"`) — retry shortly |

### POST /exam/resume

Full state rehydration after a relaunch or crash: manifest, all saved answers, and the live clock in one call. Participant token required. Empty body.

**Response `200`**

```json
{
  "exam": { "examId": "WCL-EXAM", "title": "...", "durationSeconds": 3600, "questionsToServe": 60, "instructions": ["..."] },
  "manifest": { "examId": "WCL-EXAM", "shuffleSeed": "...", "questions": [ ... ] },
  "answers": [
    { "questionId": "Q-001", "selectedOptionIds": ["O-003"], "status": "answered", "clientSeq": 17, "answeredAt": "2026-07-07T10:05:30.000Z" }
  ],
  "deadlineAt": "2026-07-07T11:00:00.000Z",
  "remainingSeconds": 3100,
  "serverTime": "2026-07-07T10:08:20.000Z",
  "status": "in_progress"
}
```

If the deadline passed while the client was away, the session is finalized first and `status` is `auto_submitted`.

### POST /exam/feedback

Submit post-examination feedback. Participant token required, and the session
must be `submitted` or `auto_submitted` (otherwise `409 Exam not submitted`).
Ratings are integers from 1 to 5; the comment is optional (max 1000
characters). Only the first submission per session is stored; repeats still
return `200`.

**Request**

```json
{ "platformRating": 4, "infrastructureRating": 5, "comment": "Smooth experience" }
```

**Response `200`**

```json
{ "ok": true }
```

### POST /exam/integrity

Report a proctoring event (the client sends these on focus loss etc.). Participant token required.

**Request**

```json
{ "type": "focus_loss", "meta": { "durationMs": 4200 } }
```

**Response `200`**

```json
{ "ok": true }
```

---

## Admin

All routes below are prefixed `/admin` and (except login) require an admin token.

### POST /admin/login

**Request**

```json
{ "email": "admin@wcl.local", "password": "adminpass", "totp": "123456" }
```

`totp` is required only after the admin has run MFA setup.

**Response `200`**

```json
{ "token": "eyJhbGciOi...", "email": "admin@wcl.local" }
```

**Errors:** `401` — bad credentials, missing TOTP (`"TOTP code required"`), or wrong TOTP.

### POST /admin/mfa/setup

Generate and enable a TOTP secret for the logged-in admin. Empty body.

**Response `200`**

```json
{ "secret": "JBSWY3DP...", "otpauthUrl": "otpauth://totp/WCL:admin@wcl.local?secret=..." }
```

Scan `otpauthUrl` in an authenticator app; from then on login requires `totp`.

### GET /admin/leaderboard?examId=WCL-EXAM&limit=50&offset=0

Paged leaderboard from Redis (rebuilt from the DB automatically if empty).

**Response `200`**

```json
{
  "examId": "WCL-EXAM",
  "total": 700,
  "entries": [
    { "rank": 1, "participantId": "a1b2...", "username": "user042", "displayName": "Jane Doe", "score": 58 }
  ]
}
```

### GET /admin/sessions?examId=WCL-EXAM

Live monitoring: status counts + the 200 most recent sessions.

**Response `200`**

```json
{
  "counts": { "not_started": 12, "in_progress": 640, "submitted": 40, "auto_submitted": 8 },
  "sessions": [
    {
      "sessionId": "d3b0...",
      "username": "user001",
      "status": "in_progress",
      "startedAt": "2026-07-07T10:00:00.000Z",
      "deadlineAt": "2026-07-07T11:00:00.000Z",
      "submittedAt": null
    }
  ]
}
```

### GET /admin/results?examId=WCL-EXAM

All graded results, newest first.

**Response `200`**

```json
[
  {
    "sessionId": "d3b0...",
    "username": "user001",
    "examId": "WCL-EXAM",
    "status": "submitted",
    "score": 42,
    "maxScore": 60,
    "correct": 42,
    "wrong": 10,
    "unanswered": 8,
    "startedAt": "2026-07-07T10:00:00.000Z",
    "submittedAt": "2026-07-07T10:45:12.000Z",
    "gradedAt": "2026-07-07T10:45:12.500Z"
  }
]
```

### GET /admin/results/:sessionId

Per-candidate answer review — every served question with the correct options and what the candidate picked.

**Response `200`**

```json
{
  "sessionId": "d3b0...",
  "username": "user001",
  "examId": "WCL-EXAM",
  "status": "submitted",
  "score": 42,
  "maxScore": 60,
  "startedAt": "2026-07-07T10:00:00.000Z",
  "submittedAt": "2026-07-07T10:45:12.000Z",
  "answers": [
    {
      "questionId": "Q-001",
      "type": "SCQ",
      "text": "Which planet is known as the Red Planet?",
      "imageUrl": null,
      "options": [
        { "id": "O-001", "text": "Venus", "isCorrect": false },
        { "id": "O-003", "text": "Mars", "isCorrect": true }
      ],
      "selectedOptionIds": ["O-003"],
      "outcome": "correct"
    }
  ]
}
```

`outcome` is `correct | wrong | unanswered`. **Errors:** `404` unknown session.

### PATCH /admin/results/:sessionId

Edit a final score (audited as `result.score_edit`; leaderboard and live WS update immediately).

**Request**

```json
{ "finalScore": 45, "reason": "question Q-017 thrown out" }
```

`finalScore` may be any number — fractional and negative values are accepted
(negative marking can push a raw score below zero).

**Response `200`** — the updated result row (same shape as one entry of `GET /admin/results`).

**Errors:** `404` — no graded result for that session yet.

### GET /admin/export/results.csv?examId=WCL-EXAM

CSV download of the results list. Response is `text/csv`, columns: Username, Exam, Status, Score, Max score, Correct, Wrong, Unanswered, Started at, Submitted at.

### GET /admin/export/leaderboard.csv?examId=WCL-EXAM

CSV download of the full leaderboard (all ranked entries, not paged). Response is `text/csv`, columns: Rank, Username, Name, Score.

### POST /admin/sessions/:sessionId/reset

Wipe a session back to `not_started`: deletes its answers and result, clears deadline/seed, removes the leaderboard entry. Audited. Empty body.

**Response `200`**

```json
{ "ok": true }
```

### POST /admin/sessions/:sessionId/release-device

Clear the device binding so the candidate can log in from a different machine (hardware failure, seat move). Their next login rebinds to the new device and logs a `device_change` event. Audited. Empty body.

**Response `200`**

```json
{ "ok": true }
```

### POST /admin/sessions/:sessionId/add-time

Extend one candidate's deadline. Pushed live to a connected client over pub/sub. Audited.

**Request**

```json
{ "seconds": 300 }
```

**Response `200`**

```json
{ "ok": true, "deadlineAt": "2026-07-07T11:05:00.000Z" }
```

**Errors:** `409` — session isn't `in_progress`.

### POST /admin/exams/:examId/add-time

Extend every in-progress session of an exam (and the exam's `availableUntil`, if set).

**Request**

```json
{ "seconds": 300 }
```

**Response `200`**

```json
{ "ok": true, "updated": 640 }
```

### POST /admin/exams/:examId/open · POST /admin/exams/:examId/close

Open or close the exam for login. Audited. Empty body.

**Response `200`**

```json
{ "ok": true, "isOpen": true }
```

### POST /admin/exams/:examId/publish

Toggle the results-published flag.

**Request**

```json
{ "published": true }
```

**Response `200`**

```json
{ "ok": true, "resultsPublished": true }
```

### GET /admin/integrity-events?examId=WCL-EXAM&sessionId=...&limit=100

Integrity events, newest first. Both filters optional. Types seen in practice: `focus_loss`, `double_login`, `device_change`.

**Response `200`**

```json
[
  {
    "id": "e91c...",
    "sessionId": "d3b0...",
    "username": "user001",
    "type": "focus_loss",
    "meta": { "durationMs": 4200 },
    "createdAt": "2026-07-07T10:12:00.000Z"
  }
]
```

### GET /admin/questions?examId=WCL-EXAM

Full question bank **including answers** — admin-only.

**Response `200`**

```json
[
  {
    "id": "Q-001",
    "type": "SCQ",
    "text": "Which planet is known as the Red Planet?",
    "imageUrl": null,
    "marks": 1,
    "options": [
      { "id": "O-001", "text": "Venus", "isCorrect": false },
      { "id": "O-003", "text": "Mars", "isCorrect": true }
    ]
  }
]
```

### POST /admin/questions

Create or update questions (upsert by `id`; omit `id` to create). Options are replaced wholesale. Validates SCQ has exactly one correct option, MCQ at least one. Busts the Redis bank cache. Audited.

**Request**

```json
{
  "examId": "WCL-EXAM",
  "questions": [
    {
      "type": "MCQ",
      "text": "Which of these are prime?",
      "marks": 2,
      "options": [
        { "text": "2", "isCorrect": true },
        { "text": "3", "isCorrect": true },
        { "text": "4", "isCorrect": false }
      ]
    }
  ]
}
```

**Response `200`**

```json
{ "ok": true, "ids": ["Q-a1b2c3d4"] }
```

Each question may include an optional `imageUrl` (a URL returned by
`POST /admin/upload`, or `null` to clear it); it is echoed back by
`GET /admin/questions`, the candidate manifest, and the result review.

### DELETE /admin/questions/:id

Delete a question and its options. Refused if any session was ever served it.

**Response `200`:** `{ "ok": true }` · **Errors:** `404` unknown, `409` already served.

### POST /admin/upload

Upload a question image. The body is the **raw image bytes** (not multipart); set
`Content-Type` to the image's own type — one of `image/png`, `image/jpeg`,
`image/webp`, `image/gif`. Max **5 MB**. The file is stored in the configured
S3-compatible bucket (Floci locally, real S3 in production); put the returned
`url` in a question's `imageUrl`. Audited.

**Request**

```
Content-Type: image/png

<raw image bytes>
```

**Response `200`**

```json
{ "url": "http://localhost:4566/wcl-images/q/2f1c8e4a-....png" }
```

**Errors:** `400` — missing body, unsupported content-type, or larger than 5 MB.

### GET /admin/participants

All participants, sorted by username.

**Response `200`**

```json
[
  { "id": "a1b2...", "username": "user001", "displayName": "Candidate 001", "dob": "2001-04-12", "createdAt": "2026-07-07T09:00:00.000Z" }
]
```

`dob` (`YYYY-MM-DD`, or `null`) is used by the external hall-ticket portal
(username + dob login) and shown in admin; it plays no part in exam login.

### GET /admin/hallticket

Hall-ticket seat allocations (participants ⋈ hallticket_seats), sorted by
username. Load rows with `bun run import:seats` in `app/api`.

**Response `200`**

```json
[
  { "id": "a1b2...", "username": "user001", "displayName": "Candidate 001", "dob": "2001-04-12", "blockNo": "Digital Tower", "floorNo": "Ground Floor", "labNo": "Lab 1", "seatNo": "A-001" }
]
```

### POST /admin/participants/import

Bulk import (max 1000 per call). `secret` and `dob` are **optional**: a row
without a `secret` gets the common exam password from `PARTICIPANT_PASSWORD`
(default `wclrbu2026`), and `dob` is `"YYYY-MM-DD"`, stored and shown in admin
only (for a future external hall-ticket site) — it plays no part in login.
Secrets are argon2id-hashed on ingest; existing usernames are skipped,
duplicates within the batch collapse to the first. Audited.

**Request**

```json
{
  "participants": [
    { "username": "user701", "displayName": "New Candidate", "dob": "2003-11-02" },
    { "username": "user702", "secret": "s3cret", "displayName": "Own Password" }
  ]
}
```

**Response `200`**

```json
{ "created": 1, "skipped": 0 }
```

---

## WebSocket

### `ws://<host>/admin/ws?token=<admin JWT>`

Read-only live feed. The upgrade is rejected unless the token is a valid admin JWT. Each message is:

```json
{ "channel": "wcl:leaderboard:WCL-EXAM", "payload": { "participantId": "...", "username": "user042", "score": 58, "maxScore": 60, "submittedAt": "..." } }
```

Channels: `wcl:leaderboard:<examId>` (score changes — new grades and admin edits) and `wcl:session:<sessionId>` (`add_time` pushes).
