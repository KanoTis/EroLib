# Design: premature live-record complete + resume

## Architecture

```
poller (TS)                    live-record (Go)
───────────                    ────────────────
onair open ──► ensureJob
                 │
                 ├─ no job → insert pending_media
                 ├─ terminal + still open → reset pending_media (R4)
                 └─ open states → keep
ensureStarted ──► spawn live-record ──► audio_N.ogg
                 │                         │
                 │                    empty_track ──► log + skip (no exit)
                 │                    WS end / abort ──► exit 0
                 ▼
              bytes OK? ──► completed + upsert live_media (D2: max bytes)
```

## Component boundaries

| Layer | Owns | Must not |
|-------|------|----------|
| `apps/live-record/main.go` | Session lifetime, track pull policy, RTP → Ogg | Know about job state / DB |
| `live-recorder.ts` | Spawn, path choice, state transitions, media upsert | Decide “still onair” |
| `live-poller.ts` | Onair check, ensureJob, terminal→pending reset | Parse CF track errors |
| `live_media` / delete APIs | Single library row per room; room-dir delete | Segment merge |

## Go: empty_track non-fatal

**Current:** `pullTracks` → `pullTracksWithRetry` → non-retryable err → `done <- err` → `stop with audio after error` → process exit.

**Target:**

1. Classify **ghost-track errors** (non-fatal when recoverable):
   - response body / err string contains `empty_track_error`
   - or `add_track missing sessionDescription` with tracks carrying `errorCode: empty_track_error`
2. On ghost-track error inside `pullTracks` / WS `track` handler:
   - log: `ignore empty_track trackName=… session=…`
   - **do not** mark those keys in `pulled`
   - **do not** send to `done`
   - return nil from pull path so WS loop continues
3. Keep fatal: transport failures that kill WS, join hard-fail with zero packets, max duration, WS `end`, explicit cancel.
4. Optional hardening: if ghost-track floods (e.g. same key > N times / minute), log once per key and skip further attempts for that key only (still no session exit).

Do **not** treat all `missing sessionDescription` as non-fatal if body has no empty_track (other CF errors may still need exit). Prefer matching `empty_track_error` first.

## TS: output path for resume segments

**Current:** always `path.join(outDir, "audio.ogg")`.

**Target:** pick next free name under `liveMediaDir(...)`:

```
audio.ogg          # first / preferred
audio_2.ogg
audio_3.ogg
…
```

Algorithm: if `audio.ogg` missing → use it; else find max `N` in `audio_N.ogg` / existing `audio.ogg` counts as 1 → write `audio_{N+1}.ogg`.

`job.mediaRelPath` = this attempt’s relative path after complete.

## TS: live_media upsert (D2)

On successful attempt (bytes ≥ MIN_BYTES_OK):

1. Always set job `state=completed`, `mediaRelPath=this attempt`.
2. Upsert `live_media` on `(provider, roomId)`:
   - If no row → insert with this path/bytes.
   - If row exists and **this bytes > existing.bytes** (or existing.bytes null) → update path/bytes/jobId/recordedAt.
   - If this bytes ≤ existing.bytes → **keep** existing mediaRelPath/bytes (still update jobId/title/author if useful; do not shrink the library playable file).

Library play URL remains `GET .../media/:provider/:roomId/audio` → uses `live_media.mediaRelPath` (longest).

## TS: terminal resume (R4)

In `checkSubscription` when `room && room.isOpen`:

After `ensureJob(room)` returns existing row:

```
if job.state in (completed, failed)
   && !recorder.isActive(job.id)
   && room.isOpen
then
   update job:
     state = pending_media
     error = null
     endedAt = null
     # keep mediaRelPath pointing at last attempt (or leave as-is)
   log [live-poller] resume job=… room=…
```

Then `ensureStarted` as today.

**Do not** reset while `recorder.isActive`.

**Do not** reset `blocked` without fixing block reason (out of scope).

When onair closes, existing `closeOpenJobsForAuthor` still applies; if job already completed with media, leave completed.

## Compatibility

| Concern | Behavior |
|---------|----------|
| Unique job/media per room | Unchanged — one job row, one library row |
| Disk segments | Multiple ogg allowed under same room dir |
| Delete media/job | `removeLiveMediaFiles` deletes room dir → all segments gone |
| Spec `live-media-library.md` | Update: multi-file room dir + longest-wins library pointer |
| Concurrent limit | Unchanged (2) |

## Trade-offs

| Choice | Why |
|--------|-----|
| Ignore empty_track vs re-join | Re-join mid-session risks losing current RTP; ignore is safer for job 14 pattern |
| New file vs append | Ogg append mid-stream is corrupt-prone |
| Longest library file vs latest | User wants “most content”; short failed tail should not replace long earlier segment |
| Reset completed vs new job | Schema unique on room_id forbids second job |

## Rollback

1. Revert Go non-fatal classification → old early-exit behavior.
2. Revert poller reset → no resume.
3. Segment files left on disk are harmless; library still points at one path.

## Risks

- Rapid onair flap could reset/re-record often → mitigate: only reset when not active; optional min completed age (e.g. 30s) if needed during implement.
- Ghost tracks for the **only** publisher → session may idle with few packets; still prefer not exit until WS end / no RTP watchdog (out of scope unless tests show need).
