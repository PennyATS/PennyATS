FROM node:26-bookworm-slim AS build

ENV NEXT_TELEMETRY_DISABLED=1
# Ask next.config.ts for standalone output (used by the runtime stage below).
ENV PENNYATS_STANDALONE=1
WORKDIR /app

RUN npm install --global pnpm@10.28.0
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @pennyats/web build

# Migrations need the source files, migration SQL, and the tsx CLI.
FROM build AS migrate
RUN mkdir -p /app/apps/web/.data/uploads && chown -R node:node /app/apps/web/.data
USER node
CMD ["pnpm", "db:migrate"]

FROM node:26-bookworm-slim AS app

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    HOSTNAME=0.0.0.0 \
    PORT=3000 \
    STORAGE_DIR=/app/apps/web/.data/uploads
WORKDIR /app

COPY --from=build --chown=node:node /app/apps/web/.next/standalone ./
COPY --from=build --chown=node:node /app/apps/web/.next/static ./apps/web/.next/static
COPY --chmod=755 docker/app-start.sh /usr/local/bin/pennyats-start
RUN mkdir -p /app/apps/web/.data/uploads && chown -R node:node /app/apps/web/.data

USER node
EXPOSE 3000
CMD ["pennyats-start"]
