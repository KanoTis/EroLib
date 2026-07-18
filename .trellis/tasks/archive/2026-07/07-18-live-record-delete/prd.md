# 直播录制删除功能

## Goal

在媒体库与直播页支持删除直播录制成品与录制任务，释放磁盘并清理本地库记录。

## Scope

### In scope

1. **媒体库成品删除**（`live_media`）
   - 入口：Library 页直播条目（列表 / 卡片）
   - 删除 DB 行 + 对应音频文件（`mediaRelPath`）
   - 若关联 `jobId` 存在：同步删除该 `live_record_jobs` 行（避免任务列表残留「已完成但媒体已删」）

2. **录制任务删除**（`live_record_jobs`）
   - 入口：Live 页「录制任务」表格
   - 任意状态可删：`pending_media` / `recording` / `completed` / `failed` / `blocked` / `discovered` 等
   - 若任务仍在录制：先 `stop` 再删
   - 若存在对应 `live_media`（同 provider+roomId 或 jobId）：一并删除媒体行与音频文件
   - 尽力清理任务目录下残留文件（若路径可知）

3. **API**
   - `DELETE /api/live/media/:provider/:roomId` → `{ ok: true }`；不存在 404
   - `DELETE /api/live/jobs/:id` → `{ ok: true }`；不存在 404
   - 前端 `api` 封装 + 确认后调用 + 刷新列表

4. **交互**
   - 删除前 `confirm` 二次确认
   - 成功后从当前列表移除；失败展示错误

### Out of scope

- 批量删除 / 回收站
- 删除「选定作者 / 订阅」本身（已有 subscription DELETE）
- 点播作品删除
- 远程平台侧任何操作（仅本地）

## Constraints

- 不破坏正在播放：若当前播放器源指向被删媒体，删除后允许播放失败；不要求自动切歌
- 文件缺失时仍应成功删除 DB 行（幂等清理）
- 进行中任务必须先中止 recorder session，避免写回已删 job

## Acceptance Criteria

- [x] Library 直播条目有「删除」按钮；确认后条目消失，音频文件与 `live_media` 行不在
- [x] 删除成品时，关联 `live_record_jobs` 一并消失
- [x] Live 页录制任务有「删除」按钮；任意状态可删
- [x] 删除 `recording` / `pending_media` 任务时，活动录制被 stop，任务与可能的媒体一并清理
- [x] 删除 `completed` 任务时，对应媒体库条目与文件一并清理
- [x] API 对不存在资源返回 404；文件已丢时仍可删 DB
- [x] 类型与现有 Hono / api.ts / 页面风格一致

## Notes

- 轻量任务：PRD-only，无独立 design/implement 文档
- 关键实现面：`apps/server/src/app.ts`、`live-recorder` stop 暴露、`apps/web/src/api.ts`、`LibraryPage.tsx`、`LivePage.tsx`
