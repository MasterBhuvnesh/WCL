# WCL RESULT

`wclresult` is the public result portal for the WCL examination platform used
for the Western Coalfields Limited examination at Ramdeobaba University. Once
an administrator publishes results, a candidate signs in with the same
employee id and date of birth used for their hall ticket and sees their final
score along with every question they were served and the correct answer.
Nothing is disclosed before that switch is flipped.

Next.js 16 built with Bun and served by the standalone Node server on
`node:22-alpine`. Built from
[MasterBhuvnesh/WCL](https://github.com/MasterBhuvnesh/WCL).

## QUICK START

```bash
docker run -d --name wclresult \
  -p 5002:5002 \
  -e DATABASE_URL="postgres://user:pass@host:5432/wcl" \
  -e EXAM_ID="WCL-EXAM" \
  bhuvneshverma/wclresult:latest
```

## THE PORT IS 5002

The image declares `EXPOSE 5002`, and `PORT` and `HOSTNAME` are already set
for container networking. Publish it wherever you like on the host, for
example `-p 8080:5002`. The container runs as the unprivileged `node` user.

TLS and host routing are expected to come from a load balancer or reverse
proxy in front. The image serves plain HTTP and does no host matching.

## TAGS

| Tag | What it is |
| --- | --- |
| `latest` | The most recent release. Moved only by a `result-v*` git tag. |
| `v0.1.1` | A specific release. Immutable. |

Pin to a version tag in production. `latest` moves under you.

## ENVIRONMENT

Two variables, both read at run time rather than baked into the build:

- **`DATABASE_URL`**. The PostgreSQL database owned by
  `bhuvneshverma/wclapi`, used to look up participants, sessions, and
  results. It defaults to `postgres://wcl:wcl@localhost:5432/wcl`, which is a
  development value and will not resolve from inside a container.
- **`EXAM_ID`**. The exam whose publication flag gates candidates who never
  started a session. It defaults to `WCL-EXAM` and must match the `EXAM_ID`
  given to `bhuvneshverma/wclapi`. A mismatch leaves those candidates unable
  to see a published result.

This portal reads that database directly and does not call the API, so it
needs no API URL and works while the API is down.

## RELATED IMAGES

`bhuvneshverma/wclapi` grades the papers and owns the database this portal
reads. `bhuvneshverma/wcladmin` is where results are published, and
`bhuvneshverma/wclhallticket` is the hall ticket portal candidates use before
exam day.

## LICENSE

Copyright (c) 2026 Bhuvnesh Verma and Vivian Demello. All rights reserved.
The source is published so it can be read and studied. It is not open source:
using, copying, modifying, or redistributing it requires written permission
from both copyright holders.
