# Erolib — Self-hosted voice media backup library

**English** | [中文](README.zh-CN.md) | [日本語](README.ja.md)

Self-hosted with Docker: sync favorites from **Otobanana / Koe-koe / Erovoice** to local storage, browse and play in the browser; supports **Otobanana live subscription and recording**.

## Features

| Module | Description |
|------|------|
| Providers | Configure accounts for the three sites (password or Cookie); credentials stored AES-encrypted |
| Sync | Scheduled / manual pull of favorites, then enqueue downloads |
| Library | Local work list (paginated), detail, cover art, and audio playback; metadata refresh supported |
| Download jobs | Inspect queue status; retry failures from work detail |
| Live | Otobanana following live, history streamers, subscription recording, playback |
| Settings | Runtime options such as sync interval (reschedules after save) |
| Auth | Optional local login (enabled when `AUTH_PASSWORD` is non-empty) |

Global bottom player: shared by library works and live replays; continues across route changes.

Unfavoriting remotely **does not delete** local files; it only marks “remote favorite = no”.

## Quick start (Docker)

```bash
# 1. Edit docker-compose.yml
#    - CREDENTIALS_SECRET: required, random string ≥16 chars (do not use sample values)
#    - AUTH_PASSWORD: optional; non-empty enables login (AUTH_USERNAME defaults to admin)

# 2. If the GHCR package is private, log in first (token needs read:packages)
# echo YOUR_PAT | docker login ghcr.io -u YOUR_GITHUB_USER --password-stdin

docker compose pull
docker compose up -d
curl -sS http://localhost:8080/api/health
# Open http://localhost:8080 in a browser
```

- Default image: `ghcr.io/kanotis/erolib:latest` (built and pushed by GitHub Actions)
- Build from source: use `build: .` in `docker-compose.yml` (optionally `image: erolib:local`), then `docker compose up -d --build`
- Compose sets `init: true` (reaps child processes); image includes Go `live-record` and **BtbN static GPL ffmpeg** (with `libmp3lame`, not the full apt stack)

### Volume mounts

| Container path | Host example | Description |
|---------|-----------|------|
| `/data` | `./data` | SQLite `app.db`, sessions, etc. |
| `/media` | `./media` | Completed backups: `{provider}/{authorId}/{workId}/`; live: `{provider}/live/...` |
| `/cache` | `./cache` | Download temp files (safe to clear) |

### Environment variables

| Variable | Default | Description |
|------|------|------|
| `PORT` / `HOST` | `8080` / `0.0.0.0` | Listen address |
| `AUTH_USERNAME` | `admin` | Login username |
| `AUTH_PASSWORD` | empty | Empty **disables auth**; do not expose on public networks |
| `CREDENTIALS_SECRET` | (weak dev default) | Encrypts provider credentials, **≥16 chars**; change for production |
| `DATA_DIR` / `MEDIA_DIR` / `CACHE_DIR` | `/data` etc. | Data and media paths |
| `SYNC_INTERVAL_HOURS` | `4` | Auto-sync interval (hours) |
| `MAX_DOWNLOAD_CONCURRENCY` | `2` | VOD download concurrency |
| `WEB_DIST_DIR` | `/app/web/dist` in image | Static frontend directory |
| `FFMPEG_PATH` | Docker default `/usr/local/bin/ffmpeg` | Override locally; image uses BtbN `linux64-gpl` static build |
| `LIVE_RECORDER_BIN` | (optional) | Path to Go `live-record`; Docker default `/usr/local/bin/live-record` |
| `NODE_ENV` | `production` in prod image | Runtime environment |

Full load logic: `apps/server/src/config.ts` (`FFMPEG_PATH` is read by `providers/ffmpeg.ts`).

## Usage flow

1. **Providers**: add Otobanana / Koe-koe / Erovoice (password or Cookie) → **Test** login  
2. **Sync**: click “Sync now”, or rely on scheduled sync  
3. **Download jobs**: watch the queue; retry failures from work detail  
4. **Library**: only works with status `downloaded` can play; search / filter / load more  
5. **Live** (Otobanana): sync follow history / check live → subscribe → auto-record → play replays on Live or Library pages  
6. **Settings**: adjust sync interval

### Site notes

| Site | Description |
|------|------|
| Otobanana | VOD favorite sync and download; live subscription and recording |
| Koe-koe | Favorite page parsing and audio download |
| Erovoice | Site HLS (~75 kbps AAC) → server decrypt/transcode to `audio.mp3`; needs **ffmpeg** |

**Live recording (native only)**: uses only the Go/pion binary `apps/live-record`. Docker image ships `/usr/local/bin/live-record`. Locally:

```bash
cd apps/live-record && go build -o live-record.exe .
# Optional: set LIVE_RECORDER_BIN=... to override search path
```

## Local development

Requirements:

- Node.js **≥ 20** (Docker image uses Node 22)
- pnpm **10** (see root `packageManager`)
- Local **ffmpeg** (Erovoice download / transcode; on `PATH` or set `FFMPEG_PATH`)
- Live recording: **Go ≥ 1.22** to build `apps/live-record` (or set `LIVE_RECORDER_BIN`)

```bash
pnpm install
pnpm --filter @erolib/shared build
pnpm dev:server   # :8080
pnpm dev:web      # :5173, /api proxied to 8080
# or
pnpm dev          # server + web in parallel
```

When directory env vars are unset, defaults are `./data`, `./media`, `./cache` under the working directory. Dev can keep the default `CREDENTIALS_SECRET`; production must override it.

Build and test:

```bash
pnpm build
pnpm test         # server unit tests
pnpm typecheck
pnpm start        # production server (build first)
```

## Project layout

```
apps/server         Hono API · job scheduling · Providers · live recording · SQLite
apps/live-record    Go/pion browserless live recording (Otobanana Realtime → Opus/Ogg)
apps/web            React SPA (Library / Providers / Sync / Jobs / Live / Settings)
packages/shared     Shared types and contracts
```

## Security notes

- Without `AUTH_PASSWORD`, anyone who can reach the port can operate the instance — **local or trusted LAN only**
- Always change `CREDENTIALS_SECRET`; never commit real secrets
- Provider credentials are encrypted at rest; unbinding an account does not delete downloaded media
- Do not commit `./data` that contains real accounts

## Troubleshooting

| Symptom | Likely cause | Fix |
|------|----------|------|
| Image pull 401 / denied | GHCR private package, not logged in | `docker login ghcr.io`, token with `read:packages` |
| `/api/health` unreachable | Container down or port in use | `docker compose ps` / `logs`; check `8080` mapping |
| Erovoice download fails mentioning ffmpeg | No local ffmpeg | Install ffmpeg or set `FFMPEG_PATH`; Docker image includes it |
| Live record `live-record binary not found` | pion binary not built | `cd apps/live-record && go build`, or set `LIVE_RECORDER_BIN` |
| Changing `SYNC_INTERVAL_HOURS` has no effect | Interval follows **Settings / DB config** | Save in Web **Settings**; compose env is mostly first-run defaults |
| Logged out immediately / Cookie issues | Reverse proxy not forwarding cookies or HTTPS misconfig | Same-origin access or fix proxy; session cookie is httpOnly |

## Stack (summary)

- Backend: Hono, Drizzle, libSQL/SQLite, Zod, ffmpeg  
- Live: Go + pion WebRTC (`apps/live-record`)  
- Frontend: React 19, React Router 7, Vite 6  
- Deploy: Docker multi-stage (Node 22 + `pnpm deploy --prod` + live-record + BtbN static ffmpeg), GHCR `ghcr.io/kanotis/erolib`
