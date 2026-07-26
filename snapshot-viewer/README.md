# Snapshot Viewer

Runs a local copy of the production database from `wcl-snapshot.dump` and serves
it through Prisma Studio in the browser. It is a throwaway copy. Production is
never touched.

## Contents

- `docker-compose.yml` - two services: `db` (Postgres 18) and `studio` (Prisma Studio).
- `restore.sh` - one-time init hook that restores the dump into `db` on first boot.
- `prisma/schema.prisma` - datasource only. `prisma db pull` fills in the models by introspecting the DB.
- `wcl-snapshot.dump` - the pg_dump custom-format snapshot. Gitignored, holds real PII, do not commit.

## Prerequisites

Docker Desktop running. Nothing else to install.

## Run

From this folder:

```
docker compose up -d
```

First run pulls images, restores the dump, installs Prisma, and introspects the
schema, so it takes a couple of minutes. Watch progress with:

```
docker compose logs -f studio
```

When the log shows `Prisma Studio is up on http://localhost:5555`, open:

- Prisma Studio: http://localhost:5555
- Postgres direct: `localhost:5433`, database `postgres`, user `postgres`, password `local`

Click any model in the left sidebar to browse rows.

## Stop

```
docker compose down       # stop, keep the restored data
docker compose down -v     # stop and wipe the DB; next `up` re-restores from the dump
```

## Refresh the snapshot from production

Re-dump, replacing the file here, then recreate the DB:

```
docker run --rm -v "D:\Projects\WCL\snapshot-viewer:/out" -v "D:\Projects\WCL\app\api:/api" postgres:18 \
  sh -c 'DBURL=$(grep ^DATABASE_URL= /api/.env | cut -d= -f2-); pg_dump "$DBURL" -Fc -f /out/wcl-snapshot.dump'

docker compose down -v && docker compose up -d
```

## Notes

- Prisma is pinned to v6. Prisma v7 removed `url` from the schema and needs a
  separate config file. v6 avoids that. The upgrade nag in the logs can be ignored.
- The only credential here is the throwaway `local` password for the local
  container. The dump file is the sensitive part and stays gitignored.
