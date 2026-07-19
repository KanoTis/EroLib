# Implement: docker-slim-prod

## Checklist

1. [x] 改写 `Dockerfile`：deploy --prod + runtime 无 pnpm + 新路径
2. [x] 核对 `docker-compose.yml` / `README.md` 中 `WEB_DIST_DIR` 与启动说明
3. [x] `files: ["dist"]` 限制 server/shared 打包内容
4. [x] 本机 `pnpm deploy --prod --legacy` 验证 prod 树 ~47MB（含 shared/libsql/hono）
5. [ ] Docker Desktop 引擎未起：完整 `docker build` 待用户本机验证

## Validate

```bash
# Docker available:
docker build -t erolib:slim .
docker run --rm erolib:slim node -e "import('@libsql/client'); import('hono'); console.log('ok')"
docker images erolib:slim
```

## Rollback

Revert Dockerfile / docs commits.
