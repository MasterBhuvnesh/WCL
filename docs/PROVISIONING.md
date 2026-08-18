# Provisioning and first deployment

How to take the WCL platform from an empty AWS account to serving traffic.
Terraform builds the infrastructure; the application is deployed separately by
copying the compose files to the two instances. This document covers both
halves and the steps between them.

Region is `ap-south-1` (Mumbai) throughout. The hostnames below use
`rbuexam.in`; substitute your own domain by setting `root_domain` in
`terraform.tfvars`.

Related reading: `terraform/README.md` for what the configuration creates,
`docs/ARCHITECTURE.md` for how the pieces fit together, and
`docs/DEPLOY_BACKEND.md` / `docs/DEPLOY_FRONTEND.md` for the per-service
deployment detail and the CI release flow.

## What you end up with

Two EC2 instances behind one load balancer:

| Instance | Runs | Ports |
|---|---|---|
| `wcl-backend` (t3.medium) | API, Watchtower, Loki, Alloy, Prometheus, Grafana | 4000, 3000 |
| `wcl-frontend` (t3.small) | Admin, hall ticket, result, Watchtower | 5000, 5001, 5002 |

Plus RDS Postgres, ElastiCache Redis, an S3 bucket for question images, an ACM
wildcard certificate, and five Route53 alias records.

## Prerequisites

1. **AWS credentials** for the target account, with permissions for EC2, RDS,
   ElastiCache, ELB, ACM, S3, IAM, and Route53.

   ```bash
   aws configure set region ap-south-1
   aws sts get-caller-identity     # confirm the account before continuing
   ```

2. **Terraform** 1.5 or newer.

3. **A Route53 hosted zone for the domain, already delegated.** Terraform reads
   the zone as a data source and does not create it. This is deliberate: a zone
   destroyed and recreated by Terraform gets new nameservers every cycle, which
   breaks registrar delegation on every iteration.

   ```bash
   aws route53 create-hosted-zone --name rbuexam.in \
     --caller-reference "wcl-$(date +%s)" \
     --query 'DelegationSet.NameServers' --output text
   ```

   Point the registrar at those four nameservers, then confirm public DNS
   agrees before going further:

   ```bash
   nslookup -type=NS rbuexam.in 8.8.8.8
   ```

   **This gates everything.** ACM validates the certificate over public DNS. If
   the domain does not resolve, `aws_acm_certificate_validation` blocks for
   about 45 minutes and then fails, taking the HTTPS listener and therefore the
   whole load balancer with it.

4. **The two SSH private keys** in `secret/`. Terraform uploads their public
   halves, so existing keys keep working after a rebuild:

   ```bash
   ssh-keygen -y -f secret/wcl-backend.pem
   ssh-keygen -y -f secret/wcl-frontend.pem
   ```

## 1. Provision the infrastructure

Create `terraform.tfvars` from the example. It is gitignored and must never be
committed; it holds the database password.

```bash
cd terraform
cp terraform.tfvars.example terraform.tfvars
```

Fill in `rds_master_password` and the two public keys from the previous step.
Override `root_domain` and `images_bucket` if you are not using the defaults.
S3 bucket names are globally unique across all of AWS, so a rebuild in a
different account usually needs a new one.

```bash
terraform init
terraform plan -out=tfplan
terraform apply tfplan
```

Expect roughly 10 to 15 minutes. RDS takes about 6 minutes and the Instance
Connect Endpoint about 3, and they run in parallel.

Read the outputs when it finishes:

```bash
terraform output
terraform output -raw uploader_secret_access_key
```

Keep the endpoints and the uploader key pair; the next step needs them.

## 2. Reach the instances (Instance Connect tunnel)

There is no public SSH. Port 22 is admitted only from the Instance Connect
Endpoint's security group, so the internet cannot reach it. The endpoint
tunnels SSH over 443, which also works from networks that block port 22.

The tunnel is a foreground process. Open it in one terminal and leave it
running, then use a second terminal for `ssh` and `scp` against `127.0.0.1`.

**Terminal 1, backend tunnel on local port 2223:**

```bash
aws ec2-instance-connect open-tunnel --region ap-south-1 \
  --instance-connect-endpoint-id "$(terraform -chdir=terraform output -raw instance_connect_endpoint_id)" \
  --instance-id "$(terraform -chdir=terraform output -raw backend_instance_id)" \
  --remote-port 22 --local-port 2223
```

**Terminal 1 (or a third), frontend tunnel on local port 2222:**

```bash
aws ec2-instance-connect open-tunnel --region ap-south-1 \
  --instance-connect-endpoint-id "$(terraform -chdir=terraform output -raw instance_connect_endpoint_id)" \
  --instance-id "$(terraform -chdir=terraform output -raw frontend_instance_id)" \
  --remote-port 22 --local-port 2222
```

