# Bulk import scripts (CSV / XLSX)

Three importers that load spreadsheet data directly into Postgres. Each
accepts a `.csv` or `.xlsx` file (first sheet only), matches headers
case-insensitively and ignores surrounding whitespace, validates every row
first, and writes all-or-nothing: a single invalid row aborts the whole
import with a list of problems and their spreadsheet row numbers. Add
`--dry-run` to validate without writing anything.

Run everything from `app/api` with the API's `.env` in place; the scripts use
the same `DATABASE_URL`, Redis, and S3 settings as the server.

```bash
cd app/api
bun run import:questions    data/questions.sample.xlsx          # or: bun scripts/import-questions.ts <file> [examId]
bun run import:participants data/participants.sample.xlsx
bun run import:seats        data/hallticket-seats.sample.xlsx
```

Sample files for all three live in [`data/`](../data/) and can be opened in
Excel as templates.

---

## 1. Questions (`import:questions`)

`bun scripts/import-questions.ts <file> [examId] [--dry-run]`. The examId
defaults to `EXAM_ID` from the environment (`WCL-EXAM`).

| column | required | notes |
|---|---|---|
| `type` | yes | `SCQ` or `MCQ` (case-insensitive) |
| `text` | yes | the question prompt |
| `marks` | no | positive integer, default 1 |
| `image` | no | an `http(s)://` URL is stored as-is; anything else is a file path relative to the spreadsheet, uploaded to S3/Floci (png/jpg/jpeg/webp/gif) |
| `option_a` to `option_f` | at least 2 non-empty | the answer options, in order |
| `correct` | yes | letters of the correct option(s), for example `A`, `a,c`, or `B;D`; SCQ requires exactly one, MCQ at least one |

Local images require the Floci container (`docker compose up -d`). After a
successful import the script flushes the Redis question-bank cache
(`bank:<examId>`) so the API serves the new bank immediately.

## 2. Participants (`import:participants`)

`bun scripts/import-participants.ts <file> [--dry-run]`

| column | required | notes |
|---|---|---|
| `username` | yes | login name or roll number; must be unique |
| `display_name` | no | shown in the admin panel and on hall tickets |
| `dob` | no | `YYYY-MM-DD`, `DD/MM/YYYY`, or `DD-MM-YYYY`; required for hall-ticket portal login |
| `secret` | no | per-candidate password; rows without one receive the common password from `PARTICIPANT_PASSWORD` |

Usernames that already exist in the database are skipped and listed in the
output, never overwritten. Keep any plaintext `secret` list somewhere safe,
because only the hash is stored.

## 3. Hall-ticket seats (`import:seats`)

`bun scripts/import-hallticket-seats.ts <file> [--dry-run]`

| column | required | notes |
|---|---|---|
| `username` | yes | must already exist in participants; import participants first |
| `block_no` | yes | for example `Digital Tower` |
| `floor_no` | yes | for example `Ground Floor` |
| `lab_no` | yes | for example `Lab 1` |
| `seat_no` | yes | for example `F-001`; each seat may appear only once per file |

One seat row is kept per participant: re-importing a username reallocates
that candidate's seat (upsert). The hall-ticket portal (`app/hallticket`)
serves tickets from these rows joined with participants; exam-wide details
(date, timings, venue) live in `app/hallticket/data/exam.json`.

---

## Preparing the spreadsheet

- **Leading zeros:** format the `username` and `seat_no` columns as Text in
  Excel, otherwise `user007` becomes `7`. The importers read the displayed
  cell text, so the sheet imports exactly as it appears in Excel.
- **Headers:** the first row must contain the column names above. Case and
  surrounding spaces are ignored; extra columns are ignored.
- **Empty rows:** fully empty rows are skipped automatically. A partially
  filled row is an error, so delete leftovers.
- **Dates:** keep the `dob` column as text in one of the accepted formats.
  Native Excel date cells also work, because the displayed text is imported.
- **Images:** paths in the `image` column resolve relative to the spreadsheet
  file, for example `images/q1.png` next to the sheet.
- Only the first sheet of an `.xlsx` workbook is read.
- When in doubt, run with `--dry-run` first: it reports every problem with
  its row number and writes nothing.

## Removing imported data (undo)

The recommended path:

```bash
bun run clean <questions|participants|seats|all>          # preview: prints DB host and counts
bun run clean <questions|participants|seats|all> --yes    # actually delete
```

It removes only what the importers load: questions and options of `EXAM_ID`
(plus the bank cache), participants without exam sessions (their seat rows
cascade), and seat rows. It never touches sessions, answers, results, exams,
or admins. It targets whatever `DATABASE_URL` points at; the preview prints
the host, so verify it before adding `--yes`.

Development shortcut: `bun run seed --fresh` wipes everything (Postgres and
Redis) back to demo data. The same warning applies, because it also follows
`DATABASE_URL`. The manual SQL equivalents below run against the local
Docker containers:

**Questions** (options do not cascade, so delete them first, then flush the
bank cache):

```bash
docker exec -i wcl-postgres psql -U wcl -d wcl <<'SQL'
DELETE FROM options WHERE question_id IN (SELECT id FROM questions WHERE exam_id = 'WCL-EXAM');
DELETE FROM questions WHERE exam_id = 'WCL-EXAM';
SQL
docker exec wcl-redis redis-cli del bank:WCL-EXAM
```

**Participants** (only participants with no exam sessions can be deleted;
their seat rows cascade automatically):

```bash
docker exec wcl-postgres psql -U wcl -d wcl -c \
  "DELETE FROM participants WHERE username LIKE 'emp1%' AND id NOT IN (SELECT participant_id FROM exam_sessions);"
```

**Hall-ticket seats** (safe to clear and re-import at any time):

```bash
docker exec wcl-postgres psql -U wcl -d wcl -c "DELETE FROM hallticket_seats;"
```
