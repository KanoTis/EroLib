# 媒体库视图模式：小尺寸 / 标准 / 列表

## Goal

媒体库列表支持三种展示模式切换：**小尺寸**、**标准尺寸**、**列表**，方便在「一屏多看」与「信息更完整」之间切换。标准尺寸保持现有卡片网格；列表样式对齐用户提供的示意图（左封面、右标题/元信息/操作）。视图偏好用 `localStorage` 记住；窄屏不强制模式。

## Background / Confirmed Facts

| # | 事实 | 证据 |
|---|------|------|
| 1 | 媒体库页仅一种网格 | `LibraryPage.tsx` 固定 `className="library-grid"` + `work-card` 纵向卡片 |
| 2 | 网格 CSS 固定密度 | `styles.css` `.library-grid { minmax(220px, 1fr) }`；`.work-body { min-height: 132px }` |
| 3 | 封面组件已有 size 钩子 | `WorkCover` 支持 `size?: "card" \| "detail"`；列表可扩展 `list`，小卡可复用 `card` + 容器缩放 |
| 4 | 无视图偏好持久化 | `apps/web` 内无 `localStorage` 视图偏好 |
| 5 | 无网格/列表切换图标 | `Icons.tsx` 无 view-mode 图标，需新增 |
| 6 | 筛选工具栏已在 page-header | 搜索 + provider + status + 搜索按钮；视图切换器放工具栏同区 |
| 7 | 移动断点 | `styles.css` `@media (max-width: 900px)` 仅布局/侧栏，无媒体库视图强制逻辑 |

示意图（用户提供）：列表行为横向 row——左侧方封面、中间标题/作者、右侧渠道徽章 + 状态徽章 + 播放按钮；页头右侧为三段式图标切换（密网格 / 标准网格 / 列表）。

## Requirements

### R1. 三种视图模式

| 模式 | 布局 | 说明 |
|------|------|------|
| `small` | 密网格 | 更小卡片、更小封面与字号，一屏更多作品 |
| `standard` | 现有网格 | 保持当前 `library-grid` 视觉与密度（默认） |
| `list` | 横向列表 | 对齐示意图：左封面、右信息与操作 |

- 工具栏提供**分段控件**（segmented control），三个图标按钮互斥选中
- 切换仅影响展示，**不重新请求**数据
- 空态 / 加载态 / 错误态与视图模式无关，保持现状
- 窄屏（≤900px）**三模式均可**，不强制、不隐藏选项；CSS 自适应即可

### R2. 列表样式（对齐示意图）

每个作品一行：

- 左侧：方形封面（真实图或现有占位）
- 中间：标题（可点进详情）、作者名
- 右侧：渠道徽章、状态徽章、已下载可「播放」

列表默认**不展示**「远端收藏」行（标准/小尺寸卡片可保留），保持行高紧凑。

### R3. 小尺寸

- 仍为卡片网格，但 `minmax` 更小、padding/字号/封面字标缩放
- 信息层级与标准一致（标题、作者·渠道、播放），可收紧间距

### R4. 标准尺寸

- 视觉与交互与当前 `library-grid` / `work-card` **等价**（可重构 class，用户观感不变）

### R5. 视图偏好持久化

- 键：`erolib.library.viewMode`
- 值：`small` | `standard` | `list`
- 切换时写入；首次进入读取；非法/缺失 → `standard`
- 仅前端 localStorage，不同步服务端

### R6. 无障碍与交互

- 分段控件：`role="group"` + `aria-label`；当前模式按钮 `aria-pressed="true"`
- 键盘可操作（原生 button）
- 标题链接、播放按钮行为与现网一致

## Acceptance Criteria

- [ ] 媒体库工具栏可在 **小尺寸 / 标准 / 列表** 三模式间切换，当前模式有明确选中态
- [ ] 首次无偏好时默认为 **标准**
- [ ] 切换后刷新页面仍恢复上次模式（`localStorage` 键 `erolib.library.viewMode`）
- [ ] **标准** 与改前卡片网格观感一致
- [ ] **小尺寸** 明显更密（同宽下列数更多或卡片更小）
- [ ] **列表** 为横向行布局：左封面、中标题/作者、右渠道/状态/播放，对齐示意图信息结构
- [ ] 切换视图不触发重新拉取；筛选/搜索/播放/详情链路仍可用
- [ ] 窄屏仍可切换三模式，无强制覆盖偏好
- [ ] 无封面作品仍用现有占位，不出现破图

## Out of Scope

- 后端 API / 分页 / 排序变更
- 虚拟列表 / 无限滚动
- 拖拽排序、多选批量操作
- 详情页布局变更
- 用户账号级服务端偏好同步
- 窄屏强制列表或隐藏某一模式

## Decisions

| # | 决策 | 结论 |
|---|------|------|
| 1 | 偏好持久化 | `localStorage` 键 `erolib.library.viewMode`；非法回退 `standard` |
| 2 | 窄屏策略 | 三模式都可用，不强制、不隐藏 |

## Implementation Notes (non-binding)

主要改动文件（供实现参考，非验收项）：

- `apps/web/src/pages/LibraryPage.tsx` — 视图 state、切换器、按模式 class
- `apps/web/src/styles.css` — small grid / list row / segmented control
- `apps/web/src/components/Icons.tsx` — 三种视图图标
- 可选：`WorkCover.tsx` 增加 `list` size

轻量任务：本 PRD 足以进入实现；无需强制 `design.md` / `implement.md`。

## Notes

- 任务目录：`.trellis/tasks/07-15-media-library-view-modes/`
