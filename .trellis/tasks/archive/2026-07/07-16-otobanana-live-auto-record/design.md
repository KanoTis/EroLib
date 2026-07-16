# Design: Otobanana 直播自动录制（Phase 1 为主）

## Scope Boundary

| Phase | In | Out |
|-------|----|-----|
| Phase 1 | 选定作者、username 解析、onair 轮询、followee 展示、独立 live 表、任务幂等、基础 UI、媒体阻塞状态 | 真实拉流/转码/入库作品库 |
| Phase 2 | recorder 挂接、音频落盘、结束归档 | 其他站点、默认导入 `works` |

本 design 以 **Phase 1 可实施** 为完成标准；Phase 2 只定挂接点。

## Architecture

```text
Web UI (Live page)
    │ REST
    ▼
app.ts API  (/api/live/*)
    │
    ├─ live_subscriptions (选定作者)
    ├─ live_record_jobs   (场次任务)
    │
    ▼
LivePoller (JobRunner 旁路定时器)
    │ 对每个 enabled subscription
    │  GET /users/{authorId}/onair
    │  开播 → ensureLiveJob(room_id)
    │  下播 → close open jobs
    │
    ├─ Otobanana session (followee 列表 / 可选鉴权)
    └─ Phase 2: LiveRecorder.attach(job)  [hook only]
```

原则：

- **不扩展** 现有 VOD `Provider.download` 去扛长任务。
- **不复用** `download_jobs` 状态机。
- Otobanana HTTP 调用集中在 `providers/otobanana.ts`（或同目录 `otobanana-live.ts`），避免 app 层散落 URL。

## Data Model

### `live_subscriptions`

手动选定、会自动开任务的作者名单。

| 列 | 说明 |
|----|------|
| id | PK |
| provider | 固定 `otobanana`（预留扩展） |
| author_id | UUID，唯一 `(provider, author_id)` |
| username | 可空，展示/回填 |
| display_name | 可空 |
| enabled | bool，默认 true |
| last_onair_at | 最近检测到在播 |
| last_room_id | 最近 room |
| last_check_at | 最近轮询 |
| last_error | 轮询/解析错误 |
| created_at / updated_at | |

### `live_record_jobs`

一场直播一个任务（幂等）。

| 列 | 说明 |
|----|------|
| id | PK |
| provider | `otobanana` |
| author_id | UUID |
| room_id | 唯一 `(provider, room_id)` |
| post_ptr_id | 可空 |
| stream_service | 如 `realtime` |
| title | 可空 |
| state | 见状态机 |
| started_at | 开播/建任务 |
| ended_at | 下播或结束 |
| media_rel_path | Phase 2 |
| error | |
| meta_json | 原始 onair 摘要 |
| created_at / updated_at | |

### 状态机（`live_record_jobs.state`）

```text
discovered ──► pending_media ──► recording ──► completed
     │               │               │
     │               ▼               ▼
     └──────────► blocked         failed
                     │
                     ▼
                  ended (optional terminal when offline without media)
```

Phase 1 实际路径：

- 开播建任务 → `pending_media`（或直接 `blocked`，message=`media protocol unsupported`）
- 下播且无媒体 → `ended`（或 `failed` 仅用于异常）

Phase 2：

- `pending_media` → `recording` → `completed`（写 `media_rel_path`）

## Otobanana Live API Surface（服务端封装）

```ts
// conceptual
resolveAuthor(input: string): Promise<{ authorId, username, displayName }>
getUserOnair(authorId, session?): Promise<OnairRoom | null>  // 404 → null
listFolloweeLivestreams(session): Promise<OnairRoom[]>
// Phase 2 later:
// resolvePlayback(room): Promise<PlaybackSource>
```

`resolveAuthor`：

1. trim；像 UUID → 可选 `GET /users/{id}` 校验并取 username
2. 否则 strip `@`，并行/串行 `is_adult=false|true` + `search=`
3. exact `username` match；0/N → 错误

`getUserOnair`：匿名可；若有 provider session 可附带 Authorization。

`listFolloweeLivestreams`：必须有效 Otobanana 账号 session；失败返回明确错误给 UI。

## Backend API（erolib）

| Method | Path | 说明 |
|--------|------|------|
| GET | `/api/live/subscriptions` | 选定作者列表 |
| POST | `/api/live/subscriptions` | body: `{ input: string }` UUID 或 username |
| DELETE | `/api/live/subscriptions/:id` | 移除选定 |
| PATCH | `/api/live/subscriptions/:id` | `{ enabled?: boolean }` |
| GET | `/api/live/followees` | 当前 followee 在播（需 otobanana provider 登录） |
| POST | `/api/live/followees/:authorId/select` | 从 followee 选定加入 subscriptions |
| GET | `/api/live/jobs` | 任务列表（可 filter state） |
| POST | `/api/live/poll` | 可选：立即触发一轮轮询 |

Shared types 放 `@erolib/shared`：`LiveSubscriptionPublic`、`LiveRecordJobPublic`、`LiveOnairPublic`。

## Poller

- 挂在现有 `createJobRunner` 定时循环旁，或独立 `createLivePoller`，由 `index.ts` 启动。
- 默认间隔：建议 30–60s（settings 可后续加；Phase 1 可用常量）。
- 每轮：
  1. 读 `enabled` subscriptions
  2. 逐个 `getUserOnair`（有限并发，如 2–3）
  3. 在播：`INSERT OR IGNORE` job by `room_id`；更新 subscription last_* 
  4. 未播：若该 author 有 open job → 标记 `ended`
- followee 列表 **不** 由 poller 自动建任务；仅 UI 查询时拉取。

## Web UI

新页面 `/live`（导航入口 “直播”）：

1. **选定作者**
   - 输入框：UUID / username
   - 列表：username、显示名、enabled、最近在播、last_error、删除
2. **关注的人在播**
   - 刷新按钮；无登录提示去 Providers 配置 Otobanana
   - 行操作：选定录制
3. **录制任务**
   - 状态徽章、room_id、作者、时间、错误
   - 轮询刷新（对齐 JobsPage ~4s）

样式复用现有 `page` / `card` / `badge` / `toolbar`。

## Phase 2 Hook

```ts
interface LiveRecorder {
  canHandle(job: LiveRecordJobRow): boolean;
  start(job): Promise<void>;
  stop(job): Promise<void>;
}
```

Phase 1：`canHandle` 恒 false 或返回 unsupported → job 保持 `pending_media`/`blocked`。  
Phase 2：实现 Otobanana realtime/IVS recorder，写入 `media_rel_path`。

媒体目录建议：`{dataDir}/live/otobanana/{authorId}/{roomSafeId}/`（与 `media/` VOD 分离）。

## Compatibility / Migration

- SQLite 新表；无破坏性迁移。
- 现有 VOD 路径零改行为（除导航多一项）。
- Provider 账号仍用现有 `provider_accounts`；live followee 复用 otobanana session。

## Risks

| 风险 | 缓解 |
|------|------|
| username 搜索分区漏查 | 强制 false+true 两边 |
| followee 需登录 | UI 明确错误；选定作者 onair 可匿名 |
| 轮询限流 | 低并发 + 30–60s 间隔 |
| 媒体未通被误认为完成 | 禁止 Phase 1 进入 `completed` |
| room_id 字符特殊 | DB 原文存储；路径 sanitize |

## Rollback

- 删除/禁用 `/live` 路由与 poller 即可；表可保留。
- 无 VOD 数据依赖，回滚安全。
