# Implement: remove-playwright

## Checklist

1. **Config**  
   - [ ] `apps/server/src/config.ts`：移除 `LiveRecorderMode` / `LIVE_RECORDER`；保留 `liveRecorderBin`  
   - [ ] 全仓引用 `liveRecorder` mode 的调用点改为仅 bin

2. **live-recorder native-only**  
   - [ ] 删除 playwright import 与 browser session 代码  
   - [ ] `resolveNativeBin` 始终必填；找不到 → 明确错误  
   - [ ] 删除 script 路径与 `makeBrowserFns`

3. **Delete assets / scripts**  
   - [ ] 删 `src/jobs/live-browser-script.js`  
   - [ ] 删 `scripts/copy-runtime-assets.mjs`  
   - [ ] 删 `scripts/probe-audio-levels.ts`  
   - [ ] `package.json` build → 仅 `tsc`；移除 `playwright` 依赖  
   - [ ] `pnpm install` 更新 lock

4. **Docker / compose / README**  
   - [ ] Dockerfile 去掉 Playwright 安装与 env  
   - [ ] compose 去 `ipc: host` 与 browser 注释；env 收敛  
   - [ ] README 直播录制章节与故障表  
   - [ ] `apps/live-record/README.md` server 集成表

5. **Spec**  
   - [ ] 更新 `.trellis/spec/backend/live-media-library.md` 决策与路径契约

6. **Validate**  
   - [ ] `pnpm --filter @erolib/shared build`（若需要）  
   - [ ] `pnpm --filter @erolib/server typecheck`  
   - [ ] `pnpm --filter @erolib/server test`  
   - [ ] 全仓 grep：`playwright`、`live-browser-script`、`PLAYWRIGHT_`、`LIVE_RECORDER=browser` 应仅剩归档任务/历史文档（代码与活跃 README 无）

## Validation commands

```bash
pnpm --filter @erolib/server typecheck
pnpm --filter @erolib/server test
pnpm --filter @erolib/server build
# optional local:
# cd apps/live-record && go build -o live-record.exe .
rg -n "playwright|live-browser-script|PLAYWRIGHT_|chromium\.launch" apps packages Dockerfile docker-compose.yml README.md
```

## Review gates

- [ ] 无 browser 死代码  
- [ ] Docker runtime 不再拉浏览器  
- [ ] Spec 与实现一致  

## Rollback

`git revert` 本任务提交；镜像回退上一 tag。
