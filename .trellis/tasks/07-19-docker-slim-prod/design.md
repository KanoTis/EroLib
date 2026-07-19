# Design: docker-slim-prod

## Target runtime layout

```text
/app/                          # pnpm deploy --prod 输出根
  package.json
  dist/                        # server 编译产物
  node_modules/                # 仅 prod + workspace 注入的 shared
/app/web/dist/                 # Vite SPA（单独 COPY）
/usr/local/bin/live-record
# apt: ca-certificates, ffmpeg
```

Env:
- `WEB_DIST_DIR=/app/web/dist`
- `LIVE_RECORDER_BIN=/usr/local/bin/live-record`
- `WORKDIR=/app`
- `CMD ["node", "dist/index.js"]`

## Build pipeline

```
base (node+pnpm)
  → live-record-build (go)
  → build:
       pnpm install --frozen-lockfile
       build shared, web, server
       pnpm --filter @erolib/server deploy --prod /out/server
  → runtime (node slim, no pnpm):
       apt ffmpeg + ca-certificates
       COPY --from=build /out/server → /app
       COPY web dist → /app/web/dist
       COPY live-record
```

## pnpm deploy notes

- `--prod` 排除 devDependencies（tsx/typescript/vite 等不进镜像）。
- `--legacy`：不改动本地 workspace 的 `inject-workspace-packages`，避免强迫全局 inject。
- `@erolib/shared` 须已 build；deploy 会把 workspace 包拷进产物（需 dist 可用）。
- `apps/server` / `packages/shared` 的 `"files": ["dist"]` 限制打包内容。
- 构建后删 `*.map` / `*.d.ts` 与误拷的 src/test/data（进一步瘦身，运行时不需要）。
- Windows 本机 `pnpm deploy` 对盘符绝对路径有 bug；**以 Docker Linux 构建为准**。

## Risks

| 风险 | 缓解 |
|------|------|
| libsql native 绑定丢失 | deploy 后在镜像内 `node -e "import('@libsql/client')"` smoke |
| shared 未进 deploy | 先 build shared；检查 `/app/node_modules/@erolib/shared` |
| WEB_DIST 路径错 | 显式 ENV + README |
