# live-record (Go / pion)

Browserless Otobanana live recorder using [pion/webrtc](https://github.com/pion/webrtc).

Implements the Cloudflare Realtime listener flow:

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

Node `live-recorder` **requires** this binary (native-only; no browser fallback):

| Env | Meaning |
|-----|---------|
| `LIVE_RECORDER_BIN` | Optional explicit path. Docker default: `/usr/local/bin/live-record` |

If unset, the server searches `/usr/local/bin/live-record`, monorepo
`apps/live-record/live-record(.exe)`, and `live-record` on `PATH`.

Missing binary → live record job `failed` with a build / `LIVE_RECORDER_BIN` hint.
