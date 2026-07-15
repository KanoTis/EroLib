# Erolib — 自托管音声媒体备份库

Docker 自托管：备份 Otobanana / Koe-koe / Erovoice 收藏到本地，浏览器浏览与播放。

## 快速开始（Docker）

```bash
# 修改 docker-compose.yml 中的 CREDENTIALS_SECRET（必填，≥16 字符）
# 可选设置 AUTH_PASSWORD 启用本机登录

docker compose up --build -d
curl -sS http://localhost:8080/api/health
# 浏览器打开 http://localhost:8080
```

卷挂载：

| 容器路径 | 说明 |
|---------|------|
| `/data` | SQLite `app.db` |
| `/media` | 已完成备份 `{provider}/{authorId}/{workId}/` |
| `/cache` | 下载临时文件（可清空） |

## 本地开发

```bash
pnpm install
pnpm --filter @erolib/shared build
pnpm dev:server   # :8080
pnpm dev:web      # :5173 proxy /api → 8080
```

Erovoice 下载需要本机 **ffmpeg** 在 `PATH`（或设置 `FFMPEG_PATH`）。Docker 镜像已内置。

构建与测试：

```bash
pnpm build
pnpm test
pnpm typecheck
```

环境变量见 `docker-compose.yml` / `apps/server/src/config.ts`。

## 使用流程

1. **Providers** 页配置 Otobanana / Koe-koe / Erovoice（账密或 Cookie）
2. **测试** 登录 → **同步 / 任务** 点「立即同步」
3. 下载完成后在 **媒体库** 播放（仅 `downloaded` 可播）
4. 远端取消收藏不会删本地文件，仅标记「远端收藏=否」

Erovoice 音频来自站点 HLS（约 75kbps AAC），服务端解密后转码为 `audio.mp3`。

## 结构

```
apps/server   Hono API + job runner + providers
apps/web      React SPA
packages/shared  共享类型
```
