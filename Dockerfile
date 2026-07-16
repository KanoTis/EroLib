# syntax=docker/dockerfile:1

FROM node:22-bookworm-slim AS base
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@10.30.1 --activate

FROM base AS build
# .dockerignore keeps context small and excludes host node_modules/dist
COPY . .
RUN pnpm install --frozen-lockfile \
  && pnpm --filter @erolib/shared build \
  && pnpm --filter @erolib/web build \
  && pnpm --filter @erolib/server build

FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    PORT=8080 \
    HOST=0.0.0.0 \
    DATA_DIR=/data \
    MEDIA_DIR=/media \
    CACHE_DIR=/cache \
    WEB_DIST_DIR=/app/apps/web/dist
LABEL org.opencontainers.image.source=https://github.com/KanoTis/EroLib \
      org.opencontainers.image.description="Self-hosted audio media backup server" \
      org.opencontainers.image.licenses=MIT
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates ffmpeg \
  && rm -rf /var/lib/apt/lists/* \
  && corepack enable && corepack prepare pnpm@10.30.1 --activate

COPY package.json pnpm-workspace.yaml ./
COPY packages/shared/package.json packages/shared/
COPY apps/server/package.json apps/server/
COPY --from=build /app/packages/shared/dist packages/shared/dist
COPY --from=build /app/apps/server/dist apps/server/dist
COPY --from=build /app/apps/web/dist apps/web/dist
COPY --from=build /app/node_modules node_modules
COPY --from=build /app/apps/server/node_modules apps/server/node_modules
COPY --from=build /app/packages/shared/node_modules packages/shared/node_modules

RUN mkdir -p /data /media /cache
EXPOSE 8080
CMD ["node", "apps/server/dist/index.js"]
