#!/usr/bin/env bash
# Instance bootstrap: install Docker Engine + the compose plugin, let the
# ubuntu user run docker, and create the deploy directory. The compose file
# and .env are copied in afterwards (see docs/DEPLOY_BACKEND.md /
# docs/DEPLOY_FRONTEND.md); this only prepares the host.
set -euxo pipefail

export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y ca-certificates curl

install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
chmod a+r /etc/apt/keyrings/docker.asc

echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] \
  https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
  > /etc/apt/sources.list.d/docker.list

apt-get update
apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

usermod -aG docker ubuntu
systemctl enable --now docker

mkdir -p /srv/wcl
chown ubuntu:ubuntu /srv/wcl
