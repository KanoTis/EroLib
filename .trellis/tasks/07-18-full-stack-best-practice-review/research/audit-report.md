# Erolib 全栈审查报告

- 任务：`.trellis/tasks/07-18-full-stack-best-practice-review`
- 日期：2026-07-18
- 范围：server / web / shared / Docker；**仅报告，不改业务代码**
- 方法：L1 代码盘点 + L2 specs/质量 + L3 `grok-search-rs` 时新性 + L4 优先级
- 详注：`inventory.md`、`quality-notes.md`、`external-stack-notes.md`

---

## 1. 执行摘要

Erolib 作为**单机自托管音声备份库**，整体架构**合理且大体时新**：

| 层 | 判断 |
|----|------|
| API | Hono 4 + `@hono/node-server` — **仍适用** |
| 数据 | Drizzle + `@libsql/client` 本地 SQLite — **仍适用** |
| 校验 | Zod 3 — **可升级**到 Zod 4（非紧急） |
| 前端 | React 19 + RR7 + Vite 6 SPA — **仍适用** |
| 备份流水线 | 同步→队列→cache 提交 media + Range 播放 — **合理** |
| Live | Playwright 浏览器录流 — **模式可行**；GHCR 镜像已装 Chromium headless shell（`77799e6`） |
| 安全 | AES-GCM 凭据 + HMAC session — **方向正确**；**sessionBlob 明文**仍为 P0；默认鉴权关闭、Docker root 等需加固 |

**结论**：不必换技术栈。当前优先 **P0：Provider `sessionBlob` 明文落库**；Live 生产浏览器缺口已在 master 修复（见 §5 历史项）。其余为依赖升级与运维加固。

---

## 2. 功能清单（按子系统）

完整表见 `inventory.md`。覆盖面：

- **鉴权**：可选本机登录、session cookie、health 放行  
- **Providers**：Otobanana / Koe-koe / Erovoice 配置、validate-on-save、测试登录  
- **VOD**：定时/手动同步、下载队列、重试、元数据刷新、ID3、本地缺文件再下  
- **媒体库 API**：作品列表/详情、音频 Range、封面  
- **Live**：订阅、关注在播、历史同步、录制 jobs、live_media 播放  
- **Web**：库 / 详情 / Providers / 同步 / 任务 / 直播 / 设置 + 全局播放器  
- **部署**：多阶段 Docker（Node 22 + ffmpeg + Playwright Chromium shell + pnpm）、compose 三卷 + `init`/`ipc: host`  

---

## 3. 实现质量评估

### 3.1 做得好的（保留）

1. **Validate-on-save**（`app.ts` + spec `provider-account-credentials`）：失败不落错误凭据。  
2. **VOD 本地可用性门闸**（`isLocalAudioAvailable` + `enqueueDownload`）：符合 `vod-sync-local-media`。  
3. **下载路径 sanitize + cache→media commit**：降低半文件与路径注入面。  
4. **音频 HTTP Range**：播放器 seek 必要能力已具备。  
5. **全局 PlayerProvider**：路由切换不卸播放器，符合 `global-audio-player`。  
6. **shared 契约**：两端共用类型，减少漂移。  
7. **解析类单测**：koekoe/erovoice/hls/crypto 有覆盖。

### 3.2 主要弱点

| 项 | 评级 | 证据 |
|----|------|------|
| sessionBlob 明文 | **高风险（当前 P0）** | `provider_accounts.session_blob` 存 JSON Session（含 token） |
| 下载失败无自动重试策略 | 可改进 | `processJob` catch → failed；仅手动 retry |
| Cookie 无 `Secure` | 可改进 | `session.ts:121-126` |
| CORS 过宽 | 可改进 | `app.ts:210-215` origin 反射 |
| app.ts 巨石 | 可改进 | ~1378 行单文件 |
| API/Job/Live/Web 测试弱 | 可改进 | test 目录以解析为主 |
| 密钥派生 SHA-256 | 可改进 | `credentials.ts:deriveKey` 无拉伸 |
| compose 默认无鉴权 | 运维风险 | `AUTH_PASSWORD: ""` |
| Docker Playwright 浏览器（历史） | **已修复** | 曾缺浏览器；`77799e6` 后 runtime 安装 chromium shell |

---

## 4. 技术选型时新性对照

