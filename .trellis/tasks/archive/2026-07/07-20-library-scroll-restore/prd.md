# 修复媒体库返回滚动位置

## Goal

Issue #6: 返回媒体库时应回到点击前的位置,而不是顶部。

## Context

- 滚动发生在 `window` 上(`.content` 无 `overflow: auto`;`.layout` 为 `min-height: 100dvh`)。
- `App.tsx:172` 的 `<main key={location.pathname}>` 导致路由切换时 main 重新挂载。
- LibraryPage 在 unmount 时丢失所有状态,remount 时重新调用 `loadInitial()`,滚动位置重置为 0。

## Requirements

- 从媒体库点击作品进入 `WorkDetailPage`,再通过"返回媒体库"回到 `LibraryPage` 时,`window.scrollY` 恢复到离开时的值。
- 滚动位置保存在 `sessionStorage` 中(同标签页有效,关闭后清除)。
- 恢复时机:首次 `loadInitial()` 完成且数据已渲染后,用 `requestAnimationFrame` 恢复。
- 恢复后立即清除 sessionStorage 中的值,避免刷新后重复恢复到过期位置。
- 切换筛选 / 搜索 / 类型时不恢复(新查询结果,位置无意义)。
- "加载更多"追加数据后不触发恢复(仅首次加载恢复)。

## Acceptance Criteria

- [x] 媒体库列表 → 点击作品 → 详情页 → 返回媒体库 → 滚动位置恢复到点击前。
- [x] 媒体库 → 点击作品 → 详情页 → 返回 → 再次点击另一作品 → 返回 → 每次都恢复到离开时位置。
- [x] 切换类型 / 搜索后,列表从顶部开始(不恢复旧位置)。
- [x] "加载更多"后滚动位置不被重置。
- [x] `pnpm --filter @erolib/web typecheck` 通过。

## Implementation Notes

- 用 `useRef` 标记 `needsRestore`,仅在首次 `loadInitial` 的 `finally` 块中恢复。
- unmount 时(`useEffect` cleanup)将 `window.scrollY` 写入 `sessionStorage`。
- 不移除 `App.tsx` 的 `key={location.pathname}`(其他页面依赖 fade-in 动画)。
