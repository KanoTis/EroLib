# Erolib — 自托管音声媒体备份库

Docker 自托管：将 **Otobanana / Koe-koe / Erovoice** 的收藏同步到本地，在浏览器中浏览、播放；支持 **Otobanana 直播订阅与录制**。

## 功能

| 模块 | 说明 |
|------|------|
| Providers | 配置三站账号（账密或 Cookie），凭证 AES 加密落库 |
| 同步 | 定时 / 手动拉取收藏列表，入队下载 |
| 媒体库 | 本地作品列表（分页）、详情、封面与音频播放；可刷新元数据 |
| 下载任务 | 查看队列状态；失败可在作品详情重试 |
| 直播 | Otobanana 关注中开播、历史主播、订阅录制、回放播放 |
| 设置 | 同步间隔等运行参数（保存后按新间隔调度） |
| 鉴权 | 可选本机登录（`AUTH_PASSWORD` 非空即启用） |

全局底部播放器：媒体库作品与直播回放共用，路由切换不中断。

远端取消收藏**不会删除**本地文件，仅标记「远端收藏=否」。

## 快速开始（Docker）

```bash
# 1. 编辑 docker-compose.yml
#    - CREDENTIALS_SECRET：必填，≥16 字符的随机串（勿用示例值）
#    - AUTH_PASSWORD：可选；非空则启用登录（AUTH_USERNAME 默认 admin）

# 2. 若 GHCR 包为私有，需先登录（token 需 read:packages）
# echo YOUR_PAT | docker login ghcr.io -u YOUR_GITHUB_USER --password-stdin

docker compose pull
docker compose up -d
curl -sS http://localhost:8080/api/health
# 浏览器打开 http://localhost:8080
```

- 默认镜像：`ghcr.io/kanotis/erolib:latest`（GitHub Actions 构建推送）
- 本地改源码构建：在 `docker-compose.yml` 使用 `build: .`（可设 `image: erolib:local`），然后 `docker compose up -d --build`
- Compose 已设 `init: true`、`ipc: host`（直播录制依赖 Playwright Chromium）

### 卷挂载

| 容器路径 | 宿主机示例 | 说明 |
|---------|-----------|------|
| `/data` | `./data` | SQLite `app.db`、会话等 |
| `/media` | `./media` | 已完成备份：`{provider}/{authorId}/{workId}/`；直播：`{provider}/live/...` |
| `/cache` | `./cache` | 下载临时文件（可清空） |

### 环境变量

| 变量 | 默认 | 说明 |
|------|------|------|
| `PORT` / `HOST` | `8080` / `0.0.0.0` | 监听地址 |
| `AUTH_USERNAME` | `admin` | 登录用户名 |
| `AUTH_PASSWORD` | 空 | 空则**关闭鉴权**；公网切勿暴露 |
| `CREDENTIALS_SECRET` | （开发默认弱密钥） | 加密 Provider 凭证，**≥16 字符**；生产必改 |
| `DATA_DIR` / `MEDIA_DIR` / `CACHE_DIR` | `/data` 等 | 数据与媒体路径 |
| `SYNC_INTERVAL_HOURS` | `4` | 自动同步间隔（小时） |
| `MAX_DOWNLOAD_CONCURRENCY` | `2` | VOD 下载并发 |
| `WEB_DIST_DIR` | 镜像内 SPA 路径 | 静态前端目录 |
| `FFMPEG_PATH` | （可选） | 本机 ffmpeg 路径；Docker 已内置，一般无需设置 |
| `PLAYWRIGHT_BROWSERS_PATH` | 镜像内 `/ms-playwright` | 浏览器二进制目录；镜像已配置 |
| `NODE_ENV` | 生产镜像为 `production` | 运行环境 |

完整加载逻辑见 `apps/server/src/config.ts`（`FFMPEG_PATH` 由 `providers/ffmpeg.ts` 读取）。

## 使用流程

