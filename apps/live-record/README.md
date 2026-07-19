# live-record (Go / pion)

Browserless Otobanana live recorder using [pion/webrtc](https://github.com/pion/webrtc).

Implements the same Cloudflare Realtime listener flow as
`apps/server/src/jobs/live-browser-script.js`:

`join` → WebSocket track announce → `add_track` → `renegotiate` → Opus RTP → Ogg file.

## Build

```bash
cd apps/live-record
go build -o live-record .
# Windows:
go build -o live-record.exe .
```

## Smoke

```bash
# token from Otobanana session, or email/password
./live-record -token "$OTOBANANA_TOKEN" -pick-live -max-sec 25 -out /tmp/smoke.ogg

./live-record -email "$OTOBANANA_EMAIL" -password "$OTOBANANA_PASSWORD" \
  -post-ptr-id "<uuid>" -max-sec 60 -out ./audio.ogg
```

## Server integration

Node `live-recorder` prefers this binary when found (`LIVE_RECORDER=auto`, default):

| Env | Meaning |
|-----|---------|
| `LIVE_RECORDER=auto` | Use binary if present, else Playwright |
| `LIVE_RECORDER=native` | Require binary |
| `LIVE_RECORDER=browser` | Force Playwright |
| `LIVE_RECORDER_BIN` | Explicit path to binary |

Search paths include `/usr/local/bin/live-record` and monorepo
`apps/live-record/live-record(.exe)`.
