# Implement — 审查执行清单

## 前置

- [x] 用户同意建任务
- [x] D1 仅报告 / D2 全栈深度 / D3 中文详报
- [x] 用户审过 `prd.md` + `design.md` + `implement.md` 后进入 Phase 2（报告撰写）

## 执行顺序

### 1. 代码功能盘点（L1）

- [x] 读 `apps/server/src/app.ts` + `routes/*`，列出全部 API 与中间件
- [x] 读 `jobs/*`：runner、live-poller/recorder/history-sync 触发与状态
- [x] 读 `providers/*`：三站 + live 下载/同步路径
- [x] 读 `auth/*`、`crypto/*`、`storage/*`、`db/*`、`media/*`、`config.ts`
- [x] 读 `apps/web/src/App.tsx` + 全部 pages + `player/*` + `api.ts`
- [x] 读 `packages/shared` 导出契约
- [x] 读 `Dockerfile`、`docker-compose.yml`、根/子 `package.json`
- [x] 笔记：`research/inventory.md`

### 2. Specs 与质量（L2）

- [x] 对照 backend active specs：live-media-library、provider-account-credentials、vod-sync-local-media
- [x] 对照 frontend：global-audio-player
- [x] 抽样测试：`apps/server/test/**` 覆盖盲区
- [x] 笔记：`research/quality-notes.md`

### 3. 外部时新性检索（L3，grok-search-rs）

- [x] Hono / node-server 现状与替代
- [x] Drizzle + libSQL/SQLite 2025–2026
- [x] Zod 3→4 迁移态势
- [x] Playwright 服务端自动化实践
- [x] React 19 + RR7 + Vite 6 自托管 SPA
- [x] 自托管媒体备份 / 任务与文件布局实践
- [x] Session + 凭据加密常见模式
- [x] 汇总：`research/external-stack-notes.md`

### 4. 合成主报告（L4）

- [x] 撰写 `research/audit-report.md`（结构见 design.md）
- [x] 每条非「仍适用」结论附来源或「仅代码内」
- [x] P0/P1/P2 齐全；给出后续 task 拆分建议标题

### 5. 质量门（check）

- [x] AC1–AC4 自检
- [x] `git status`：无 `apps/**` / `packages/**` 业务改动（本任务仅 task/research）
- [x] 报告内链接与路径可定位
- [x] **Playwright P0 再核对**：对照 master `77799e6`，Dockerfile/compose 已装 chromium + init/ipc → 报告中该条标为**已修复**，活跃 P0 收敛为 sessionBlob

## 验证命令

```bash
# 确认未改业务代码（审查阶段应仅有 task/research 与规划文件）
git status
git diff --stat

# 可选：依赖树快照（只读）
pnpm -r list --depth 0
```

无自动化单测要求（本任务不改代码）。

## 回滚点

| 点 | 条件 | 动作 |
|----|------|------|
| RP1 | 误改 apps/** | `git checkout -- apps packages`（确认无其它意图改动后） |
| RP2 | 外部结论不可靠 | 降级为 P2 或标「证据不足」并重搜 |

## 禁止

- 在审查中顺手升级依赖或重构
- 用模型记忆代替 `grok-search-rs` 断言「最新」

## 完成定义

- [x] `research/audit-report.md` 存在且满足 AC1–AC4
- [x] check 通过（含 Playwright 过期结论修订）
- [x] 用户可据此创建后续 P0/P1 实现任务
