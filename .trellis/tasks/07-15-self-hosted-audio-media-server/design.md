# Design: 自托管音声媒体服务器

## 1. Overview

单容器 TypeScript 应用：Hono API + 静态 React SPA + 进程内同步/下载任务 + SQLite。  
核心链路：**凭证 → 拉收藏 → 入队下载 → 落盘 media → 本地库播放**。

```text
Browser (React SPA)
        │ HTTP
        ▼
┌───────────────────────────────┐
│  App container                │
│  Hono API  +  static web      │
│  Job runner (sync/download)   │
│  Provider plugins             │
│       │                       │
│       ├─ DATA_DIR  (SQLite)   │
│       ├─ MEDIA_DIR (library)  │
│       └─ CACHE_DIR (temp)     │
└───────────────────────────────┘
        │ outbound HTTPS
        ▼
  Otobanana / Koe-koe (/ Erovoice MVP-2)
```

## 2. Boundaries

| 模块 | 职责 | 非职责 |
|------|------|--------|
| `web` | UI：库、同步状态、账号配置、播放 | 不直连各站 API |
| `api` | HTTP、鉴权、CRUD、触发任务、媒体文件服务 | 不解析各站 HTML/业务细节 |
| `core/library` | 作品/作者统一模型、查询、状态机 | 不知 Provider 协议细节 |
| `core/jobs` | 同步任务、下载队列、调度（4h）、重试 | 不持有站点凭证明文逻辑以外的 UI |
| `core/crypto` | 凭证加解密（`CREDENTIALS_SECRET`） | — |
| `providers/*` | 登录、拉收藏、取元数据、下载到 cache | 不写最终 media 布局策略（由 library/storage 统一） |
| `storage` | 路径约定、cache→media 原子提交、清理 | — |

## 3. Provider Contract

所有 Provider 实现同一接口（名称可调整，语义固定）：

```ts
type ProviderId = 'otobanana' | 'koekoe' | 'erovoice'

interface ProviderAuth {
  mode: 'password' | 'cookie'
  username?: string
  password?: string
  cookieHeader?: string  // raw Cookie header or structured jar
}

interface RemoteWorkRef {
  provider: ProviderId
  workId: string
  authorId: string | null
  title?: string
  // provider-specific opaque payload optional
}

interface Provider {
  id: ProviderId
  /** Validate credentials; establish session (JWT/cookies). */
  login(auth: ProviderAuth): Promise<Session>
  /** Session still usable? */
  isSessionValid(session: Session): Promise<boolean>
  /** List bookmark/likes for backup source. */
  listFavorites(session: Session): AsyncIterable<RemoteWorkRef>
  /** Fetch normalized metadata + media URLs. */
  getWork(session: Session, workId: string): Promise<WorkMetadata>
  /** Download assets into cacheDir; return paths + checksums. */
  download(
    session: Session,
    work: WorkMetadata,
    cacheDir: string,
    onProgress?: (p: DownloadProgress) => void,
  ): Promise<DownloadResult>
}
```

- MVP-1 实现：`otobanana`, `koekoe`
- MVP-2 实现：`erovoice`（HLS 解密在 `download` 内完成，对外仍产出单一 audio 文件）

## 4. Data Model (SQLite)

最小表（字段可在实现时微调）：

| 表 | 用途 |
|----|------|
| `settings` | 同步间隔等（默认 4h） |
| `provider_accounts` | provider、enabled、auth_mode、encrypted_payload、session_blob、status |
| `authors` | provider + author_id + display_name + avatar_path? |
| `works` | provider + work_id + author_id + title + status + remote_in_favorites + paths + error |
| `sync_runs` | 每次同步：provider、started/finished、counts、error |
| `download_jobs` | work 外键、state(queued/running/done/failed)、progress、attempts |

**Work status：** `discovered` → `queued` → `downloading` → `downloaded` | `failed`  
**remote_in_favorites：** sync 时更新；false 不触发删盘。

## 5. Storage Layout

```text
DATA_DIR/app.db
MEDIA_DIR/{provider}/{authorId| _unknown}/{workId}/
  meta.json
  cover.jpg?
  audio.<ext>
CACHE_DIR/downloads/{jobId}/
CACHE_DIR/tmp/
```

