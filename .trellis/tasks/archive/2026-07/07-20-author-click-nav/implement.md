# Implement: 作者页与作者名导航

## Checklist

### 1. Shared DTO
- [ ] 在 `packages/shared/src/index.ts` 增加 `AuthorPublic`
- [ ] 导出类型供 web/server 使用

### 2. Server — 过滤
- [ ] `GET /api/works`：query `authorId` → `eq(works.authorId, …)`
- [ ] `GET /api/live/media`：同上

### 3. Server — 作者路径与头像
- [ ] `paths.ts`：`authorAvatarPaths(mediaRoot, provider, authorId)`
- [ ] 服务：ensure authors row、聚合 displayName、otobanana 拉 `avatar_url` 并下载
- [ ] `GET /api/authors/:provider/:authorId`
- [ ] `GET /api/authors/:provider/:authorId/avatar`（流式，Content-Type 按扩展名）
- [ ] 扩展 otobanana `UserProfile`（或专用 fetch）以解析 `avatar_url`

### 4. Web — API 客户端
- [ ] `api.getAuthor(provider, authorId)`
- [ ] `api.authorAvatarUrl(provider, authorId)`
- [ ] `listWorks` / `listLiveMedia` 支持 `authorId` 参数

### 5. Web — 组件与页面
- [ ] `AuthorLink` 组件
- [ ] `AuthorPage`：头像、订阅、VOD、Live
- [ ] `App.tsx` 注册路由
- [ ] `LibraryPage` / `WorkDetailPage` 使用 `AuthorLink`

### 6. 样式
- [ ] 作者页头与头像占位样式（`styles.css`，贴合现有）

## Validation

```bash
pnpm --filter @erolib/shared build   # 若有
pnpm --filter @erolib/server typecheck  # 或仓库既有 typecheck
pnpm --filter @erolib/web typecheck
# 手动：
# 1. 打开媒体库 → 点作者 → 作者页 VOD 过滤正确
# 2. 作品详情 → 点作者
# 3. otobanana 作者首次进入后 hasAvatar 或占位；刷新后若已下载应有图
# 4. 添加订阅 / 切换开关
# 5. authorId=_unknown 不可点
```

## Risky files

- `apps/server/src/app.ts`（大文件，改动集中在 works/live media/authors 路由）
- `apps/web/src/pages/LibraryPage.tsx`（多处作者展示）

## Rollback points

1. 仅 shared + server 过滤：可独立回退
2. 作者 API：无前端时无害
3. 前端入口：最后合入，易回退

## Follow-up（非本任务）

- Live/Sync/PlayerBar 接 `AuthorLink`
- erovoice/koekoe 头像策略
