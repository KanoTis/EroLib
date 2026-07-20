# 点击作者名跳转到作者页面

> Source: [GitHub issue #5](https://github.com/KanoTis/EroLib/issues/5)

## Goal

用户在媒体库与作品详情点击作者名后，进入该作者本地主页：看到头像与显示名，浏览其本地 VOD 与直播回放，并能查看/操作订阅状态。

## Background

- 作者名多处为纯文本；无作者页、无 `/authors/...` 路由。
- `authors` 表（含 `avatarPath`）已建但业务未读写；稳定键 `(provider, authorId)`。
- `GET /api/works` / `GET /api/live/media` 不支持 `authorId` 过滤。
- 订阅 API 已有（`enabled` / `syncWorks`）；手动添加默认两者为 `false`（`app.ts`、`SubscribeAddPage`）。
- otobanana 用户/直播响应含 `avatar_url`，尚未落库；koekoe 无真实头像。

## Requirements

### R1 — 作者页
- 路由：`/authors/:provider/:authorId`（`authorId` 使用 `encodeURIComponent`）。
- 展示：头像、显示名、本地 VOD 列表、本地直播回放列表、订阅状态与操作。

### R2 — 可点击入口（MVP）
- `LibraryPage` 点播卡片作者名、`WorkDetailPage` 作者字段。
- 复用 `AuthorLink`；`authorId` 缺失或 `_unknown` 时纯文本。
- 不做：Live / Sync / PlayerBar / SubscribeAdd。

### R3 — 列表过滤
- `GET /api/works` 与 `GET /api/live/media` 支持 query `authorId`（与现有 `provider` 组合）。

### R4 — 作者详情 API
- `GET /api/authors/:provider/:authorId` → 聚合 DTO（显示名、头像、订阅摘要）。
- `GET /api/authors/:provider/:authorId/avatar` → 本地头像文件（无则 404）。

### R5 — 头像懒加载落库
- 首次打开作者详情时：若无 `authors.avatarPath`，则按 provider 拉取远端头像 URL、下载到本地并 upsert `authors`；失败则占位，不阻塞页面其余内容。
- 有本地文件后优先读本地（类比 works cover）。

### R6 — 订阅
- 作者页展示是否已订阅及 `enabled` / `syncWorks`。
- 未订阅时可「添加订阅」：`enabled=false`、`syncWorks=false`（与手动添加一致）。
- 已订阅可切换开关（复用 `PATCH /api/live/subscriptions/:id`）；自动录制仅 otobanana。

## Acceptance Criteria

- [ ] AC1: 媒体库点播卡片点作者 → `/authors/{provider}/{authorId}`
- [ ] AC2: 作品详情点作者 → 同上
- [ ] AC3: 作者页显示显示名 + 头像（有图显示，无则占位）
- [ ] AC4: 作者页 VOD 列表仅该作者本地作品
- [ ] AC5: 作者页直播回放列表仅该作者本地 media
- [ ] AC6: 作者页可添加订阅或切换 `enabled` / `syncWorks`
- [ ] AC7: `authorId` 缺失/`_unknown` 不出现可点坏链

## Out of Scope

- PlayerBar 副标题链接
- Live / Sync / SubscribeAdd 作者链接
- 外链源站作者页
- 全站 provider 完整主页抓取（仅头像所需最小元数据）

## Decisions

| # | 决策 | 选择 |
|---|------|------|
| D1 | 页面内容 | VOD + 直播回放 + 订阅操作 |
| D2 | 头像 | 懒加载落库 `authors.avatarPath` |
| D3 | 入口 | 仅 Library + WorkDetail |
| D4 | 新订阅默认 | `enabled=false`, `syncWorks=false` |