- 提交：下载与校验在 cache 完成 → `rename`/copy 到 media → 更新 DB `downloaded`
- 播放：API 仅对 `downloaded` 作品提供 `/api/media/...` 或受鉴权的静态映射

## 6. Job Flow

### Sync (manual or every 4h)

1. 对每个 enabled account：解密凭证 → 确保 session 有效（账密可重登；cookie 失效则标记 account error）
2. `listFavorites` 全量枚举
3. Upsert works；新 work → `download_jobs`
4. 本地有、远端无 → `remote_in_favorites=false`
5. 写 `sync_runs`

### Download worker

1. 取 queued job（限并发，默认 1–2；Koe-koe 注意 1–2s 间隔）
2. `getWork` + `download` → cache
3. 原子落入 media 路径
4. 更新 work status / job done

进程内 runner 即可；状态全在 SQLite，容器重启后可恢复 queued/failed。

## 7. API Surface (MVP-1)

| Method | Path | 说明 |
|--------|------|------|
| POST | `/api/auth/login` | 本机 admin（若启用） |
| GET | `/api/health` | 健康检查 |
| GET/PUT | `/api/settings` | 同步间隔等 |
| GET/POST/PATCH/DELETE | `/api/providers` | 账号 CRUD（密码不回显明文） |
| POST | `/api/providers/:id/test` | 测登录 |
| POST | `/api/sync` | 立即同步（可指定 provider） |
| GET | `/api/sync/runs` | 同步历史 |
| GET | `/api/works` | 库列表/搜索 |
| GET | `/api/works/:provider/:workId` | 详情 |
| GET | `/api/works/.../audio` | 播放流（Range） |
| GET | `/api/jobs` | 下载队列 |

本机鉴权：配置了 `AUTH_PASSWORD` 则除 health 外需 session/cookie；未配置则开放（文档警告）。

## 8. Frontend Pages (MVP-1)

1. **Library** — 列表、搜索、状态筛选、播放
2. **Work detail** — 元数据、远端收藏标记、重试下载
3. **Providers** — 账密/Cookie 表单、启用、测试
4. **Jobs / Sync** — 队列、最近同步、手动同步按钮
5. **Settings** — 间隔、路径只读展示

## 9. Docker

```yaml
# sketch
services:
  app:
    build: .
    ports: ["8080:8080"]
    environment:
      AUTH_USERNAME: admin
      AUTH_PASSWORD: ""
      CREDENTIALS_SECRET: change-me
      DATA_DIR: /data
      MEDIA_DIR: /media
      CACHE_DIR: /cache
      SYNC_INTERVAL_HOURS: "4"
    volumes:
      - ./data:/data
      - ./media:/media
      - ./cache:/cache
```

单镜像：Node 构建 web → 由 Hono 托管 `dist`。

## 10. Security

- 凭证 at rest：AES-GCM（或等价）+ `CREDENTIALS_SECRET`
- 日志禁止打印密码/完整 cookie
- 出站请求模拟合理 UA；遵守各站间隔
- 默认绑定文档强调反向代理与勿裸奔公网

## 11. Trade-offs

| 选择 | 收益 | 代价 |
|------|------|------|
| 进程内队列 | 运维简单 | 水平扩展差（可接受） |
| SQLite | 单文件备份 | 高并发写弱 |
| 仅下载后播 | 语义清晰 | 首播等待下载 |
| Cookie+账密 | 适配风控/2FA 边缘 | Cookie 过期需用户更新 |
| media 含 authorId | 便于按作者浏览磁盘 | 作者改名不改路径（ID 稳定） |

## 12. Rollback / Ops

- 升级：保留三 volume；跑 Drizzle migrate
- 回滚：旧镜像 + 同 volume；迁移需向后兼容或有 down migration
- 灾难：备份 `DATA_DIR` + `MEDIA_DIR`；cache 可不备份

## 13. MVP-2 Hook

`erovoice` Provider 实现同一 `download`：m3u8 → ts → AES → 合并为 `audio.m4a/mp3` 再提交 media。库/UI/任务无需分叉。
