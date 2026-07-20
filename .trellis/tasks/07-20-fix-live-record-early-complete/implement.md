# Implement: premature live-record complete + resume

## Checklist

### 1. Go — non-fatal empty_track

- [ ] File: `apps/live-record/main.go`
- [ ] Add helper `isEmptyTrackError(err error) bool` (and/or inspect add_track response body for `empty_track_error`).
- [ ] In `pullTracks` / WS `track` path: if `pullTracksWithRetry` fails with empty_track → log ignore, return nil (do not forward to `done`).
- [ ] Do not mark failed keys as `pulled`.
- [ ] Keep retry policy for 5xx/transport; keep fatal path for real WS/session death.

### 2. TS — segment output path

- [ ] File: `apps/server/src/jobs/live-recorder.ts`
- [ ] Replace hard-coded `audio.ogg` with next free `audio.ogg` / `audio_N.ogg` under `liveMediaDir`.
- [ ] Keep MIN_BYTES_OK / spawn args unchanged except `-out`.

### 3. TS — live_media longest-wins

- [ ] Same file `upsertLiveMediaForJob` (or caller): only replace library path when new bytes > existing.bytes (or no existing).
- [ ] Job row always stores this attempt’s `mediaRelPath` on completed.

### 4. TS — poller resume

- [ ] File: `apps/server/src/jobs/live-poller.ts`
- [ ] When room open and job is `completed`|`failed` and `!recorder.isActive(job.id)` → set `pending_media`, clear `error`/`endedAt`, log resume.
- [ ] Then existing `ensureStarted`.

### 5. Spec

- [ ] Update `.trellis/spec/backend/live-media-library.md`: multi-segment room dir; library points at longest; delete still removes room dir.

### 6. Tests / smoke

- [ ] Prefer unit-level pure helpers if extracted (path next-name, longest-wins predicate).
- [ ] Go: if no unit harness, manual/logic review + compile `go build`.
- [ ] Server: existing live tests still pass; add small unit test if easy for path/upsert logic.

## Validation commands

```bash
# Go
cd apps/live-record && go build -o live-record.exe .

# Server (from repo root; use project’s usual test script)
pnpm --filter @erolib/server test
# or package.json equivalent if filter name differs
```

Manual smoke (if stack up):

1. Subscribe author, start live-record session.
2. Confirm mid-session empty_track in logs is `ignore` not `stop with audio after error` + process death.
3. Force-kill live-record while still onair → next poll: `resume job=` + new `audio_2.ogg` + recording again.
4. Library play still works; delete media removes room folder.

## Review gates

- Before claim done: AC1–AC7 from `prd.md`.
- Check agent must re-read `live-media-library.md` after edit.
- No schema migration required.

## Rollback points

| After step | Rollback |
|------------|----------|
| 1 only | Revert main.go |
| 1–3 | Revert recorder + main; poller still old |
| Full | Revert three code files + spec |

## Risky files

- `apps/live-record/main.go` — session lifecycle
- `apps/server/src/jobs/live-recorder.ts` — state + media
- `apps/server/src/jobs/live-poller.ts` — resume loop
- `.trellis/spec/backend/live-media-library.md`
