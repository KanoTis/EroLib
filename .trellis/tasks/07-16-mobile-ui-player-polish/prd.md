# Mobile UI and player polish

## Goal

让 Erolib Web 在手机端可舒适浏览与操作；提供**全局自定义迷你播放器 + Media Session**，路由切换不断播，视觉与交互接近音声应用而非裸 `<audio controls>`。

## Background

- 前端：Vite React SPA（`apps/web`），暗色 + 橙色 accent，CSS tokens 已存在（含 `--player-h`）。
- 布局：桌面侧栏；`max-width: 900px` 时侧栏抽屉 + `mobile-topbar`。
- 播放现状：`LibraryPage` / `LivePage` 各页固定底栏 + 原生 `<audio controls>`；`WorkDetailPage` 页内原生 audio；**播放状态不跨路由**。
- 已有：`api.audioUrl` / `api.liveAudioUrl` / `api.coverUrl`；`IconPlay` / `IconClose`；safe-area 部分预留；a11y 基础（skip-link、focus-visible、reduced-motion）。
- 窄屏痛点（截图 + 代码）：工具栏横向挤；原生 audio 与暗色主题割裂；底栏关闭钮偏小；换页断播。

## Decisions

| 主题 | 决定 |
|------|------|
| 播放器深度 | **自定义 mini player + Media Session** |
| 手机主导航 | **保留汉堡 + 侧栏抽屉**（不做底部 Tab） |
| 跨路由播放 | **App 级全局底栏播放器**（单实例） |
| 组件复用 | **抽取共享播放层**（context + bar + 控件）供库/直播/详情触发 |

## Requirements

### R1. 手机端布局与导航
- ≤900px：主内容无横向溢出；`env(safe-area-inset-*)` 尊重 notch / home indicator。
- 保留汉堡 + 侧栏抽屉；backdrop 关闭；路由切换关闭抽屉（已有，保持）。
- 顶栏 / 主内容 / 全局播放器不互相遮挡；有播放器时内容 `padding-bottom` 足够。

### R2. 库页与通用窄屏可用性
- 搜索 + 筛选 + 视图切换在 375px 可操作（允许换行/堆叠，不可不可达）。
- 列表/卡片播放等按钮触达 ≥44×44；徽章不挤爆标题。
- Providers / Sync / Jobs / Live / Settings / Detail：表单与主按钮可用；宽表格 `overflow-x: auto`。

### R3. 全局自定义播放器 + Media Session
- App 挂载**唯一**播放实例与固定底栏（有当前曲目时显示）。
- 控件：play/pause、可拖进度、当前/总时长、关闭；桌面可显示音量。
- 元数据：标题；直播显示「直播」标识；VOD 有封面则展示缩略图。
- **Media Session**：`metadata`（title、artist 可选、artwork 可选）；`play` / `pause` / `seekto`（及 `previoustrack`/`nexttrack` 可 no-op 或 hide）。
- 加载 / 错误：可读文案（如「加载中…」「无法播放」），不静默失败。
- 库页、直播页、详情页「播放」均走全局 `play` API；换路由**不断播**。
- 详情页：不再依赖独立页内原生 controls；可显示「当前正在播放本作品」状态或仅触发全局底栏。

### R4. 范围约束
- 不改后端 API / 鉴权 / 下载 / 同步逻辑。
- 不引入重型 UI 库；CSS + 少量 React 组件。
- 不实现播放队列、连播、倍速记忆、歌词。

## Acceptance Criteria

- [ ] AC1：375px 宽媒体库：开导航、搜索/筛选、切视图、播放、关播放器；主内容无横向滚动。
- [ ] AC2：全局底栏为自定义 UI（非裸原生 controls）；播放/关闭 ≥44×44；列表不被遮挡。
- [ ] AC3：从库页播放后进入详情（或其它路由），音频继续；底栏仍在。
- [ ] AC4：Live 页「播放」进入同一全局播放器；样式一致。
- [ ] AC5：详情页可触发/反映同一播放器，无第二套原生 controls 长期并存。
- [ ] AC6：Media Session：系统媒体控件可 play/pause；有封面时 artwork 不导致异常；无封面不崩。
- [ ] AC7：`prefers-reduced-motion` 无多余动效；键盘 focus 可见。
- [ ] AC8：`pnpm` 前端 typecheck / build 通过。

## Out of scope

- 播放队列 / 连播 / 倍速云同步
- 底部 Tab 导航重构
- Light mode / 品牌色重做
- PWA 安装与离线 SW
- 波形可视化 / 均衡器

## Non-goals clarification

- 系统锁屏「上一首/下一首」可不实现真实切曲（无队列时禁用或忽略）。
- 跨浏览器 Media Session 能力差异以「有则用、无则降级」为准。
