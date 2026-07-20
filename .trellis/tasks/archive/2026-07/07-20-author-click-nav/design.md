# Design: 作者页与作者名导航

## Boundaries

| 层 | 职责 |
|----|------|
| `packages/shared` | `AuthorPublic` 等 DTO |
| `apps/server` | 过滤 query、作者详情/头像 API、懒下载头像、upsert `authors` |
| `apps/web` | 路由、`AuthorPage`、`AuthorLink`、入口改造 |

## Contracts

### `AuthorPublic`（shared）

```ts
{
  provider: ProviderId;
  authorId: string;
  displayName: string | null;
  username: string | null;
  hasAvatar: boolean;
  subscription: LiveSubscriptionPublic | null;
}
```

- 显示名优先级：`authors.displayName` → subscription → 任一 work/liveMedia 的 `authorName` → `authorId`。
- `hasAvatar`：本地 `avatarPath` 存在且文件可读。

### API

| Method | Path | 说明 |
|--------|------|------|
| GET | `/api/authors/:provider/:authorId` | 详情；触发懒加载头像（best-effort） |
| GET | `/api/authors/:provider/:authorId/avatar` | 静态头像流（404 若无） |
| GET | `/api/works?provider=&authorId=` | 新增 `authorId` 条件 |
| GET | `/api/live/media?provider=&authorId=` | 同上 |
| 现有 | subscriptions CRUD | 作者页复用，不新造 |

路由参数 `authorId` 需 `decodeURIComponent`（与 works 一致）。

### 前端路由

```
/authors/:provider/:authorId  → AuthorPage
```

### 存储路径

```
{mediaDir}/{provider}/authors/{sanitizedAuthorId}/avatar.{ext}
```

DB `authors.avatarPath` 存相对 `mediaDir` 的路径（与 cover 一致风格）。

## Data flow

```
AuthorLink click
  → /authors/:provider/:authorId
  → GET author detail (upsert authors row if missing; try avatar fetch)
  → parallel: GET works?authorId= , GET live/media?authorId=
  → 若 hasAvatar → <img src=/api/authors/.../avatar>
  → 订阅区：无则 POST，有则 PATCH
```

## 头像懒加载

1. 查 `authors` by `(provider, authorId)`。
2. 若 `avatarPath` 有效且文件存在 → 跳过下载。
3. 否则按 provider 取 URL：
   - **otobanana**：`GET api/users/{uuid}`（扩展 `UserProfile` 解析 `avatar_url`）；非 UUID 时先 `resolveAuthorByInput`。
   - **koekoe / erovoice**：MVP 不拉远端，直接占位（可后续扩展）。
4. 下载到上述路径，upsert `authors`（`displayName`/`avatarPath`/`updatedAt`）。
5. 网络/解析失败：仍返回 AuthorPublic（`hasAvatar=false`），不 5xx 整页。

## UI

- **`AuthorLink`**：`to={`/authors/${provider}/${encodeURIComponent(authorId)}`}`；无效 id → span。
- **`AuthorPage`**：页头（头像+名+provider）+ 订阅控件 + VOD 列表 + Live 列表；列表项复用 Library 卡片风格（标题链作品详情）。
- **占位头像**：显示名首字 + 与 `WorkCover` 类似的 hash 渐变。

## Compatibility

- 仅扩展 query / 新路径；现有客户端不传 `authorId` 行为不变。
- 不改 `authors` 表结构（已够用）。
- PlayerBar / Live / Sync 入口本任务不改。

## Trade-offs

| 选择 | 原因 |
|------|------|
| 详情 GET 内懒加载头像 | 少一次客户端调用；失败不影响列表 |
| 不强制填满 authors 于同步时 | 改动面小；打开作者页再补 |
| 订阅默认双关 | 与 SubscribeAdd 一致，避免误开录制 |

## Rollback

- 删除新路由/页面/API 即可；`authors` 表与已下载头像可保留无害。
