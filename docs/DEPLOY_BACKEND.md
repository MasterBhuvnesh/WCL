# Backend deployment (API + observability)

The API runs on a t3.medium EC2 instance behind the same application load
balancer as the frontend. The load balancer terminates TLS and routes by
hostname. The observability stack (Loki, Alloy, Prometheus, Grafana; see
docs/OBSERVABILITY.md) runs on the same instance in the same compose file.

| URL | Service | Container port |
|---|---|---|
| https://api.rbuexam.in | API (Bun/Express) | 4000 |
| https://grafana.rbuexam.in | Grafana | 3000 |

Postgres is RDS (`wcl-db`), Redis is ElastiCache (`wcl-redis`, reachable only
inside the VPC, which the instance is in). Images live on Docker Hub as
`bhuvneshverma/wclapi`. Loki, Alloy, and Prometheus are internal to the
compose network and publish no ports.

How all of this fits together (VPC, security groups, ALB routing, data flows)
is in docs/ARCHITECTURE.md; the Terraform that can rebuild it is in
`terraform/`.

## What exists in AWS (ap-south-1, created 2026-07-17; Grafana 2026-07-21)

| Resource | Identifier |
|---|---|
| EC2 instance `wcl-backend` (t3.medium, Ubuntu 24.04, 20 GB gp3, key pair `wcl-backend`) | `i-08da393d608685e37` |
| Target group `wcl-api` (HTTP 4000, health check `/health`) | rule on the shared ALB: host `api.rbuexam.in` |
| Target group `wcl-grafana` (HTTP 3000, health check `/api/health`) | rule on the shared ALB: host `grafana.rbuexam.in` |
| Security group `wcl-backend-ec2` | 4000, 3000, and 22 accessible only from the ALB / endpoint security group; nothing public |
| Route53 | `api.rbuexam.in` and `grafana.rbuexam.in` A-alias to the `wcl-frontend` ALB |

The ALB, ACM wildcard certificate, and Instance Connect Endpoint are shared
with the frontend; see docs/DEPLOY_FRONTEND.md for those identifiers.
Instance user data installed Docker and created `/srv/wcl`.

## Deployed state (2026-07-21)

The full stack is running: `docker-compose.backend.yml`, `.env.prod.backend`,
and the `observability/` config directory are in `/srv/wcl`, both target
groups are healthy, `https://api.rbuexam.in/health` returns ok, and
`https://grafana.rbuexam.in` serves the provisioned dashboards (WCL API and
WCL Exam Day). The API is at v0.1.3, which added the request middleware and
the `/metrics` endpoint.

## Env files

`.env.prod.backend` (template: `.env.prod.backend.example`) carries the same
keys as `app/api/.env` plus production overrides:

- `NODE_ENV=production`: the server refuses to boot with the development
  JWT_SECRET or ADMIN_PASSWORD in this mode.
- `REDIS_URL` points at the ElastiCache endpoint instead of localhost.
- `METRICS_TOKEN`: bearer token Prometheus sends when scraping `/metrics`.

The compose service loads it with `env_file`. Two derived files also live in
`/srv/wcl`:

- `observability/metrics-token`: the raw token, mounted into Prometheus
  (it cannot read env vars). Regenerate after changing the token:
  `grep '^METRICS_TOKEN=' .env.prod.backend | cut -d= -f2- > observability/metrics-token`
- `.env`: compose interpolation file holding `GRAFANA_ADMIN_PASSWORD`
  (the Grafana admin login).

## Deploying / redeploying

SSH goes through the Instance Connect Endpoint tunnel; the exact commands
(and the WSL key-permission workaround) are in `secret/README.md`.

```bash
# through the tunnel on local port 2223
scp -i /tmp/wcl-backend.pem -P 2223 -r \
  docker-compose.backend.yml .env.prod.backend observability \
  ubuntu@127.0.0.1:/srv/wcl/
ssh -i /tmp/wcl-backend.pem -p 2223 ubuntu@127.0.0.1 \
  "cd /srv/wcl && grep '^METRICS_TOKEN=' .env.prod.backend | cut -d= -f2- > observability/metrics-token && docker compose -f docker-compose.backend.yml up -d"
```

On a fresh instance, also create the interpolation file once:
`echo 'GRAFANA_ADMIN_PASSWORD=<password>' > /srv/wcl/.env`.

Verify with `curl -s localhost:4000/health` on the instance, then
`https://api.rbuexam.in/health` publicly. For the observability side:
`curl -s -H "Authorization: Bearer $METRICS_TOKEN" localhost:4000/metrics`
answers, and https://grafana.rbuexam.in logs in and shows live panels.

## How updates ship (CI/CD)

Run `./release.sh api` (bumps the version, commits, and pushes an
`api-v*` tag): the `api-docker.yml` workflow typechecks, builds, and
pushes `bhuvneshverma/wclapi` (`latest` + `v<version>`); watchtower on
the instance polls Docker Hub every minute, pulls it, and restarts the
container. Ordinary pushes to `main` no longer deploy anything, so merging
is safe at any time; never cut a release during a live exam window.

Only the api container carries the watchtower label; the observability
containers are pinned to fixed image tags and only change when the compose
file is redeployed by hand.

## Database migrations

The image contains drizzle-kit and the `drizzle/` folder. To apply new
migrations, run once on the instance:

```bash
docker exec wclapi bunx drizzle-kit migrate
```