| 技术 | 仓库版本 | 2026 判断 | 建议 |
|------|----------|-----------|------|
| Hono + node-server | ^4.7 / ^1.14 | **仍适用** | 保留；关注 adapter 大版本 |
| Node | ≥20，Docker 22 | **仍适用** | 保留 22 LTS 线 |
| Drizzle + libSQL | ^0.43 / ^0.15 | **仍适用** | 保留；可选 drizzle-kit 迁移 |
| Zod | ^3.24 | **可升级** | 规划 Zod 4 |
| Playwright | ^1.61 | **仍适用**（成本高） | 保留；Docker 已装 chromium headless shell |
| React 19 | ^19.1 | **仍适用** | 保留 SPA |
| react-router | ^7.5 | **仍适用** | 保留 |
| Vite | ^6.2 | **仍适用**（大版本可升级） | 保留 6 或规划 7/8 |
| pnpm 10 | 10.30.1 | **仍适用** | 保留 |
| 手写 job 队列（SQLite） | 自研 | **可接受** | 单机无需 BullMQ；可补重试 |
| Bun 替代 Node | 未用 | 可选加速 | **P2** 非必须 |

外部依据摘要见 `external-stack-notes.md`（Hono 官方、Drizzle/Turso 文档、Zod v4 官方等）。

---

## 5. 发现清单

### P0（建议立即另开任务）

#### [P0] Provider `sessionBlob` 明文存储第三方会话

- **现状**：登录后 `sessionBlob: JSON.stringify(session)`；含 accessToken 等。密码/cookie 有 AES-GCM，会话没有。  
- **证据**：`app.ts:370,460,519,931`；`runner.ts:109-130,238,656`；`live-poller.ts` / `live-history-sync.ts` 同类写入；`schema.ts:24`。  
- **外部依据**：仅代码内 + 安全常识（token 等价会话密钥）。  
- **建议动作**：升级 | 与 `encryptedPayload` 同密钥加密 session；迁移读旧明文写新密文。  
- **影响面**：`app.db` 泄露面。  
- **建议后续任务**：`encrypt-provider-session-blob`

### 已修复（原 P0，保留历史）

#### [已修复 / 原 P0] 生产镜像缺少 Playwright Chromium，Live 录制不可用

- **历史现状（审查初稿）**：`live-recorder.ts` 依赖 `chromium.launch`；当时 Dockerfile 仅装 ffmpeg，未 `playwright install`。  
- **修复状态（2026-07-18）**：**已在 master 修复**，commit `77799e6`（`fix(docker): ship Playwright chromium headless shell in GHCR image (#3)`）。  
- **当前证据**：  
  - `Dockerfile:27` `PLAYWRIGHT_BROWSERS_PATH=/ms-playwright`  
  - `Dockerfile:46-48` runtime：`playwright install --with-deps --only-shell chromium`  
  - `docker-compose.yml:4-5` `init: true`、`ipc: host`（Playwright 容器建议）  
  - active spec：`.trellis/spec/backend/live-media-library.md` Design Decisions 已要求上述契约  
- **外部依据**：https://playwright.dev/docs/docker 、 https://playwright.dev/docs/browsers  
- **建议动作**：**保留**当前实现；后续若升级 `playwright` 主版本，需同步验证镜像内浏览器版本与 `PLAYWRIGHT_BROWSERS_PATH`。  
- **影响面**：Docker Live 全链路（修复后生产可 launch）。  
- **建议后续任务**：无需重开 `fix-docker-playwright-live`；可选 smoke：容器内 `chromium.launch` / 一场短录。

### P1（明显改进 / 维护）

#### [P1] 下载失败无自动重试与上限

- **现状**：失败即 `failed`；`attempts` 只增不驱动重试。  
- **证据**：`apps/server/src/jobs/runner.ts:458-471`；手动 `POST .../retry`。  
- **外部依据**：仅代码内（自托管 job 常见指数退避）。  
- **建议动作**：升级 | 有限次重试 + 退避；耗尽再 failed。  
- **影响面**：VOD 同步/下载稳健性。  
- **建议后续任务**：`download-job-retry-policy`

#### [P1] Session cookie 加固与 HTTPS 文档

- **现状**：httpOnly + SameSite=Lax；无 Secure；单用户 env 明文密码比对（timingSafeEqual）。  
- **证据**：`apps/server/src/auth/session.ts:66-78,121-126`。  
- **外部依据**：https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html — 要求 Secure + HttpOnly + 显式 SameSite；全站 TLS。  
- **建议动作**：升级 | `Secure` 可配置（或 `AUTH_COOKIE_SECURE` / 检测 HTTPS）；文档强制反代 HTTPS + HSTS；可选 argon2 哈希存 AUTH_PASSWORD。  
- **影响面**：启用本机鉴权时的会话劫持面。  
- **建议后续任务**：`harden-auth-cookie`

