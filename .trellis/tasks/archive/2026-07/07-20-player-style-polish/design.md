# 播放器样式优化 — 技术设计

## 1. 边界

| 文件 | 改动范围 |
|------|----------|
| `apps/web/src/player/PlayerContext.tsx` | 添加 `collapsed` 状态 + `toggleCollapsed` + localStorage 持久化 |
| `apps/web/src/player/types.ts` | `PlayerContextValue` 增加 `collapsed` 和 `toggleCollapsed` |
| `apps/web/src/components/PlayerBar.tsx` | 条件 class `player--collapsed`; 进度条高亮 CSS var; 收起/展开按钮 |
| `apps/web/src/components/Icons.tsx` | 新增 `IconChevronDown` / `IconChevronUp`(或复用现有) |
| `apps/web/src/styles.css` | 播放器卡片样式重写; 移除 `layout--player-open .content` padding; 移动端适配 |
| `apps/web/src/App.tsx` | 移除 `layout--player-open` class 逻辑(播放器改为 overlay) |

不改动:`PlayerProvider` 的音频生命周期、Media Session 逻辑、same-track 策略。

## 2. 状态设计

```ts
// PlayerContext.tsx 新增
const COLLAPSED_KEY = "erolib.player.collapsed";

const [collapsed, setCollapsed] = useState<boolean>(() => {
  try { return localStorage.getItem(COLLAPSED_KEY) === "1"; } catch { return false; }
});

const toggleCollapsed = useCallback(() => {
  setCollapsed((prev) => {
    const next = !prev;
    try { localStorage.setItem(COLLAPSED_KEY, next ? "1" : "0"); } catch { /* ignore */ }
    return next;
  });
}, []);
```

`collapsed` 和 `toggleCollapsed` 通过 context 暴露。`PlayerBar` 消费它们,`App.tsx` 不再需要 `track` 判断 `layout--player-open`。

## 3. PlayerBar 布局设计

### 3.1 展开 vs 收起

单一 DOM 树,用 `player--collapsed` class 切换。内部不需要的元素用 `opacity + max-width + overflow` 过渡消失:

```tsx
<div className={`player${collapsed ? " player--collapsed" : ""}`}>
  <div className="player-main">
    {/* meta 区:展开和收起都显示,但收起时缩小 */}
    <div className="player-meta">...</div>
    {/* controls 区:收起时隐藏 */}
    <div className="player-controls">...</div>
  </div>
  {/* 收起/展开按钮:始终显示 */}
  <button className="player-collapse-btn" onClick={toggleCollapsed}>
    {collapsed ? <IconChevronUp/> : <IconChevronDown/>}
  </button>
</div>
```

### 3.2 进度条已播放高亮

用 CSS variable 传递已播放百分比,native range track 用 `linear-gradient` 着色:

```tsx
const seekPercent = canSeek && duration > 0
  ? Math.min(100, Math.max(0, (displayTime / duration) * 100))
  : 0;

<input
  className="player-seek"
  style={{ "--seek-percent": `${seekPercent}%` } as React.CSSProperties}
  ...
/>
```

```css
.player-seek::-webkit-slider-runnable-track {
  background: linear-gradient(
    to right,
    var(--accent) 0%,
    var(--accent) var(--seek-percent, 0%),
    rgba(148, 163, 184, 0.28) var(--seek-percent, 0%),
    rgba(148, 163, 184, 0.28) 100%
  );
}
/* 同理 moz-range-track */
```

音量条同理,用 `--volume-percent`。

### 3.3 收起按钮位置

收起按钮放在卡片右上角或右侧,始终可见。展开时图标向下(收起),收起时图标向上(展开)。

## 4. CSS 设计

### 4.1 展开模式(默认)

