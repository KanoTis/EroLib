# Design: remove-playwright

## Boundaries

| 层 | 改动 |
|----|------|
| `apps/server` | 砍 browser 录制；config 收敛；删依赖/脚本 |
| `apps/live-record` | 不变协议；文档 env 表更新 |
| Docker / compose / README | 去掉 Chromium 与 Playwright 说明 |
| Spec | `live-media-library.md` 决策段改写 |
| Web | 无 UI 变更（已支持 ogg） |

## Target architecture

```
live-poller → createLiveRecorder
                → resolveNativeBin (required)
                → spawn live-record -token … -post-ptr-id … -out audio.ogg
                → finalize live_media (audio/ogg)
```

无 Chromium、无 page.evaluate、无 WAV browser 路径。

## Config contract

| Env | 语义 |
|-----|------|
| `LIVE_RECORDER_BIN` | 可选；绝对路径或 PATH 名。未设则搜现有 candidate 列表 |
| ~~`LIVE_RECORDER`~~ | **移除**（或若保留兼容：仅接受 `native`，其它值 warn + 当 native） |

推荐：**移除** `LiveRecorderMode` 与 `LIVE_RECORDER`，只留 `liveRecorderBin: string | null`。  
兼容选项（若担心外部 compose）：解析到非空未知值时 log warn，一律按 native。

**本任务采用**：删除 mode；仅 `LIVE_RECORDER_BIN`；compose/Dockerfile 删 `LIVE_RECORDER=auto`。

## `live-recorder.ts` shape

保留：
- `LiveRecorder` 接口、`ActiveSession`、`MAX_CONCURRENT`、`MAX_MS`、`MIN_BYTES_OK`
- `runNativeSession`、job state 更新、`live_media` upsert、stop/abort

删除：
- `import from "playwright"`、`getBrowser`、`makeBrowserFns`、`runBrowserSession`（或等价 browser 分支）
- `SCRIPT_PATH` / script 缓存
- PCM/WAV 浏览器组装路径（native 已写 ogg）

缺 bin：`ensureStarted` 内 `setJobState(failed, error)` 后 return / throw 与现有 native 失败一致。

## Build / package

```json
"build": "tsc -p tsconfig.json"
```

- 删除 `scripts/copy-runtime-assets.mjs` 与 package 中的引用。
- `pnpm install` 刷新 lock，确认无 `playwright` / `playwright-core`。

## Docker

1. 保留 `golang` stage 构建 `live-record`。
2. Runtime：`ca-certificates` + `ffmpeg`；COPY 二进制到 `/usr/local/bin/live-record`。
3. 删除：`PLAYWRIGHT_BROWSERS_PATH`、`mkdir /ms-playwright`、`playwright install …`。
4. Env：`LIVE_RECORDER_BIN=/usr/local/bin/live-record`（可写死，不必再设 LIVE_RECORDER）。

## Compose

- 保留 `init: true`（子进程 reaping）。
- 去掉 `ipc: host`（Playwright 建议；native 不需要）。
- 环境变量只留 `LIVE_RECORDER_BIN`（可选写死路径）。

## Spec 更新要点

`live-media-library.md`：
- Disk 示例补 `audio.ogg`（及历史 `wav` 仍可播）。
- 删除 “Browser inject script is a runtime asset” 与 “Docker must ship Playwright”。
- 新增：runtime **必须** 有 `live-record`；由 Node spawn；失败不降级浏览器。

## Risks

| 风险 | 缓解 |
|------|------|
| 本地未 build Go | README + job 错误文案 |
| 长录稳定性 | 已在 #4 smoke；本任务不做协议改，仅删回退 |
| 旧文档/CI 仍 install chromium | 全仓 grep 清理 README/Dockerfile |

## Rollback

Git revert 本任务提交即可恢复 Playwright 路径（依赖 #4 时代码仍在历史中）。
