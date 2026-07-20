# 修复媒体库滚动位置并优化前端与播放器样式

## Goal

修复 GitHub Issue #6(返回媒体库时恢复滚动位置),并将全局播放器从全宽固定底栏改为类似 Spotify / Apple Music 的浮动卡片样式,支持收起 / 展开。

## Task Map

| Child | Slug | Status | Notes |
|-------|------|--------|-------|
| 修复媒体库返回滚动位置 | `library-scroll-restore` | planning | Issue #6; PRD-only lightweight task |
| 播放器样式优化 | `player-style-polish` | planning | 浮动卡片 + 收起/展开; complex (prd + design + implement) |
| 前端样式优化 | `frontend-style-polish` | cancelled | 用户选择跳过 |

## Requirements

- 从媒体库点击作品进入详情页,返回媒体库时恢复离开时的滚动位置。
- 全局播放器改为浮动卡片样式,叠加在页面内容上(不推挤内容布局)。
- 播放器支持收起(迷你模式)与展开(完整模式)切换,有过渡动画。
- 播放器在路由切换时不中断播放(现有行为保持)。

## Acceptance Criteria

- [ ] 媒体库 → 作品详情 → 返回媒体库,滚动位置恢复到点击前。
- [ ] 播放器以浮动卡片形式显示(有圆角、阴影、边距),叠加在内容上。
- [ ] 点击收起按钮 → 播放器变为迷你模式(右下角小卡片)。
- [ ] 点击展开按钮 → 播放器恢复完整模式。
- [ ] 收起 / 展开有平滑过渡动画。
- [ ] 播放器收起/展开偏好持久化(localStorage)。
- [ ] 移动端(375px)播放器正常显示。
- [ ] 路由切换时播放不中断。
- [ ] `pnpm --filter @erolib/web typecheck` 通过。

## Notes

- 前端样式优化已取消,后续如需可重新创建任务。
- 播放器样式优化已取消,后续如需可重新创建任务。
- 本父任务以「滚动恢复」交付收尾;样式子任务不做。
- 播放器改为 overlay 后,内容区不再需要 `layout--player-open` 的 `padding-bottom`。