**Terminal 2, connect through the tunnel.** SSH refuses keys that are readable
by other users, and permissions on the Windows D: drive do not satisfy it, so
copy each key somewhere with correct modes first:

```bash
install -m 600 secret/wcl-backend.pem /tmp/wcl-backend.pem
install -m 600 secret/wcl-frontend.pem /tmp/wcl-frontend.pem

ssh -i /tmp/wcl-backend.pem -p 2223 ubuntu@127.0.0.1     # backend
ssh -i /tmp/wcl-frontend.pem -p 2222 ubuntu@127.0.0.1    # frontend
```

The host key changes on every rebuild, and both instances answer on
`127.0.0.1`, so add these to avoid known-hosts conflicts on a fresh stack:

```bash
-o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null
```

### The shorter route

`secret/ssh.sh` wraps all of the above: it resolves the instance and endpoint
ids, opens the tunnel, waits for it to listen, connects, and tears the tunnel
down when the session ends.

```bash
./secret/ssh.sh backend
./secret/ssh.sh frontend
```

`secret/redis.sh` does the same and forwards ElastiCache to `localhost:6380`,
so `redis-cli -p 6380` reaches production Redis. Postgres is reachable the same
way through an `ssh -L` forward.

Both scripts look the identifiers up by name at run time rather than storing
them, so they keep working after a rebuild changes every id. They live in the
gitignored `secret/` directory alongside the private keys, so on a machine that
does not have that directory, use the explicit commands above.

Confirm the bootstrap ran before deploying. User data installs Docker and
creates the deploy directory:

```bash
docker --version && docker compose version && ls -ld /srv/wcl
```

## 3. Fill in the environment files

Both files are gitignored. Copy the examples and fill them from the Terraform
outputs.

```bash
cp .env.prod.backend.example .env.prod.backend
cp .env.prod.frontend.example .env.prod.frontend
```

`.env.prod.backend` needs:

| Key | Value |
|---|---|
| `DATABASE_URL` | `postgres://postgres:<password>@<rds_endpoint>/postgres?sslmode=require` |
| `REDIS_URL` | `redis://<redis_endpoint>` |
| `S3_BUCKET` | the `images_bucket` output |
| `S3_REGION` | `ap-south-1` |
| `S3_ENDPOINT` | `https://s3.ap-south-1.amazonaws.com` |
| `S3_ACCESS_KEY_ID` | the `uploader_access_key_id` output |
| `S3_SECRET_ACCESS_KEY` | the `uploader_secret_access_key` output |
| `NODE_ENV` | `production` |
| `JWT_SECRET`, `ADMIN_PASSWORD` | long random values, not the development defaults |
| `METRICS_TOKEN` | long random value, used by Prometheus |

The password in `DATABASE_URL` must match `rds_master_password` in
`terraform.tfvars`. `env_file` values are read literally by compose, so
characters such as `$` need no escaping.

`.env.prod.frontend` needs only `DATABASE_URL`, the same value. The hall ticket
and result portals read the database directly and never call the API.

The admin panel's API URL is **not** here. `NEXT_PUBLIC_API_BASE` is inlined
into the client bundle at build time, so it comes from the CI repository
variable of that name and cannot be changed at run time. Setting it in an env
file has no effect.

## 4. Copy the deployment artifacts

With the tunnels open:

```bash
# Backend
scp -i /tmp/wcl-backend.pem -P 2223 -r \
  docker-compose.backend.yml .env.prod.backend observability \
  ubuntu@127.0.0.1:/srv/wcl/

# Frontend
scp -i /tmp/wcl-frontend.pem -P 2222 \
  docker-compose.frontend.yml .env.prod.frontend \
  ubuntu@127.0.0.1:/srv/wcl/
```

## 5. Create the two derived files on the backend

Neither is generated by Terraform or shipped in the repository.

```bash
ssh -i /tmp/wcl-backend.pem -p 2223 ubuntu@127.0.0.1
cd /srv/wcl

# Grafana admin login, read by compose interpolation
echo 'GRAFANA_ADMIN_PASSWORD=<generate a strong value>' > .env

# Prometheus cannot read environment variables, so the token is mounted
grep '^METRICS_TOKEN=' .env.prod.backend | cut -d= -f2- > observability/metrics-token

chmod 600 .env observability/metrics-token
```

Record the Grafana password somewhere durable. It exists only on the instance
and is lost with it.

## 6. Start the stacks

```bash
# Backend: API, Watchtower, Loki, Alloy, Prometheus, Grafana
ssh -i /tmp/wcl-backend.pem -p 2223 ubuntu@127.0.0.1 \
  "cd /srv/wcl && docker compose -f docker-compose.backend.yml up -d"

# Frontend: admin, hall ticket, result, Watchtower
ssh -i /tmp/wcl-frontend.pem -p 2222 ubuntu@127.0.0.1 \
  "cd /srv/wcl && docker compose -f docker-compose.frontend.yml up -d"
```

