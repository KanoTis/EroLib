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

1. Write PCM/WAV under `liveMediaDir(config.mediaDir, ...)`.
2. Set `live_record_jobs.media_rel_path` to path relative to `mediaDir`.
3. Upsert `live_media` on `(provider, room_id)` when bytes are sufficient for a playable file.

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

#### Wrong (build)

```json
// package.json — tsc only; live-browser-script.js never reaches dist
"build": "tsc -p tsconfig.json"
```

#### Correct (build)

```json
"build": "tsc -p tsconfig.json && node scripts/copy-runtime-assets.mjs"
```

## Design Decisions

- **Independent `live_media` table** (not `works.kind`): keeps VOD sync/retry isolation.
- **`media/{provider}/live/...` partition**: avoids colliding with VOD `media/{provider}/{author}/{workId}`.
- **Browser inject script is a runtime asset**: `apps/server/src/jobs/live-browser-script.js` is plain JS loaded via `readFile` relative to compiled `live-recorder.js`. Server `build` must copy it to `dist/jobs/` (`scripts/copy-runtime-assets.mjs` after `tsc`). `tsc` alone does not emit this file — missing copy → production `ENOENT` and live auto-record fails. `.dockerignore` must **not** exclude `apps/server/scripts/copy-runtime-assets.mjs` (smoke/probe scripts may still be ignored).

- **Docker runtime must ship Playwright Chromium**: `live-recorder` calls `chromium.launch({ headless: true })`. The npm `playwright` package alone is not enough — the GHCR image must install matching browser binaries + OS deps in the **runtime** stage after `node_modules` is present, e.g. `apps/server/node_modules/.bin/playwright install --with-deps --only-shell chromium`, with `PLAYWRIGHT_BROWSERS_PATH` set at install and runtime (currently `/ms-playwright`). Skipping this produces `Executable doesn't exist at .../chromium_headless_shell-...`. Prefer the package-local CLI (version-locked to lockfile), never floating `npx playwright@latest`. Compose should use `init: true` and `ipc: host` per Playwright Docker recommendations.
