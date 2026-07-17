# 媒体库分页加载

## Goal

媒体库不再只展示首屏截断结果；用户可在筛选/搜索条件下持续浏览完整本地库（VOD + live），避免「库变大后只能看到前几十条」。

## Background / Confirmed Facts

| # | 事实 | 证据 |
|---|------|------|
| 1 | `GET /api/works` 已支持 `limit`（默认 50、上限 200）与 `offset` | `apps/server/src/app.ts` ~573–605 |
| 2 | `GET /api/live/media` 同样支持 `limit`/`offset`（默认 50、上限 200） | `apps/server/src/app.ts` ~1261–1291 |
| 3 | 两接口均只返回数组，**无** `total` / `hasMore` / cursor | 同上 |
| 4 | Web `api.works()` 未传 `limit`/`offset`，依赖服务端默认首批 50 | `apps/web/src/api.ts` ~91–97 |
| 5 | Web `api.liveMedia()` 写死 `limit: 50`，无 offset | `LibraryPage.tsx` ~144–148；`api.ts` ~147–151 |
| 6 | `LibraryPage` 一次 `load()` 替换列表，无「加载更多 / 分页 / 无限滚动」 | `LibraryPage.tsx` ~129–158 |
| 7 | `kind=all` 时客户端合并 VOD+live，按 `sortAt`（updatedAt 等）降序 | `LibraryPage.tsx` ~182–198 |
| 8 | 筛选：`q` / `provider` / `status`(非 live) / `kind`；`kind` 变更自动重载，其余需点搜索或 Enter | `LibraryPage.tsx` toolbar |
| 9 | 视图模式 small/standard/list 与播放行为与本任务正交 | 既有 view-modes 任务 |

## Product Decisions

| 决策 | 选择 |
|------|------|
| 浏览交互 | 底部 **「加载更多」按钮**（非页码、非无限滚动 MVP） |
| 批次大小 | 每源 **50** |
| 总数展示 | **不**展示 total / 「已加载 x 条」 |
| hasMore | 客户端：`batch.length === pageSize` ⇒ 可能还有；否则耗尽 |
| kind=all 加载更多 | 对仍有 more 的 **VOD 与 live 各拉一批** |
| 排序保证 | 仅对 **已加载集合** 按 `sortAt` 降序；不要求全库严格交错全局序 |

## Requirements

### R1. API 客户端可分页

- `api.works` / `api.liveMedia` 支持传入 `limit`、`offset`。
- 行为与服务端现有语义一致（默认 50、上限 200）。
- **不**扩展响应 shape（仍返回数组）。

### R2. 首批与筛选重置

- 进入页 / 切换 `kind` / 点击搜索（或 Enter）时：从 offset 0 拉当前筛选下的首批，**替换**列表，并重置各源 offset/hasMore。
- 加载中有明确状态；错误可提示且不静默吞掉。
- 筛选字段变更时机与现状一致：`kind` 自动重载；`q`/`provider`/`status` 点搜索或 Enter 后生效。

### R3. 加载更多

- 当任一相关源 `hasMore` 时，列表底部显示「加载更多」。
- 点击后对仍有 more 的源请求下一批并 **追加**；加载中按钮禁用/显示进行中，避免重复点击。
- 相关源均耗尽时隐藏「加载更多」。
- `kind=all`：两侧各自有 more 则 **并行各拉一批**；仅一侧有 more 则只拉该侧。
- `kind=vod` / `kind=live`：只分页对应源。

### R4. 混合列表展示

- 继续合并 VOD + live，对已加载项按 `sortAt` 降序。
- 双源独立 offset；去重键保持 `vod:provider:workId` / `live:provider:roomId`（追加时不应出现重复 key）。

### R5. 既有能力不回归

- 视图模式、播放、徽章、筛选字段、路由 `?type=` 行为保持。
- 禁止用提高 `limit` 到 200 或一次拉全量来「绕过」分页。

## Acceptance Criteria

- [ ] AC1：库内条目数 > 50 时，首屏只渲染首批（默认 50/相关源），且可通过「加载更多」看到更多条目。
- [ ] AC2：筛选/搜索/切换类型后列表从第一批重新开始，不与旧结果错误拼接。
- [ ] AC3：`kind=vod` / `kind=live` / `kind=all` 下加载更多均可用；all 时两侧有 more 则各进一页；合并列表对已加载项按 `sortAt` 降序。
- [ ] AC4：最后一批不足 pageSize 后隐藏「加载更多」，不再发出多余请求。
- [ ] AC5：视图切换、播放 VOD/live、渠道/状态筛选、移动布局不回归。
- [ ] AC6：相关 typecheck / 既有测试通过。

## Out of Scope

- 统一 VOD+live 的服务端合并分页 API
- 页码跳转 / 跳到指定页
- 无限滚动（MVP 后可选）
- 虚拟列表性能优化
- total 字段或「已加载 x / 共 y」UI
- 同步、下载、元数据刷新流程
- 改变默认排序字段或筛选语义
