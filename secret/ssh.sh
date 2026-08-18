#!/usr/bin/env bash
# One-command SSH into a WCL instance: ./secret/ssh.sh backend|frontend
# Opens the EC2 Instance Connect tunnel in the background, connects through
# it, and tears the tunnel down when the SSH session ends.
set -euo pipefail

DIR="$(cd "$(dirname "$0")" && pwd)"
case "${1:-}" in
  backend)  NAME=wcl-backend  PORT=2223 PEM="$DIR/wcl-backend.pem" ;;
  frontend) NAME=wcl-frontend PORT=2222 PEM="$DIR/wcl-frontend.pem" ;;
  *) echo "usage: $0 backend|frontend" >&2; exit 1 ;;
esac

# Instance and endpoint ids change on every rebuild, so resolve them by name
# rather than pinning them here.
ID=$(aws ec2 describe-instances --region ap-south-1 \
  --filters "Name=tag:Name,Values=$NAME" "Name=instance-state-name,Values=running" \
  --query "Reservations[0].Instances[0].InstanceId" --output text)
[ "$ID" = "None" ] && { echo "no running instance tagged $NAME" >&2; exit 1; }

EICE=$(aws ec2 describe-instance-connect-endpoints --region ap-south-1 \
  --query "InstanceConnectEndpoints[?State=='create-complete']|[0].InstanceConnectEndpointId" \
  --output text)
[ "$EICE" = "None" ] && { echo "no Instance Connect Endpoint available" >&2; exit 1; }

# ssh rejects keys on the D: drive (always 0777 under WSL); copy to Linux fs.
KEY=/tmp/wcl-$1.pem
install -m 600 "$PEM" "$KEY"

aws ec2-instance-connect open-tunnel --region ap-south-1 \
  --instance-connect-endpoint-id "$EICE" \
  --instance-id "$ID" --remote-port 22 --local-port "$PORT" &
TUNNEL=$!
trap 'kill $TUNNEL 2>/dev/null' EXIT

# Wait for the tunnel to start listening (up to ~10s).
for _ in $(seq 20); do
  { exec 3<>/dev/tcp/127.0.0.1/$PORT; } 2>/dev/null && { exec 3>&-; break; }
  sleep 0.5
done

ssh -i "$KEY" -p "$PORT" -o StrictHostKeyChecking=accept-new ubuntu@127.0.0.1
