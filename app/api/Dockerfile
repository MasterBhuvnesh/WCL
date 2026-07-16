# WCL exam API. Bun runs TypeScript directly, so there is no build step.
#
#   docker build -t wcl-api .
#   docker run --env-file .env -p 4000:4000 wcl-api
#
# The same image runs the one-off jobs:
#   docker run --rm --env-file .env wcl-api bun run db:migrate
#   docker run --rm --env-file .env -v ./data:/app/data wcl-api bun run import:questions data/questions.sample.xlsx
FROM oven/bun:1-slim
WORKDIR /app

COPY package.json bun.lock ./
# Dev deps stay in: drizzle-kit is needed for `bun run db:migrate` in-container.
RUN bun install --frozen-lockfile

COPY tsconfig.json drizzle.config.ts ./
COPY drizzle ./drizzle
COPY src ./src
COPY scripts ./scripts

ENV NODE_ENV=production
EXPOSE 4000
USER bun
CMD ["bun", "src/index.ts"]
