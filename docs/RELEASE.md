# Skill: Releasing services via version control

How this repo turns a version bump into a running container: bump
`package.json`, commit, push an annotated `<service>-v<version>` tag, and let
GitHub Actions build and publish the image to Docker Hub. Deploys to the EC2
instances are then a deliberate `docker compose pull && up -d` away.

The one command that does most of this is `./release.sh` at the repo root.

## The mental model

```
./release.sh api patch
        |
        v
package.json 1.2.3 -> 1.2.4   (npm version --no-git-tag-version)
git commit "chore(api): bump version to v1.2.4"
git tag -a api-v1.2.4
git push origin HEAD api-v1.2.4
        |
        v  (tag push event)
.github/workflows/api-docker.yml
  - bun install + typecheck          (api only; Next apps typecheck in build)
  - read version from package.json   -> v1.2.4
  - docker login (DOCKERHUB_USERNAME / DOCKERHUB_TOKEN secrets)
  - docker build + push
        |
        v
Docker Hub: <user>/wclapi:v1.2.4  AND  <user>/wclapi:latest
        |
        v  (when you choose to deploy)
ssh into EC2 -> docker compose pull -> docker compose up -d
```

Key invariant: **the git tag `<service>-v<version>` always matches an image on
Docker Hub tagged `v<version>`.** If a tag exists in git, its image exists on
Docker Hub. That makes rollback trivial (see below).

## Service-to-artifact map

| Service | Tag pattern | Workflow | Docker Hub repo | Runs on |
|---|---|---|---|---|
| API | `api-v*` | `.github/workflows/api-docker.yml` | `wclapi` | backend EC2 |
| Admin panel | `admin-v*` | `.github/workflows/admin-docker.yml` | `wcladmin` | frontend EC2 |
| Hall-ticket portal | `hallticket-v*` | `.github/workflows/hallticket-docker.yml` | `wclhallticket` | frontend EC2 |
| Result portal | `result-v*` | `.github/workflows/result-docker.yml` | `wclresult` | backend EC2 |

Every image is pushed twice: once as the exact `v<version>` and once as
`latest`. Compose files on the servers reference `latest`; the exact tags are
the audit trail and rollback targets.

Nothing builds or deploys on ordinary pushes to `main`. Releases happen only
on tag pushes (or manual `workflow_dispatch` from the Actions tab). This is
intentional — deploying is a decision, not a side effect of merging.

## Prerequisites

- Clean working tree for the service you're releasing (`git status`).
- Repo secrets set: `DOCKERHUB_USERNAME`, `DOCKERHUB_TOKEN`
  (hub.docker.com -> Account Settings -> Personal access tokens).
- For admin only: the `NEXT_PUBLIC_API_BASE` Actions **variable** (currently
  `https://api.rbuexam.in`). It is baked into the client bundle at *build*
  time, so changing it requires re-releasing admin.
- Bash + Node available locally (the script uses `npm version` and `node -p`).

## Using ./release.sh

```bash
./release.sh api|admin|hallticket|result [patch|minor|major]
```

Bump type defaults to `patch`. Semver shorthand:

- `patch` — bug fixes, no behavior change users depend on (1.2.3 -> 1.2.4)
- `minor` — new features, backwards compatible (1.2.3 -> 1.3.0)
- `major` — breaking changes (1.2.3 -> 2.0.0)

Example session:

```bash
$ ./release.sh api patch
Released api-v1.2.4.
```

What the script does, line by line:

1. Validates the service name against `^(api|admin|hallticket|result)$` and
   the bump against `^(patch|minor|major)$` — fails fast before touching
   anything.
2. `cd app/<service>`.
3. `npm version <bump> --no-git-tag-version` — writes the new version into
   `package.json` without creating its own commit/tag (the script makes them
   itself so it controls the message and tag name).
4. Reads the new version back out of `package.json` with `node -p`.
5. `git add package*.json` — stages `package.json` and, where present,
   `package-lock.json` (the API app is Bun-managed and has none).
6. Commits as `chore(<service>): bump version to v<version>`.
7. Creates annotated tag `<service>-v<version>`.
8. Pushes both the branch HEAD and the tag in one go.

Note the script pushes whatever branch you're currently on (`HEAD`), so run it
from the branch you want released — normally `main`.

## Manual release (what the script automates)

If you ever need to do it by hand:

```bash
cd app/api
npm version patch --no-git-tag-version
git add package*.json
git commit -m "chore(api): bump version to v$(node -p "require('./package.json').version")"
git tag -a "api-v$(node -p "require('./package.json').version")" -m "api release"
git push origin HEAD --tags
```

You can also trigger a rebuild of an existing version from the GitHub Actions
tab ("API Docker image" -> Run workflow) — useful when only the Dockerfile or
a build arg changed and the code version didn't.

## Deploying to the servers

Building the image does not deploy it. On each EC2 instance (see
docs/DEPLOY_BACKEND.md and docs/DEPLOY_FRONTEND.md for connection details):

```bash
cd /srv/wcl
docker compose -f docker-compose.backend.yml pull    # or docker-compose.frontend.yml
docker compose -f docker-compose.backend.yml up -d
docker image prune -f                                # optional cleanup
```

Because compose references `latest`, `pull` fetches exactly the image the last
release produced.

### Rollback

Find the last good tag, then pin it on the server:

```bash
# on the EC2 instance
docker pull <dockerhub-user>/wclapi:v1.2.3
# edit the compose file's image line to :v1.2.3, then:
docker compose -f docker-compose.backend.yml up -d
```

Or, if you just want `latest` to point at an older build again, re-run the
workflow for that tag via `workflow_dispatch` after checking out the old tag —
the image gets rebuilt and re-pushed as `latest`.

To undo a bad release in git itself (rare; usually you roll forward):

```bash
git push origin :refs/tags/api-v1.2.4     # delete remote tag
git tag -d api-v1.2.4                     # delete local tag
git revert <bump-commit-sha>
```

Deleting the tag does not delete the Docker Hub image — remove it from the
hub UI if it must not be pulled.

## Troubleshooting

- **Workflow didn't run after release.sh** — check the tag actually landed:
  `git ls-remote --tags origin | grep api-v`. A typo'd tag pattern silently
  matches nothing; patterns are exact (`api-v*`, not `v*`).
- **Typecheck failed in Actions** — the release tag exists but no image was
  pushed. Fix, then either re-release with a new patch bump or re-run the
  workflow after pushing the fix to the same tag (delete and re-push it).
- **Admin still shows the old API URL** — `NEXT_PUBLIC_API_BASE` is baked at
  build time; verify the Actions variable and re-release admin.
- **Server didn't pick up the new version** — compose caches; confirm with
  `docker inspect --format '{{.Config.Image}} {{.Image}}' <container>` and
  compare the image digest against Docker Hub.
- **Script says "unknown service"** — only the four names above are valid;
  the Electron client releases separately via `release-client.yml` and is not
  covered by this flow.

## Related docs

- docs/DEPLOY_BACKEND.md — backend EC2, ALB routing, env files
- docs/DEPLOY_FRONTEND.md — frontend EC2, TLS, target groups
- docs/AUTO_UPDATE.md — how the Electron client updates itself
- docs/BUILD_CHECKLIST.md — pre-release checks for the desktop client
