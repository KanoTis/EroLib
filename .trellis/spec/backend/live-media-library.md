# Live Media Library

Executable contracts for Otobanana live recordings that appear in the media library.

## 1. Scope / Trigger

- Trigger: completed live recordings must be browsable/playable in the library without writing into VOD `works`.
- Layers: recorder → SQLite `live_media` → `/api/live/media*` → Library/Live UI.
- Provider scope: Otobanana only (same as live auto-record).

## 2. Signatures

### Disk

```text
{MEDIA_DIR}/{provider}/live/{authorId}/{roomSafe}/audio.ogg
# Historical browser-era files may still be audio.wav
```

- Helper: `liveMediaDir(mediaRoot, provider, authorId, roomId)` in `apps/server/src/storage/paths.ts`.
- `roomSafe`: `roomId` with `:` → `_`, then `sanitizePathSegment`.
- Do **not** use `DATA_DIR/live` as the finished-media path.
- New recordings from native `live-record` write **`audio.ogg`** (Ogg Opus). Legacy **`audio.wav`** rows remain playable when present.

### DB: `live_media`

| Column | Notes |
|--------|--------|
| `provider`, `room_id` | unique key |
| `author_id`, `author_name`, `title` | display |
| `job_id` | optional link to `live_record_jobs.id` |
| `audio_ext` | default `wav` (schema); new native jobs write `ogg` |
| `media_rel_path` | relative to **MEDIA_DIR** (forward slashes) |
| `bytes`, `duration_seconds`, `recorded_at` | optional metrics |

Parallel to VOD: `works` remains VOD-only. `live_record_jobs` is the recording pipeline; `live_media` is the library entry.

### API

- `GET /api/live/media?q=&provider=&authorId=&limit=&offset=` → `LiveMediaPublic[]` (`authorId` optional exact match on `live_media.author_id`; same pattern on `GET /api/works`)
- `GET /api/live/media/:provider/:roomId/audio` → audio stream (Content-Type from `audio_ext`: `audio/ogg` or `audio/wav`; Range supported)
- `DELETE /api/live/media/:provider/:roomId` → `{ ok: true }`; missing row → 404
- `DELETE /api/live/jobs/:id` → `{ ok: true }`; missing job → 404

### Shared type

`LiveMediaPublic` includes fixed `kind: "live"` for UI merge with VOD cards.

### Delete cascade (local only)

| Entry | Behavior |
|-------|----------|
| `DELETE .../media/:provider/:roomId` | Stop linked recorder sessions → remove audio + room dir under `liveMediaDir` → delete matching `live_record_jobs` (by `job_id` and same provider+roomId) → delete `live_media` row |
| `DELETE .../jobs/:id` | `livePoller.stopRecording(id)` (awaits session finalize) → delete matching `live_media` (by `job_id` or same provider+roomId) + files → delete job row |

Rules:

- File missing on disk still succeeds (DB cleanup is idempotent; `rm` uses `{ force: true }`).
- Paths must stay under `MEDIA_DIR` (`path.relative` escape check). Room dirs are removed only via `liveMediaDir` (sanitized), never by deleting arbitrary parents of a polluted `mediaRelPath`.
- Active recording must be stopped before DB/file removal so finalize cannot write back after delete.
- Web: `api.deleteLiveMedia` / `api.deleteLiveJob`; UI uses `confirm` + danger button (Library live cards / Live jobs table).

## 3. Contracts

### Recorder complete path

1. Spawn Go/pion `live-record` binary; write Ogg Opus under `liveMediaDir(config.mediaDir, ...)` as `audio.ogg`.
2. Set `live_record_jobs.media_rel_path` to path relative to `mediaDir`.
3. Upsert `live_media` on `(provider, room_id)` when bytes are sufficient for a playable file (`audio_ext=ogg`).

Missing binary: job fails with a readable error (build `apps/live-record` or set `LIVE_RECORDER_BIN`). **No browser / Playwright fallback.**

### Library UI

