# Candidate feedback

Written 2026-07-17. Covers the post-submission feedback feature and the
changes to the submitted screen in the client.

## What the candidate sees

After submitting (or being auto-submitted), the client no longer shows the
per-question review. The submitted screen now shows:

1. The total score only (`score / maxScore`), fetched from `GET /exam/result`.
   If the result is not ready yet (grading race), a Retry button appears.
2. A feedback form with two mandatory 1 to 5 star ratings and an optional
   comment (max 1000 characters):
   - How was the examination platform?
   - How was the college infrastructure (seating, labs, facilities)?

The window stays fullscreen throughout; the title bar is hidden once the exam
is submitted (developer mode keeps it for debugging). After the feedback is
sent, a thank-you message shows for three seconds and the application closes
itself, leaving the machine ready for the next candidate.

## API

`POST /exam/feedback` (participant token, session must be submitted or
auto-submitted). Body:

```json
{ "platformRating": 4, "infrastructureRating": 5, "comment": "optional" }
```

First submission per session wins; repeats are acknowledged with `200` but
not stored (`ON CONFLICT DO NOTHING` on the session id). Full contract in
[API.md](API.md).

## Database

Table `feedback` (migration `0004_right_lyja.sql`, applied to production RDS
on 2026-07-17):

| Column | Type | Notes |
|---|---|---|
| `session_id` | uuid, primary key | references `exam_sessions.id`; one row per session |
| `participant_id` | uuid | references `participants.id` |
| `exam_id` | text | references `exams.id`; indexed (`feedback_exam_idx`) |
| `platform_rating` | integer | 1 to 5 |
| `infrastructure_rating` | integer | 1 to 5 |
| `comment` | text, nullable | max 1000 characters, trimmed |
| `created_at` | timestamptz | defaults to now |

There is no admin UI for feedback yet; query the table directly, for example:

```sql
SELECT p.username, f.platform_rating, f.infrastructure_rating, f.comment
FROM feedback f JOIN participants p ON p.id = f.participant_id
ORDER BY f.created_at;
```

## Files changed

- `app/api/src/db/schema.ts` - `feedback` table
- `app/api/src/routes/exam.ts` - `POST /exam/feedback`
- `app/client/src/renderer/src/pages/SubmittedPage.tsx` - score-only screen plus form
- `app/client/src/renderer/src/lib/api.ts` - `api.feedback()`
- `app/client/src/renderer/src/App.tsx` - title bar hidden after submission
