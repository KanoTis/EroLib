# Design: 媒体库分页加载

## 1. Overview

在现有 `limit`/`offset` 列表 API 上补齐 Web 客户端分页状态机，媒体库以「加载更多」浏览完整结果。服务端契约保持返回数组；`hasMore` 由客户端按批大小推断。

## 2. Boundaries

| In | Out |
|----|-----|
| `apps/web/src/api.ts` 分页参数 | 新合并列表后端 API |
| `LibraryPage` 列表状态 / 加载更多 UI | total / count 查询 |
| 可选极轻 CSS（按钮区） | 无限滚动、虚拟列表、页码 |
| 服务端若无需改则不动 | 改变 works/live 排序或筛选语义 |

服务端 `GET /api/works` 与 `GET /api/live/media` **已支持** `limit`/`offset`，MVP **不改** app.ts，除非验证发现 bug。

## 3. Contracts

### 3.1 HTTP（现状，不变）

```
GET /api/works?q&status&provider&limit&offset  → WorkPublic[]
GET /api/live/media?q&provider&limit&offset    → LiveMediaPublic[]
```

- 默认 `limit=50`，clamp 到 `[1, 200]`（服务端现逻辑）。
- 排序：`updatedAt DESC`（各自表）。

### 3.2 Web API client

```ts
works(params?: {
  q?: string;
  status?: string;
  provider?: string;
  limit?: number;
  offset?: number;
}): Promise<WorkPublic[]>;

liveMedia(params?: {
  q?: string;
  provider?: string;
  limit?: number;
  offset?: number;
}): Promise<LiveMediaPublic[]>;
```

### 3.3 前端分页状态（LibraryPage）

```ts
const PAGE_SIZE = 50;

// per-source
vodOffset: number;      // next offset to request
liveOffset: number;
vodHasMore: boolean;
liveHasMore: boolean;

// UI
loading: boolean;       // initial / filter reload
loadingMore: boolean;   // append path
works: WorkPublic[];
liveItems: LiveMediaPublic[];
```

`hasMore` 更新规则（单次响应 `batch`）：

```
hasMore = batch.length === PAGE_SIZE
nextOffset = prevOffset + batch.length
```

空批或不足一页 → `hasMore = false`。

## 4. Data flow

### 4.1 重置加载（replace）

触发：mount + `kind` 变化；搜索按钮 / Enter。

1. `loading=true`，清空错误。
2. 将 `vodOffset/liveOffset=0`，按 `kind` 决定 `wantVod/wantLive`。
3. 并行请求各相关源 `limit=PAGE_SIZE, offset=0`。
4. 替换 `works` / `liveItems`；按返回长度设 hasMore 与 next offset。
5. `loading=false`。

### 4.2 加载更多（append）

触发：底部按钮；仅当 `showLoadMore = (wantVod && vodHasMore) || (wantLive && liveHasMore)`。

1. 若 `loading || loadingMore` 则忽略。
2. `loadingMore=true`。
3. 对 hasMore 的源并行请求 `offset=该源 offset`。
4. **按 key 去重后** 追加到对应数组；更新 offset/hasMore。
5. `items` 的 `useMemo` 对合并结果按 `sortAt` 降序。
6. `loadingMore=false`；错误写入 `error`，已加载数据保留。

### 4.3 kind=all 语义

- 重置：两源 offset 0 各一页。
- 更多：两侧各自 `hasMore` 则各拉一批；一侧耗尽后只推进另一侧。
- 展示：已加载并集排序；**不**声称全库全局序。

## 5. UI

- 列表下方：有 more 时渲染 `button`「加载更多」；`loadingMore` 时 disabled + 文案「加载中…」。
- 首屏 `loading` 仍用现有 loading-block；加载更多时 **不**整页替换为 spinner（保留列表）。
- 无 total 文案。

## 6. Compatibility / Rollback

- 未传 `limit`/`offset` 的其它调用方行为不变（默认首 50）。
- 回滚：还原 `api.ts` + `LibraryPage` 即可；无 DB migration。

## 7. Risks

| 风险 | 缓解 |
|------|------|
| 混合列表非全局严格序 | PRD 已接受；文档化 |
| 重复 key（异常重拉） | 追加时 by key 过滤 |
| 竞态：快速连点筛选/更多 | loading/loadingMore 门闩；可选 request generation id 丢弃过期响应 |
| 筛选未点搜索就点加载更多 | 与现状一致：更多用当前已生效的筛选状态（state 中的 q/status/provider） |

## 8. Test plan

- 手动：>50 条库，首屏条数、加载更多、筛选重置、kind 切换、播放。
- `pnpm` typecheck web（及需要时 shared）。
- 无强制新单测；若有易抽纯函数（hasMore/merge）可补，非门禁。
