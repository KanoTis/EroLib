# Otobanana 直播自动录制

## Goal

在 erolib 中支持 **OTOBANANA 直播自动录制**：用户手动选定要录的作者后，系统发现其开播、定位 `room_id` 并创建录制任务。  
**Phase 1** 交付发现、独立 live 任务模型与基础 Web UI；**Phase 2** 在媒体协议打通后真正录音频入库。

## Background

- 当前 erolib 只覆盖三站 VOD 同步/下载；`Provider`、`download_jobs`、`hls.ts` 均面向短任务 VOD。
- 本任务范围：**仅 Otobanana**（不做 Koe-Koe / EroVoice）。
- 作者 → room 已实测可用；`stream_service=realtime` 的媒体拉取尚未闭环，故采用分阶段交付。

## Confirmed Facts

### 作者 → room

| 输入 | 结果 | API |
|------|------|-----|
| 作者 UUID 在播 | `200` + `room_id`，`is_open: true` | `GET /api/users/{userId}/onair`（匿名可用） |
| 作者 UUID 未播 | `404` | 同上 |
| 作者 UUID 列表形态 | `data: []` 或含 room | `GET /api/users/{userId}/livestreams` |
| username 作 path | 不可用 | `/api/users/{username}` / `.../onair` → 404 |
| username 搜索 | 可用 | `GET /api/users?is_adult=false\|true&search={username}`，结果需 **username 精确匹配**；成人/一般分区需两边查；去掉前导 `@` |

`room_id` 形态：`{stream_service}:{userId}:{sessionOrStreamId}`  
例：`realtime:802b8dfd-...:906a876a-...`

Room 关键字段：`room_id`、`post_ptr_id`、`post.user_id`、`post.user.username`、`post.user.name`、`is_open`、`stream_service`、`room_open_at`。

### 发现列表

- `GET /api/top/livestreams?is_adult=false|true`
- `GET /api/livestreams?is_adult=false|true`
- `GET /api/top/followeelivestreams`（需登录；无会话为空）

### 媒体层（Phase 2 blocker）

- 样本 `stream_service: "realtime"`，无公开 m3u8。
- 前端含 Amazon IVS player；`/api/livestreams/ivs/{id}/chats/token` 为聊天 token。
- 直播页未登录会跳登录。
- **room → 可录媒体 URL/协议仍开放。**

### 现有代码约束

- `Provider` 无 live API。
- `downloadHlsToTs` 拒绝无 `#EXT-X-ENDLIST` 的 live playlist。
- `download_jobs` 不适合长时间录制会话。

## Requirements

### R1 — 选定作者与发现（Phase 1）

- 用户可添加要自动录制的作者：**UUID 或 username**。
  - UUID：直接作为主键用于 `/onair`。
  - username：去掉 `@` 后，对 `is_adult=false/true` 两边执行 `/api/users?search=`，对结果 **username 精确匹配** 得到 UUID；零命中/多命中明确报错。
  - 持久化以 **author UUID 为主键**，保存 username/显示名便于展示。
- 发现来源：
  - **已选定作者**：轮询 `/users/{id}/onair`。
  - **Followee 在播**（依赖已配置的 Otobanana 登录会话）：`/top/followeelivestreams`，仅展示，**不自动录制**。
- 用户可从 followee 在播列表 **手动选定** 作者加入录制名单。
- 仅已选定作者开播时创建录制任务；未选定 followee 不得建任务。

### R2 — 独立 live 数据模型与幂等（Phase 1）

- 使用独立表（建议：`live_subscriptions` + `live_record_jobs`），与 VOD `works` / `download_jobs` 分离。
- 已选定作者开播 → 创建 live 任务；Phase 1 允许状态为 `pending_media` / `blocked`（媒体未通）。
- 幂等键：`provider + room_id`（或 `post_ptr_id`）唯一，禁止并行重复任务。
- 下播 / 连续 onair `404` → 任务可标记结束；Phase 1 不要求音频文件。
- Phase 1 **不**写入普通 `works`。

### R3 — 基础 Web UI + 可观测性（Phase 1）

- Web UI 必做：
  - 添加/移除选定作者（UUID/username）
  - followee 在播列表 + “选定录制”
  - live 任务列表（状态、room、作者、错误信息）
- 能看到轮询/最近检测结果与失败原因（会话失效、解析失败、媒体阻塞等）。

### R4 — 真实录制入库（Phase 2）

- 媒体协议解阻后，对已选定在播场次自动录制。
- 结果归属独立 live 存储/任务；默认不强制导入 `works`（后续可选增强）。
- Phase 1 状态机必须能挂接 recorder，避免推倒重来。

## Acceptance Criteria

- [ ] AC1: 给定已选定作者 UUID，能判断是否在播；在播时存储 `room_id` 与作者元数据。
- [ ] AC2: 未在播作者、以及 followee 列表中**未选定**作者，都不会创建录制任务。
- [ ] AC3: 同一 `room_id`/`post_ptr_id` 不会并行创建重复任务。
- [ ] AC4 (Phase 1): 已选定作者开播后出现可观测 live 任务；媒体未通时为明确等待/阻塞状态，非静默失败。
- [ ] AC5 (Phase 1): username 添加：精确解析成功可入库；失败返回明确错误。
- [ ] AC6 (Phase 1): 登录有效时可展示 followee 在播，并支持选定加入名单。
- [ ] AC7 (Phase 1): 基础 Web UI 可完成名单管理与任务状态查看。
- [ ] AC8 (Phase 2): 媒体可解后，已选定作者开播自动录制并产出可播放音频到 live 存储。
- [ ] AC9: 仅 Otobanana；不实现其他站 live。

## Out of Scope

- Koe-Koe / EroVoice 直播
- 弹幕/礼物采集入库（除非录制协议强依赖）
- 多账号矩阵、分布式录制节点
- 将 live 默认混入 VOD 媒体库 `works`
- 边录边播播放器
- 以非官方搜索参数（如 `?q=`）作为唯一 username 解析路径

## Resolved Decisions

| 决策 | 选择 |
|------|------|
| 交付策略 | 分阶段：Phase 1 发现+任务+UI；Phase 2 录制 |
| 自动录制触发 | 仅**手动选定**作者；followee 只作发现/展示 |
| 作者输入 | UUID + username（search API + 精确匹配） |
| 存储模型 | 独立 live 表，不与 VOD jobs/works 混用 |
| Phase 1 UI | 必须有基础 Web UI |

## Research Pointers

- `research/otobanana-live-author-room.md`
- `docs/otobanana_reverse_engineering.md`（列表/IVS 线索；作者→room 以本任务实测为准）
