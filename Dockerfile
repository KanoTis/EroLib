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

# BtbN GPL static build (includes libmp3lame for Erovoice). Not LGPL, not apt ffmpeg.
# Override: docker build --build-arg FFMPEG_URL=...
FROM debian:bookworm-slim AS ffmpeg-fetch
ARG FFMPEG_URL=https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-linux64-gpl.tar.xz
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl xz-utils \
  && rm -rf /var/lib/apt/lists/* \
  && curl -fsSL -o /tmp/ffmpeg.tar.xz "${FFMPEG_URL}" \
  && mkdir -p /tmp/ffmpeg-src \
  && tar -xJf /tmp/ffmpeg.tar.xz -C /tmp/ffmpeg-src --strip-components=1 \
  && install -m 0755 /tmp/ffmpeg-src/bin/ffmpeg /out-ffmpeg \
  && /out-ffmpeg -version \
  && /out-ffmpeg -hide_banner -encoders 2>/dev/null | grep -q libmp3lame \
  && rm -rf /tmp/ffmpeg.tar.xz /tmp/ffmpeg-src

FROM base AS build
# .dockerignore keeps context small and excludes host node_modules/dist
COPY . .
# Stale composite tsbuildinfo (if ever present) must not skip declaration emit
RUN find . -name '*.tsbuildinfo' -delete \
  && pnpm install --frozen-lockfile \
  && pnpm --filter @erolib/shared build \
  && test -f packages/shared/dist/index.d.ts \
  && pnpm --filter @erolib/web build \
  && pnpm --filter @erolib/server build \
  # Portable prod tree for @erolib/server (no monorepo devDeps / web toolchain).
  # --legacy: pnpm v10 deploy without inject-workspace-packages (local workspace stays link-based).
  # Use a path under WORKDIR so deploy resolves cleanly in the Linux build container.
  && pnpm --filter @erolib/server deploy --prod --legacy /app/deploy-out \
  && mkdir -p /out \
  && mv /app/deploy-out /out/server \
  && find /out/server -type f \( -name '*.map' -o -name '*.d.ts' \) -delete \
  && (rm -rf /out/server/src /out/server/test /out/server/scripts \
    /out/server/data /out/server/media /out/server/cache \
    /out/server/.tmp-research /out/server/tsconfig.json 2>/dev/null || true)

FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    PORT=8080 \
    HOST=0.0.0.0 \
    DATA_DIR=/data \
    MEDIA_DIR=/media \
    CACHE_DIR=/cache \
    WEB_DIST_DIR=/app/web/dist \
    LIVE_RECORDER_BIN=/usr/local/bin/live-record \
    FFMPEG_PATH=/usr/local/bin/ffmpeg
LABEL org.opencontainers.image.source=https://github.com/KanoTis/EroLib \
      org.opencontainers.image.description="Self-hosted audio media backup server" \
      org.opencontainers.image.licenses=MIT
# ca-certificates only — ffmpeg is a static BtbN binary (no apt media stack)
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates \
  && rm -rf /var/lib/apt/lists/*

# Prod-only server tree from pnpm deploy (package.json + dist + node_modules)
COPY --from=build /out/server/ /app/
# SPA assets (not part of server package)
COPY --from=build /app/apps/web/dist /app/web/dist
COPY --from=live-record-build /out/live-record /usr/local/bin/live-record
COPY --from=ffmpeg-fetch /out-ffmpeg /usr/local/bin/ffmpeg

RUN mkdir -p /data /media /cache
EXPOSE 8080
CMD ["node", "dist/index.js"]
