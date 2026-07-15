# Implement: 媒体库元数据与 UI 修复

## Order

### 1. Shared types

- [ ] `packages/shared/src/index.ts`：`WorkMetadata` 增加 `sourceUrl?: string | null`
- [ ] 如需对外展示，`WorkPublic` 可选加 `sourceUrl`（从 `metaJson` 解析）——**推荐加上**，详情页可显示原始链接

### 2. Koe-koe parser fix

- [ ] `parseDetail`：标题多策略 + 宣传文案黑名单
- [ ] 解析 `description`（`.desc.detail` / `.desc`）
- [ ] **`coverUrl = null`**（移除 gender icon → cover 逻辑；可选 `extra.gender` 文本）
- [ ] 填 `sourceUrl = detailUrl(workId)`
- [ ] 扩展测试：正常标题 / 宣传文案回归 / description 非空 / `coverUrl === null`

### 3. Otobanana sourceUrl

- [ ] `castToMeta`：`sourceUrl = https://otobanana.com/general/cast/${workId}`
- [ ] description 保持 `post.text`

### 4. ID3 module

- [ ] 依赖：`pnpm --filter @erolib/server add node-id3`（+ `@types` 若有）
- [ ] 新增 `apps/server/src/media/id3.ts`：`tagAudioFile`
- [ ] 单测：临时 mp3 fixture 写读（可用最小合法 mp3 头 + node-id3 read）

### 5. Runner integration

- [ ] `processJob`：commit 前对 cache audio 打 ID3
- [ ] `meta.json` 含 `sourceUrl`
- [ ] 新增 `refreshWorkMetadata(provider, workId)`（导出给 API）
  - getWork → 更新 DB/meta → 可选封面 → tag 现有 audio
  - 下载中 → 明确错误

### 6. API

- [ ] `GET /api/works/:provider/:workId/cover`
- [ ] `POST /api/works/:provider/:workId/refresh-metadata`
- [ ] `toPublicWork`：若加 `sourceUrl`，从 `metaJson` 解析

### 7. Frontend library

- [ ] `api.coverUrl` / `api.refreshMetadata`
- [ ] `LibraryPage`：封面 `<img>` + provider 筛选
- [ ] `WorkDetailPage`：封面、原始链接、刷新元数据按钮
- [ ] 样式：`.work-cover img` / `.detail-cover img` object-fit cover

### 8. Split Sync / Jobs

- [ ] 新增 `SyncPage.tsx`（从 JobsPage 迁同步 UI）
- [ ] `JobsPage` 仅任务
- [ ] `App.tsx` 路由 + 导航文案/图标（Jobs 图标可复用；Sync 可用 `IconRefresh`）

### 9. Verify

```bash
pnpm --filter @erolib/server test
pnpm typecheck
pnpm build
```

手动（有账号时）：

1. 同步 Koe-koe → 抽查 title/description；封面为占位（非性别图标）
2. Otobanana 有封面作品：列表/详情见真实封面；详情见简介 + 源链接
3. 渠道筛选
4. 外部播放器/ffprobe 看 ID3
5. 对错误存量点「刷新元数据」
6. `/sync` 与 `/jobs` 分离

## Risk files

| 文件 | 风险 |
|------|------|
| `providers/koekoe.ts` | 解析回归 |
| `jobs/runner.ts` | 下载成功路径变复杂 |
| `media/id3.ts` | 写文件损坏 |
| `App.tsx` + 新页面 | 路由遗漏 |

## Rollback points

1. 解析/测试通过后再接 runner
2. ID3 失败可临时 no-op
3. UI 拆页可独立合并

## Out of this PR

- 全库 backfill
- Erovoice
- 非 MP3 全格式标签
