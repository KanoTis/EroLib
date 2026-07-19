# Implement Phase B: 统一作者订阅 + listAuthorWorks

## Checklist

### 1. DB + Shared + API
- [x] `sync_works` 列 + migrate 幂等（旧行 0）
- [x] `LiveSubscriptionPublic.syncWorks`
- [x] toPublic / POST / PATCH 读写
- [x] POST 默认：syncWorks true；enabled 仅 otabana true

### 2. Provider.listAuthorWorks
- [x] types.ts 接口
- [x] otobanana：`/api/users/{id}/casts` 分页
- [x] koekoe：search.php 分页解析
- [x] erovoice：作者页 voiceList 解析
- [x] 解析单测（能抽纯函数则加 fixture）

### 3. Runner
- [x] syncOne 作者作品循环（不依赖 favorite_sync_enabled）
- [x] upsert remoteInFavorites=false
- [x] per-author lastError / lastCheckAt
- [x] 账号缺失跳过

### 4. SyncPage UI
- [x] provider 选择 + 双开关
- [x] 非 otabana 隐藏自动录制
- [x] 文案「同步作品」

### 5. Verify
- [x] typecheck shared/server/web
- [x] server tests
- [ ] 手工：开 syncWorks → 立即同步 → 库中出现作品

## Validation

```bash
pnpm --filter @erolib/shared build
pnpm --filter @erolib/server test
pnpm --filter @erolib/server exec tsc --noEmit
pnpm --filter @erolib/web exec tsc --noEmit
```

## Risky

- 三渠道 HTML/API 分页形态
- 与收藏对账交叉污染 remoteInFavorites
- 添加 API 现写死 otabana 需扩展 multi-provider
