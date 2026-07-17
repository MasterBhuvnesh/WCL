<div align="center">

<img src="app/admin/public/assets/wcl.logo.png" alt="WCL" width="96">

# WCL Examination Platform

<img src="https://img.shields.io/badge/-Bun-000000?style=for-the-badge&logo=bun&logoColor=white">
<img src="https://img.shields.io/badge/-Next.js-000000?style=for-the-badge&logo=nextdotjs&logoColor=white">
<img src="https://img.shields.io/badge/-Electron-000000?style=for-the-badge&logo=electron&logoColor=9FEAF9">
<img src="https://img.shields.io/badge/-PostgreSQL-000000?style=for-the-badge&logo=postgresql&logoColor=4169E1">
<img src="https://img.shields.io/badge/-Redis-000000?style=for-the-badge&logo=redis&logoColor=DC382D">
<img src="https://img.shields.io/badge/-AWS-000000?style=for-the-badge&logo=amazonwebservices&logoColor=FF9900">
<img src="https://img.shields.io/badge/-Docker-000000?style=for-the-badge&logo=docker&logoColor=2496ED">

</div>

## About

Monorepo for the WCL examination system: a proctored desktop exam client,
its backend API, an admin panel, and a public hall-ticket portal.

| App | Stack | README |
|---|---|---|
| `app/api` | Bun, Express, Drizzle, Postgres, Redis | [README](app/api/README.md) |
| `app/admin` | Next.js admin panel | [README](app/admin/README.md) |
| `app/hallticket` | Next.js hall-ticket portal | [README](app/hallticket/README.md) |
| `app/client` | Electron kiosk exam client | [README](app/client/README.md) |

## Production

Everything runs in ap-south-1 behind one application load balancer with an
ACM wildcard certificate:

| URL | Service | Instance |
|---|---|---|
| https://rbuexam.in | Hall-ticket portal | `wcl-frontend` (i-0378fc929e8142723, t3.small) |
| https://admin.rbuexam.in | Admin panel | `wcl-frontend` |
| https://api.rbuexam.in | API | `wcl-backend` (i-08da393d608685e37, t3.medium) |

Each instance runs its stack with Docker Compose
(`docker-compose.frontend.yml`, `docker-compose.backend.yml`) plus
watchtower, which pulls new images from Docker Hub after every CI build.
Deployment guides: [docs/DEPLOY_FRONTEND.md](docs/DEPLOY_FRONTEND.md) and
[docs/DEPLOY_BACKEND.md](docs/DEPLOY_BACKEND.md).

## SSH access

The instances accept SSH only through the EC2 Instance Connect Endpoint
tunnel (works over 443, so it also bypasses networks that block port 22).
Keys live in the gitignored `secret/` folder; on WSL copy them to the Linux
filesystem first because keys on the D: drive fail the permission check:

```bash
install -m 600 secret/wcl-frontend.pem /tmp/wcl-frontend.pem
install -m 600 secret/wcl-backend.pem /tmp/wcl-backend.pem
```

Frontend (`wcl-frontend`, admin panel + hall-ticket portal):

```bash
# terminal 1: tunnel (leave running)
aws ec2-instance-connect open-tunnel --region ap-south-1 \
  --instance-connect-endpoint-id eice-05efaf3d6de004931 \
  --instance-id i-0378fc929e8142723 --remote-port 22 --local-port 2222

# terminal 2
ssh -i /tmp/wcl-frontend.pem -p 2222 ubuntu@127.0.0.1
```

Backend (`wcl-backend`, API):

```bash
# terminal 1: tunnel (leave running)
aws ec2-instance-connect open-tunnel --region ap-south-1 \
  --instance-connect-endpoint-id eice-05efaf3d6de004931 \
  --instance-id i-08da393d608685e37 --remote-port 22 --local-port 2223

# terminal 2
ssh -i /tmp/wcl-backend.pem -p 2223 ubuntu@127.0.0.1
```

More detail (scp examples, credentials notes): `secret/README.md`.

## Development

```bash
docker compose up -d          # local Postgres, Redis, Floci (repo root)
cd app/api && bun install && bun run seed --fresh && bun run dev
cd app/admin && bun install && bun run dev        # localhost:5000
cd app/hallticket && bun install && bun run dev   # localhost:5001
cd app/client && bun install && bun run dev
```

Guides live in [docs/](docs/): API reference, new-exam runbook, deployment,
and writing rules (docs/RULES.md) for all prose in this repository.
