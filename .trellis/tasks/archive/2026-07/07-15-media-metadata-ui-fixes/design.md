# Design: 媒体库元数据与 UI 修复

## 1. Overview

在现有 Hono + React 架构上补齐元数据链路，不改产品模型：

```text
Provider.getWork  ──► title / description / coverUrl / sourceUrl
        │
        ▼
download (cache)  ──► audio + optional cover
        │
        ▼
tagAudio (ID3)    ──► write tags into audio file
        │
        ▼
commitCacheToMedia + DB update
        │
        ▼
GET /api/works/.../cover  ──► SPA <img>
```

存量：`POST .../refresh-metadata` → getWork → 可选重下封面 → 原地改 audio ID3 → 更新 DB/`meta.json`。

## 2. Boundaries

| 模块 | 改动 | 不改 |
|------|------|------|
| `providers/koekoe` | 标题/简介解析；`sourceUrl`；**coverUrl 恒 null**（不抓性别图标） | 登录/书签分页 |
| `providers/otobanana` | 补 `sourceUrl`；确认 description | 收藏分页 |
| `providers/*` 契约 | `WorkMetadata` 增加 `sourceUrl?` | Provider 接口方法集 |
| `jobs/runner` | 下载后打 ID3；实现 refresh-metadata | 同步策略/4h 调度 |
| `app` API | cover 路由；refresh 路由 | works 列表 filter 语义（已有） |
| `web` | 封面 img、渠道筛选、同步/任务拆页、刷新按钮 | 播放器能力 |
| `shared` | 类型字段 | 状态机 |

## 3. Contracts

### 3.1 WorkMetadata 扩展

```ts
interface WorkMetadata {
  // existing…
  description?: string;
  coverUrl?: string | null;
  /** Canonical public page for the work */
  sourceUrl?: string | null;
  extra?: Record<string, unknown>;
}
```

`sourceUrl` 由各 provider 在 `getWork` 填入；runner 也可按规则兜底生成。

### 3.2 Source URL 规则

| Provider | URL |
|----------|-----|
| koekoe | `https://koe-koe.com/detail.php?n={workId}` |
| otobanana | `https://otobanana.com/general/cast/{workId}` |
| erovoice | 预留；未实现时 `null` |

### 3.3 Cover API

```http
GET /api/works/:provider/:workId/cover
```

- 404：作品不存在 / 无 `coverRelPath` / 文件缺失
- 200：`image/jpeg|png|webp|…`，支持可选 ETag；不必 Range
- 鉴权：与 `/audio` 相同中间件

前端：

```ts
api.coverUrl(provider, workId) => `/api/works/${provider}/${workId}/cover`
```

列表/详情：`coverPath` 非空时 `<img src={api.coverUrl(...)} alt="" />`，`onError` 回退占位。

#### 3.3.1 Provider cover policy

| Provider | coverUrl 来源 | 说明 |
|----------|---------------|------|
| otobanana | `thumbnail_url`，否则 `user.avatar_url` | 真实图，可下载 |
| koekoe | **始终 `null`** | 站点仅有 `/img/female|male|couple*.png` 性别图标，**不是**作品封面/作者头像；删除现有 icon→coverUrl 逻辑 |
| erovoice | MVP-2 | — |

刷新元数据时同样遵守：Koe-koe 不得因「有 icon」去下载/覆盖 cover 文件。

### 3.4 Refresh metadata API

```http
POST /api/works/:provider/:workId/refresh-metadata
→ { ok: true } | { error }
```

语义（runner 内聚）：

1. 加载 work + provider account；无账号 → 400
2. `ensureSession` + `getWork`
3. 更新 title/description/author*/duration；写 `meta.json`（含 sourceUrl）
4. 若 `meta.coverUrl`：下载到 media 目录临时文件 → 替换 `cover.*` → 更新 `coverRelPath`
5. 若 `status===downloaded` 且 audio 存在：`tagAudio(audioPath, meta, coverPath?)`
6. 不改 status（除非此前 failed 且刷新成功且音频仍在，可保持 downloaded）
7. **不**强制重下音频

并发：同一 work 若有 `queued/running` job，返回 409 或排队到 job 结束后再刷（实现取 409 + 文案「下载进行中」更简单）。

### 3.5 ID3 tagging

新模块：`apps/server/src/media/id3.ts`

```ts
export async function tagAudioFile(opts: {
  audioPath: string;
  meta: WorkMetadata;
  coverPath?: string | null;
}): Promise<{ tagged: boolean; reason?: string }>
```

