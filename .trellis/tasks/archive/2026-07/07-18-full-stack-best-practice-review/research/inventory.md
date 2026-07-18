# L1 功能盘点

## Server API（`apps/server/src/app.ts`）

| 功能 | 入口 | 关键文件 | 依赖 | 实现摘要 |
|------|------|----------|------|----------|
| CORS | `app.use *` | app.ts:210 | hono/cors | 反射 origin 或 `*`，credentials true |
| 鉴权中间件 | `/api/*` | auth/session.ts | HMAC cookie | 除 health/login/status 外需 session |
| Health | GET `/api/health` | app.ts:231 | — | ok/version/time |
| 登录态 | GET `/api/auth/status` | app.ts:239 | cookie | 报告 authEnabled/authenticated |
| 登录/登出 | POST `/api/auth/login` `/logout` | app.ts:255 | env AUTH_* | 单用户 env 密码，HMAC token cookie |
| 设置读/写 | GET/PUT `/api/settings` | app.ts:278 | settings 表 | 同步间隔等 |
| Provider 列表/目录 | GET `/api/providers` `/catalog` | app.ts:318 | db+crypto | 解密仅用于 hasPassword/hasCookie |
| Provider CRUD+测试 | POST/PATCH/DELETE/test | app.ts:334 | providers+crypto | 保存前 verify login（validate-on-save） |
| 同步触发/历史 | POST `/api/sync` GET `/sync/runs` | app.ts:540 | JobRunner | fire-and-forget triggerSync |
| 作品库 | GET `/api/works` 详情 | app.ts:573 | works | 搜索/筛选/分页 |
| 重试下载 | POST `.../retry` | app.ts:620 | downloadJobs | 入队+kickDownloads |
| 音频 Range | GET `.../audio` | app.ts:643 | fs stream | 206 Range 播放 |
| 封面 | GET `.../cover` | app.ts:704 | path.join media | 按 coverRelPath 读文件 |
| 刷新元数据 | POST `.../refresh-metadata` | app.ts:736 | runner | 下载中 409 |
| 下载任务列表 | GET `/api/jobs` | app.ts:754 | join works | 最近 100 |
| Live 订阅 CRUD | `/api/live/subscriptions` | app.ts:940 | liveSubscriptions | Otobanana 作者 |
| Live 关注在播 | GET `/api/live/followees` | app.ts:1043 | otabana-live API | 需 session token |
| Live 历史缓存 | GET/POST history | app.ts:1092 | historySyncer | 本地缓存+后台同步 |
| Live 选中关注 | POST select | app.ts:1184 | subscriptions | 幂等 insert |
| Live jobs/poll | GET jobs POST poll | app.ts:1232 | livePoller | 手动 poll |
| Live 媒体库 | GET `/api/live/media` + audio | app.ts:1261 | liveMedia | Range 播放 |
| SPA 静态 | `/*` | app.ts:1348 | serveStatic | 生产 webDistDir |

## Jobs

| 功能 | 入口 | 关键文件 | 依赖 | 实现摘要 |
|------|------|----------|------|----------|
| VOD 同步 | interval / POST sync | jobs/runner.ts | providers | listFavorites → upsert works → enqueue |
| VOD 下载泵 | kickDownloads | runner.ts:475 | 并发配置 | claim queued→running，失败标 failed |
| 启动恢复 | recoverOnStart | runner.ts:518 | — | running 改回 queued |
| 本地缺文件再下 | enqueueDownload | runner.ts:139 + paths | isLocalAudioAvailable | downloaded 但 0-byte/缺失再入队 |
| Live 轮询 | LivePoller | live-poller.ts | otabana API | 订阅作者开播→录制 job |
| Live 录制 | LiveRecorder | live-recorder.ts | Playwright chromium | 浏览器内脚本抓流写文件 |
| Live 历史同步 | LiveHistorySyncer | live-history-sync.ts | followee APIs | 缓存作者场次 |

## Providers

