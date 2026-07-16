# Implement: Otobanana 直播自动录制

## Phase 1 Checklist

### 1. Shared types

- [ ] `@erolib/shared` 增加：
  - `LiveJobState`
  - `LiveSubscriptionPublic`
  - `LiveRecordJobPublic`
  - `LiveOnairPublic`（followee/onair 展示）

### 2. DB schema

- [ ] `live_subscriptions`、`live_record_jobs` 表 + unique indexes
- [ ] 导出 row types
- [ ] 确认启动路径会 migrate/create 新表（沿用现有 drizzle/sqlite 初始化方式）

### 3. Otobanana live helpers

- [ ] `resolveAuthorByInput(input)`：UUID 校验 / `users?is_adult=&search=` 精确匹配
- [ ] `getUserOnair(authorId, token?)`：404 → null
- [ ] `listFolloweeLivestreams(token)`
- [ ] 单测：search 精确匹配、404 onair、room 字段映射（fixture JSON）

### 4. Live poller

- [ ] `createLivePoller`（或 runner 内模块）：轮询 enabled subscriptions
- [ ] ensure job by `provider+room_id` 幂等
- [ ] offline → close open jobs
- [ ] Phase 1 新建任务 state = `pending_media` 或 `blocked` + 明确 error/message
- [ ] `index.ts` 启动/停止与 runner 对齐

### 5. HTTP API

- [ ] `GET/POST/DELETE/PATCH /api/live/subscriptions`
- [ ] `GET /api/live/followees`
- [ ] `POST /api/live/followees/:authorId/select`
- [ ] `GET /api/live/jobs`
- [ ] 可选 `POST /api/live/poll`
- [ ] 错误：400 解析失败、401/503 provider 未配置或 session 失效

### 6. Web UI

- [ ] 路由 `/live` + 导航
- [ ] `api.ts` 客户端方法
- [ ] `LivePage`：名单 / followee / jobs 三块
- [ ] 轮询刷新任务列表

### 7. Validation (Phase 1)

```bash
# unit
# 跑现有 test 脚本 + 新增 otobanana live 解析测试

# manual / smoke
# 1. POST subscription by username of a known user
# 2. POST subscription by UUID
# 3. 若作者在播：GET jobs 出现 pending_media/blocked 且 room_id 正确
# 4. 未选定 followee 在播：jobs 不增加
# 5. 重复 poll：同一 room_id 仅一条 job
# 6. UI：添加/删除/选定/列表可见
```

## Phase 2 Checklist（本任务后半或 follow-up）

- [ ] Research：登录态抓 playback / realtime 媒体
- [ ] `LiveRecorder` 实现
- [ ] `pending_media` → `recording` → `completed`
- [ ] 音频落盘路径与可播放验证

## Risk Files

- `apps/server/src/db/schema.ts`
- `apps/server/src/providers/otobanana.ts`
- `apps/server/src/jobs/runner.ts` / 新 `live-poller.ts`
- `apps/server/src/app.ts`
- `packages/shared/src/index.ts`
- `apps/web/src/App.tsx`、新 `LivePage.tsx`、`api.ts`

## Rollback Points

1. Schema 加表后、API 前：表空置无害
2. API 就绪、UI 前：可用 curl 验收
3. UI 合并后：可隐藏导航回退

## Definition of Done (Phase 1)

- PRD AC1–AC7、AC9 满足
- AC8（真实录音）明确留给 Phase 2，jobs 不得假 `completed`
- 有 design 挂接点，避免推倒重来
