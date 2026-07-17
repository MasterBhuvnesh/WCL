# Build with Bun, run the standalone Next server on Node.
FROM oven/bun:1-slim AS build
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
COPY . .
# NEXT_PUBLIC_* values are inlined into the client bundle at build time, so
# the public API URL must be provided here, not at run time.
ARG NEXT_PUBLIC_API_BASE=https://api.rbuexam.in/
ENV NEXT_PUBLIC_API_BASE=$NEXT_PUBLIC_API_BASE
RUN bun run build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production PORT=5000 HOSTNAME=0.0.0.0
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public
USER node
EXPOSE 5000
CMD ["node", "server.js"]
