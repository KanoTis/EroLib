# Fix premature live-record completed and no resume

## Goal

订阅作者仍在直播时，录制不应因 CF Realtime 的瞬态 `empty_track_error` 整场退出并永久停在 `completed`；应尽量连续录完同一场，并在同 room 仍 onair 时自动恢复。

## Background

日志 `erolib-app-1(2).html`（2026-07-20）job=14：~3min 后 mid-session `empty_track_error` → `stop with audio after error` → `completed`；作者仍在播但不再 spawn。

根因链：

1. `apps/live-record/main.go`：`empty_track_error` 非 5xx → 不重试 → 经 `done` 结束进程
2. `apps/server/src/jobs/live-recorder.ts`：`bytes >= 2048` → `completed` + upsert `live_media`
3. `live-poller.ensureJob`：同 `(provider, roomId)` 复用已有 job；`ensureStarted` 跳过终态

Schema：`live_record_jobs` / `live_media` 均 UNIQUE `(provider, room_id)`；磁盘 `{MEDIA_DIR}/{provider}/live/{authorId}/{roomSafe}/`。

## Decisions

| # | Decision |
|---|----------|
| D1 | **保活 + 轻量 reset**：Go 忽略 ghost `empty_track` 不整场退出；进程死后若同 room 仍 onair 且 job 终态 → reset `pending_media` 并用新文件名再录 |
| D2 | **库展示最长片段**：`live_media` 指向该 room 下 **bytes 最大** 的 ogg（相等则较新）；`job.mediaRelPath` = 本次 attempt 文件；delete room 仍删整个 room 目录（含全部 segment） |
| D3 | **短段策略 A**：多文件时只播最长；短文件闲置。主路径靠 Go 保活单文件，多文件仅服务重启/进程死后 |

## Requirements

- R1. Mid-session `empty_track_error` / `add_track missing sessionDescription` 不得结束整场（不 `return err` 到主 done）。
- R2. 未明确结束前继续写当前输出文件。
- R3. 仅 WS `end`、onair 关闭 abort、max duration、无音频真失败等结束进程并落库。
- R4. 同 room 仍 onair + job 为 `completed`/`failed` + 无 active recorder → reset `pending_media` 再 spawn；输出新文件名（不覆盖已有片段）。
- R5. 遵守 D2：`live_media` 更新为更大/更新可播文件；delete cascade 不变。
- R6. 日志区分：ignored ghost track / resume reset / 真失败退出。

## Acceptance Criteria

- [ ] AC1: mid-session `empty_track` 时 `live-record` 不 exit，继续收 RTP。
- [ ] AC2: 不会因该错误单独永久停录。
- [ ] AC3: 同 room 仍 onair 时不会长期「completed + 无人在录」。
- [ ] AC4: 正常结束 → `completed` + `live_media` 可播。
- [ ] AC5: 无音频/真失败 → `failed`。
- [ ] AC6: 再录不覆盖已有片段；delete room 清掉全部 segment。
- [ ] AC7: 多段时 `live_media` 指向 bytes 最大文件。

## Out of scope

- 多 segment 离线拼接
- VOD / history-sync
- Playwright 回退
- `ws close 1012` 进程内重连（可另开）
- 非必要的 `MAX_CONCURRENT` / poll 间隔调整
