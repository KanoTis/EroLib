# Playwright Docker standard practice (2026-07-18)

Sources: playwright.dev/docs/docker, playwright.dev/docs/browsers, Context7 /microsoft/playwright v1.61.0.

## Two official paths

### 1) Pre-built image (testing/dev oriented)

```
mcr.microsoft.com/playwright:v1.61.0-noble
```

- Includes browsers + system deps.
- **Does not** include the npm `playwright` package (install separately).
- Docs say: intended for testing/development; version tag must match project Playwright.
- Heavy (full browser set + Ubuntu base). Not ideal as base for a slim app server that also needs ffmpeg/app layout.

### 2) Build your own (recommended for app images)

Official snippet:

```dockerfile
FROM node:20-bookworm
RUN npx -y playwright@1.61.0 install --with-deps
```

For chromium-only production:

```bash
npx playwright install --with-deps chromium
# or, headless-only (smaller):
npx playwright install --with-deps --only-shell chromium
```

`--with-deps` = browsers + OS packages in one step (`install-deps` + `install`).

## Runtime / ops recommendations (official)

When running Playwright in Docker:

| Flag | Why |
|------|-----|
| `--init` | Avoid zombie processes (PID 1) |
| `--ipc=host` | Chromium shared-memory stability |
| optional `--cap-add=SYS_ADMIN` | Only if launch fails without it (local debug) |

Root user disables Chromium sandbox; OK for trusted app code. For untrusted sites, non-root + seccomp profile.

## Version lock (critical)

Browser binary revision must match installed `playwright` package. Mismatch → same class of "Executable doesn't exist".

In multi-stage builds: install browsers in the **runtime** stage using the **same** Playwright version as `node_modules` (prefer CLI from the copied/local package, not a floating `npx playwright@latest`).

## Browser path pitfalls

- Default Linux path: `~/.cache/ms-playwright` (root → `/root/.cache/ms-playwright`)
- Do **not** put that path under Docker BuildKit `--mount=type=cache` without ensuring layers persist — cache mounts can leave binaries out of final image
- Optional: `PLAYWRIGHT_BROWSERS_PATH=/ms-playwright` for explicit non-home path
- Optional hermetic: `PLAYWRIGHT_BROWSERS_PATH=0` → under `node_modules/playwright-core/.local-browsers`

## Fit for EroLib

- App already on `node:22-bookworm-slim` multi-stage + ffmpeg
- Only needs Chromium headless for live-recorder
- **Standard fit**: keep slim multi-stage; after `node_modules` is present in runtime, run  
  `npx playwright install --with-deps --only-shell chromium`  
  (or without `--only-shell` if full chromium preferred)
- Compose hardening (`init`, `ipc: host`) is official ops recommendation, orthogonal to missing binary

## Decision impact on prior A/B/C

- **A (Dockerfile only)**: fixes root cause; matches "build your own image" official path
- **B (+ compose init/ipc)**: aligns with official "Recommended Docker Configuration"; stability, not the missing-exec fix
- **C (+ README)**: documents rebuild/redeploy; optional
