# Fix live-browser-script missing from production dist

## Goal

Production GHCR images must ship `apps/server/dist/jobs/live-browser-script.js` so Otobanana live auto-recording can inject the browser capture script.

## Background

- `live-recorder.ts` loads the script at runtime via `new URL("./live-browser-script.js", import.meta.url)` and `readFile`.
- Source lives at `apps/server/src/jobs/live-browser-script.js` (plain JS on purpose; not TypeScript).
- Server build is `tsc -p tsconfig.json` only. `tsc` does not emit/copy this `.js` into `dist/`.
- Dockerfile runtime stage only copies `apps/server/dist`, so production hits:
  `ENOENT: open '/app/apps/server/dist/jobs/live-browser-script.js'`.
- Local `pnpm dev` works because `tsx` runs from `src/`.

## Requirements

1. `@erolib/server` production build must place `live-browser-script.js` next to compiled `live-recorder.js` under `dist/jobs/`.
2. Fix must work on Windows and Linux (Docker build host + CI).
3. Script content must stay plain JS (no TS compile transforms that inject helpers into browser-evaluated code).
4. No behavior change to recording logic beyond making the script loadable in production.

## Acceptance Criteria

- [x] After `pnpm --filter @erolib/server build`, file exists at `apps/server/dist/jobs/live-browser-script.js`.
- [x] Content matches `apps/server/src/jobs/live-browser-script.js` (same browser entry exports).
- [x] Dockerfile path `/app/apps/server/dist/jobs/live-browser-script.js` is present after image build copy of `dist`.
- [x] Runtime no longer fails script load with `ENOENT ... live-browser-script.js` when a live record job starts (verified via dist path + identical content after build).

## Out of Scope

- Playwright / WebRTC capture algorithm changes
- Live poller / subscription UI changes
- Migrating the browser script to TypeScript or a bundler

## Technical Notes

- Preferred fix: post-`tsc` copy of `src/jobs/live-browser-script.js` → `dist/jobs/` in `@erolib/server` build script (Node `fs.cpSync` or equivalent, cross-platform).
- Alternative (not preferred): enable `allowJs` and rely on `tsc` emit — less explicit about “this is a runtime asset”.