- 依赖：`node-id3`（纯 JS，写 ID3v2；适合 MP3）
- 仅当 ext 为 `mp3`（或嗅探为 MPEG audio）时写入；否则 `{ tagged:false, reason:"unsupported" }`
- 字段映射：
  - title → TIT2
  - artist → TPE1
  - comment → COMM（description）
  - album → `Erolib / {provider}` 或 provider 显示名
  - image → APIC from cover file
  - URL → `www` / `userDefinedUrl`（node-id3 的 `www` 或 `raw` 帧）；若库限制，COMM 追加 `\nsource_url={url}`

调用点：

1. `processJob`：`commitCacheToMedia` **之前**对 cache 内 audio 打标签（提交后文件即带标签）
2. `refreshMetadata`：对 media 内 audio 原地打标签

失败策略：**不阻断**下载成功；log/记 `extra.id3Error` 可选。刷新时 ID3 失败返回 200 + warning 或 500——取 **200 ok，error 字段可选**，避免封面/标题已更新却整体失败。

### 3.6 Koe-koe parseDetail 修正

问题：首个 `<h2>` / `<title>` 可能不是作品标题（站点多 h2、或 title 为营销句）。

策略（按序）：

1. `og:title` meta（若存在且 scrub 后非空）
2. 主内容区更具体选择：靠近 `<audio>` / `.audioTime` 的 `h2`，或文档约定结构
3. 全页 `h2` 中**排除**已知站点文案 / 过长短语黑名单
4. 最后才用 `<title>`，并 strip ` | koe-koe` 类后缀
5. description：`div.desc.detail` 内文本；fallback `.desc`；HTML 去标签、trim

- `スマートフォンから録音した音声を投稿できる`
- `エロ声やオナニーボイス`
- 纯站点名 `koe-koe` / `コエコエ`

**封面：** 解析到的 gender icon **不得**写入 `coverUrl`（可把 gender 记入 `extra.genderIcon` 仅供调试，默认不落盘图片）。

单测：

- 正常 h2 标题
- HTML 含宣传句在 title/h2 时仍取真标题
- description 解析

### 3.7 UI 拆页

| 路由 | 页面 | 内容 |
|------|------|------|
| `/sync` | `SyncPage` | 立即同步按钮、`sync_runs` 表 |
| `/jobs` | `JobsPage` | 仅 `download_jobs` |
| `/jobs` 旧混合行为移除 | | |
| 可选 `/tasks` alias | 同 Jobs | 不做也可 |

侧栏：

- 媒体库 `/`
- Providers `/providers`
- 同步 `/sync`
- 下载任务 `/jobs`
- 设置 `/settings`

`JobsPage` 删除 sync 区块与 sync 按钮；迁到 `SyncPage`。

### 3.8 Library filter

`LibraryPage` 增加 `<select>` provider；`load()` 传 `api.works({ q, status, provider })`。  
后端已支持，无需 schema 变更。

## 4. Data flow

### 新下载

```text
getWork → download(cache)
  → tagAudio(cache/audio)
  → commitCacheToMedia
  → DB: title, description, coverRelPath, metaJson(+sourceUrl)
```

### 刷新元数据

```text
getWork → update fields
  → optional cover re-fetch into media
  → tagAudio(media/audio) if present
  → rewrite meta.json
  → DB update
```

### 封面展示

```text
DB.coverRelPath set → SPA img → GET cover → read MEDIA_DIR file
```

## 5. Compatibility

- DB schema：**无强制 migration**（description/cover 列已有）。`sourceUrl` 放 `metaJson`，不必新列。
- 旧客户端：新增路由/字段向后兼容。
- 已下载无 ID3：靠 R7 单条刷新。
- Docker：新增 npm 依赖 `node-id3`，重建镜像即可。

## 6. Trade-offs

| 选项 | 取舍 |
|------|------|
| `node-id3` vs ffmpeg | 无系统依赖、仅 MP3；够用 |
| 刷新不重下音频 | 快、省流量；音频本体损坏需走 retry 下载 |
| cover 独立路由 vs 内嵌 base64 | 路由可缓存、列表更轻 |
| 同步/任务拆页 | 导航多一项；职责清晰 |
| Koe-koe 性别图标当封面 | 误导且三件作品共用一图；占位更诚实 |

## 7. Risks

| 风险 | 缓解 |
|------|------|
| Koe-koe HTML 变体 | 多策略 + 单测 + 黑名单 |
| ID3 写坏文件 | 先写 temp 再 rename；失败保留原文件 |
| 刷新时 session 失效 | 与下载相同 ensureSession；错误回显 |
| 封面热链鉴权 cookie | 同源 `/api` + credentials include（现有 `request`） |

## 8. Rollback

- 回退 provider 解析与 UI 路由即可；ID3 已写入的文件保留标签无害
- 移除 cover 路由后前端回退占位
