# 全量功能与时新性架构审查

## Goal

对 Erolib 做一次**全栈同等深度**的功能与技术选型审查，判断实现是否合理/最佳、方案是否时新；产出**简体中文可执行详报**与 P0/P1/P2 建议。外部对照必须使用 `grok-search-rs`。本任务**只出报告，不改业务代码**。

## Background

- 产品：Docker 自托管音声媒体备份库；备份 Otobanana / Koe-koe / Erovoice 收藏；浏览器浏览与播放。
- 结构：`apps/server`（Hono API + jobs + providers）、`apps/web`（React SPA）、`packages/shared`。
- 关键依赖：Hono 4、Drizzle 0.43、@libsql/client、Zod 3、Playwright、React 19、react-router 7、Vite 6、pnpm 10、Node ≥20、TS 5.8。
- Server 面：auth、crypto、db、jobs（sync/download/live）、media、providers、routes、storage。
- Web 面：Login、Providers、Sync、Jobs、Library、WorkDetail、Live、Settings、全局 Player。

## Requirements

| ID | 要求 |
|----|------|
| R1 | **功能盘点**：枚举 server/web/shared/Docker 全部用户可见与运维功能；每项含入口路径、核心依赖、实现摘要。 |
| R2 | **实现质量**：评估正确性风险、可维护性、边界处理、与 active specs 一致性；区分「合理」与「可改进」。 |
| R3 | **时新性对照**：用 `grok-search-rs` 检索 2025–2026 主流实践；结论标「仍适用 / 可升级 / 建议替换」并附来源。 |
| R4 | **优先级清单**：P0（安全/数据损坏）、P1（过时或高维护成本）、P2（可选优化）；每条含现状、问题、建议、影响面。 |
| R5 | **报告落盘**：`research/audit-report.md`（可加 research 子笔记）；可被后续实现任务引用。 |

## Acceptance Criteria

- [ ] AC1: 功能清单覆盖 routes、jobs/providers、web pages/player、auth/storage、shared、Docker，无大块盲区。
- [ ] AC2: 「过时/非最佳」结论均有 `grok-search-rs` 依据，或明确标「仅代码内证据」。
- [ ] AC3: 报告含 P0/P1/P2 与建议动作（保留/升级/替换/重构）；**不改业务代码**。
- [ ] AC4: 交付 `research/audit-report.md`，可独立被后续 task 引用。
- [ ] AC5: 规划制品齐备且用户审过后再 `task.py start`。

## Out of Scope

- 业务代码修改、依赖升级落地、重构 PR。
- 新增 Provider / 新业务功能。
- 第三方站点合规评估（超出技术实现层面）。

## Decisions

| ID | 决策 |
|----|------|
| D1 | 交付 = 仅报告，不改代码 |
| D2 | 深度 = 全栈同等深度 |
| D3 | 风格 = 简体中文 + 可执行详报 |

## Technical Notes

- 对照维度：框架/ORM/鉴权/任务队列模式/前端数据层/播放器/容器部署/密钥管理。
- 代码对照：`.trellis/spec/backend/*`（含 live-media、credentials、vod-sync）、`.trellis/spec/frontend/global-audio-player.md`。
- 工具：`grok-search-rs`（web_search / web_fetch）；禁止凭训练数据断言「最新」。