#### [P1] Zod 3 → 4

- **现状**：`zod@^3.24`。  
- **证据**：`apps/server/package.json`。  
- **外部依据**：https://zod.dev/v4/versioning 、 https://zod.dev/v4/changelog 。  
- **建议动作**：升级 | 跑 typecheck/test；可用 codemod。  
- **影响面**：server 校验与依赖树。  
- **建议后续任务**：`upgrade-zod-4`

#### [P1] CORS 与公网暴露面

- **现状**：`origin: (o) => o || "*"` + credentials。  
- **证据**：`apps/server/src/app.ts:210-215`。  
- **外部依据**：仅代码内。  
- **建议动作**：升级 | 默认同源/固定 origin 列表；compose 强调勿裸暴露。  
- **影响面**：浏览器跨域与公网误暴露面。  
- **建议后续任务**：`tighten-cors`

#### [P1] 路由/Job 集成测试缺口

- **现状**：无 app 路由、runner、live 集成测。  
- **证据**：`apps/server/test/*`（crypto-paths / 解析类；无 HTTP/job/live）。  
- **外部依据**：仅代码内。  
- **建议动作**：升级 | 对 validate-on-save、enqueue 缺文件、auth middleware 补测。  
- **影响面**：回归安全与同步语义。  
- **建议后续任务**：`server-integration-tests`

### P2（可选优化）

#### [P2] 密钥派生加强

- **现状**：`deriveKey` = `SHA-256(secret)`，无盐/无拉伸。  
- **证据**：`apps/server/src/crypto/credentials.ts:13-15`。  
- **外部依据**：仅代码内 + Node crypto 惯例（建议 HKDF/scrypt）。  
- **建议动作**：升级 | 引入 HKDF/scrypt + 版本字段 `v:2` 可轮换。  
- **影响面**：凭据加密；需迁移旧 blob。  
- **建议后续任务**：`credential-key-derive-v2`

#### [P2] 拆分 `app.ts` 路由模块

- **现状**：单文件约 1378 行，路由全堆叠。  
- **证据**：`apps/server/src/app.ts`。  
- **外部依据**：仅代码内。  
- **建议动作**：重构 | 按 auth/providers/works/live/jobs 拆 Hono 子应用。  
- **影响面**：server 可维护性，无用户可见行为变化。  
- **建议后续任务**：`split-server-routes`

#### [P2] Docker non-root + 健康检查

- **现状**：runtime 默认 root；compose 无 healthcheck。  
- **证据**：`Dockerfile`、`docker-compose.yml`。  
- **外部依据**：https://hono.dev/getting-started/nodejs （生产清单常见 non-root / health）。  
- **建议动作**：升级 | USER non-root + `healthcheck` curl `/api/health`。  
- **影响面**：部署安全与编排探针。  
- **建议后续任务**：`docker-non-root-healthcheck`

#### [P2] drizzle-kit 正式迁移

- **现状**：手写 `migrate()` SQL 可用。  
- **证据**：`apps/server/src/db/client.ts`。  
- **外部依据**：https://orm.drizzle.team/docs/get-started/turso-new 。  
- **建议动作**：升级 | schema 演进多时引入 drizzle-kit。  
- **影响面**：DB 演进流程。  
- **建议后续任务**：`drizzle-kit-migrations`

#### [P2] 前端数据层

- **现状**：手写 `api.ts` fetch，无 query cache。  
- **证据**：`apps/web/src/api.ts`。  
- **外部依据**：仅代码内（单用户 SPA 可接受）。  
- **建议动作**：保留 | 轮询变复杂时再考虑轻量 cache（非必须 TanStack Query）。  
- **影响面**：Web 请求层。  
- **建议后续任务**：（暂不拆任务）

#### [P2] Bun 运行时试验

- **现状**：Node 22 + `@hono/node-server`。  
- **证据**：`Dockerfile`、`apps/server/package.json`。  
- **外部依据**：https://hono.dev/getting-started/nodejs （同代码可跑 Bun；非必须）。  
- **建议动作**：保留 | 仅在验证 ffmpeg/playwright 兼容后试验，不为性能强迁。  
- **影响面**：运行时与 CI 镜像。  
- **建议后续任务**：（可选调研，不急）

