# Docker runtime 生产依赖裁剪瘦身

## Goal

在**不影响功能**的前提下，缩小 GHCR/本地 Docker 镜像：runtime 只带 server 生产依赖 + web dist + live-record + ffmpeg，去掉全量 monorepo `node_modules` 与 runtime 内 pnpm/corepack。

## Decisions

| # | 决策 | 结论 |
|---|---|---|
| D1 | 依赖裁剪 | build 后 `pnpm --filter @erolib/server deploy --prod` 产出可运行目录 |
| D2 | runtime 工具链 | 不装 corepack/pnpm；CMD 直接 `node` |
| D3 | 布局 | 部署根为 `/app`（server deploy 输出）；静态资源 `/app/web/dist`；`WEB_DIST_DIR` 对齐 |
| D4 | ffmpeg / live-record | **保留** apt ffmpeg 与 Go 二进制（本任务不改） |
| D5 | alpine / 静态 ffmpeg | 不做 |

## Requirements

### R1 — 生产依赖部署
- Dockerfile build 阶段在 shared/web/server 构建完成后，对 `@erolib/server` 执行 `deploy --prod`。
- Runtime 只 COPY deploy 产物 + web dist + live-record；不再 COPY 整棵 monorepo `node_modules`。

### R2 — Runtime 无 pnpm
- Runtime 镜像不含 corepack prepare / pnpm。
- 启动：`node dist/index.js`（或 deploy 布局下等价路径）。

### R3 — 功能不变
- 环境变量语义保持（`DATA_DIR`/`MEDIA_DIR`/`CACHE_DIR`/`LIVE_RECORDER_BIN`/`CREDENTIALS_SECRET` 等）。
- Erovoice 仍可找到系统 `ffmpeg`。
- 直播仍用 `/usr/local/bin/live-record`。
- Web SPA 仍由 server 静态托管（`WEB_DIST_DIR`）。

## Acceptance Criteria

- [ ] AC1：Dockerfile runtime 无 `corepack` / `pnpm` / 全量 monorepo node_modules 三路径 COPY
- [ ] AC2：runtime 含 server 生产依赖（含 `@libsql/client` native 绑定）与 `dist`
- [ ] AC3：`WEB_DIST_DIR` 指向镜像内 web 构建产物且与 compose/README 一致
- [ ] AC4：`LIVE_RECORDER_BIN=/usr/local/bin/live-record` 与 ffmpeg 仍安装
- [ ] AC5：本地 `docker build` 成功，或至少 Dockerfile 契约可审；`pnpm` server typecheck 无回归（若仅改 Docker 则跳过业务测）
- [ ] AC6：README 若写镜像路径/启动方式则同步

## Out of Scope

- 换 alpine、换静态 ffmpeg
- 业务代码功能变更
- remove-playwright 已完成项

## Notes

- 前置：Playwright 已移除；当前体积瓶颈为全量 node_modules + ffmpeg + 基镜像。
