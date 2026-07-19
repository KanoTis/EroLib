# Design: 同步页订阅 + 直播瘦身 + 统一作者订阅作品

## Status

- **Phase A（已落地）**：Tab/布局、favorite_sync_enabled、Live 瘦身、Settings 历史同步。
- **Phase B（本轮）**：统一作者订阅双开关 + 三渠道 `listAuthorWorks` + 并入 `runSync`。

## Architecture / Boundaries

| 层 | Phase B 变更 |
|---|---|
| DB | `live_subscriptions` 增 `sync_works`；`enabled` 语义固定为 **live 自动录制** |
| Shared | `LiveSubscriptionPublic` 增 `syncWorks`；可选 `liveRecord` 别名映射 `enabled` |
| Provider | `listAuthorWorks(session, authorId)` 三渠道实现 |
| Runner | `syncOne`：收藏夹（若 favorite_sync）+ 订阅作者作品（`sync_works`） |
| API | subscriptions PATCH 支持 `syncWorks` / `enabled` |
| Web | Sync 订阅 Tab 双开关；添加默认策略 |

## Data model

### `live_subscriptions`（统一名单，表名保留）

| 列 | 语义 |
|---|---|
| `enabled` | **自动录制**（live-poller）。仅 otobanana 有效 |
| `sync_works` NEW | **同步作品**（VOD listAuthorWorks）。默认：新行 true；**migrate 旧行 = 0**（不突袭下载） |

唯一键仍 `(provider, author_id)`。

Migrate 幂等：

```sql
ALTER TABLE live_subscriptions ADD COLUMN sync_works INTEGER NOT NULL DEFAULT 0;
-- 新 insert 在应用层写 sync_works=1（VOD 默认开）
```

### `works` 与来源

| 来源 | `remoteInFavorites` | 收藏对账 |
|---|---|---|
| listFavorites | `true` | 参与「不在远端 likes → 标 false」 |
| listAuthorWorks | **`false`**（保持/写入 false） | **不参与** 上述循环（循环只 select `remoteInFavorites=true`，故安全） |

入队仍走 `enqueueDownload`（本地缺文件可重下）。

### sync_runs

最小改动：继续累计 `discovered` / `enqueued`（收藏 + 作者合计）。可选后续加 `authorDiscovered` 列 — **本期不做**。

## Provider contract

```ts
export interface Provider {
  // existing...
  listFavorites(session: Session): AsyncIterable<RemoteWorkRef>;
  /** Yield works for one author. authorId is provider-native id (resolved). */
  listAuthorWorks(
    session: Session,
    authorId: string,
  ): AsyncIterable<RemoteWorkRef>;
  getWork(session: Session, workId: string): Promise<WorkMetadata>;
  // ...
}
```

### Otobanana

- Resolve：复用 live `resolveAuthorByInput`（uuid/username）
- List：`GET /api/users/{userId}/casts` 分页（对齐 likes 的 `next_page_url` / data 形态，见 `docs/otobanana_reverse_engineering.md`）
- 映射：复用 cast → `RemoteWorkRef` 助手

### Koe-koe

- authorId：作者显示名（现有 works 常用 name 作 id）
- List：`GET search.php?word={encodeURIComponent(name)}&m=1&p=N` 解析同 list.php 卡片
- 需登录 cookie 与否：对照收藏列表请求头；能公开则可不强制

### Erovoice

- authorId：作者 slug（URL `/{slug}/`）
- List：GET 作者页 HTML，解析 `voiceList` / 与 bookmark 卡类似的作品链接；分页若存在则跟

若某渠道 list 失败：该作者记 `lastError`，**不** fail 整个 provider sync（继续下一作者）。

## Runner flow (`syncOne`)

```
ensureSession
if account.favoriteSyncEnabled:
  for ref in listFavorites → upsert works remoteInFavorites=true → enqueue
  reconcile favorites → mark not favorite
else:
  skip favorites block

for sub in subscriptions where provider=X and sync_works=true:
  for ref in listAuthorWorks(session, sub.authorId):
    upsert works with remoteInFavorites=false (never set true from this path)
    enqueue
  update sub lastCheckAt / clear or set lastError
```

**Account gate**：作者作品同步需要该 provider 账号存在；不要求 `favorite_sync_enabled`（收藏关、作者开仍应同步作者作品）。

若整账号无 session：作者循环跳过并记 run error 片段。

## API

| 方法 | 变更 |
|---|---|
| GET/POST `/api/live/subscriptions` | 响应含 `syncWorks`；POST body 可选 `syncWorks?` `enabled?`（live） |
| PATCH `/api/live/subscriptions/:id` | `{ enabled?, syncWorks? }` |
| 路径保留 `/api/live/...` | 避免大改路由；UI 文案为「订阅作者」 |

添加默认：

- `syncWorks: true`（除非 body 显式 false）
- `enabled: true` 仅当 provider===otobanana，否则 `false`

## Frontend (Sync 订阅 Tab)

表格列：作者 | 渠道 | 同步作品 | 自动录制 | 错误 | 操作

- 同步作品：toggle → patch syncWorks
- 自动录制：仅 otabana 显示 toggle；其它显示「—」
- 添加表单：输入 + provider 选择（若多账号）或默认 otabana 若仅直播习惯 — **若现添加无 provider 选择且写死 otabana**：需扩展为可选 provider（三渠道名单）

**添加 UI**：`provider` 下拉（已配置的 providers）+ 作者输入。

## Live poller

仍：`enabled === true` 且 provider otobanana（表内 provider 字段）。

## Compatibility

- 旧 live 订阅：`sync_works=0`，行为与现在一致（只录播）
- 用户打开「同步作品」后下次全量同步才拉作品
- 前端类型 bump `syncWorks`

## Trade-offs

| 选择 | 说明 |
|---|---|
| 保留表名 live_subscriptions | 少迁移；命名略歪 |
| 作者作品 remoteInFavorites=false | 避免收藏对账误伤 |
| 旧行 sync_works 默认 0 | 防突袭全量下载 |
| 失败 per-author | 单作者挂了不拖垮渠道 |

## Rollback

- 停用 listAuthorWorks 调用即可；列可留
- 双开关 UI 回退为单 enabled

## Testing focus

- Otobanana casts 分页单测/fixture 若可得
- syncOne：仅 sync_works 作者入队；favorites off 时仍作者同步
- remoteInFavorites 对账不碰作者作品
- koekoe/erovoice 解析冒烟
