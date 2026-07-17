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

Complete platform for conducting the WCL proctored examination: candidates
sit the exam in a locked-down desktop client, administrators manage
questions, participants, and live results from a web panel, and candidates
download their hall tickets from a public portal beforehand. A single API
backs all three, with Postgres for persistent data and Redis for live exam
state.

## Applications

| App | What it does | README |
|---|---|---|
| `app/api` | Bun/Express API: auth, exam sessions, grading, live admin feed | [README](app/api/README.md) |
| `app/admin` | Next.js admin panel: questions, participants, monitoring, results | [README](app/admin/README.md) |
| `app/hallticket` | Next.js public portal: hall-ticket lookup and PDF download | [README](app/hallticket/README.md) |
| `app/client` | Electron kiosk client the candidates take the exam in | [README](app/client/README.md) |

## Production

| URL | Service |
|---|---|
| https://rbuexam.in | Hall-ticket portal |
| https://admin.rbuexam.in | Admin panel |
| https://api.rbuexam.in | API |

Each service ships as a Docker image built by GitHub Actions and runs on EC2
behind an application load balancer; watchtower rolls out new images
automatically after every push to main.

## Documentation

| Document | Contents |
|---|---|
| [docs/API.md](docs/API.md) | API reference |
| [docs/NEW_EXAM.md](docs/NEW_EXAM.md) | Runbook for setting up a new exam |
| [docs/DEPLOY_FRONTEND.md](docs/DEPLOY_FRONTEND.md) | Frontend infrastructure and deployment |
| [docs/DEPLOY_BACKEND.md](docs/DEPLOY_BACKEND.md) | Backend infrastructure and deployment |
| [docs/RULES.md](docs/RULES.md) | Writing rules for all prose in this repository |
