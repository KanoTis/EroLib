# Implement: GHCR Playwright Chromium

## Ordered checklist

1. **Inspect Playwright binary path in installed layout**  
   Confirm whether CLI lives at root `node_modules/.bin/playwright` and/or `apps/server/node_modules/.bin/playwright` after Docker copy pattern (same as current Dockerfile COPY of both node_modules trees).

2. **Edit `Dockerfile` (runtime stage)**  
   - After node_modules + dist copies, before or after `mkdir -p /data...`  
   - Set `ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright`  
   - `RUN` install:
     - Prefer: use local package CLI  
       `node_modules/playwright/cli.js` or `.bin/playwright`  
       `install --with-deps --only-shell chromium`  
     - Ensure apt lists cleaned after `--with-deps`  
   - Keep existing `ffmpeg` / `ca-certificates` install; may merge with install-deps or leave separate (install-deps will apt-get as root).  
   - Do not use BuildKit cache mount on `/ms-playwright` or `~/.cache/ms-playwright`.

3. **Edit `docker-compose.yml`**  
   Under `services.app`:
   ```yaml
   init: true
   ipc: host
   ```

4. **Smoke validate (required)**  
   ```bash
   docker build -t erolib:pw-smoke .
   docker run --rm --init --ipc=host erolib:pw-smoke \
     node -e "const {chromium}=require('playwright'); (async()=>{const b=await chromium.launch(); await b.close(); console.log('ok')})().catch(e=>{console.error(e); process.exit(1)})"
   ```  
   Note: package is ESM (`"type":"module"`) — use `node --input-type=module -e "import { chromium } from 'playwright'; ..."` or a tiny temp `.mjs` mounted/copied if `-e` import fails.  
   Working directory must be `/app` so resolution finds hoisted playwright.

   Alternative one-liner from /app:
   ```bash
   docker run --rm --init --ipc=host -w /app erolib:pw-smoke \
     node --input-type=module -e "import { chromium } from 'playwright'; const b = await chromium.launch(); await b.close(); console.log('ok');"
   ```

5. **Regression checks**  
   - Image still starts: `node apps/server/dist/index.js` / health if runnable without secrets  
   - `ffmpeg` still present: `docker run --rm erolib:pw-smoke ffmpeg -version`

6. **Quality**  
   No app TS change → skip unit tests unless touch server code.  
   Diff review: Dockerfile + compose only.

## Validation commands

| Check | Command |
|-------|---------|
| Build | `docker build -t erolib:pw-smoke .` |
| Launch browser | ESM one-liner above → prints `ok` |
| ffmpeg | `docker run --rm erolib:pw-smoke ffmpeg -version` |
| No FF/WebKit bloat | Optional: `ls` under `/ms-playwright` only chromium/headless-shell dirs |

## Risky files / rollback

| File | Risk |
|------|------|
| `Dockerfile` | Build failure / image size / missing CLI path |
| `docker-compose.yml` | Orchestrators that reject `ipc: host` |

Rollback: revert two files; redeploy previous image tag/digest.

## Done when

- AC1–AC6 from `prd.md` satisfied  
- Smoke launch succeeds  
- Ready for commit / GHCR rebuild via existing workflow

## Out of implement scope

- README  
- GHA workflow edits  
- live-recorder source changes  
