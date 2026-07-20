# VOD Sync Local Media

Executable contracts for full-sync re-download when local VOD audio is missing or empty.

## 1. Scope / Trigger

- Trigger: user deletes or empties files under `MEDIA_DIR`, then runs full sync (`立即同步全部` / scheduled `runSync`).
- Layers: `JobRunner.syncOne` → `enqueueDownload` → `download_jobs` → `processJob`.
- Provider scope: VOD providers with `works` rows **and** `provider_accounts.favorite_sync_enabled = true` (not Live `live_media`).
- Account gate: use `favoriteSyncEnabled`, **not** legacy `provider_accounts.enabled` (see provider-account-credentials favorite-sync scenario).

## 2. Signatures

### Helper

```ts
// apps/server/src/storage/paths.ts
export interface LocalAudioWorkRef {
  mediaRelDir: string | null | undefined;
  audioExt: string | null | undefined;
}

export async function isLocalAudioAvailable(
  mediaRoot: string,
  work: LocalAudioWorkRef,
): Promise<boolean>;
```

Resolved path:

```text
{mediaRoot}/{mediaRelDir}/audio.{audioExt}
```

(`audioExt` leading `.` stripped; matches `mediaWorkDir(...).audio(ext)` file name.)

### Sync / enqueue

- `enqueueDownload(work)` — shared gate for sync and any other enqueue caller.
- `syncOne` always calls `enqueueDownload` for existing favorites (no outer `status !== "downloaded"` skip).

## 3. Contracts

### Availability

| Condition | `isLocalAudioAvailable` |
|-----------|-------------------------|
| missing/empty `mediaRelDir` or `audioExt` | `false` |
| path does not exist / `stat` fails | `false` |
| `size === 0` | `false` |
| file exists and `size > 0` | `true` |

### Enqueue when `status === "downloaded"`

- Available → **do not** enqueue (`return false`).
- Unavailable → treat as not downloaded: insert `download_jobs(state=queued)`, set `works.status = queued`.

### Dedupe

- Existing `download_jobs` in `queued` or `running` for the work → no second job.

### Out of scope

- Live `live_media` re-record.
- Cover-only missing (does not force audio re-download).
- Non-zero-byte corruption / checksum verify.
- `recoverOnStart` full disk scan (only sync path checks disk).

## 4. Validation & Error Matrix

| Condition | Result |
|-----------|--------|
| Favorite + downloaded + audio gone | new job, `enqueued++`, status `queued` |
| Favorite + downloaded + 0-byte audio | same as missing |
| Favorite + downloaded + good audio | skip enqueue |
| Favorite + failed/discovered | enqueue if no open job (unchanged) |
| Open job already queued/running | skip insert |
| Play API file missing | still `404 Audio file missing` (independent of sync) |

## 5. Good / Base / Bad

- **Good**: delete `audio.mp3` under media work dir → full sync re-enqueues and re-downloads.
- **Base**: intact library → sync discovers favorites but `enqueued` does not include already-downloaded works.
- **Bad**: trust only `works.status === "downloaded"` without disk check → library shows downloaded but play 404 forever after manual media delete.

## 6. Tests Required

- Unit (`apps/server/test/crypto-paths.test.ts`):
  - exists + size > 0 → true
  - missing file → false
  - 0-byte → false
  - missing `mediaRelDir` / `audioExt` → false

## 7. Wrong vs Correct

#### Wrong

```ts
async function enqueueDownload(work: WorkRow): Promise<boolean> {
  if (work.status === "downloaded") return false;
  // ...
}

// syncOne
if (existing[0].status !== "downloaded") {
  if (await enqueueDownload(existing[0])) enqueued += 1;
}
```

#### Correct

```ts
async function enqueueDownload(work: WorkRow): Promise<boolean> {
  if (work.status === "downloaded") {
    if (await isLocalAudioAvailable(config.mediaDir, work)) return false;
  }
  // open-job dedupe + insert...
}

// syncOne — always delegate to enqueueDownload
if (await enqueueDownload(existing[0])) enqueued += 1;
```

## Design Decisions

- **Shared gate in `enqueueDownload`**: one disk check for sync and future callers; avoid outer status-only skip in `syncOne`.
- **Prefer DB `mediaRelDir` + `audioExt`**: same values written on successful commit; no re-derive from authorId required for availability.
- **0-byte counts as missing**: empty leftovers after interrupted delete/write should re-download.

## Scenario: Author subscription works in full sync

### 1. Scope / Trigger

- Trigger: full/scheduled `runSync` / `syncOne` after favorites block (or instead of favorites when `favorite_sync_enabled=false`).
- Layers: `live_subscriptions.sync_works` → `Provider.listAuthorWorks` → `works` upsert → `enqueueDownload`.

### 2. Signatures

```ts
// apps/server/src/providers/types.ts
listAuthorWorks(session: Session, authorId: string): AsyncIterable<RemoteWorkRef>;

// live_subscriptions.sync_works INTEGER NOT NULL DEFAULT 0  (migrate old rows = 0)
// LiveSubscriptionPublic.syncWorks: boolean
```

### 3. Contracts

| Source | `remoteInFavorites` | Favorite reconcile |
|--------|---------------------|--------------------|
| `listFavorites` | `true` | yes |
| `listAuthorWorks` | **always false** (never set true on this path) | no (reconcile only selects `remoteInFavorites=true`) |

| Gate | Rule |
|------|------|
| Favorites block | requires account + `favorite_sync_enabled` |
| Author works block | requires account; **independent** of `favorite_sync_enabled` |
| Per-author failure | set `lastError`, continue other authors / finish run |

#### 3.3 Provider `listAuthorWorks` query rules

Empty author lists are legal (new / inactive authors). Do **not** treat empty as error — fix provider query params when known prolific authors return empty.

| Provider | Rule |
|----------|------|
| **otobanana** | Page `GET /api/users/{uid}/casts?limit=&offset=&is_adult=` for **both** `is_adult=false` and `is_adult=true`, dedupe by `workId`. Omitting `is_adult` defaults to non-adult and returns empty `data[]` for R18 creators. |
| **koekoe** | Search with **base name only** (`koeKoeAuthorSearchBase`: strip `◆…` / `◇ID_…`), `m=1` **and** `g=1` then `g=2` (without `g`, author mode returns 0). Filter cards with `koeKoeAuthorMatches` so trip subscriptions do not ingest other same-base authors. Full trip string as `word` returns empty. |
| **erovoice** | Existing author listing (no dual-flag / gender loop required for this contract). |

### 4. Validation & Error Matrix

| Condition | Result |
|-----------|--------|
| `sync_works=true`, account ok | discover + enqueue via `enqueueDownload` |
| `sync_works=false` or removed | no new author discoveries; existing media kept |
| Author list throws | author `lastError`; run continues |
| Work already from favorites | upsert keeps favorites flag true if already true; author path must not force true |

### 5. Good / Base / Bad

- **Good**: enable 同步作品 → full sync downloads author works not in favorites.
- **Base**: old subscription after migrate has `sync_works=0` → no surprise downloads.
- **Bad**: author path sets `remoteInFavorites=true` → reconcile marks them not-favorite when absent from likes.

### 6. Tests Required

- Unit: provider list parsers (koekoe list cards, etc.).
- Manual: one `syncWorks` author per configured provider → sync → works appear / enqueue.

### 7. Wrong vs Correct

#### Wrong

```ts
// author path
remoteInFavorites: true, // pollutes favorites reconcile
```

#### Correct

```ts
// author path
remoteInFavorites: false,
// favorites reconcile: where remoteInFavorites === true only
```