- Default: merge `GET /api/works` + `GET /api/live/media`, sort by updated/recorded time.
- Filter: `type=all|vod|live` (query `/?type=live` supported).
- Live badge required; VOD must not be labeled live.
- Play live via `api.liveAudioUrl(provider, roomId)` — never `/api/works/.../audio`.
- **Pagination (required when list can exceed one page)**:
  - Page size **50** per source (`limit=50`, `offset` advances by returned length).
  - First load / kind change / search: **replace** list at `offset=0`; reset both sources’ hasMore/offset before the request settles (block load-more on stale window).
  - “加载更多”: **append** only; `hasMore = batch.length === 50` (no `total` field).
  - `type=all`: each source with hasMore fetches the next batch (parallel); do **not** require global strict interleaving across unloaded rows.
  - Web client must pass `limit`/`offset` on `api.works` and `api.liveMedia` — never raise limit to “load everything”.

### Live page

- `completed` + `mediaRelPath`: in-page play + link to `/?type=live`.

## 4. Validation & Error Matrix

| Condition | Result |
|-----------|--------|
| Unknown `(provider, roomId)` for audio | 404 JSON |
| Row exists, file missing on disk | 404 `Audio file missing` |
| Range start/end invalid | 416 with `Content-Range: bytes */size` |
| Live item retry as VOD work | Not applicable — no `download_jobs` row |
| `DELETE` media unknown `(provider, roomId)` | 404 `{ error: "Not found" }` |
| `DELETE` job invalid / missing id | 400 invalid id / 404 not found |
| `DELETE` when file already gone | 200 `{ ok: true }` (DB still cleaned) |
| `live-record` binary missing | job `failed` with build / `LIVE_RECORDER_BIN` hint |

## 5. Good / Base / Bad

- **Good**: completed job → file under `media/otobanana/live/.../audio.ogg` + `live_media` row + library play works.
- **Base**: empty `live_media` → library shows only VOD (or empty state).
- **Bad**: writing finished media only under `data/live` without `live_media` upsert → library cannot play.
- **Bad**: expecting Playwright/Chromium fallback when binary is missing → recording must fail clearly.

## 6. Tests Required

- Unit: path helper produces `.../live/...` under media root (extend media paths suite when touching paths).
- Manual/smoke: record complete → list `/api/live/media` → audio 200 + Range 206.
- Regression: VOD `/api/works/:p/:id/audio` and retry unchanged.

## 7. Wrong vs Correct

#### Wrong

```ts
// Finished recording under DATA_DIR and only update live_record_jobs
const outDir = path.join(config.dataDir, "live", provider, authorId, roomSafe);
// Library still only reads works → never appears
```

#### Correct

```ts
const outDir = liveMediaDir(config.mediaDir, provider, authorId, roomId);
// mediaRelPath relative to mediaDir; upsert live_media; serve via /api/live/media/.../audio
```

#### Wrong (recorder)

```ts
// Browser fallback when native binary is missing
import { chromium } from "playwright";
await chromium.launch({ headless: true });
```

#### Correct (recorder)

```ts
// Native-only: resolve live-record binary or fail the job
const bin = await resolveNativeBin(config); // throws if missing
// spawn bin → audio.ogg → upsert live_media with audio_ext=ogg
```

#### Correct (build)

```json
"build": "tsc -p tsconfig.json"
```

No runtime browser script copy step is required.

## Design Decisions

- **Independent `live_media` table** (not `works.kind`): keeps VOD sync/retry isolation.
- **`media/{provider}/live/...` partition**: avoids colliding with VOD `media/{provider}/{author}/{workId}`.
- **Native-only live recording**: `live-recorder` spawns the Go/pion binary from `apps/live-record` (Docker: `/usr/local/bin/live-record`). Optional override: `LIVE_RECORDER_BIN`. Missing binary fails the job with a clear error; there is **no** Playwright / Chromium path.
- **Docker runtime must ship `live-record`**: multi-stage build compiles the Go binary and copies it into the runtime image alongside Node + ffmpeg. No browser install layer. Compose may set `init: true` for child-process reaping; `ipc: host` is not required.