## 7. Apply the database migrations

**On a fresh database the API crash-loops until this runs.** It queries the
`admins` table during bootstrap and exits with
`PostgresError: relation "admins" does not exist`. Because the container is
restarting, `docker exec` is unreliable, so use a one-off container instead:

```bash
ssh -i /tmp/wcl-backend.pem -p 2223 ubuntu@127.0.0.1 \
  "cd /srv/wcl && docker run --rm --env-file .env.prod.backend \
     bhuvneshverma/wclapi:latest bunx drizzle-kit migrate"
```

Then restart the API:

```bash
ssh -i /tmp/wcl-backend.pem -p 2223 ubuntu@127.0.0.1 \
  "cd /srv/wcl && docker compose -f docker-compose.backend.yml restart api"
```

Against an already-running container the documented form still applies:

```bash
docker exec wclapi bunx drizzle-kit migrate
```

On first boot against an empty database with `NODE_ENV=production`, the API
creates the administrator account and the exam itself from `ADMIN_EMAIL`,
`ADMIN_PASSWORD`, and the `EXAM_*` values. Existing rows are never updated, so
changing those later has no effect.

## 8. Verify

On the instances:

```bash
docker ps                                  # every container Up
curl -s localhost:4000/health              # backend
curl -s -o /dev/null -w '%{http_code}\n' localhost:3000/api/health   # Grafana
curl -s -o /dev/null -w '%{http_code}\n' localhost:5001              # hall ticket
```

All five target groups should report healthy:

```bash
for tg in wcl-api wcl-grafana wcl-admin wcl-hallticket wcl-result; do
  ARN=$(aws elbv2 describe-target-groups --names $tg \
        --query "TargetGroups[0].TargetGroupArn" --output text)
  printf "%-16s " "$tg"
  aws elbv2 describe-target-health --target-group-arn "$ARN" \
    --query "TargetHealthDescriptions[0].TargetHealth.State" --output text
done
```

Then publicly:

```bash
curl -s -o /dev/null -w '%{http_code}\n' https://rbuexam.in/
curl -s https://api.rbuexam.in/health
curl -s -o /dev/null -w '%{http_code} -> %{redirect_url}\n' http://rbuexam.in/
```

Expect 200 at the apex (hall ticket), a health payload from the API, and a 301
from HTTP to HTTPS. The admin panel answers 307 and redirects to `/admin`, and
`https://api.rbuexam.in/` answers 404 because candidate routes are mounted at
specific paths rather than the root. Both are correct.

## Troubleshooting

**Provider checksum failures on Windows.** `terraform plan` or `apply` fails
with "the cached package for registry.terraform.io/hashicorp/aws does not match
any of the checksums recorded in the dependency lock file", often minutes after
a successful run. Real-time antivirus rewriting the 700 MB provider binary is
the usual cause. Repair with:

```bash
terraform init -upgrade
```

Excluding the `terraform/.terraform` directory from antivirus scanning prevents
it recurring. If the lock file genuinely lacks your platform, record it once:

```bash
terraform providers lock -platform=windows_amd64 -platform=linux_amd64
```

**The admin target group reports `Target.ResponseCodeMismatch`.** The panel
redirects `/` to `/admin`, so a health check expecting exactly 200 sees a 307
and never passes. The configuration sets `matcher = "200-399"` on that target
group for this reason. Note that a load balancer routes to every target when
*all* targets in a group are unhealthy, so a broken check of this kind can hide
behind that fallback rather than causing a visible outage.

**Targets report unhealthy right after `apply`.** Expected. The instances exist
before any container does, and the API is unhealthy until the migrations in
step 7 have run. Re-check after starting the stacks.

**Saved plan files are sensitive.** A `tfplan` embeds the variable values it was
created with, including the database password, so it is as sensitive as state.
`terraform/.gitignore` excludes `tfplan`, `*.tfplan`, and `plan.json` alongside
`*.tfstate` and `terraform.tfvars`.

## Tearing down

```bash
cd terraform
terraform destroy
```

The hosted zone survives, since Terraform only reads it. Note that
`skip_final_snapshot` is `true` on the database, so a destroy takes no final
snapshot. Take one by hand first if the data matters:

```bash
aws rds create-db-snapshot --region ap-south-1 \
  --db-instance-identifier wcl-db \
  --db-snapshot-identifier wcl-db-final-$(date +%Y%m%d)
```

Objects in the images bucket are not removed by `destroy` while the bucket is
non-empty; empty it first with `aws s3 rm s3://<bucket> --recursive`.
