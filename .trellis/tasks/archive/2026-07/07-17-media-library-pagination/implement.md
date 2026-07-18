# Implement: 媒体库分页加载

## Ordered checklist

1. **api.ts**
   - `works` / `liveMedia` 增加可选 `limit`、`offset`，写入 query string。

2. **LibraryPage 状态**
   - 常量 `PAGE_SIZE = 50`。
   - 增加 `vodOffset`/`liveOffset`/`vodHasMore`/`liveHasMore`/`loadingMore`。
   - 拆 `load()` 为 `loadInitial()`（replace）与 `loadMore()`（append），或用参数 `mode: "replace" | "append"`。

3. **请求参数**
   - 所有列表请求显式传 `limit: PAGE_SIZE` 与当前 offset。
   - replace 后根据 batch 长度更新 hasMore/offset；append 去重合并。

4. **UI**
   - 列表后条件渲染「加载更多」。
   - `loadingMore` 禁用按钮；保留列表可见。

5. **竞态（最小）**
   - `loadingMore` / `loading` 互斥；replace 进行中忽略 loadMore。
   - 可选：`requestId` ref，过期响应不 `setState`。

6. **样式**
   - 沿用现有 button；必要时 `.library-load-more` 居中/间距，不引入新设计系统。

7. **验证**
   - web typecheck。
   - 手动：首批、更多、筛选重置、vod/live/all、播放不回归。

## Validation commands

```bash
pnpm --filter @erolib/web typecheck
# 若 monorepo 脚本不同，用仓库惯用：
# pnpm -C apps/web exec tsc --noEmit
```

（实现前以 `package.json` 为准。）

## Risky files

- `apps/web/src/pages/LibraryPage.tsx` — 状态机主战场
- `apps/web/src/api.ts` — 契约入口

## Rollback

- `git checkout -- apps/web/src/pages/LibraryPage.tsx apps/web/src/api.ts`

## Done when

- PRD AC1–AC6 可演示通过
- 无 typecheck 错误
