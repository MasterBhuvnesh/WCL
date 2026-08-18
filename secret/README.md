# secret/

Access material for the WCL deployment, plus the helper used to reach the
instances.

Almost everything here is gitignored. The two exceptions are this file and
`ssh.sh`, which contain no private material. **The SSH private keys are never
committed**, and `.gitignore` re-excludes `*.pem` and `*.key` after the
exceptions specifically so a stray `git add secret/` cannot pick them up.

## Files

| File | Committed | Purpose |
|---|---|---|
| `ssh.sh` | yes | Opens a tunnel and connects to an instance |
| `README.md` | yes | This file |
| `redis.sh` | no | Forwards production Redis to `localhost:6380` |
| `wcl-backend.pem` | never | SSH key for the backend instance, key pair `wcl-backend` |
| `wcl-frontend.pem` | never | SSH key for the frontend instance, key pair `wcl` |

If you have cloned this repository without the keys, you cannot reach the
instances. Terraform uploads the public halves of these two key pairs when it
builds the stack, so whoever provisioned it holds the private halves.

## Connecting

From the repository root:

```bash
./secret/ssh.sh backend     # API, Grafana, and the observability stack
./secret/ssh.sh frontend    # admin panel, hall ticket, result portal
```

The script resolves the instance and the Instance Connect Endpoint by name,
copies the key somewhere with acceptable permissions, opens the tunnel, waits
for it to listen, connects, and closes the tunnel when the session ends.

Nothing is pinned to an instance id, so the script keeps working after a
rebuild replaces every identifier. It only requires that the instances carry
their usual `Name` tags, which Terraform sets.

Local ports 2223 (backend) and 2222 (frontend) must be free. If a previous
tunnel is still running, the script cannot bind and the connection fails.

## Why a tunnel is needed

The instances have no public SSH. Port 22 is admitted only from the EC2
Instance Connect Endpoint's security group, so the internet cannot reach it at
all. The endpoint carries SSH over 443, which also works from networks that
block outbound port 22.

The same tunnel is the only route to RDS and ElastiCache, since both are closed
to everything outside the VPC. `redis.sh` uses it to forward Redis to
`localhost:6380` for `redis-cli`; Postgres works the same way with an `ssh -L`
forward.

## Note for WSL and Windows

SSH refuses a private key that other users can read, and files on the D: drive
report `0777` regardless of what you set. Copy the key to the Linux filesystem
first. `ssh.sh` already does this:

```bash
install -m 600 secret/wcl-backend.pem /tmp/wcl-backend.pem
```

## Related

`docs/PROVISIONING.md` documents the explicit tunnel commands for a machine
that does not have this directory, along with the full rebuild and deployment
runbook.
