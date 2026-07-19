# 完全移除 Playwright，直播录制仅保留 Go/pion native

## Goal

去掉 Node 侧 Playwright / Chromium 回退，直播录制**只**通过 `apps/live-record`（Go + pion）完成，缩小镜像与依赖面。

## Background

- PR #4 已合入：`LIVE_RECORDER=auto` 时优先 native，Playwright 仅作 fallback。
- 生产 Docker 仍安装 Chromium headless shell + `playwright` npm 包，镜像与本地 dev 成本高。
- 浏览器路径资产：`live-browser-script.js`、`copy-runtime-assets.mjs`、`probe-audio-levels.ts`。
- Spec `live-media-library.md` 仍要求「运行时拷贝 browser script」与「镜像装 Playwright」。

## Decisions

| # | 决策 | 结论 |
|---|---|---|
| D1 | 回退策略 | **硬切**：删除 browser 路径，不再提供 Playwright fallback |
| D2 | 配置面 | 去掉 `LIVE_RECORDER=auto\|browser`；仅保留 native（可保留 `LIVE_RECORDER_BIN` 覆盖路径） |
| D3 | 缺二进制 | 启动录制时明确失败（job `failed` + 可读错误），不静默降级 |
| D4 | 探测脚本 | 删除 `probe-audio-levels.ts`（不重写）；验证改用 `apps/live-record` CLI / 现有 smoke |
| D5 | Compose | 去掉 Playwright 相关说明与非必要 `ipc: host`；`init: true` 可保留（子进程回收） |
| D6 | 输出格式 | 不变：native → Ogg Opus（`audio/ogg`）；不恢复 WAV browser 路径 |

## Requirements

### R1 — Server 录制仅 native
- `live-recorder.ts` 只 spawn Go 二进制；删除 `chromium` / `page.evaluate` / script 加载逻辑。
- 找不到二进制：录制 job 失败并写清晰错误（含构建/设置 `LIVE_RECORDER_BIN` 提示）。

### R2 — 删除 Playwright 依赖与资产
- `apps/server/package.json` 移除 `playwright`；更新 lockfile。
- 删除：`live-browser-script.js`、`copy-runtime-assets.mjs`、`probe-audio-levels.ts`。
- Server `build` 不再依赖 runtime-assets 拷贝（`tsc` 即可，或保留无副作用的空步骤则不建议）。

### R3 — Config / env 收敛
- 删除 `LiveRecorderMode` 的 `auto` / `browser`（或整型收敛为仅 bin 路径配置）。
- 保留 `LIVE_RECORDER_BIN`（可选）；Docker 默认 `/usr/local/bin/live-record`。
- 删除 `PLAYWRIGHT_BROWSERS_PATH` 及相关文档。

### R4 — Docker / Compose 瘦身
- Dockerfile：去掉 `playwright install`、`/ms-playwright`、Playwright env；保留 Go 编译 stage + `live-record` 二进制 + ffmpeg。
- compose：去掉 browser 模式注释；评估去掉 `ipc: host`（原为 Chromium）；保留 `LIVE_RECORDER_BIN`。

### R5 — 文档与 Spec
- README：本地/部署只描述 Go 构建与 native；故障表去掉 Chromium 类条目。
- 更新 `.trellis/spec/backend/live-media-library.md`：去掉 browser-script / Playwright 决策；改为 native 二进制契约。
- `apps/live-record/README.md`：去掉 `LIVE_RECORDER=auto|browser` 表项。

### R6 — 兼容与行为
- 已有 Ogg 媒体库播放 / 删除 API 保持。
- 历史 WAV 文件若仍存在，服务端按扩展名提供 `audio/wav` 的现有逻辑保留（不主动迁移/删除）。

## Acceptance Criteria

- [ ] AC1：`apps/server` 无 `playwright` 依赖；源码无 `from "playwright"` / `chromium.launch`
- [ ] AC2：仓库内无 `live-browser-script.js`、`probe-audio-levels.ts`、`copy-runtime-assets.mjs`（或 copy 脚本不再被 build 引用）
- [ ] AC3：Dockerfile 无 `playwright install` / `PLAYWRIGHT_BROWSERS_PATH` / Chromium 安装层
- [ ] AC4：镜像仍包含可执行 `/usr/local/bin/live-record`；runtime 仅依赖 Node + ffmpeg + live-record（无浏览器）
- [ ] AC5：`LIVE_RECORDER=browser` 或 `auto` 不再作为支持模式；缺二进制时录制失败信息可读
- [ ] AC6：`pnpm --filter @erolib/server typecheck` 与现有 server tests 通过
- [ ] AC7：`live-media-library` spec 与 README 与代码一致（native-only）
- [ ] AC8：live-poller 仍可 `ensureStarted` / `stop` / 并发上限；输出仍为 Ogg 入库路径

## Out of Scope

- 改写/替换 `apps/live-record` 协议或容器网络调试
- 把历史 WAV 批量转 Ogg
- 非 Otobanana 渠道直播
- 重新引入任何无头浏览器方案

## Notes

- 前置：PR #4 已在本地 merge（`ce52542`）；实现基于当前 master。
- 本地 dev 硬要求：能 `go build` 出 `apps/live-record` 或设 `LIVE_RECORDER_BIN`。
- 实现前需 `design.md` + `implement.md`，再 `task.py start`。
