# Fix GHCR image Playwright chromium missing

## Goal

生产 GHCR 镜像内可成功 `chromium.launch()`，使 Otobanana live 录制在容器中可用；并按官方建议加固 compose 运行参数，降低 Chromium 在 Docker 中的稳定性问题。

## Background

- 生产报错：`browserType.launch: Executable doesn't exist at /root/.cache/ms-playwright/chromium_headless_shell-1228/...`
- 触发路径：`apps/server/src/jobs/live-recorder.ts` → `chromium.launch({ headless: true, ... })`
- 依赖：`apps/server` 使用 `playwright@^1.61.1`（lock `1.61.1`）；仅使用 Chromium
- 当前 `Dockerfile` runtime 只装 `ca-certificates` + `ffmpeg`，未执行 `playwright install` / `install-deps`
- `pnpm install` 只装 npm 包，不下载浏览器；默认路径 `~/.cache/ms-playwright`
- 官方自建镜像路径：`npx playwright install --with-deps chromium`（可加 `--only-shell` 仅 headless）
- 官方 Docker 运行建议：`--init`、`--ipc=host`
- 镜像经 `.github/workflows/docker-publish.yml` 推 GHCR；`docker-compose.yml` 拉 `ghcr.io/kanotis/erolib:latest`
- 范围决策：**B** — 修 Dockerfile + compose 加 `init`/`ipc`

## Requirements

- **R1** Runtime 镜像必须包含与已装 Playwright 版本匹配的 Chromium（含 headless shell，因 `headless: true` 且未指定 channel）
- **R2** Runtime 镜像必须包含 Chromium 所需 Linux 系统依赖（Debian bookworm）
- **R3** 只装 Chromium，不装 Firefox/WebKit
- **R4** 保持现有多阶段结构、`ffmpeg`、env 与 `CMD`：`node apps/server/dist/index.js`；不切换到 `mcr.microsoft.com/playwright` 基镜像
- **R5** 浏览器安装使用镜像内与 `node_modules` 一致的 Playwright CLI（禁止浮动 `@latest`）
- **R6** `docker-compose.yml` 为 app 服务增加官方推荐：`init: true`、`ipc: host`
- **R7** 本地 `docker build` 后，容器内最小 smoke：`chromium.launch()` + `browser.close()` 成功
- **R8** 本任务交付可构建的 Dockerfile + compose；GHCR push 依赖现有 workflow / 已有凭证，不阻塞代码交付

## Acceptance Criteria

- [x] AC1：`Dockerfile` runtime 在 `node_modules` 就位后安装 Chromium + system deps，版本与 `playwright@1.61.x` 一致
- [x] AC2：本地构建镜像中 Node 可 `import { chromium } from "playwright"` 并 `await chromium.launch(); await browser.close()` 成功
- [x] AC3：不再出现 `Executable doesn't exist at .../ms-playwright/chromium_headless_shell-...`
- [x] AC4：仅 Chromium（或 only-shell 的 headless shell），无 Firefox/WebKit
- [x] AC5：`ffmpeg`、现有 env、`CMD` 仍可用
- [x] AC6：`docker-compose.yml` 含 `init: true` 与 `ipc: host`

## Out of Scope

- 改写 `live-recorder` 业务逻辑（除非镜像兼容强制需要 env/path）
- README 文档（范围 C）
- 强制本地开发 `playwright install` 流程
- 真实 Otobanana live E2E（需账号与直播间）
- 切换基镜像到官方 Playwright image
- 本会话内必须完成远程 GHCR push

## Technical Notes (constraints only)

- 安装须在 **runtime** stage，且不能把浏览器目录仅放在不会进入最终层的 BuildKit cache mount
- 可选：`PLAYWRIGHT_BROWSERS_PATH` 固定路径；若设置，runtime env 需一致
- headless-only 可用 `--only-shell` 减小体积（`live-recorder` 为 `headless: true` 且无 channel）

## Verification (2026-07-18)

- `docker build -t erolib:pw-smoke .` 成功；安装 `chromium_headless_shell-1228` → `/ms-playwright`
- `docker run --rm --init --ipc=host -w /app/apps/server erolib:pw-smoke node --input-type=module -e "import { chromium } from 'playwright'; const b = await chromium.launch(); await b.close(); console.log('ok')"` → `ok`（browser 149.0.7827.55）
- `ffmpeg -version` 正常；`/ms-playwright` 仅有 `chromium_headless_shell-1228` 与 Playwright 自带 `ffmpeg-1011`（无 Firefox/WebKit）