#### [P2] cover/media 读路径 resolve 校验

- **现状**：写入 sanitize；读取依赖 DB 内 rel path + `path.join`。  
- **证据**：`app.ts` cover/audio 路由；`storage/paths.ts`。  
- **外部依据**：仅代码内。  
- **建议动作**：升级 | `path.resolve` 后断言 `startsWith(mediaDir)`。  
- **影响面**：媒体读路径安全（DB 被污染时）。  
- **建议后续任务**：`media-path-resolve-guard`

#### [P2] Vite 6 → 7/8 可选跟踪

- **现状**：`vite@^6.2`；官方主线已推进大版本，v6 文档仍在。  
- **证据**：`apps/web/package.json`；https://vite.dev/guide/ 、https://v6.vite.dev 。  
- **外部依据**：Vite 官方文档站版本线。  
- **建议动作**：可升级 | 非紧急；与 React 插件兼容性验证后升级。  
- **影响面**：前端构建链。  
- **建议后续任务**：`upgrade-vite-major`（低优先）

---

## 6. 建议路线图（后续任务拆分）

| 顺序 | 任务 slug（建议） | 级 | 价值 |
|------|-------------------|----|------|
| — | ~~fix-docker-playwright-live~~ | 已完成 | `77799e6` 已合入 master |
| 1 | encrypt-provider-session-blob | **P0** | 降低 DB 泄露危害 |
| 2 | download-job-retry-policy | P1 | 同步稳健 |
| 3 | harden-auth-cookie | P1 | 鉴权加固 |
| 4 | upgrade-zod-4 | P1 | 依赖时新 |
| 5 | tighten-cors + server-integration-tests | P1 | 安全与回归 |
| 6 | docker-non-root-healthcheck / split-server-routes / credential-key-derive-v2 / media-path-resolve-guard | P2 | 工程卫生 |
| 7 | upgrade-vite-major | P2 | 构建链跟踪（低优先） |

**不建议**：为「追新」重写为 Nest/Next/SSR、换 ORM、上 K8s 任务队列——与单机备份定位不匹配。

---

## 7. 附录：检索与代码来源

### 外部（grok-search-rs / 官方文档深读）

- Hono Node：https://hono.dev/getting-started/nodejs  
- @hono/node-server：https://www.npmjs.com/package/@hono/node-server  
- Drizzle Turso：https://orm.drizzle.team/docs/get-started/turso-new  
- Turso TS：https://docs.turso.tech/sdk/ts/reference  
- Zod 4：https://zod.dev/v4/versioning 、 https://zod.dev/v4/changelog  
- Playwright Docker：https://playwright.dev/docs/docker 、 https://playwright.dev/docs/browsers  
- OWASP Session：https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html  
- React 19：https://react.dev/blog/2024/12/05/react-19  
- React Router：https://reactrouter.com/home  
- Vite：https://vite.dev/guide/ 、 https://v6.vite.dev  

详摘：`external-stack-notes.md`。

### 代码锚点（抽样）

- API 巨石：`apps/server/src/app.ts`  
- Session：`apps/server/src/auth/session.ts`  
- 加密：`apps/server/src/crypto/credentials.ts`  
- Runner：`apps/server/src/jobs/runner.ts`  
- Live：`apps/server/src/jobs/live-recorder.ts`  
- 路径：`apps/server/src/storage/paths.ts`  
- DB：`apps/server/src/db/client.ts`、`schema.ts`  
- Web 壳：`apps/web/src/App.tsx`、`player/PlayerContext.tsx`  
- Docker：`Dockerfile`、`docker-compose.yml`  

### AC 自检

| AC | 状态 |
|----|------|
| AC1 功能清单覆盖 | 是（inventory + 本报告 §2） |
| AC2 过时结论有来源或标代码内 | 是 |
| AC3 P0/P1/P2 + 动作 | 是（活跃 P0：`sessionBlob`；Playwright 已降为「已修复」） |
| AC4 落盘 research/audit-report.md | 是 |
| 不改业务代码 | 是（仅 task/research） |

### Check 修订记录

| 日期 | 修订 |
|------|------|
| 2026-07-18 | trellis-check：对照 master `77799e6`，将「Docker 缺 Playwright」从活跃 P0 标为**已修复**；活跃 P0 收敛为 sessionBlob 加密；同步 inventory / quality / external-stack 笔记。 |
