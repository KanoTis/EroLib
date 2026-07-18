# Design — 全量审查方法与报告结构

## 目标形态

本任务产出**审查知识制品**，不产出业务代码变更。主交付：

```
.trellis/tasks/07-18-full-stack-best-practice-review/
  research/
    audit-report.md          # 主报告（简体中文详报）
    external-stack-notes.md  # grok-search-rs 外部对照摘录（可选但推荐）
```

## 审查边界

| 纳入 | 排除 |
|------|------|
| apps/server 全模块 | 改业务代码 / 升依赖 PR |
| apps/web 全页面与 player | 新功能实现 |
| packages/shared 类型契约 | 第三方站点法律合规深度评估 |
| Docker / compose / Dockerfile | 与本仓库无关的运维平台选型 |
| package.json 依赖版本与模式 | — |
| active Trellis specs 一致性 | — |

## 方法（四层）

### L1 — 功能盘点（代码事实）

按入口枚举，不猜：

1. **Server routes**：读 `apps/server/src/routes/*` 与 `app.ts` 挂载。
2. **Jobs**：`jobs/runner.ts`、live-*、sync/download 触发链。
3. **Providers**：otobanana / koekoe / erovoice / live 适配器契约。
4. **Auth / Crypto / Storage / DB**：session、credentials 加密、paths、schema。
5. **Web**：`App.tsx` 路由 + 各 page + `player/*` + `api.ts`。
6. **Deploy**：Dockerfile、docker-compose、环境变量（`config.ts`）。

每项记录：`功能名 | 入口 | 关键文件 | 依赖 | 1–3 句实现摘要`。

### L2 — 实现质量（代码 + specs）

对照 active specs 与常见风险面：

- 安全：凭据存储、session、路径穿越、鉴权缺口。
- 数据：下载完整性、0-byte、同步语义、live 落盘。
- 并发/任务：runner 重试、幂等、失败可见性。
- 契约：shared 类型是否被两端一致使用；any/裸 cast。
- 可维护：重复逻辑、错误处理、测试覆盖盲区。

评级：`合理` | `可改进` | `高风险`。

### L3 — 时新性（grok-search-rs 强制）

对下列主题至少各一次 `web_search`（可合并相关查询），必要时 `web_fetch` 深读：

| 主题 | 对照问题 |
|------|----------|
| Hono + @hono/node-server 2025–2026 | 是否仍主流；有无推荐替代（Bun/Node native） |
| Drizzle + libSQL/SQLite | 是否仍推荐；迁移/远程 libSQL 实践 |
| Zod 3 vs Zod 4 | 升级紧迫性 |
| Playwright 服务端自动化 | 自托管抓取是否仍合理；无头稳定性实践 |
| React 19 + RR7 + Vite 6 SPA | 是否仍最佳自托管 UI 栈；SSR 是否有必要 |
| 自托管媒体库 / 备份架构 | 任务队列、文件布局、Range 播放最佳实践 |
| Node 凭证加密 / session | AES-GCM、cookie session 等常见模式 |

每条外部结论记录：`结论 | 来源 URL | 日期/上下文 | 对本项目含义`。

判断等级：

- **仍适用**：继续用，无强制动作
- **可升级**：版本或局部模式升级，非替换
- **建议替换**：架构/库级别换道（须强证据）

### L4 — 优先级合成

| 级 | 定义 | 本任务动作 |
|----|------|------------|
| P0 | 安全漏洞、数据损坏、凭据泄露、不可恢复同步错误 | 只写建议，标「建议立即另开任务」 |
| P1 | 明显过时依赖/模式、高维护成本、与 2026 主流明显偏离 | 写升级/替换路径 |
| P2 | 风格、可选性能、体验优化 | 记入 backlog 建议 |

## 报告结构（audit-report.md）

```markdown
# Erolib 全栈审查报告
## 1. 执行摘要
## 2. 功能清单（按子系统）
## 3. 实现质量评估
## 4. 技术选型时新性对照（含外部来源）
## 5. 发现清单（P0 / P1 / P2）
## 6. 建议路线图（后续任务拆分建议）
## 7. 附录：检索会话与来源
```

每条发现模板：

```markdown
### [P?] 标题
- 现状：
- 证据：`path:line` 或模块
- 外部依据：（URL 或「仅代码内」）
- 建议动作：保留 | 升级 | 替换 | 重构
- 影响面：
- 建议后续任务：
```

## 子代理分工（Phase 2）

| 角色 | 职责 |
|------|------|
| trellis-research（可多次） | L1 盘点笔记、L3 外部检索笔记写入 `research/` |
| trellis-implement | 汇总为 `audit-report.md`（写 research，不改 apps/**） |
| trellis-check | 对照 AC1–AC4：覆盖度、来源标注、P 级完整性、无业务代码 diff |

约束：**禁止**修改 `apps/**`、`packages/**`、根 `package.json` 依赖版本；允许写本任务 `research/**` 与必要的 task 元数据。

## 风险与回滚

- 风险：外部检索噪声导致误判「必须替换」→ 规则：无 ≥2 独立来源或官方文档支撑时，最高只能标 P2「可观察」。
- 风险：范围膨胀改代码 → 硬边界：任何 `apps/` diff 视为失败。
- 回滚：仅删除/修正 research 文件，无运行时影响。

## 兼容性

- 报告为 Markdown，不绑定运行时。
- 后续实现任务通过复制发现条目到新 task `prd.md` 启动。
