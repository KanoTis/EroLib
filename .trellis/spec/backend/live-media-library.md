# Live Media Library

Executable contracts for Otobanana live recordings that appear in the media library.

## 1. Scope / Trigger

- Trigger: completed live recordings must be browsable/playable in the library without writing into VOD `works`.
- Layers: recorder → SQLite `live_media` → `/api/live/media*` → Library/Live UI.
- Provider scope: Otobanana only (same as live auto-record).

## 2. Signatures

### Disk

```text
{MEDIA_DIR}/{provider}/live/{authorId}/{roomSafe}/audio.wav
```

- Helper: `liveMediaDir(mediaRoot, provider, authorId, roomId)` in `apps/server/src/storage/paths.ts`.
- `roomSafe`: `roomId` with `:` → `_`, then `sanitizePathSegment`.
- Do **not** use `DATA_DIR/live` as the finished-media path.

### DB: `live_media`

| Column | Notes |
|--------|--------|
| `provider`, `room_id` | unique key |
| `author_id`, `author_name`, `title` | display |
| `job_id` | optional link to `live_record_jobs.id` |
| `audio_ext` | default `wav` |
| `media_rel_path` | relative to **MEDIA_DIR** (forward slashes) |
| `bytes`, `duration_seconds`, `recorded_at` | optional metrics |

Parallel to VOD: `works` remains VOD-only. `live_record_jobs` is the recording pipeline; `live_media` is the library entry.

### API

- `GET /api/live/media?q=&provider=&limit=&offset=` → `LiveMediaPublic[]`
- `GET /api/live/media/:provider/:roomId/audio` → audio stream (`audio/wav`, Range supported)

### Shared type

`LiveMediaPublic` includes fixed `kind: "live"` for UI merge with VOD cards.

## 3. Contracts

### Recorder complete path

1. Write PCM/WAV under `liveMediaDir(config.mediaDir, ...)`.
2. Set `live_record_jobs.media_rel_path` to path relative to `mediaDir`.
3. Upsert `live_media` on `(provider, room_id)` when bytes are sufficient for a playable file.

### Library UI

- Default: merge `GET /api/works` + `GET /api/live/media`, sort by updated/recorded time.
- Filter: `type=all|vod|live` (query `/?type=live` supported).
- Live badge required; VOD must not be labeled live.
- Play live via `api.liveAudioUrl(provider, roomId)` — never `/api/works/.../audio`.

### Live page

- `completed` + `mediaRelPath`: in-page play + link to `/?type=live`.

## 4. Validation & Error Matrix

| Condition | Result |
|-----------|--------|
| Unknown `(provider, roomId)` for audio | 404 JSON |
| Row exists, file missing on disk | 404 `Audio file missing` |
| Range start/end invalid | 416 with `Content-Range: bytes */size` |
| Live item retry as VOD work | Not applicable — no `download_jobs` row |

## 5. Good / Base / Bad

- **Good**: completed job → file under `media/otobanana/live/.../audio.wav` + `live_media` row + library play works.
- **Base**: empty `live_media` → library shows only VOD (or empty state).
- **Bad**: writing finished WAV only under `data/live` without `live_media` upsert → library cannot play.

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

## Design Decisions

- **Independent `live_media` table** (not `works.kind`): keeps VOD sync/retry isolation.
- **`media/{provider}/live/...` partition**: avoids colliding with VOD `media/{provider}/{author}/{workId}`.
