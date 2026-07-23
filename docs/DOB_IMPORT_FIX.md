# Date of birth import: off-by-one day

Record of a data defect found on 23 July 2026, three days before the
examination, and how it was diagnosed and repaired.

## Symptom

A participant whose spreadsheet row read `31-05-1989` was stored in Postgres as
`1989-05-30`. The date of birth is the shared secret for hall-ticket portal
login (`app/hallticket/lib/candidates.ts` matches on employee ID and dob), so an
incorrect value silently locks the candidate out.

## Diagnosis

The suspicion was a timezone conversion, but the parser was already timezone
safe. `normalizeDob()` builds its date with `Date.UTC`, and commit `5fbcb6a` had
previously changed the cell reader from `toISOString()` to local day components
precisely to avoid a UTC shift.

Reading the raw cells proved otherwise. For a cell displaying `5/31/89`, SheetJS
returned:

```
1989-05-30T18:29:50.000Z  =  Tue May 30 1989 23:59:50 GMT+0530
```

The value is ten seconds short of midnight. Excel stores dates as serial
numbers, and the serial-to-`Date` conversion carries float error. Taking the
local day components of `23:59:50` on the 30th yields the 30th, so the date
lands a day early.

Two facts made the scope clear:

- Every one of the 574 date cells in `participants.final.xlsx` showed the same
  `23:59:50` pattern. The defect was systematic, not a single bad row.
- The database held exactly 574 participants, all with a date of birth, so
  `participants.final.xlsx` was the complete population. Every stored date of
  birth was wrong, and no candidate could have logged in with their real one.

## Fix

### 1. The parser

The shipped fix stops using SheetJS's `Date` conversion altogether. `cellDates`
is deliberately not passed; `cellNF` is, so a date cell can be recognised by its
number format while its value stays the raw serial. The serial is then converted
with pure UTC epoch math:

```ts
const EXCEL_EPOCH_MS = Date.UTC(1899, 11, 30);

function serialToIso(serial: number): string {
  const ms = Math.round(serial * 1440) * 60_000;
  return new Date(EXCEL_EPOCH_MS + ms).toISOString().slice(0, 10);
}
```

No local timezone is ever consulted, so the result cannot depend on where the
import runs. Rounding to the nearest minute absorbs serials written a few
seconds shy of midnight by other tools, while leaving a genuine time of day
intact for cells that carry one.

`normalizeDob()` also gained a bare-serial branch. `final.wcl.list.xlsx` has a
DOB column whose number formatting was stripped, so its dates arrive as plain
text like `32659`. The branch is restricted to exactly five digits, which spans
1927 to 2173, so a stray four-digit year such as `2001` is still rejected rather
than silently converting.

An earlier attempt in this repository rounded the corrupted local `Date` back to
the nearest day instead. It produced the same result on the participant file but
was strictly worse: it repaired a value after the timezone had already damaged
it, rather than avoiding the damage, and it had no answer for the bare serials
in `final.wcl.list.xlsx`. It was superseded before release.

### 2. The repair

`import-participants.ts` skips usernames that already exist and never updates
them, so re-running the import could not correct the stored rows. A separate
script was required: `app/api/scripts/fix-participant-dob.ts`.

It re-reads the source file with the corrected parser, compares against the
database, and updates only the rows that differ, in a single atomic `CASE`
statement. It is dry-run by default and writes only with `--apply`. Usernames
absent from the database are reported and left alone. Redis caches only
`id`, `username` and `secretHash` for a participant, never the date of birth, so
no cache invalidation was needed.

### 3. The check

`app/api/scripts/check-dob.ts` is an assert-based self-check covering serial
conversion, the five-digit guard, the documented text formats, and rejection of
impossible dates such as `31/02/1989` and `29/02/1989`. It uses `node:assert`
rather than `bun:test` because the project does not depend on `bun-types` and a
`bun:test` import fails `tsc`.

```
cd app/api
bun scripts/check-dob.ts
```

It was run under `TZ=Asia/Calcutta`, `TZ=UTC` and `TZ=America/New_York` to cover
both sides of UTC. All cases passed.

## Verification

The corrected parser was checked against the spreadsheet's own display strings,
not against assumptions: cells rendering `5/31/89`, `6/15/89`, `4/24/92`,
`10/10/89` and `7/5/89` now parse to `1989-05-31`, `1989-06-15`, `1992-04-24`,
`1989-10-10` and `1989-07-05`.

The repair reported 574 rows needing update, each moving forward exactly one
day. After applying it, a second dry run reported:

```
File rows with a dob: 574
Matched in database:  574
Need updating:        0
```

The two independent fixes described above were written in parallel and then
compared: re-running the same dry run under the serial-based parser also
reported `Need updating: 0`. Two implementations that share no code agreeing on
all 574 rows is the strongest evidence available here that the stored dates are
now correct.

## Follow-up

The parser fix is verified against the spreadsheet, but that only establishes
that the database now agrees with the file. Confirm a sample of dates against
what candidates actually submitted, since the repair is only as correct as the
source file.

Note also that `final.wcl.list.xlsx` names its identifier column `user name`
with a space, not `username`. `readRows()` lowercases and trims headers but does
not collapse inner spaces, so the importers do not recognise that column. The
failure is loud rather than silent, since `username is required` aborts the run
with nothing written, but the file cannot be imported as it stands.

## Commands

```
cd app/api
bun scripts/check-dob.ts                                              # self-check
bun scripts/fix-participant-dob.ts data/participants.final.xlsx           # dry run
bun scripts/fix-participant-dob.ts data/participants.final.xlsx --apply   # write
```

## Lesson

The earlier commit `5fbcb6a` fixed a real timezone bug in the same three lines
and looked like a complete fix, which is why the remaining defect survived: the
output was plausible in isolation. What exposed it was printing the raw cell
value next to the spreadsheet's own rendered text (`cell.w`) and comparing the
two. When an import produces dates that look reasonable, compare against what
the source file displays, not against what the parser returns.
