# Implement: Mobile UI and player polish

## Checklist

### 1. Player core
- [ ] `apps/web/src/player/types.ts` — `PlayableTrack`, status types
- [ ] `apps/web/src/player/PlayerContext.tsx` — Provider + `usePlayer`
  - hidden `<audio>`
  - play / toggle / seek / volume / mute / stop
  - event wiring: timeupdate, durationchange, play, pause, waiting, canplay, ended, error
  - same-id policy per design
- [ ] `apps/web/src/player/mediaSession.ts` — set/clear Media Session metadata + handlers
- [ ] Icons: `IconPause`, `IconVolume`, `IconVolumeMute` in `Icons.tsx`

### 2. Player UI
- [ ] `apps/web/src/components/PlayerBar.tsx` — custom mini bar
  - artwork optional, title, live badge, play/pause, times, range, volume (desktop), close
  - a11y: region label, button labels, range `aria-valuemin/max/now`
- [ ] `styles.css` — player chrome, progress accent, mobile two-row, hit targets ≥44px
- [ ] Update `--player-h` (or CSS that pads content when bar visible)

### 3. App shell
- [ ] Wrap authenticated shell with `PlayerProvider` in `App.tsx`
- [ ] Render `<PlayerBar />` once under layout (sibling to content)
- [ ] Ensure mobile topbar / sidebar z-index stack: backdrop 45, sidebar 50, player 40 (or player above content but below sidebar)

### 4. Page migration
- [ ] `LibraryPage` — remove local playing state + local `.player`; `play({ kind, id, title, src, artworkUrl? })`
- [ ] `LivePage` — same
- [ ] `WorkDetailPage` — remove native controls; play button uses global player; show “正在播放” when track matches

### 5. Mobile layout polish
- [ ] `.toolbar` wrap / full-width search at ≤900px (and tighter rules if needed at 640)
- [ ] `.table-wrap` overflow-x; form grids already 1-col
- [ ] List card actions touch spacing
- [ ] `touch-action: manipulation` on buttons/inputs where helpful
- [ ] Content bottom padding tracks player open height + safe-area

### 6. Validation
- [ ] Manual 375px: library filters + play + navigate away + continue audio + close
- [ ] Manual: Live play + Detail play + Media Session play/pause (Chrome desktop at least)
- [ ] `pnpm --filter @erolib/web exec tsc --noEmit` (or project equivalent)
- [ ] `pnpm --filter @erolib/web build` if available

## Risky files

- `apps/web/src/App.tsx` — shell + provider
- `apps/web/src/pages/LibraryPage.tsx` — highest traffic player entry
- `apps/web/src/styles.css` — global layout/player
- New: `apps/web/src/player/*`, `PlayerBar.tsx`

## Rollback points

1. After player core only: pages still old → don't ship mid-state.
2. Prefer single PR: provider + bar + all three page migrations together.

## Out of this checklist

- Bottom tabs, queue, light mode, backend changes
