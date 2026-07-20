# 播放器样式优化 — 执行计划

## 前置条件

- [x] PRD 已完成
- [x] design.md 已完成
- [ ] 审核 gate:用户确认设计方案后再开始

## 执行步骤

### Step 1: PlayerContext + types 添加 collapsed 状态

- [ ] `apps/web/src/player/types.ts`:无需改(类型从 PlayerContextValue 导出)
- [ ] `apps/web/src/player/PlayerContext.tsx`:
  - [ ] 新增 `COLLAPSED_KEY` 常量
  - [ ] 新增 `collapsed` state(localStorage 初始化)
  - [ ] 新增 `toggleCollapsed` callback(localStorage 持久化)
  - [ ] `PlayerContextValue` 类型添加 `collapsed: boolean` 和 `toggleCollapsed: () => void`
  - [ ] `useMemo` value 数组添加依赖
- [ ] 验证:`pnpm --filter @erolib/web typecheck`

### Step 2: Icons 添加收起/展开图标

- [ ] `apps/web/src/components/Icons.tsx`:
  - [ ] 新增 `IconChevronDown`(向下箭头 = 收起)
  - [ ] 新增 `IconChevronUp`(向上箭头 = 展开)
  - [ ] 或复用现有图标(检查是否已有 chevron/close 图标可用)

### Step 3: PlayerBar 实现

- [ ] `apps/web/src/components/PlayerBar.tsx`:
  - [ ] 从 `usePlayer()` 解构 `collapsed` 和 `toggleCollapsed`
  - [ ] 根容器添加 `player--collapsed` 条件 class
  - [ ] 添加收起/展开按钮(始终可见,放在 player-close 旁边或右上角)
  - [ ] 进度条:计算 `seekPercent`,设置 `--seek-percent` CSS var
  - [ ] 音量条:计算 `volumePercent`,设置 `--volume-percent` CSS var
  - [ ] 收起时关闭按钮隐藏(收起模式用展开按钮代替)
- [ ] 验证:`pnpm --filter @erolib/web typecheck`

### Step 4: styles.css 播放器样式重写

- [ ] `apps/web/src/styles.css`:
  - [ ] `.player` 改为浮动卡片:圆角、阴影、边距、`right` + `width` 定位
  - [ ] `.player-main` grid 布局调整
  - [ ] `.player--collapsed`:缩小 width,隐藏 controls/subtitle/status/close
  - [ ] `.player--collapsed .player-controls`:opacity + max-width + overflow 过渡
  - [ ] `.player-collapse-btn`:收起/展开按钮样式
  - [ ] seek track `linear-gradient` 高亮(webkit + moz)
  - [ ] volume track `linear-gradient` 高亮
  - [ ] 删除 `.layout--player-open .content` 的 padding-bottom 规则(两处:桌面 + 移动端)
  - [ ] `.library-load-more` 加 `scroll-margin-bottom`
  - [ ] 移动端 `@media (max-width: 900px)`:
    - [ ] 展开模式 width 调整(无 sidebar)
    - [ ] 收起模式 width 调整
    - [ ] 保留音量控制(紧凑布局,不再 `display: none`)
- [ ] 验证:浏览器手动检查桌面端 + 移动端

### Step 5: App.tsx 移除 layout--player-open

- [ ] `apps/web/src/App.tsx`:
  - [ ] `AuthenticatedShell` 中移除 `usePlayer()` 的 `track` 解构
  - [ ] `<div className={track ? "layout layout--player-open" : "layout"}>` → `<div className="layout">`
  - [ ] 如果 `usePlayer` 不再被 `AuthenticatedShell` 使用,移除导入
- [ ] 验证:`pnpm --filter @erolib/web typecheck`

### Step 6: 整体验证

- [ ] `pnpm --filter @erolib/web typecheck` 通过
- [ ] 浏览器手动验证:
  - [ ] 播放音频 → 浮动卡片显示(展开模式)
  - [ ] 进度条已播放部分高亮
  - [ ] 点击收起 → 右下角迷你卡片
  - [ ] 点击展开 → 恢复完整模式
  - [ ] 刷新页面 → 收起/展开偏好保持
  - [ ] 移动端(375px)展开 + 收起正常
  - [ ] 移动端展开模式可调音量
  - [ ] 路由切换播放不中断

## 验证命令

```bash
pnpm --filter @erolib/web typecheck
```

## 回滚点

- 每个 Step 完成后可 git stash / git checkout 单文件回滚
- Step 4(styles.css)是最大改动,如果样式有问题可单独 revert styles.css + PlayerBar.tsx
