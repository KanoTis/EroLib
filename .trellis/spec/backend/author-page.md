# Author Page API

Executable contracts for local author pages (click author name → author home).

## 1. Scope / Trigger

- Trigger: UI navigates to `/authors/:provider/:authorId` or lists works/live media filtered by author.
- Layers: `authors` table + media avatar files → `/api/authors*` + filtered list APIs → web `AuthorPage` / `AuthorLink`.
- Stable key: `(provider, authorId)` (no slug). Path params use `encodeURIComponent` / route decode once (do not double-decode in React).

## 2. Signatures

### Shared DTO

```ts
// packages/shared
interface AuthorPublic {
  provider: ProviderId;
  authorId: string;
  displayName: string | null;
  username: string | null;
  hasAvatar: boolean;
  subscription: LiveSubscriptionPublic | null;
}
```

### Disk

```text
{MEDIA_DIR}/{provider}/authors/{sanitizedAuthorId}/avatar.{ext}
```

- Helper: `authorAvatarPaths(mediaRoot, provider, authorId)` in `apps/server/src/storage/paths.ts`.
- DB `authors.avatar_path`: path relative to **MEDIA_DIR** (forward slashes).

### API

| Method | Path | Notes |
|--------|------|--------|
| GET | `/api/authors/:provider/:authorId` | `AuthorPublic`; best-effort lazy avatar; never 5xx solely because remote avatar failed |
| GET | `/api/authors/:provider/:authorId/avatar` | image stream; missing → 404 |
| GET | `/api/works?…&authorId=` | optional exact `works.author_id` filter (with existing `provider`/`q`/`status`) |
| GET | `/api/live/media?…&authorId=` | optional exact `live_media.author_id` filter |

### Module

- Aggregation + lazy download: `apps/server/src/authors/ensure-author.ts`
- Otobanana profile: `fetchUserProfile` / `UserProfile.avatar_url` in `otobanana-live.ts`

## 3. Contracts

### Display name priority

`authors.displayName` → subscription display/username → any work or liveMedia `authorName` → `authorId`.

### `hasAvatar`

Local `avatarPath` set **and** file exists under `MEDIA_DIR`. Stale path (file deleted) → clear DB field and allow re-fetch.

### Lazy avatar (on GET detail)

1. Ensure `authors` row (unique `(provider, authorId)`; concurrent insert → re-read, no 500).
2. If avatar file present → skip download.
3. Else provider:
   - **otobanana**: fetch user profile `avatar_url` (UUID or resolve input first); download to author avatar path; upsert row.
   - **koekoe / erovoice**: no remote fetch (MVP); placeholder on UI.
4. Network/parse failures: return `AuthorPublic` with `hasAvatar=false`.

### List filters

- `authorId` query is exact match on stored author id string.
- Omitting `authorId` preserves previous list behavior.

### Subscription on author page (web)

- Reuse `POST/PATCH /api/live/subscriptions`.
- **Manual add defaults** (Author page + SubscribeAdd + server): `syncWorks=false`, `enabled=false` (user enables explicitly). Auto-record only valid for otobanana.

## 4. Validation & Error Matrix

| Condition | Result |
|-----------|--------|
| Avatar file missing | GET avatar → 404; detail still 200 with `hasAvatar=false` |
| Remote avatar download fails | detail 200, no avatar |
| Concurrent first insert on same author | second request re-reads row, 200 |
| List without `authorId` | unchanged global list |
| Invalid/missing/`_unknown` authorId in UI | plain text, no `AuthorLink` |

## 5. Good / Base / Bad

- **Good**: Library VOD card → `/authors/otobanana/{uuid}` → filtered VOD + live + optional avatar after first open.
- **Base**: Author with only local works, no subscription, no avatar → page works with placeholder.
- **Bad**: Double `decodeURIComponent` on route params (throws on `%` in id).
- **Bad**: Failing remote avatar returns 500 for whole author detail.

## 6. Tests Required

- Unit: `authorAvatarPaths` under media root (`crypto-paths.test.ts`).
- Typecheck shared/server/web.
- Manual: AC click paths; filter correctness; `_unknown` not linkable; add subscription defaults off.

## 7. Wrong vs Correct

#### Wrong

```ts
// Fail the whole author detail when avatar download throws
const avatar = await downloadAvatar(...); // throws → 500
```

#### Correct

```ts
try {
  await ensureAvatarBestEffort(...);
} catch {
  // keep hasAvatar false
}
return toAuthorPublic(row);
```

#### Wrong

```tsx
const authorId = decodeURIComponent(params.authorId!); // RR already decoded
```

#### Correct

```tsx
const authorId = params.authorId!; // use route param as-is
```

## Design Decisions

- **Lazy avatar on detail GET**: one client call; failure isolated.
- **Do not backfill `authors` during full sync (MVP)**: open page then hydrate.
- **Manual subscribe flags default off**: match `app.ts` POST body defaults and `SubscribeAddPage` (not “on by default”).
