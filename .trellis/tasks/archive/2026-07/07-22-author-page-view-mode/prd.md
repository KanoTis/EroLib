# Author page view size modes

## Goal

Give the author page the same media layout size controls as the library page (small / standard / list), so users can browse an author's local VOD works and live recordings at a comfortable density.

## Background

- Library supports three view modes: `small` | `standard` | `list` in `apps/web/src/pages/LibraryPage.tsx`.
- Preference key: `localStorage` `erolib.library.viewMode` (invalid/missing → `standard`).
- Shared layout CSS in `apps/web/src/styles.css`: `library-grid`, `library-grid--small`, `library-list`, `work-card--list`, `view-mode-toggle`.
- Toggle icons: `IconViewSmall` / `IconViewStandard` / `IconViewList` with labels 小尺寸 / 标准尺寸 / 列表.
- Author page `apps/web/src/pages/AuthorPage.tsx` hardcodes `library-grid` for 点播 and 直播; no view-mode state.
- Spec `.trellis/spec/frontend/author-navigation.md` covers author sections and page size 50; no view mode yet.

## Decisions

| # | Decision | Choice |
|---|----------|--------|
| D1 | Preference storage | Share `erolib.library.viewMode` with library |
| D2 | Modes | `small` / `standard` / `list` (same labels/icons as library) |
| D3 | Mode scope | One page-level mode applies to both 点播 and 直播 |
| D4 | Toggle placement | Single control below the author header card and above both media sections |

## Requirements

- R1. Author page shows a three-option view-mode control (小尺寸 / 标准尺寸 / 列表), same icons and `aria-label` / `aria-pressed` pattern as library.
- R2. Selected mode applies to both 点播作品 and 直播回放 lists (not per-section).
- R3. Layout markup parity with library:
  - standard → `library-grid` + `work-card` + cover `size="card"`
  - small → `library-grid library-grid--small` + icon-only play when playable
  - list → `library-list` + `work-card work-card--list` + cover `size="list"` (badge moves into actions row like library)
- R4. Read/write preference via `erolib.library.viewMode`; tolerate private-mode storage failures like library.
- R5. Toggle sits once below author header / subscribe card, above the first media section.
- R6. No API or backend changes.
- R7. Preserve existing author-page behavior: load author + lists, subscription add/toggles, load more, play, empty/error/loading, back link.

## Out of scope

- Live delete on author page
- Scroll restore on author page
- Search/filters on author page
- Per-section independent modes
- Required extraction of a shared media-grid component
- Changing library modes or labels

## Acceptance Criteria

- [x] AC1. Author page shows one view-mode control with three options (icons + accessible names 小尺寸 / 标准尺寸 / 列表), placed below the author header card and above media lists.
- [x] AC2. Changing mode updates both 点播 and 直播 layouts immediately without full page reload.
- [x] AC3. Standard: multi-column `library-grid` cards.
- [x] AC4. Small: `library-grid--small`; playable items use icon-only play control with `aria-label`.
- [x] AC5. List: `library-list` + `work-card--list` + list cover size.
- [x] AC6. Shared preference: mode set on author page is stored in `erolib.library.viewMode` and is what library reads on load (and the reverse).
- [x] AC7. Empty sections, load-more, subscribe controls, and back-to-library still work.
- [x] AC8. `pnpm` web typecheck (or project equivalent) passes.

## Spec follow-up (after implement)

- [x] Added to `.trellis/spec/frontend/author-navigation.md`: page sections include view-mode toggle; shared key `erolib.library.viewMode`.

## Task class

Lightweight — PRD-only; implementation is UI wiring in `AuthorPage.tsx` reusing existing CSS/icons.
