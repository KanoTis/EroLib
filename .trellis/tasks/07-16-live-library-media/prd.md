# 直播录制并入媒体库

## Goal

完成的 Otobanana 直播录制进入**媒体库**可浏览/播放；文件落在 `MEDIA_DIR/{provider}/live/...`；库内与 VOD 明确区分。

## Background

- 父任务：`07-16-otobanana-live-auto-record`。
- 现状：录制写 `{DATA_DIR}/live/.../audio.wav`，仅 `live_record_jobs`；媒体库只读 `works` + `/api/works/.../audio`。
- VOD 路径：`MEDIA_DIR/{provider}/{authorId}/{workId}/audio.{ext}`。
- 范围：仅 Otobanana live。

## Decisions

| 决策 | 选择 |
|------|------|
| 数据模型 | 独立 `live_media`（名称以实现为准）表，不写 `works` |
| 磁盘 | `MEDIA_DIR/{provider}/live/{authorId}/{roomSafe}/audio.wav` |
| 媒体库 | 默认混合列表 + 筛选「全部 / 点播 / 直播」+「直播」徽章 |
| Live 页完成项 | 就地播放 + 可选跳转媒体库 |

## Requirements

1. **R1 存储**：录制成品写入 `MEDIA_DIR/{provider}/live/{authorId}/{roomSafe}/audio.wav`；`data/live` 不再作为正式成品路径。
2. **R2 入库**：`completed` 时 upsert 独立库条目（关联 `provider` + `roomId`，可挂 `jobId`）。
3. **R3 列表/筛选**：媒体库合并 VOD + live；类型筛选 + 直播徽章。
4. **R4 播放**：独立 live audio API（Range 可选但推荐）；库页与 Live 页均可播已完成项。
5. **R5 隔离**：不进入 `download_jobs`；VOD retry/同步不变。
6. **R6 Live 入口**：任务 `completed` 显示播放 + 跳转库（筛选 live 或可定位）。
7. **R7 迁移**：不要求自动迁移历史 `data/live` 文件。

## Acceptance Criteria

- [x] AC1：新完成录制文件在 `MEDIA_DIR/{provider}/live/{authorId}/{roomSafe}/audio.wav`。
- [x] AC2：媒体库默认混合列表可见直播项，带「直播」徽章；筛选「直播」/「点播」行为正确。
- [x] AC3：库页可播放直播项（audio API 正常，player 可用）。
- [x] AC4：VOD 项行为不变，不被标成直播；live 不可触发 VOD retry。
- [x] AC5：Live 页完成任务可就地播放，并可跳转媒体库。
- [x] AC6：shared/server/web typecheck 与现有 server unit tests 通过。

## Out of Scope

- 非 Otobanana 直播；封面抓取；历史文件批量迁移；转码/标签；写入 `works` 表。

## Notes

- `live_record_jobs` 继续表示录制流水；`live_media` 表示可播库条目。
- `mediaRelPath` 语义改为相对 `MEDIA_DIR`（design 写清）。
