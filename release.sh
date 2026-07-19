#!/usr/bin/env bash
# Bump a service version, commit, and tag it. The Docker workflows read the
# package.json version and tag the pushed image v<version>, so the git tag
# <service>-v<version> always matches an image on Docker Hub.
#
# Usage: ./release.sh api|admin|hallticket [patch|minor|major]   (default: patch)
set -euo pipefail

SVC=${1:?usage: release.sh api|admin|hallticket [patch|minor|major]}
[[ "$SVC" =~ ^(api|admin|hallticket)$ ]] || { echo "unknown service: $SVC" >&2; exit 1; }
BUMP=${2:-patch}
[[ "$BUMP" =~ ^(patch|minor|major)$ ]] || { echo "unknown bump type: $BUMP" >&2; exit 1; }

cd "$(dirname "$0")/app/$SVC"
npm version "$BUMP" --no-git-tag-version >/dev/null
V=$(node -p "require('./package.json').version")

# package*.json also stages package-lock.json where it exists (api has none)
git add package*.json
git commit -m "chore($SVC): bump version to v$V"
git tag -a "$SVC-v$V" -m "$SVC v$V"
git push origin HEAD "$SVC-v$V"
echo "Released $SVC-v$V."
