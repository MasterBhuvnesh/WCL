# WCL HALL TICKET

`wclhallticket` is the public hall ticket portal for the WCL examination
platform used for the Western Coalfields Limited examination at Ramdeobaba
University. A candidate signs in with their employee id and date of birth,
sees their seat allocation and exam details, and prints the hall ticket PDF
before exam day.

Next.js 16 built with Bun and served by the standalone Node server on
`node:22-alpine`. Built from
[MasterBhuvnesh/WCL](https://github.com/MasterBhuvnesh/WCL).

## QUICK START

```bash
docker run -d --name wclhallticket \
  -p 5001:5001 \
  -e DATABASE_URL="postgres://user:pass@host:5432/wcl" \
  bhuvneshverma/wclhallticket:latest
```

## THE PORT IS 5001

The image declares `EXPOSE 5001`, and `PORT` and `HOSTNAME` are already set
for container networking. Publish it wherever you like on the host, for
example `-p 8080:5001`. The container runs as the unprivileged `node` user.

TLS and host routing are expected to come from a load balancer or reverse
proxy in front. The image serves plain HTTP and does no host matching.

## TAGS

| Tag | What it is |
| --- | --- |
| `latest` | The most recent release. Moved only by a `hallticket-v*` git tag. |
| `v0.1.10` | A specific release. Immutable. |

Pin to a version tag in production. `latest` moves under you.

## ENVIRONMENT

One variable, read at run time rather than baked into the build:

- **`DATABASE_URL`**. The PostgreSQL database owned by
  `bhuvneshverma/wclapi`, used to look up participants and their hall ticket
  seats. It defaults to `postgres://wcl:wcl@localhost:5432/wcl`, which is a
  development value and will not resolve from inside a container.

This portal reads that database directly and does not call the API, so it
needs no API URL and works while the API is down.

## RELATED IMAGES

`bhuvneshverma/wclapi` owns the database this portal reads and the import job
that populates the seat allocations. `bhuvneshverma/wcladmin` is the
administrator control room, and `bhuvneshverma/wclresult` is the result
portal candidates use after the paper closes.

## LICENSE

Copyright (c) 2026 Bhuvnesh Verma and Vivian Demello. All rights reserved.
The source is published so it can be read and studied. It is not open source:
using, copying, modifying, or redistributing it requires written permission
from both copyright holders.
