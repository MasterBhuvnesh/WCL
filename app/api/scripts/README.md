# Bulk import scripts (CSV / XLSX)

Three importers that load spreadsheet data straight into Postgres. Each accepts
a `.csv` **or** `.xlsx` file (first sheet only), matches headers
case/whitespace-insensitively, validates **every** row first and writes
all-or-nothing — a single bad row aborts the whole import with a list of
problems and their spreadsheet row numbers. Add `--dry-run` to validate
without writing anything.

Run everything from `app/api` with the API's `.env` in place (the scripts use
the same `DATABASE_URL` / Redis / S3 settings as the server):

```bash
cd app/api
bun run import:questions    data/questions.sample.xlsx          # or: bun scripts/import-questions.ts <file> [examId]
bun run import:participants data/participants.sample.xlsx
bun run import:seats        data/hallticket-seats.sample.xlsx
```

Sample files for all three live in [`data/`](../data/), ready to copy as
templates into Excel.

---

## 1. Questions — `import:questions`

`bun scripts/import-questions.ts <file> [examId] [--dry-run]` — examId
defaults to `EXAM_ID` from the env (`WCL-EXAM`).

| column | required | notes |
|---|---|---|
| `type` | yes | `SCQ` or `MCQ` (case-insensitive) |
| `text` | yes | the question prompt |
| `marks` | no | positive integer, default 1 |
| `image` | no | `http(s)://…` stored as-is; anything else is a file path **relative to the spreadsheet**, uploaded to S3/Floci (png/jpg/jpeg/webp/gif) |
| `option_a` … `option_f` | ≥ 2 non-empty | the answer options, in order |
| `correct` | yes | letters of the correct option(s): `A`, `a,c`, `B;D` — SCQ exactly one, MCQ at least one |

Local images require the Floci container: `docker compose up -d`.
After a successful import the script flushes the Redis question-bank cache
(`bank:<examId>`) so the API serves the new bank immediately.

## 2. Participants — `import:participants`

`bun scripts/import-participants.ts <file> [--dry-run]`

| column | required | notes |
|---|---|---|
| `username` | yes | login name / roll number; must be unique |
| `display_name` | no | shown in admin and on hall tickets |
| `dob` | no | `YYYY-MM-DD`, `DD/MM/YYYY` or `DD-MM-YYYY`; used by the hall-ticket portal login |
| `secret` | no | per-candidate password; rows without one get the common `PARTICIPANT_PASSWORD` (default `wclrbu2026`) |

Usernames that already exist in the DB are **skipped** (listed in the output),
never overwritten. Keep any plaintext `secret` list somewhere safe — only the
hash is stored.

## 3. Hall-ticket seats — `import:seats`

`bun scripts/import-hallticket-seats.ts <file> [--dry-run]`

| column | required | notes |
|---|---|---|
| `username` | yes | must already exist in participants — import participants first |
| `block_no` | yes | e.g. `Digital Tower` |
| `floor_no` | yes | e.g. `Ground Floor` |
| `lab_no` | yes | e.g. `Lab 1` |
| `seat_no` | yes | e.g. `F-001`; each seat may appear only once per file |

One seat row per participant: re-importing a username **reallocates** that
candidate's seat (upsert). The hall-ticket portal (`app/hallticket`) serves
tickets from these rows joined with participants; exam-wide details (date,
timings, venue) live in `app/hallticket/data/exam.json`.

---

## Cleaning the spreadsheet before import

- **Leading zeros:** format the `username` / `seat_no` columns as *Text* in
  Excel, or `user007` becomes `7`. The importers read the displayed cell text,
  so what you see in Excel is what gets imported.
- **Headers:** first row must be the column names above — case and surrounding
  spaces don't matter, extra columns are ignored.
- **Empty rows:** fully empty rows are skipped automatically; a *partially*
  filled row is an error, so delete leftovers.
- **Dates:** keep the `dob` column as text in one of the accepted formats;
  Excel's own date cells also work because the displayed text is imported.
- **Images:** paths in the `image` column resolve relative to the spreadsheet
  file, e.g. `images/q1.png` next to your CSV.
- Only the **first sheet** of an `.xlsx` workbook is read.
- When in doubt, run with `--dry-run` first — it reports every problem with
  its row number and writes nothing.

## Removing imported data (undo)

The easy way:

```bash
bun run clean <questions|participants|seats|all>          # preview: shows DB host + counts
bun run clean <questions|participants|seats|all> --yes    # actually delete
```

It cleans only what the importers load — questions/options of `EXAM_ID` (+
bank cache), session-less participants (seats cascade), and seat rows. It
never touches sessions, answers, results, exams, or admins. **It targets
whatever `DATABASE_URL` points at** (the preview prints the host — check it).

Dev shortcut: `bun run seed --fresh` wipes **everything** (Postgres + Redis)
back to demo data — same warning, it follows `DATABASE_URL`. The manual SQL
equivalents, if you prefer:

**Questions** (options don't cascade — delete them first, then flush the bank
cache):

```bash
docker exec -i wcl-postgres psql -U wcl -d wcl <<'SQL'
DELETE FROM options WHERE question_id IN (SELECT id FROM questions WHERE exam_id = 'WCL-EXAM');
DELETE FROM questions WHERE exam_id = 'WCL-EXAM';
SQL
docker exec wcl-redis redis-cli del bank:WCL-EXAM
```

**Participants** (only participants with no exam sessions can be deleted; their
seat rows cascade automatically):

```bash
docker exec wcl-postgres psql -U wcl -d wcl -c \
  "DELETE FROM participants WHERE username LIKE 'emp1%' AND id NOT IN (SELECT participant_id FROM exam_sessions);"
```

**Hall-ticket seats** (safe to clear and re-import any time):

```bash
docker exec wcl-postgres psql -U wcl -d wcl -c "DELETE FROM hallticket_seats;"
```
