# WCL ADMIN

`wcladmin` is the control room for the WCL examination platform used for the
Western Coalfields Limited examination at Ramdeobaba University.
Administrators manage questions and their images, import participants and
seat allocations, watch live sessions as candidates write, grant extra time,
release a device binding when a lab PC fails, review integrity events, and
export results.

Next.js 16 built with Bun and served by the standalone Node server on
`node:22-alpine`. Built from
[MasterBhuvnesh/WCL](https://github.com/MasterBhuvnesh/WCL).

## QUICK START

```bash
docker run -d --name wcladmin -p 5000:5000 bhuvneshverma/wcladmin:latest
```

There is nothing to configure at run time. This image is a browser client for
`bhuvneshverma/wclapi`, and the API URL it talks to is fixed at build time.
Read the next section before deploying it.

## THE API URL IS BAKED IN AT BUILD TIME

`NEXT_PUBLIC_API_BASE` is a Next.js public variable, so its value is inlined
into the client bundle during `next build`. Setting it with `-e` on
`docker run` does nothing.

The published tags were built against `https://api.rbuexam.in`, and that
deployment has been decommissioned. To point the panel at your own API, build
the image yourself with the build argument:

```bash
docker build \
  --build-arg NEXT_PUBLIC_API_BASE="https://api.example.com" \
  -t wcladmin ./app/admin
```

## THE PORT IS 5000

The image declares `EXPOSE 5000`, and `PORT` and `HOSTNAME` are already set
for container networking. Publish it wherever you like on the host, for
example `-p 8080:5000`. The container runs as the unprivileged `node` user.

TLS and host routing are expected to come from a load balancer or reverse
proxy in front. The image serves plain HTTP and does no host matching.

## TAGS

| Tag | What it is |
| --- | --- |
| `latest` | The most recent release. Moved only by an `admin-v*` git tag. |
| `v0.1.7` | A specific release. Immutable. |

Pin to a version tag in production. `latest` moves under you.

## RELATED IMAGES

`bhuvneshverma/wclapi` is the API this panel drives, and it is the only
backend it needs; the panel never reaches the database directly.
`bhuvneshverma/wclhallticket` and `bhuvneshverma/wclresult` are the two public
candidate portals.

## LICENSE

Copyright (c) 2026 Bhuvnesh Verma and Vivian Demello. All rights reserved.
The source is published so it can be read and studied. It is not open source:
using, copying, modifying, or redistributing it requires written permission
from both copyright holders.
