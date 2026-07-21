# WCL infrastructure (Terraform)

This codifies the AWS infrastructure the WCL exam system runs on, so the whole
stack can be rebuilt from one `terraform apply`. It mirrors what was originally
created by hand with the AWS CLI (see the personal `docs/AWSCLI.md`) in region
`ap-south-1`.

It provisions **infrastructure only**. It does not deploy the application:
container images ship through Docker Hub and watchtower, and the compose files
plus `.env` files are copied to the instances separately (see
`docs/DEPLOY_BACKEND.md` and `docs/DEPLOY_FRONTEND.md`).

For how the pieces fit together (VPC, subnets, security-group rules, the load
balancer, and the request data flows), read `docs/ARCHITECTURE.md`.

## What it creates

| Area | Resources |
|---|---|
| Networking | 4 security groups, EC2 Instance Connect Endpoint (uses the default VPC and subnets) |
| Compute | 2 EC2 instances (`wcl-backend` t3.medium, `wcl-frontend` t3.small), 2 key pairs, Docker installed via user-data |
| Data | RDS Postgres `wcl-db`, ElastiCache Redis `wcl-redis` |
| Storage | S3 `wcl-images` (public read) + least-privilege IAM uploader |
| TLS | ACM wildcard certificate `rbuexam.in` + `*.rbuexam.in`, DNS-validated |
| Routing | ALB `wcl-frontend`, 4 target groups, HTTP to HTTPS redirect, host-header rules |
| DNS | A-alias records for apex, `admin`, `api`, `grafana` |

The Route53 hosted zone for the domain is assumed to already exist; it is read
as a data source, not created.

## Layout

```
versions.tf     provider + required versions (state backend note)
variables.tf    inputs and shared tags
data.tf         default VPC/subnets, Ubuntu AMI, hosted zone
network.tf      security groups + Instance Connect Endpoint
compute.tf      key pairs + EC2 instances
database.tf     RDS + ElastiCache
storage.tf      S3 bucket + IAM uploader
acm.tf          wildcard certificate + DNS validation
alb.tf          load balancer, target groups, listeners, rules
dns.tf          A-alias records
outputs.tf      endpoints, ids, uploader credentials
user-data.sh    instance bootstrap (Docker + /srv/wcl)
```

## Usage

```bash
cd terraform
cp terraform.tfvars.example terraform.tfvars   # fill in password + public keys
terraform init
terraform plan
terraform apply
```

Required variables (`terraform.tfvars`):

- `rds_master_password`: the Postgres master password. It must match
  `DATABASE_URL` in `.env.prod.backend`.
- `backend_public_key` / `frontend_public_key`: the public halves of the two
  SSH key pairs. Derive them from the existing private keys:
  `ssh-keygen -y -f ../secret/wcl-backend.pem` and
  `ssh-keygen -y -f ../secret/wcl.pem`.

## After apply

1. Read the outputs: `terraform output` (RDS and Redis endpoints, instance ids,
   uploader access key). `terraform output -raw uploader_secret_access_key` for
   the secret.
2. Fill `.env.prod.backend` and `.env.prod.frontend` from those endpoints and
   keys, then copy them plus the compose files to `/srv/wcl` on each instance
   and run `docker compose ... up -d` (deploy docs have the exact commands).
3. Apply database migrations once: `docker exec wclapi bunx drizzle-kit migrate`.

## Important: this rebuilds, it does not adopt the live stack

Running `apply` against the account that already holds the live resources will
fail on name clashes (`wcl-db`, `wcl-frontend`, the security groups, and so on
must be unique). This config is meant for a clean rebuild, for example in a new
account or after teardown.

To bring the current live resources under Terraform instead, `terraform import`
each one before applying, for example:

```bash
terraform import aws_instance.backend i-08da393d608685e37
terraform import aws_db_instance.postgres wcl-db
terraform import aws_lb.main arn:aws:elasticloadbalancing:ap-south-1:377329306779:loadbalancer/app/wcl-frontend/a13824d6232a2f35
```

The identifiers for every resource are in `docs/AWSCLI.md`.

## Notes

- The instance AMI ignores drift (`lifecycle.ignore_changes = [ami]`), so a
  newer Ubuntu image published by Canonical does not trigger a replacement of a
  running box.
- RDS is `publicly_accessible = true` to match the live instance; the security
  group is what keeps it private (no public ingress). Tighten to `false` on a
  clean rebuild if you never tunnel to it from outside the VPC.
- State is local (`terraform.tfstate`, gitignored). Uncomment the S3 backend in
  `versions.tf` to share it.
