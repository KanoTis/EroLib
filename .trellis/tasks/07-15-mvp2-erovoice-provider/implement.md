# Implement: Erovoice MVP-2 Provider

## Strategy

先工具层（m3u8 解析 / AES / ffmpeg）可单测，再实现 Provider，再拆 gate，最后 Docker + 手工冒烟。

## Ordered Checklist

### Phase 1 — Utils + fixtures

- [x] `apps/server/src/providers/ffmpeg.ts`：探测 PATH、`transcodeToMp3(input, output)` 用 `spawn` 参数数组
- [x] `apps/server/src/providers/hls.ts`：
  - 解析 playlist → `{ keyUri, iv, method, segments[], mediaSequence }`
  - `decryptAes128Cbc(buf, key, iv)`
  - `downloadHlsToTs({ playlistUrl|body, headers, cacheDir, onProgress, refreshPlaylist })`
- [x] 单测：`test/hls-parse.test.ts`、`test/erovoice-parse.test.ts`
- [x] HTML 解析辅助：bookmark 卡片 + detail 页

### Phase 2 — Provider 实现

- [x] 重写 `apps/server/src/providers/erovoice.ts`
- [x] 复用 `download-utils` 的 cookie merge / fetchToFile / sleep
- [x] 直播 / 无 ENDLIST → 明确 Error

### Phase 3 — Unlock gates

- [x] `app.ts`：删除 erovoice 400；`implemented: true`
- [x] `jobs/runner.ts`：删除 erovoice skip
- [x] `ProvidersPage.tsx`：启用 Erovoice 选项
- [x] `README.md`：MVP-2 说明 + ffmpeg 依赖

### Phase 4 — Docker

- [x] `Dockerfile` runtime：安装 `ffmpeg`

### Phase 5 — Validation

- [x] `pnpm typecheck`
- [x] `pnpm test`
- [ ] 手工（有凭证时）：配置 erovoice → test login → sync → 等一 job → 库内播放
- [x] Otobanana/Koe-koe 配置页与同步入口未回退 stub


## Validation Commands

```bash
pnpm typecheck
pnpm test
pnpm --filter @erolib/server build
# optional:
docker compose build
```

手工 API 草图：

```bash
# 绑定账号后
curl -X POST http://localhost:8080/api/providers/:id/test
curl -X POST http://localhost:8080/api/sync -H 'content-type: application/json' -d '{"provider":"erovoice"}'
curl http://localhost:8080/api/jobs
curl http://localhost:8080/api/works?provider=erovoice
```

## Risk Files

| 文件 | 风险 |
|------|------|
| `providers/erovoice.ts` | 站点 HTML/AJAX 漂移 |
| `providers/hls.ts` | IV/padding 错误 → 爆音或 ffmpeg 失败 |
| `Dockerfile` | 漏装 ffmpeg → 仅容器内失败 |
| `runner.ts` / `app.ts` | 误伤其它 provider gate |

## Rollback Points

1. Phase 1 可单独保留 utils 无产品影响  
2. Phase 2 若未拆 gate，用户仍绑不上 erovoice  
3. Phase 3 后若坏：恢复 stub + skip + UI disabled  
4. 已下载 media 始终保留

## Gate Before `task.py start`

- [x] `prd.md` 收敛（含 mp3 决策）
- [x] `design.md`
- [x] `implement.md`
- [x] 用户审阅批准实现
