# 外部时新性检索笔记（grok-search-rs）

检索日期：2026-07-18。工具：`grok-search-rs` / MCP `web_search`（search_provider: grok_responses）。

## 1. Hono + @hono/node-server

**结论：仍适用（生产可用）**

- Hono + `@hono/node-server` 在 Node 20+ 上为生产就绪；adapter v2+ 相对 v1 有显著性能提升。
- 官方 Node 入门：`serve(app)`、`serveStatic`、多阶段 Docker（Node 22）、建议 non-root。
- 可选替代：同一代码可跑 Bun（`Bun.serve` / `export default { fetch }`），吞吐更高，但非必须替换。
- 生产清单常见项：反向代理 TLS、graceful shutdown、非 root、健康检查、限流/安全头。

来源：
- https://hono.dev/getting-started/nodejs
- https://www.npmjs.com/package/@hono/node-server
- https://newreleases.io/project/npm/@hono/node-server/release/2.0.0

对本项目：保留 Hono+Node 合理；Bun 属 P2 可选。缺 non-root / 安全中间件属运维加固。

## 2. Drizzle ORM + libSQL

**结论：仍适用**

- 官方推荐：`@libsql/client` + `drizzle-orm/libsql`；本地 `file:` / 远程 Turso 同一 API。
- 迁移：`drizzle-kit` generate/migrate；自托管单文件 SQLite 仍主流。
- 实践：env 配置连接、事务、typed query。

来源：
- https://orm.drizzle.team/docs/get-started/turso-new
- https://docs.turso.tech/sdk/ts/reference
- https://orm.drizzle.team/docs/tutorials/drizzle-with-turso

对本项目：`file:app.db` + 手写 `migrate()` SQL 可用；长期可引入 drizzle-kit 迁移（P2）。

## 3. Zod 3 → 4

**结论：可升级（非紧急替换）**

- Zod 4 自 2025-05 稳定；根包 `zod` 现为 v4；v3 经 `zod/v3` 可并存。
- 多数 3.25→4 改动小；有官方 changelog 与社区 codemod。
- 收益：解析更快、包更小、错误模型更新。

来源：
- https://zod.dev/v4/versioning
- https://zod.dev/v4/changelog

对本项目：当前 `zod@^3.24` 仍可用；计划升级到 v4 为 P1/P2 依赖维护项。

## 4. React 19 + react-router 7 + Vite 6

**结论：仍适用（自托管 SPA 主流）；Vite 大版本可观察升级**

- React 19 已 stable（2024-12 起）；自托管管理台继续以 SPA 为主；SSR/RSC 对内网单用户备份库无刚需。
- React Router 7 为当前主线，支持 declarative / data / framework 多模式；本项目 declarative SPA 合理。
- Vite：仓库为 `^6.2`；官方文档站当前主线已到 7/8，v6 文档仍保留。属**可升级（非强制）**，非栈替换。

来源：
- https://react.dev/blog/2024/12/05/react-19
- https://reactrouter.com/home
- https://vite.dev/guide/ （主线；另见 https://v6.vite.dev ）
- 仓库：`apps/web/package.json`（react ^19.1、react-router-dom ^7.5、vite ^6.2）

对本项目：前端栈时新，无需换框架；可选跟踪 Vite 大版本（P2）。

## 5. Playwright 服务端自动化

**结论：技术仍常用，运维成本高；Docker 必须装浏览器**

- Playwright 仍是浏览器自动化主选；服务端无头录流/抓媒体可行，但镜像需浏览器二进制 + 系统依赖。
- 官方 Docker 文档明确：需 Playwright browsers 与 browser system dependencies；自建镜像示例为  
  `npx playwright@… install --with-deps`（仅 `npm install playwright` 不够）。
- 官方镜像 `mcr.microsoft.com/playwright:v1.61.0-noble` 与仓库 `playwright@^1.61` 版本线对齐。

来源：
- https://playwright.dev/docs/docker （含 “Build your own image”）
- https://playwright.dev/docs/browsers
- 本仓库：`live-recorder.ts` `chromium.launch`；`Dockerfile` runtime 已 `playwright install --with-deps --only-shell chromium`（`77799e6`）；compose `init` + `ipc: host`

对本项目：Live 录制架构合理；**Docker 浏览器缺口已修复**（原 P0 → 已修复）。后续注意 Playwright 主版本与镜像内浏览器同步。

## 6. 自托管媒体备份模式

**结论：当前模式合理**

- 本地文件树 + SQLite 元数据 + 后台 job + Range 流式播放：自托管媒体库常见模式。
- 缓存目录下载 → 原子/rename 提交到 media：有利于避免半文件。

来源：**仅代码内 + 行业常见模式**（非单一框架标准文档）；对照 `storage/paths.ts`、`jobs/runner.ts`、音频 Range 路由。

对本项目：`cache → media` + `isLocalAudioAvailable` 再入队符合最佳实践方向。

## 7. Session / 凭据加密

**结论：AES-GCM + HMAC cookie 方向正确；细节可加固**

- AES-256-GCM 存敏感凭据：仍推荐。
- 密钥派生：生产更倾向 scrypt/HKDF 而非单次 SHA-256（密钥拉伸）。
- Cookie session（OWASP）：应使用 **Secure**（仅 HTTPS 发送）、**HttpOnly**、显式 **SameSite=Strict|Lax**；TLS 全站 + HSTS 降低会话劫持面。
- 密码存储：理想为慢哈希（argon2/bcrypt）；单用户 env 明文比对可接受但非理想。
- Provider session token 明文落库风险高于已加密的 password blob。

来源：
- https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html （Secure / HttpOnly / SameSite）
- 对照代码：`crypto/credentials.ts`（SHA-256 派生 + AES-GCM）、`auth/session.ts`（httpOnly+Lax，无 Secure）
