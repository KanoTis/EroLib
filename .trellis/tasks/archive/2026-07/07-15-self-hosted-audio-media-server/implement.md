# Implement: 自托管音声媒体服务器

## Strategy

绿场实现。先骨架与契约，再 Provider，再 UI，最后 Compose 验收。  
Erovoice 仅留接口与空实现/注册位，不进 MVP-1 验收。

## Ordered Checklist

### Phase 0 — Repo skeleton

- [ ] 初始化 monorepo（建议 `apps/server`, `apps/web`, `packages/shared` 或等价）
- [ ] TypeScript、ESLint/格式化、基础 scripts（`dev`, `build`, `start`）
- [ ] 环境变量约定：`DATA_DIR` `MEDIA_DIR` `CACHE_DIR` `AUTH_*` `CREDENTIALS_SECRET` `SYNC_INTERVAL_HOURS` `PORT`
- [ ] Dockerfile 多阶段构建 + `docker-compose.yml` 三 volume

### Phase 1 — Core storage & DB

- [ ] Drizzle schema：`provider_accounts` `authors` `works` `sync_runs` `download_jobs` `settings`
- [ ] 迁移与启动时 ensure dirs
- [ ] `storage` 路径工具：`mediaPath(provider, authorId, workId)`、cache job dir、原子提交
- [ ] 凭证加解密模块 + 单测

### Phase 2 — API shell & auth

- [ ] Hono app：health、错误模型、静态前端占位
- [ ] 本机 admin 鉴权中间件（有密码/无密码两分支）
- [ ] Providers CRUD API（无真实登录先 mock test）
- [ ] Works list/detail API（空库可用）

### Phase 3 — Job runner

- [ ] 下载队列状态机 + 并发限制
- [ ] 同步 runner：listFavorites → upsert → enqueue
- [ ] 定时调度默认 4h；`POST /api/sync` 手动触发
- [ ] 重启恢复：queued/failed 可重试

### Phase 4 — Otobanana Provider

- [ ] 账密登录 → JWT；Cookie 模式注入
- [ ] `listFavorites` via likes API
- [ ] `getWork` + 直链 `download`（Range 可选）
- [ ] 集成：配置 → 同步 → 下载 → media 落盘

### Phase 5 — Koe-koe Provider

- [ ] 账密/Cookie 会话
- [ ] 解析 `mypage.php` 书签分页
- [ ] 详情解析 + MP3 直链下载
- [ ] 请求间隔/重试；集成验收

### Phase 6 — Web UI

- [ ] Vite React：Library / Detail+Player / Providers / Jobs+Sync / Settings
- [ ] 播放仅 `downloaded`；队列与同步状态展示
- [ ] 账号表单：auth mode 切换账密/Cookie

### Phase 7 — Hardening & ship

- [ ] 日志脱敏、错误可见性
- [ ] Compose 端到端文档（README 最小用法）
- [ ] MVP-1 验收对照 `prd.md` Acceptance Criteria
- [ ] Provider 接口预留 `erovoice` 注册点（实现可 throw not implemented）

## Validation Commands

```bash
# 开发
pnpm dev          # 或 npm/yarn 等价

# 类型与构建
pnpm typecheck
pnpm build

# 单测（至少 crypto + path + 一两个 parser）
pnpm test

# Docker
docker compose up --build
curl -sS http://localhost:8080/api/health
```

手工验收：

1. 配置 Otobanana + Koe-koe 凭证（账密或 Cookie）
2. 手动同步 → 见 sync run 与 download jobs
3. 完成后 Library 可播
4. 从网站取消一收藏 → 再同步 → 本地文件仍在且标记更新
5. 重启容器 → 任务/库状态一致

## Risk Files / Areas

| 区域 | 风险 |
|------|------|
| Koe-koe HTML 解析 | 站点改版即碎；选择器集中、单测用 fixture |
| 凭证与 session 存储 | 泄露影响大；强制 secret、禁日志 |
| 原子落盘 | 半写入污染库；必须 cache 成功再进 media |
| 进程内队列 | 崩溃中断下载；靠 job 状态重试 |
| 单容器磁盘 | media 填满；需错误可观测 |

## Rollback Points

1. Phase 0–2 可整体删仓重建  
2. Phase 4 完成后应可单独用 Otobanana 演示备份  
3. Phase 5 完成后 MVP-1 功能完备  
4. UI 可落后于 API，但不阻塞 Provider 用 curl 验收  

## Child Task Map (optional after approve)

若拆子任务，建议：

| 子任务 | 交付 |
|--------|------|
| skeleton-docker | monorepo + compose |
| core-db-jobs | schema + storage + runner |
| provider-otobanana | 可备份 likes |
| provider-koekoe | 可备份书签 |
| web-ui | 浏览器闭环 |
| mvp2-erovoice | HLS 下载（后置） |

## Gate Before `task.py start`

- [x] `prd.md` 已收敛（无未决 open product questions）
- [x] `design.md` 已写
- [x] `implement.md` 已写
- [ ] **用户审阅批准进入实现**
