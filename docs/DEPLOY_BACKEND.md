# Backend deployment (API)

The API runs alone on a t3.medium EC2 instance behind the same application
load balancer as the frontend. The load balancer terminates TLS and routes
`api.rbuexam.in` to the instance.

| URL | Service | Container port |
|---|---|---|
| https://api.rbuexam.in | API (Bun/Express) | 4000 |

Postgres is RDS (`wcl-db`), Redis is ElastiCache (`wcl-redis`, reachable only
inside the VPC, which the instance is in). Images live on Docker Hub as
`bhuvneshverma/wclapi`.

## What exists in AWS (ap-south-1, created 2026-07-17)

| Resource | Identifier |
|---|---|
| EC2 instance `wcl-backend` (t3.medium, Ubuntu 24.04, 20 GB gp3, key pair `wcl-backend`) | `i-08da393d608685e37` |
| Target group `wcl-api` (HTTP 4000, health check `/health`) | rule on the shared ALB: host `api.rbuexam.in` |
| Security group `wcl-backend-ec2` | 4000 and 22 accessible only from the ALB / endpoint security group; nothing public |
| Route53 | `api.rbuexam.in` A-alias to the `wcl-frontend` ALB |

The ALB, ACM wildcard certificate, and Instance Connect Endpoint are shared
with the frontend; see docs/DEPLOY_FRONTEND.md for those identifiers.
Instance user data installed Docker and created `/srv/wcl`.

## Deployed state (2026-07-17)

The stack is running: `docker-compose.backend.yml` and `.env.prod.backend`
are in `/srv/wcl`, the target group is healthy, `https://api.rbuexam.in/health`
returns ok, and an admin login round-trips through RDS. The admin panel image
was rebuilt with `NEXT_PUBLIC_API_BASE=https://api.rbuexam.in` and pushed;
watchtower on the frontend instance picks it up automatically.

## Env file

`.env.prod.backend` (template: `.env.prod.backend.example`) carries the same
keys as `app/api/.env` plus two production overrides:

- `NODE_ENV=production`: the server refuses to boot with the development
  JWT_SECRET or ADMIN_PASSWORD in this mode.
- `REDIS_URL` points at the ElastiCache endpoint instead of localhost.

The compose service loads it with `env_file`, one file for the whole box.

## Deploying / redeploying

SSH goes through the Instance Connect Endpoint tunnel; the exact commands
(and the WSL key-permission workaround) are in `secret/README.md`.

```bash
# through the tunnel on local port 2223
scp -i /tmp/wcl-backend.pem -P 2223 docker-compose.backend.yml .env.prod.backend ubuntu@127.0.0.1:/srv/wcl/
ssh -i /tmp/wcl-backend.pem -p 2223 ubuntu@127.0.0.1 \
  "cd /srv/wcl && docker compose -f docker-compose.backend.yml up -d"
```

Verify with `curl -s localhost:4000/health` on the instance, then
`https://api.rbuexam.in/health` publicly.

## How updates ship (CI/CD)

Run `./release.sh api` (bumps the version, commits, and pushes an
`api-v*` tag): the `api-docker.yml` workflow typechecks, builds, and
pushes `bhuvneshverma/wclapi` (`latest` + `v<version>`); watchtower on
the instance pulls it within 5 minutes and restarts the container.
Ordinary pushes to `main` no longer deploy anything, so merging is safe
at any time; never cut a release during a live exam window.

## Database migrations

The image contains drizzle-kit and the `drizzle/` folder. To apply new
migrations, run once on the instance:

```bash
docker exec wclapi bunx drizzle-kit migrate
```
