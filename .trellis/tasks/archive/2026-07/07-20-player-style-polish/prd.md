# 播放器样式优化

## Goal

将全局播放器从全宽固定底栏改为类似 Spotify / Apple Music 网页端的浮动卡片样式,支持收起(迷你模式)与展开(完整模式)切换。

## Current State

- `PlayerBar` 是 `position: fixed; left: var(--sidebar-w); right: 0; bottom: 0` 的全宽底栏。
- `.layout--player-open .content` 有 `padding-bottom` 推挤内容以避免遮挡。
- 移动端(≤900px)隐藏音量控制,播放器变为单列。
- 播放器无显示 / 隐藏过渡动画。

## Requirements

### 浮动卡片布局
- 播放器是叠加在页面内容上的浮动卡片(overlay),不再推挤内容布局。
- 卡片有圆角(`--radius-lg`)、阴影(`--shadow`)、边距(四周留间距)。
- 移除 `.layout--player-open .content` 的 `padding-bottom`;播放器完全 overlay。
- 给 `.library-load-more` 等底部交互元素加 `scroll-margin-bottom` 确保可滚入视野。

### 收起 / 展开交互
- 新增收起 / 展开状态,默认展开。
- **展开模式**:完整播放控制 — 封面、标题、副标题、进度条、时间、播放/暂停、音量、关闭。
- **收起模式**:迷你卡片固定在右下角 — 封面缩略图(40×40)+ 播放/暂停按钮 + 展开按钮。
- 收起 / 展开偏好持久化到 `localStorage`。
- 收起 / 展开切换有平滑过渡动画(CSS transition)。

### 进度条改进
- seek bar 的已播放部分用 accent 色高亮(通过 `background: linear-gradient` 动态设置)。
- 收起模式下不显示进度条。

### 移动端适配
- 展开模式:底部浮动卡片,左右边距 8px。
- 收起模式:右下角迷你卡片。
- 移动端展开模式保留音量控制(当前隐藏音量的问题需要修复,改为紧凑布局或可折叠)。

### 保持不变
- `PlayerProvider` 不卸载、路由切换不中断播放。
- 同曲目策略(same-id no-op/resume/restart)。
- Media Session 集成。

## Acceptance Criteria

- [ ] 播放器以浮动卡片形式显示,有圆角、阴影、四周边距,叠加在内容上。
- [ ] 内容区不再因播放器打开而增加 `padding-bottom`。
- [ ] 点击收起按钮 → 播放器变为右下角迷你卡片(封面 + 播放/暂停 + 展开)。
- [ ] 点击展开按钮 → 播放器恢复完整模式。
- [ ] 收起 / 展开有平滑 CSS transition。
- [ ] 收起 / 展开偏好持久化(刷新后保持)。
- [ ] seek bar 已播放部分有 accent 色高亮。
- [ ] 移动端(375px)展开和收起模式都正常显示。
- [ ] 移动端展开模式可以调节音量(不再直接隐藏)。
- [ ] 路由切换时播放不中断,播放器不卸载。
- [ ] `pnpm --filter @erolib/web typecheck` 通过。