| 功能 | 入口 | 关键文件 | 依赖 | 实现摘要 |
|------|------|----------|------|----------|
| 注册表 | getProvider | providers/index.ts | — | otabana/koekoe/erovoice |
| Otobanana VOD | login/list/get/download | otabana.ts | HTTP/JWT | 收藏同步与下载 |
| Otobanana Live | resolve/list | otabana-live.ts | API v2/v3 | 作者解析、在播、历史 |
| Koe-koe | HTML 解析 | koekoe.ts | fetch | 收藏页+详情音频 |
| Erovoice | HLS 解密转码 | erovoice.ts,hls.ts,ffmpeg.ts | ffmpeg | 约 75kbps→mp3 |
| 下载工具 | fetchToFile | download-utils.ts | — | 进度回调 |

## Auth / Crypto / Storage / DB / Media

| 功能 | 入口 | 关键文件 | 依赖 | 实现摘要 |
|------|------|----------|------|----------|
| 配置 | loadConfig | config.ts | env | CREDENTIALS_SECRET≥16；默认 dev secret |
| Session | create/verify token | auth/session.ts | HMAC-SHA256 | 14 天；httpOnly+Lax；无 Secure 标志 |
| 凭据加密 | encrypt/decryptJson | crypto/credentials.ts | AES-256-GCM | 密钥=SHA256(secret) |
| 路径 | mediaWorkDir/liveMediaDir | storage/paths.ts | sanitize | provider/author/work；cache→commit |
| DB | createDb+migrate | db/client.ts schema.ts | libsql+drizzle | 手写 SQL migrate 全表 |
| ID3 | tagAudioFile | media/id3.ts | node-id3 | soft-fail 不挡下载 |

## Web

| 功能 | 入口 | 关键文件 | 依赖 | 实现摘要 |
|------|------|----------|------|----------|
| 路由壳 | App.tsx | pages/* | RR7 | 库/详情/Providers/同步/任务/直播/设置 + 登录门禁 |
| API 客户端 | api.ts | fetch credentials | shared 类型 | 统一错误 error 字段 |
| 全局播放器 | PlayerProvider+PlayerBar | player/PlayerContext.tsx, PlayerBar, types, mediaSession | Media Session | VOD+Live 统一 track id；路由切换不卸载 |
| 登录页 | LoginPage | pages/LoginPage.tsx | auth API | auth 开启时门禁 |
| 媒体库 | LibraryPage | pages/LibraryPage.tsx | works + live/media | 合并 VOD/Live；type 筛选 |
| 作品详情 | WorkDetailPage | pages/WorkDetailPage.tsx | works API | 播放/重试/刷新元数据 |
| Providers | ProvidersPage | pages/ProvidersPage.tsx | providers API | CRUD + test |
| 同步 | SyncPage | pages/SyncPage.tsx | sync API | 手动同步 + 历史 |
| 任务 | JobsPage | pages/JobsPage.tsx | jobs API | 下载队列状态 |
| 直播 | LivePage | pages/LivePage.tsx | live/* API | 订阅/在播/历史/录制/播放 |
| 设置 | SettingsPage | pages/SettingsPage.tsx | settings API | 同步间隔等 |

## Shared / Docker

| 功能 | 入口 | 关键文件 | 依赖 | 实现摘要 |
|------|------|----------|------|----------|
| 共享类型 | packages/shared | index.ts | — | Provider/Work/Live/Job 公共契约 |
| 镜像构建 | Dockerfile | multi-stage Node22 | pnpm | ffmpeg + `PLAYWRIGHT_BROWSERS_PATH` + runtime `playwright install --with-deps --only-shell chromium`（`77799e6`） |
| 编排 | docker-compose.yml | 8080 卷 | — | `init: true`、`ipc: host`；AUTH_PASSWORD 默认可空；示例 secret |

## 测试（server）

- `test/crypto-paths.test.ts` — 加解密、路径、isLocalAudioAvailable
- `test/koekoe-parse` / `erovoice-parse` / `hls-parse` / `otobanana-live` / `id3`
- **无** HTTP 路由集成测试、**无** job runner 集成测试、**无** web 测试
