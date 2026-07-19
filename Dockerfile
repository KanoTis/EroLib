# syntax=docker/dockerfile:1

FROM node:22-bookworm-slim AS base
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@10.30.1 --activate

FROM golang:1.26-bookworm AS live-record-build
WORKDIR /src
COPY apps/live-record/go.mod apps/live-record/go.sum ./
RUN go mod download
COPY apps/live-record/ ./
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/live-record .

FROM base AS build
# .dockerignore keeps context small and excludes host node_modules/dist
COPY . .
# Stale composite tsbuildinfo (if ever present) must not skip declaration emit
RUN find . -name '*.tsbuildinfo' -delete \
  && pnpm install --frozen-lockfile \
  && pnpm --filter @erolib/shared build \
  && test -f packages/shared/dist/index.d.ts \
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
    WEB_DIST_DIR=/app/apps/web/dist \
    LIVE_RECORDER_BIN=/usr/local/bin/live-record
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
COPY --from=live-record-build /out/live-record /usr/local/bin/live-record

RUN mkdir -p /data /media /cache
EXPOSE 8080
CMD ["node", "apps/server/dist/index.js"]
