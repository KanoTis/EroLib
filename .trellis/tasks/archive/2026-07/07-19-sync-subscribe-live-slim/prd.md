# 优化同步页布局并新增订阅作者，直播页瘦身为信息展示

## Goal

1. ~~布局/职责~~（已实现）：订阅管理迁同步页、直播页瘦身、设置页历史同步、分渠道收藏同步。
2. **增量（本轮）**：**统一作者订阅** — 名单可勾选「同步作品(VOD)」与「自动录制(Live)」；三渠道实现按作者拉作品；作者作品发现**并入全量同步**。

## Background

- 当前「订阅作者」= `live_subscriptions`，仅驱动 live-poller，**不**拉 VOD 作品。
- `Provider` 仅有 `listFavorites`；无 `listAuthorWorks`。
- 逆向文档已有线索：
  - Otobanana: `GET /api/users/{userId}/casts`
  - Koe-koe: `search.php?word={author}&m=1` 分页
  - Erovoice: 作者页 SSR `voiceList`
- 已落地（代码）：Sync Tab、Live 瘦身、Settings 历史同步、`favorite_sync_enabled`、Providers 去总开关。

## Decisions

| # | 决策 | 结论 |
|---|---|---|
| D1–D7 | 见前序 | 布局/收藏开关/文案等已实现 |
| D8 | 订阅作者作品 | **VOD 作者订阅 + 同步作品**（新能力），三渠道一并 |
| D9 | 名单模型 | **统一作者订阅**：每条可勾选 同步作品 / 自动录制 |
| D10 | 同步时机 | **并入全量同步**：定时/立即同步在收藏同步后（或同 run）对 `syncWorks=true` 作者 `listAuthorWorks` 入库入队；退订只停后续发现，已下载保留 |

## Requirements

### 已完成（R1–R6）
- Sync Tab、Live 瘦身、Settings 历史同步、favorite_sync、Providers UI、单入口订阅 CRUD（直播向）。

### R7 — 统一作者订阅模型（D9）
- 一份名单（演进现 `live_subscriptions` 或等价表）。
- 每条字段能力：
  - **同步作品** `syncWorks`：参与 VOD 作者作品发现
  - **自动录制** `liveRecord`（可兼容原 `enabled`）：参与 live-poller（仅 otobanana 有意义）
- 添加：provider + 作者标识（UUID/username/slug/搜索名，按渠道）
- 启停：可分别切换两标志；移除整行删除
- 非 otobanana：自动录制开关可隐藏或强制 false

### R8 — Provider `listAuthorWorks`（D8）
- 接口扩展；otobanana / koekoe / erovoice 均实现分页列举作者作品 → `RemoteWorkRef`
- 未配置账号的渠道跳过作者同步

### R9 — 并入全量同步（D10）
- `runSync` / `syncOne`：在收藏夹逻辑之外（若 `favorite_sync_enabled`）再对 `syncWorks=true` 订阅作者拉作品
- 入库复用 `works` + `enqueueDownload`（本地缺文件契约不变）
- 作者来源作品 **不要** 写入 `remoteInFavorites=true`（避免被收藏对账误标取消收藏）
- 退订/关同步作品：不再发现新作品；已下载/已入队保留

### R10 — 同步页 UI
- 「订阅作者」Tab：展示两开关（同步作品 / 自动录制）；添加时可选默认（建议：VOD 默认开，Live 仅 otobanana 默认开）
- 「VOD 同步」历史可反映作者发现计数（若改 sync_runs 字段则扩展；最小可复用 discovered/enqueued 合计）

## Acceptance Criteria

### 既有（应已满足）
- [x] AC1–AC10（布局/收藏开关/直播瘦身等）— 以代码质检为准

### 新增
- [ ] AC11: 订阅作者可独立开关「同步作品」与「自动录制」
- [ ] AC12: 全量同步会对 `syncWorks=true` 作者拉取作品并入队下载（三渠道在已配置账号时）
- [ ] AC13: 关闭同步作品或移除订阅后，全量同步不再为该作者发现新作品；已有媒体保留
- [ ] AC14: live-poller 仅处理「自动录制」开启且为 otobanana 的订阅
- [ ] AC15: 作者来源作品不因收藏对账被标 `remoteInFavorites` 取消逻辑误伤
- [ ] AC16: Provider 无账号时作者同步跳过且不拖垮整次 sync

## Out of Scope

- 从关注一键订阅
- 删除后端 select API / 物理删 `enabled` 列
- 作者作品的「远程下架删除本地文件」
- 新媒体库大改

## Notes

- 本轮在已 in_progress 任务上扩 scope；实现前更新 `design.md` / `implement.md`。
- 三渠道 listAuthorWorks 为高风险项，优先对照 `docs/*-reverse_engineering*`。
