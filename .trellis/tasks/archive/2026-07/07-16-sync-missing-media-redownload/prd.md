# Sync re-download missing media files

## Goal

用户从 `MEDIA_DIR` 删除（或清空）已下载 VOD 音频后，点击「立即同步全部」或定时同步应发现本地音频不可用并重新入队下载；本地音频仍在时不得重复下载。

## Background

- 全量同步：`SyncPage` → `api.sync()` → `JobRunner.triggerSync` → `runSync` → `syncOne`（`apps/server/src/jobs/runner.ts`）。
- 当前门闩只看 DB：
  - `enqueueDownload`：`status === "downloaded"` 直接 `return false`（`runner.ts:137-138`）
  - `syncOne`：已有作品且 `status === "downloaded"` 不入队（`runner.ts:207-209`）
- 播放接口会查盘：`GET /api/works/.../audio` 文件不存在 → `404 Audio file missing`（`app.ts:662-663`），与同步不一致。
- 对照行为：`POST /api/works/:provider/:workId/retry` 强制入队并置 `queued`。
- 音频路径：`{MEDIA_DIR}/{provider}/{authorId}/{workId}/audio.{ext}`（`mediaWorkDir`）；DB 存 `mediaRelDir` + `audioExt`。
- Live（`live_media`）无 VOD 重下通道，本任务不涉及。

## Requirements

1. **R1 — 同步时校验本地音频可用性**  
   对仍出现在远程收藏列表中的作品，入队前判定本地音频是否可用。  
   **可用** = 解析得到的音频路径存在 **且** `size > 0`。  
   **不可用**（视为缺失）包括：路径不存在、`stat` 失败、`size === 0`、缺少 `audioExt` / 无法解析路径。  
   不可用则必须重新入队下载。

2. **R2 — 入队状态可见**  
   重下走现有 `enqueueDownload`：插入 `download_jobs(state=queued)`，作品 `status → queued`，最终由 worker 下载。

3. **R3 — 文件完好则跳过**  
   `status === downloaded` 且本地音频可用时，不得重复入队。

4. **R4 — 队列去重**  
   已有 `queued`/`running` 的 job 时不重复插入（沿用现逻辑）。

5. **R5 — 仅 VOD 收藏同步路径**  
   改动落在 `syncOne` / `enqueueDownload`（或二者共用的「本地音频是否可用」判定）；Live 与非收藏作品不因本任务改变行为。

## Acceptance Criteria

- [x] AC1：`status=downloaded`，删除 `audio.{ext}` 后全量同步 → 新建 download job，`enqueued` 增加，作品进入 `queued`/`downloading`。
- [x] AC2：`status=downloaded`，音频存在但 **0 字节** → 与 AC1 相同，重新入队。
- [x] AC3：`status=downloaded` 且音频存在且 `size > 0` → 不同步入队该作品。
- [x] AC4：非 `downloaded`（`failed` / `discovered` 等）→ 仍按现逻辑入队。
- [x] AC5：Live / 非 VOD 路径无回归。

## Out of Scope

- Live 录制缺失的「重录」。
- 仅封面缺失的单独补下（元数据刷新另有入口）。
- 库 UI「删除本地文件」。
- 非 0 字节的损坏内容 / checksum 校验。
- 启动恢复 `recoverOnStart` 时全库扫盘（仅同步路径）。

## Technical Notes (intent, not full design)

- 建议把「本地音频是否可用」收敛到单一 helper，供 `enqueueDownload`（或 `syncOne`）使用，避免双门闩分叉。
- 路径优先：`mediaRelDir + audio.{audioExt}`；若无 `mediaRelDir`/`audioExt` 则视为不可用。
- 判定失败时不得静默当「已下载」。

## Decisions

| ID | Decision |
|----|----------|
| D1 | 缺失判定 = 文件不存在 **或** 0 字节（用户确认） |
| D2 | 仅封面缺失不触发重下 |
| D3 | 仅 VOD 同步/入队路径；Live 不在范围 |
