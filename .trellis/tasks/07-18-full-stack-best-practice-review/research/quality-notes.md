# L2 实现质量笔记

## 子系统评级

| 子系统 | 评级 | 说明 |
|--------|------|------|
| Provider 凭据 validate-on-save | 合理 | 与 active spec 一致；失败不落库 |
| VOD 同步 + 本地缺文件再下 | 合理 | isLocalAudioAvailable + enqueue 符合 vod-sync spec |
| 全局播放器 | 合理 | PlayerProvider 壳层 + Media Session 符合 frontend spec |
| 凭据 AES-GCM | 合理（可改进密钥派生） | 算法正确；SHA256 派生偏简 |
| Session 鉴权 | 可改进 | 单用户 env 适合自托管；无 Secure、无 CSRF 额外层 |
| Job runner | 可改进 | 有 claim/恢复；失败无自动重试上限策略；attempts 仅计数 |
| Live 录制 | 合理（镜像已修） | Playwright + chromium；`77799e6` 后 Docker 装 headless shell + compose `init`/`ipc` |
| sessionBlob 存储 | **高风险（敏感，当前 P0）** | Provider session/JWT **明文** JSON 存 DB |
| 媒体路径服务 | 可改进 | cover/live 用 path.join(mediaDir, rel)；写入侧 sanitize，读取侧无 resolve+prefix 校验 |
| CORS | 可改进 | origin 反射 `origin \|\| "*"` + credentials |
| app.ts 体量 | 可改进 | 单文件 ~1378 行，路由全堆叠 |
| 测试覆盖 | 可改进 | 解析/crypto 有测；API/job/live/e2e 弱 |
| Docker 安全 | 可改进 | root 运行；compose 默认空密码与弱 secret 示例 |
| 前端数据层 | 可改进 | 手写 fetch，无 query cache；对单用户 SPA 可接受 |
| 共享类型 | 合理 | @erolib/shared 两端复用 |

## Specs 对照

### provider-account-credentials.md — 符合

- POST/PATCH 在 verify 成功前不 persist 新凭据（app.ts:351–360, 438–449）。
- 仅 enabled 变更不调 login（app.ts:405–415）。
- test 失败写 status=error（app.ts:505–514）。

### vod-sync-local-media.md — 符合

- `enqueueDownload` 对 downloaded 先 `isLocalAudioAvailable`（runner.ts:139–145）。
- sync 对 existing 始终尝试 enqueue（runner.ts:214）。
- open job dedupe（runner.ts:146–156）。

### global-audio-player.md — 符合（代码结构）

- AuthenticatedShell 外包 PlayerProvider；PlayerBar 常驻（App.tsx:73–185）。
- playable id 约定在 player/types（spec 要求）。

### live-media-library.md — 方向符合

- live_media 表 + GET list/audio + 路径 liveMediaDir；MIN_BYTES_OK 过滤过小文件。

## 安全与可靠性细项

1. **sessionBlob 明文**（schema provider_accounts.session_blob；多处 JSON.stringify(session)）  
   - 含 accessToken 等；DB 文件泄露 = 第三方账号会话泄露。凭据本体有加密，会话未加密。

2. **Cookie 无 Secure**（session.ts:121–126）  
   - 纯 HTTP 局域网可接受；一旦 HTTPS 反代未设 Secure 会降级安全。

3. **AUTH 关闭默认**（compose AUTH_PASSWORD: ""）  
   - UI 有提示「请勿暴露公网」；属产品选择，运维风险。

4. **CREDENTIALS_SECRET 默认值**（config.ts:55–58）  
   - 开发默认字符串；compose 示例 `change-me-...` 易被照抄。

5. **下载失败无自动重试**（runner processJob catch → failed）  
   - attempts 递增但失败即终态；需用户手动 retry。适合可控但非「最佳弹性」。

6. **Playwright 镜像（已修复）**（历史：仅 ffmpeg；现：`Dockerfile:46-48` install chromium shell）  
   - 原 P0 已在 `77799e6` 关闭；Live 仍依赖镜像体积与浏览器版本锁定。

7. **路径读取**  
   - 写入 sanitizePathSegment；coverRelPath/mediaRelPath 来自 DB。若 DB 被写污染可 path traversal。可信边界=本机 DB。

8. **CORS 反射**（app.ts:210–215）  
   - 自托管可接受；公网暴露时过宽。

## 测试盲区

| 区域 | 现状 |
|------|------|
| crypto/paths | 有 |
| provider HTML/HLS 解析 | 有 |
| HTTP routes / auth | 无 |
| JobRunner sync/download | 无 |
| Live poller/recorder | 无（或极少） |
| Web UI | 无 |