1. **Providers**：添加 Otobanana / Koe-koe / Erovoice（账密或 Cookie）→ **测试** 登录  
2. **同步**：点「立即同步」；也可依赖定时同步  
3. **下载任务**：观察队列；失败可在作品详情重试  
4. **媒体库**：仅状态为 `downloaded` 的作品可播；支持搜索 / 筛选 / 加载更多  
5. **直播**（Otobanana）：同步关注历史 / 查看开播 → 订阅 → 自动录制 → 在直播页或媒体库播放回放  
6. **设置**：调整同步间隔

### 站点说明

| 站点 | 说明 |
|------|------|
| Otobanana | VOD 收藏同步与下载；直播订阅与录制 |
| Koe-koe | 收藏页解析与音频下载 |
| Erovoice | 站点 HLS（约 75kbps AAC）→ 服务端解密转码为 `audio.mp3`，需要 **ffmpeg** |

**直播录制**：镜像内已安装 Playwright Chromium headless shell。本地开发需自行安装浏览器：

```bash
pnpm --filter @erolib/server exec playwright install chromium
# 或（在 apps/server 下）
pnpm exec playwright install chromium
```

## 本地开发

要求：

- Node.js **≥ 20**（Docker 镜像为 Node 22）
- pnpm **10**（见根目录 `packageManager`）
- 本机 **ffmpeg**（Erovoice 下载 / 转码；需在 `PATH` 或设置 `FFMPEG_PATH`）
- 直播录制：本机 Playwright Chromium（见上）

```bash
pnpm install
pnpm --filter @erolib/shared build
pnpm dev:server   # :8080
pnpm dev:web      # :5173，/api 代理到 8080
# 或
pnpm dev          # server + web 并行
```

未设置目录类环境变量时，默认使用当前工作目录下的 `./data`、`./media`、`./cache`。开发可直接沿用默认 `CREDENTIALS_SECRET`；生产务必覆盖。

构建与测试：

```bash
pnpm build
pnpm test         # server 单测
pnpm typecheck
pnpm start        # 生产模式启动 server（需先 build）
```

## 项目结构

```
apps/server       Hono API · 任务调度 · Providers · 直播录制 · SQLite
apps/web          React SPA（媒体库 / Providers / 同步 / 任务 / 直播 / 设置）
packages/shared   共享类型与契约
```

## 安全提示

- 未设置 `AUTH_PASSWORD` 时，任意能访问端口的人可操作实例，**仅适合本机或受信任内网**
- 务必更换 `CREDENTIALS_SECRET`，且勿提交真实密钥到仓库
- Provider 凭证加密落库；删除账号绑定不会删除已下载媒体
- 勿将含真实账号的 `./data` 提交到版本库

## 故障排查

| 现象 | 可能原因 | 处理 |
|------|----------|------|
| 拉镜像 401 / denied | GHCR 私有包未登录 | `docker login ghcr.io`，token 含 `read:packages` |
| `/api/health` 不通 | 容器未起或端口占用 | `docker compose ps` / `logs`；检查 `8080` 映射 |
| Erovoice 下载失败且提示 ffmpeg | 本机无 ffmpeg | 安装 ffmpeg 或设置 `FFMPEG_PATH`；Docker 镜像已内置 |
| 直播录制 `Executable doesn't exist` | 未装 Playwright 浏览器 | Docker 用最新镜像；本地执行 `playwright install chromium` |
| 改了 `SYNC_INTERVAL_HOURS` 未生效 | 间隔以**设置页/库内配置**为准 | 在 Web **设置**中保存；compose 环境变量多为首次/默认相关 |
| 登录后立刻掉线 / Cookie 异常 | 反代未转发 Cookie 或 HTTPS 配置 | 同源访问或正确配置反代；当前 session cookie 为 httpOnly |

## 技术栈（概要）

- 后端：Hono、Drizzle、libSQL/SQLite、Zod、Playwright、ffmpeg  
- 前端：React 19、React Router 7、Vite 6  
- 部署：Docker multi-stage（Node 22 + ffmpeg + Chromium shell）、GHCR `ghcr.io/kanotis/erolib`
