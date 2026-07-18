# Design: GHCR Playwright Chromium for live recorder

## Problem

Runtime image has npm `playwright` but no browser binaries or OS deps.  
`chromium.launch()` resolves to missing `/root/.cache/ms-playwright/chromium_headless_shell-1228/...`.

## Approach

Keep `node:22-bookworm-slim` multi-stage app image. After runtime `node_modules` is copied, install **Chromium only** with matching Playwright CLI + system deps. Harden compose with official Docker run flags.

Do **not** switch base to `mcr.microsoft.com/playwright` (oversized, wrong product shape for a media backup server).

## Architecture

```
[build stage]  pnpm install + compile app
       |
       v
[runtime stage]
  apt: ca-certificates ffmpeg  (existing)
  copy package.json + node_modules + dist
  RUN: playwright install --with-deps --only-shell chromium
  ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright  (optional but recommended)
  CMD node apps/server/dist/index.js
```

```
[docker-compose]
  init: true
  ipc: host
  (image/env/volumes unchanged)
```

## Contracts

| Surface | Change |
|---------|--------|
| App JS | None (default `chromium.launch` finds browsers via Playwright path rules) |
| Dockerfile | Runtime install browsers + deps; optional env for browser path |
| compose | `init`, `ipc` only |
| GHCR workflow | No file change; rebuild/push picks up Dockerfile |

## Dockerfile design details

1. **When to install**  
   After `COPY --from=build ... node_modules` so `./node_modules/.bin/playwright` (or `pnpm exec` / `npx` resolving local package) is available.

2. **Exact command (preferred)**  
   ```dockerfile
   ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
   RUN mkdir -p /ms-playwright \
     && pnpm --filter @erolib/server exec playwright install --with-deps --only-shell chromium \
     && rm -rf /var/lib/apt/lists/*
   ```  
   Fallback if filter/exec is awkward in runtime (pnpm may need workspace files already present — package.json + workspace yaml are already copied):  
   ```dockerfile
   RUN ./node_modules/.bin/playwright install --with-deps --only-shell chromium
   ```  
   Prefer path under `apps/server/node_modules` if hoisting puts CLI only there:
   ```dockerfile
   RUN apps/server/node_modules/.bin/playwright install --with-deps --only-shell chromium \
     || node_modules/.bin/playwright install --with-deps --only-shell chromium
   ```  
   Implementation should use **one** deterministic path after inspecting lock/hoist layout (or `pnpm exec` from workspace root with corepack already enabled).

3. **`--only-shell`**  
   Matches `headless: true` without `channel`. Smaller image; still satisfies missing `chromium_headless_shell-1228`.

4. **Version alignment**  
   CLI must come from installed `playwright@1.61.1` tree, never `npx playwright@latest`.

5. **No cache-mount on browser dir**  
   Browser files must land in image layers.

6. **Root user**  
   Keep current root runtime (trusted app). Sandbox off is acceptable per Playwright Docker docs for trusted code.

## Compose design

```yaml
services:
  app:
    init: true
    ipc: host
    # existing image/ports/env/volumes/restart
```

- `init`: reaps zombie browser child processes  
- `ipc: host`: Chromium shared memory (official recommendation)  
- Document mentally: hosts that forbid `ipc: host` may still run; risk is Chromium crash under memory pressure, not missing binary.

## Data flow (unchanged)

```
live-poller → createLiveRecorder → chromium.launch → page evaluate → wav file
```

Only the launch environment becomes valid.

## Trade-offs

| Choice | Pro | Con |
|--------|-----|-----|
| `--only-shell` | Smaller, matches headless usage | Headed debug in container needs full chromium install |
| Keep slim base + install | Fits app + ffmpeg | Image grows ~100–300MB vs current |
| Official PW base image | Zero install friction | Huge, Ubuntu not bookworm-slim, ffmpeg/app layout rework |
| `PLAYWRIGHT_BROWSERS_PATH` | Explicit, avoids home-dir surprises | Must set at install **and** runtime |

## Compatibility / rollout

1. Merge Dockerfile + compose changes  
2. Rebuild image (local smoke AC2)  
3. Push via existing GHA on master/tag or `workflow_dispatch`  
4. Production: `docker compose pull && docker compose up -d`  
5. Rollback: previous GHCR digest; compose without init/ipc is safe if needed

## Risks

| Risk | Mitigation |
|------|------------|
| `bookworm-slim` missing deps for install-deps | `--with-deps` installs them; if fails, switch to `node:22-bookworm` non-slim runtime only |
| pnpm bin path not on PATH | Call explicit `node_modules` binary |
| Image size | `--only-shell` + chromium-only |
| CI build time/network for browser download | Accept; GHA already builds image |
| `ipc: host` not allowed on some orchestrators | Optional at deploy; binary fix does not depend on it |

## Non-goals

- Application code changes  
- README  
- Full live E2E  
