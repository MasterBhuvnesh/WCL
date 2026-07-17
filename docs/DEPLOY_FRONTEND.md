# Frontend deployment (admin panel + hall-ticket portal)

The admin panel and the hall-ticket portal run together on one EC2 instance
behind an AWS application load balancer. The load balancer terminates TLS and
routes by hostname:

| URL | Service | Container port |
|---|---|---|
| https://rbuexam.in | Hall-ticket portal | 5001 |
| https://admin.rbuexam.in | Admin panel | 5000 |

The API runs on a separate instance (not covered here). The certificate is a
wildcard, so https://api.rbuexam.in can reuse it later.

## What exists in AWS (all in ap-south-1, account 377329306779)

Created with the AWS CLI on 2026-07-17:

| Resource | Identifier |
|---|---|
| ACM certificate (rbuexam.in + *.rbuexam.in, DNS validated, ISSUED) | `arn:aws:acm:ap-south-1:377329306779:certificate/deae6a2d-5e7c-4803-9dd9-88fd8639bb13` |
| EC2 instance `wcl-frontend` (t3.small, Ubuntu 24.04, 20 GB gp3, key pair `wcl`) | `i-0378fc929e8142723` |
| Application load balancer `wcl-frontend` | `wcl-frontend-1528159323.ap-south-1.elb.amazonaws.com` |
| Target group `wcl-hallticket` (HTTP 5001) | default action of the HTTPS listener |
| Target group `wcl-admin` (HTTP 5000) | listener rule: host `admin.rbuexam.in` |
| Security group `wcl-frontend-alb` | 80 and 443 open to the internet |
| Security group `wcl-frontend-ec2` | 5000 and 5001 accessible only from the ALB security group |
| Route53 | `rbuexam.in` and `admin.rbuexam.in` are A-alias records to the ALB; the ACM validation CNAME also lives in the zone |
| Instance Connect Endpoint | `eice-05efaf3d6de004931` (SSH over 443 for networks that block port 22) |

The HTTP listener (port 80) permanently redirects to HTTPS. The instance has
no SSH ingress rule; connect with EC2 Instance Connect from the AWS console,
or add your own IP to `wcl-frontend-ec2` for port 22.

Instance user data installed Docker Engine and the compose plugin, added the
`ubuntu` user to the `docker` group, and created `/srv/wcl` as the deploy
directory.

## Deployed state (2026-07-17)

The stack is already running: `docker-compose.frontend.yml` and
`.env.prod.frontend` live in `/srv/wcl` on the instance, both target groups
report healthy, and both public URLs serve over HTTPS. The images currently
on Docker Hub were built locally; the admin image is baked with
`NEXT_PUBLIC_API_BASE=http://localhost:4000` as a placeholder until the API
instance exists.

To redeploy from scratch:

1. Copy the compose file and the env file to the instance:

   ```bash
   scp docker-compose.frontend.yml .env.prod.frontend ubuntu@13.234.119.97:/srv/wcl/
   ```

   If your network blocks outbound port 22, tunnel through the Instance
   Connect Endpoint first and use `-P 2222` against 127.0.0.1:

   ```bash
   aws ec2-instance-connect send-ssh-public-key --region ap-south-1 \
     --instance-id i-0378fc929e8142723 --instance-os-user ubuntu \
     --ssh-public-key file://~/.ssh/id_ed25519.pub
   aws ec2-instance-connect open-tunnel --region ap-south-1 \
     --instance-connect-endpoint-id eice-05efaf3d6de004931 \
     --instance-id i-0378fc929e8142723 --remote-port 22 --local-port 2222 &
   ```

2. `.env.prod.frontend` (template: `.env.prod.frontend.example`) holds the
   only runtime setting, `DATABASE_URL` for the hall-ticket portal. Both
   containers load it via `env_file`. The admin panel's API URL is baked into
   the image at build time (see CI below), not read from this file.

3. Start the stack:

   ```bash
   cd /srv/wcl
   docker compose -f docker-compose.frontend.yml up -d
   ```

4. Verify: `curl -s localhost:5001` and `curl -s localhost:5000` answer, the
   target groups report healthy in the EC2 console, and the public URLs load
   over HTTPS.

## How updates ship (CI/CD)

1. Push to `main` touching `app/admin/**` or `app/hallticket/**`.
2. GitHub Actions (`admin-docker.yml`, `hallticket-docker.yml`) builds the
   image and pushes `bhuvneshverma/wcladmin` or `bhuvneshverma/wclhallticket`
   with the `latest` and `v<version>` tags.
3. Watchtower on the instance polls Docker Hub every 5 minutes, pulls the new
   `latest`, restarts the container, and removes the old image.

No manual step is needed after the push. To roll back, `docker compose pull`
is skipped and the container is started from a `v<version>` tag instead.

The admin workflow bakes the repository variable `NEXT_PUBLIC_API_BASE`
(GitHub: Settings, Secrets and variables, Actions, Variables tab) into the
client bundle. Set it to the public API URL, for example
`https://api.rbuexam.in`, and re-run the workflow whenever it changes.

## Notes

- The app ports are not reachable from the internet; only the load balancer
  can reach 5000/5001. All public traffic is HTTPS.
- Watchtower briefly restarts a container during an update. Avoid pushing
  frontend changes during a live exam window.
- The load balancer is the only always-on cost besides the instance
  (roughly USD 18 per month plus traffic).