```css
.player {
  position: fixed;
  left: var(--space-4);
  right: var(--space-4);
  bottom: var(--space-4);
  z-index: 40;
  padding: var(--space-3) var(--space-4);
  border-radius: var(--radius-lg);
  border: 1px solid var(--border);
  background: rgba(21, 21, 44, 0.92);
  backdrop-filter: blur(18px);
  box-shadow: var(--shadow);
  transition:
    left var(--duration) var(--ease),
    bottom var(--duration) var(--ease),
    padding var(--duration) var(--ease);
}
```

### 4.2 收起模式

```css
.player--collapsed {
  left: auto;
  right: var(--space-4);
  bottom: var(--space-4);
  width: auto;
  max-width: 320px;
  padding: var(--space-2) var(--space-3);
}

.player--collapsed .player-controls {
  opacity: 0;
  max-width: 0;
  overflow: hidden;
  pointer-events: none;
  margin: 0;
  padding: 0;
}

.player--collapsed .player-close { display: none; }
.player--collapsed .player-subtitle { display: none; }
.player--collapsed .player-status { display: none; }
```

`left` 从 `var(--space-4)` 到 `auto` 无法 CSS transition。解决:展开时也不用 `left`,改用 `right` + `width`:

```css
.player {
  right: var(--space-4);
  bottom: var(--space-4);
  left: var(--space-4);  /* 过渡到 auto 不行,改用 width */
}
```

**最终方案**:用 `right` + `width`,不用 `left`:

```css
.player {
  position: fixed;
  right: var(--space-4);
  bottom: var(--space-4);
  width: calc(100vw - 2 * var(--space-4) - var(--sidebar-w));
  /* 过渡 width */
  transition: width var(--duration) var(--ease), padding var(--duration) var(--ease);
}

.player--collapsed {
  width: auto;
}
```

但 `width: auto` 也不能过渡。用 `max-width` 配合:

- 展开:`width: calc(...)` 宽
- 收起:`width: 200px` 窄(固定值)

`width` 从 `calc(...)` 过渡到 `200px` 可以,都是长度。同时 `margin-left: auto` 确保右对齐。

```css
.player {
  position: fixed;
  right: var(--space-4);
  bottom: var(--space-4);
  margin-left: auto;
  width: calc(100vw - var(--sidebar-w) - 2 * var(--space-4));
  max-width: 1200px;
  transition: width var(--duration) var(--ease), padding var(--duration) var(--ease), max-width var(--duration) var(--ease);
}

.player--collapsed {
  width: 200px;
  max-width: 200px;
}
```

移动端(≤900px):展开 `width: calc(100vw - 2 * var(--space-4))`(无 sidebar)。

### 4.3 移除 content padding

```css
/* 删除 .layout--player-open .content 的 padding-bottom */
/* App.tsx 不再添加 layout--player-open class */
```

给底部交互元素加 scroll margin:
```css
.library-load-more { scroll-margin-bottom: calc(var(--player-h) + var(--space-8)); }
```

### 4.4 移动端

```css
@media (max-width: 900px) {
  .player {
    width: calc(100vw - 2 * var(--space-2));
    right: var(--space-2);
    bottom: var(--space-2);
  }
  .player--collapsed {
    width: 180px;
  }
  /* 展开模式保留音量:改为更紧凑的布局 */
  .player-volume { min-width: 80px; }
  .player-volume-label { width: 56px; }
}
```

## 5. App.tsx 改动

```tsx
// 移除:
const { track } = usePlayer();
<div className={track ? "layout layout--player-open" : "layout"}>

// 改为:
<div className="layout">
```

## 6. 风险与兼容

| 风险 | 缓解 |
|------|------|
| 播放器 overlay 遮挡底部内容 | 加 `scroll-margin-bottom`; 用户可滚动 |
| `width` 过渡在极端视口尺寸下跳动 | 用 `max-width` 约束; 移动端单独断点 |
| 收起模式 `max-width:0` 过渡在某些浏览器闪烁 | 用 `overflow:hidden` + `opacity` 双保险 |
| 进度条 CSS var 在旧浏览器不支持 | 降级为单色 track,不影响功能 |

## 7. 回滚

所有改动集中在 5 个文件,git revert 即可回滚。无数据库 / API 变更。
