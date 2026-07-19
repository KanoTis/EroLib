# Sync / Live Page Ownership

Executable UI ownership for VOD sync, live author subscriptions, and live operations.

## 1. Scope / Trigger

- Trigger: editing Sync, Live, Settings, or Providers pages; adding subscription or followee UX.
- Routes: `/sync`, `/live`, `/settings`, `/providers`.

## 2. Signatures

```ts
// SyncPage local tab state (no URL sub-route)
type SyncTab = "subscribe" | "vod"; // default "subscribe"

// APIs used by page (apps/web/src/api.ts)
// Sync subscribe tab (unified author subscription):
//   liveSubscriptions, addLiveSubscription({ provider, input, syncWorks?, enabled? }),
//   patchLiveSubscription({ enabled?, syncWorks? }), deleteLiveSubscription
// Sync VOD tab:
//   providers, patchProvider({ favoriteSyncEnabled }), sync, syncRuns
// Live page:
//   liveFollowees, liveFolloweeHistory, liveJobs, livePoll, deleteLiveJob, play via usePlayer
// Settings:
//   syncLiveFolloweeHistory (+ settings CRUD)
// Must NOT call from Live UI:
//   selectLiveFollowee / POST .../followees/:authorId/select
```

## 3. Contracts

| Page | Owns | Must not own |
|------|------|----------------|
| **Sync** `/sync` | Tab **订阅作者**: multi-provider CRUD + **同步作品** / **自动录制** toggles; Tab **VOD 同步**: full sync, history, per-provider `favoriteSyncEnabled` | Live job delete/play; followee discovery lists |
| **Live** `/live` | Read-only followees onair + history (meta ok); jobs table (delete, play, link library); **立即检测** | Subscription add/toggle/remove; 「选定录制」; followee history **后台同步** button |
| **Settings** | Sync interval; **同步关注作者直播历史** trigger (must render even if settings load fails) | Subscription list |
| **Providers** | Account create/test/delete | Enable/disable account kill switch (removed) |

Copy: product UI uses **订阅作者**, not **选定作者 / 选定录制**.

### Unified subscription flags (table `live_subscriptions`)

| Flag | UI | Backend |
|------|-----|---------|
| `syncWorks` | **同步作品** (all providers) | `runSync` → `listAuthorWorks` for that author |
| `enabled` | **自动录制** (otobanana only; others show "—") | live-poller only |

Defaults on add: `syncWorks=true`; `enabled=true` only for otabana.

## 4. Validation & Error Matrix

| Condition | UI |
|-----------|-----|
| Settings API fails | Followee history sync control must still render (not nested under settings success-only) |
| No providers | VOD tab shows empty channel toggles; sync may no-op |
| Subscribe add fails | Error alert on Sync subscribe tab |
| Live history cache empty | Empty state; refresh list allowed; no select button |

## 5. Good / Base / Bad

- **Good**: add author on Sync with 同步作品 → full sync enqueues that author's VOD; Live poll records when 自动录制 on.
- **Base**: Live shows followees + jobs only; Settings triggers history crawl.
- **Bad**: Live still has select/subscribe CRUD (double entry, AC fail).
- **Bad**: history sync only inside `settings && (...)` so settings load error hides AC7 entry.
- **Bad**: claim that turning off favoriteSync skips the whole provider when author `syncWorks` should still run.

## 6. Tests Required

- Typecheck web.
- Manual: Sync tabs; Live no 选定; Settings history sync; Providers no 启用/禁用.

## 7. Wrong vs Correct

#### Wrong

```tsx
// LivePage — subscription management
await api.addLiveSubscription(input);
await api.selectLiveFollowee(authorId);
```

#### Correct

```tsx
// SyncPage subscribe tab only
await api.addLiveSubscription(input);
// LivePage — jobs + read-only discovery
await api.liveJobs();
await api.liveFollowees();
```

## Design Decisions

- **Single subscribe entry (Sync)**: avoids dual lists and keeps Live as ops/dashboard.
- **History sync on Settings**: Live stays read-only for discovery; ops trigger is system-level.
- **Tab without URL**: smaller change; default tab is **订阅作者**.
