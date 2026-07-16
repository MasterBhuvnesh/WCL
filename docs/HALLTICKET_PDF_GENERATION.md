# Hall-ticket PDF generation and S3 storage (plan)

Status: **planned, not implemented.** This documents the approach agreed for
moving hall-ticket PDFs off on-the-fly client rendering and into pre-generated
objects in S3. The `app/hallticket` portal currently renders the PDF **in the
candidate's browser** (`components/TicketPdf.tsx` via `@react-pdf/renderer`'s
`usePDF`); the on-screen preview is plain DOM (`components/HallTicketPreview.tsx`).
So today generation costs the server nothing — this plan is about determinism,
resilience, and offloading weak client devices, not about relieving server load.

---

## Why pre-generate

- **Deterministic output** — every candidate gets a byte-identical, verified
  file; no "it rendered differently on my phone."
- **Resilient** — works even if client JS fails; the same files can be emailed
  or bulk-printed.
- **Cheap to serve** — a static object behind a CDN; bytes never pass through
  the app server.
- **Low, one-time cost** — rendering is a batch job, not per-request. With the
  logos now compressed (see below) each PDF is ~120 KB, so 700 candidates is
  **~84 MB** total and the batch runs in ~1–2 minutes.

## Prerequisite already done: compress the logos

The source logos were 1.0 MB + 0.75 MB PNGs, embedded into **every** PDF. They
have been resized to 240 px tall and re-encoded (`app/hallticket/public/assets/{wcl,rbu}.png`,
now ~29 KB + ~51 KB). This dropped a rendered ticket from ~1.76 MB to ~120 KB —
essential before storing 700 of them. `@react-pdf/renderer` embeds PNG/JPEG only
(not WebP), so the assets must stay PNG/JPEG.

---

## Recommended approach: batch pre-generate → S3, serve via presigned URLs

Best fit while the roster and exam details are fixed ahead of exam day.

### 1. Storage layout

Reuse the existing S3 setup (Bun's built-in S3 client, env-var configured — see
`docs/S3_MIGRATION.md`). Hall tickets are **private**, unlike the public
question-image prefix `q/`:

```
s3://<bucket>/hallticket/<examId>/<employeeId>.pdf
```

- Keep **Block Public Access ON** for this prefix. No public bucket policy.
- Access is granted per-request with a short-lived **presigned GET URL** minted
  only after the DOB check passes.

### 2. Generation job

A standalone script (run with `bun`, like `app/api/src/seed.ts`), or an
admin-only route. Pseudocode:

```ts
import { renderToBuffer } from "@react-pdf/renderer";
import { HallTicketDocument } from "@/components/HallTicketDocument";
// candidates: from data/candidates.json now; from the participants table later.

for (const candidate of candidates) {
  const buf = await renderToBuffer(
    <HallTicketDocument candidate={candidate} exam={exam} />,
  );
  await s3.file(`hallticket/${examId}/${candidate.employeeId}.pdf`).write(buf, {
    type: "application/pdf",
  });
}
```

Notes:
- `HallTicketDocument` takes overridable `wclLogoSrc`/`rbuLogoSrc` (added for
  exactly this out-of-browser rendering); pass filesystem paths or absolute URLs
  so react-pdf can load the logos server-side.
- Idempotent + resumable: skip or overwrite by key. Log any candidate that fails
  to render rather than aborting the whole batch.
- Concurrency: cap at a handful of parallel renders; 700 is trivial either way.

### 3. Download flow (server-gated)

Change the login/download path so the browser never builds the PDF:

1. `POST /api/login` validates `employeeId` + DOB (unchanged — `lib/candidates.ts`).
2. On success, mint a presigned GET URL for
   `hallticket/<examId>/<employeeId>.pdf` (short TTL, e.g. 5 min) and return it
   alongside the candidate record.
3. The ticket page shows the DOM preview (`HallTicketPreview`) and a Download
   button pointing at the presigned URL. `TicketPdf`/`usePDF` and the
   client-side `@react-pdf/renderer` dependency can then be removed.

### 4. Regeneration / invalidation

The main cost of pre-generating: **when exam data changes (venue, time, seat),
the affected PDFs are stale.** Handle by re-running the job for changed
candidates (overwrites the key). Presigned URLs are short-lived, so no CDN
invalidation gymnastics — the next login fetches the fresh object. If a CDN
caches the object, set a low `Cache-Control` or bust with a version suffix in
the key.

---

## Alternative: on-demand server render + S3 cache (lazy)

Better **if exam details keep changing up to the last minute**.

- On first authenticated request for a ticket, render server-side, `write` to
  the same `hallticket/...` key, then redirect to a presigned URL.
- Subsequent requests serve the cached object directly.
- Invalidate by deleting the key when a candidate's data changes; it regenerates
  on next access.

Trade-off: simplest to keep fresh, but the first hit per candidate does the
render work on the server (spiky load around exam day) instead of offline.

---

## Access-control reminder

Do **not** make these objects public with guessable keys — `employeeId` is
guessable, so a public `hallticket/<examId>/<employeeId>.pdf` would let anyone
pull any candidate's admit card. Always gate behind the DOB check and serve via
presigned URLs (or non-guessable keys).

## Open decisions before implementing

1. **examId scoping** — the portal has no exam concept yet (single seeded exam).
   Decide whether tickets are keyed by a real `examId` (matches the exam system's
   `WCL-EXAM`) or a single fixed prefix.
2. **Trigger** — standalone `bun` script vs. an admin route/button that
   (re)generates the batch.
3. **Data source** — keep reading `data/candidates.json`, or switch to the
   `participants` table (+ new venue/seat columns, which don't exist yet;
   see `app/api/src/db/schema.ts`).
4. **Bucket** — reuse `wcl-images*` under a `hallticket/` prefix, or a separate
   private bucket.
