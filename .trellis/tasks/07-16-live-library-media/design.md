# Design: 直播录制并入媒体库

## Boundaries

| 层 | 职责 |
|----|------|
| `live-recorder` | 写 WAV 到 `MEDIA_DIR/.../live/...`；成功后 upsert `live_media` + 更新 `live_record_jobs` |
| `live_media` 表 | 可播库条目（与 `works` 平行） |
| `live_record_jobs` | 录制流水状态；`mediaRelPath` 指向相对 **MEDIA_DIR** 的文件 |
| `/api/live/media*` | list + audio 流（不伪装成 works） |
| `LibraryPage` | 拉 works + live media，合并、筛选、徽章、播放 |
| `LivePage` | 完成任务就地播放 + 链到库 |

## Schema: `live_media`

```text
live_media
  id              INTEGER PK
  provider        TEXT NOT NULL DEFAULT 'otobanana'
  room_id         TEXT NOT NULL
  author_id       TEXT NOT NULL
  author_name     TEXT
  title           TEXT
  job_id          INTEGER NULL  -- FK 语义到 live_record_jobs.id，可不强制 FK
  audio_ext       TEXT NOT NULL DEFAULT 'wav'
  media_rel_path  TEXT NOT NULL  -- 相对 MEDIA_DIR，如 otobanana/live/{author}/{room}/audio.wav
  bytes           INTEGER
  duration_seconds INTEGER NULL  -- 可选，首版可空
  recorded_at     TEXT           -- 录制完成时间
  created_at      TEXT
  updated_at      TEXT
  UNIQUE(provider, room_id)
```

Migrate：`CREATE TABLE IF NOT EXISTS` + unique index（与现有 client migrate 风格一致）。

## Disk layout

```text
{MEDIA_DIR}/{provider}/live/{authorId}/{roomSafe}/audio.wav
```

- `roomSafe`：房间 id 清洗（`:` → `_` + sanitize）。
- Helper：`liveMediaDir(mediaRoot, provider, authorId, roomId)` 在 `storage/paths.ts`（正式路径；无 `data/live` 兼容层）。

`live_record_jobs.mediaRelPath`：存相对 MEDIA_DIR 的路径（与 `live_media.media_rel_path` 一致）。

## API

### `GET /api/live/media`

Query：`q`, `provider`, `limit`, `offset`（与 works 类似，可简化）。

Response：`LiveMediaPublic[]`：

```ts
interface LiveMediaPublic {
  id: number;
  kind: "live"; // 固定，前端合并用
  provider: ProviderId;
  roomId: string;
  authorId: string;
  authorName: string | null;
  title: string | null;
  jobId: number | null;
  audioExt: string;
  mediaRelPath: string;
  bytes: number | null;
  durationSeconds: number | null;
  recordedAt: string | null;
  createdAt: string;
  updatedAt: string;
}
```

### `GET /api/live/media/:provider/:roomId/audio`

- 查 `live_media`；文件 `path.join(mediaDir, mediaRelPath)`。
- Content-Type：`audio/wav`（ext=wav）。
- 支持 Range（复用 works audio 逻辑的简化版）。

### 不改

- `/api/works/*` 契约与 VOD 行为。
- live poller / subscription API（除 jobs 暴露播放所需字段若已有 mediaRelPath）。

## Recorder flow (complete)

1. `outDir = liveMediaDir(config.mediaDir, provider, authorId, roomId)`
2. 写 `audio.pcm` → wrap `audio.wav`
3. `relPath = relative(mediaDir, outFile)` with `/` separators
4. `setJobState(completed, mediaRelPath: relPath)`
5. upsert `live_media` on `(provider, roomId)`：title/author from job/subscription

失败路径：不写 live_media（或保留 partial 不入库）。

## Frontend

### LibraryPage

- 并行 `api.works(...)` + `api.liveMedia(...)`（当 kind 筛选允许）。
- 统一卡片模型：`{ kind: "vod" | "live", ... }`。
- 筛选：
  - type: `all | vod | live`
  - provider / q：两边各过滤或服务端过滤后前端再滤。
- 徽章：live →「直播」；vod 保持 status 徽章。
- 播放：vod → 现有 `api.audioUrl`；live → `api.liveAudioUrl(provider, roomId)`。
- 详情链：vod → `/works/...`；live → 可无详情页，标题不可点或仅展开 meta。

### LivePage

- `completed` 且有 `mediaRelPath`（或 job 能映射 live media）：「播放」按钮 +「媒体库」链接（`/ ?` 或 `/library` + query `type=live`）。
- 路由：确认库路径是 `/` 还是 `/library`（现 `LibraryPage` 在 App 中的 path）。

## Compatibility / Rollback

- 旧 `data/live` 文件：不迁移；旧 job 的 mediaRelPath 若仍指 data，audio 可能 404——可接受（R7）。
- Rollback：停用 live_media 写入即可；磁盘 live 目录可手删。

## Tradeoffs

| 方案 | 取舍 |
|------|------|
| 独立表 | 库页双源合并、两套 audio API；VOD 完全隔离 |
| live 子目录 | 与 mediaWorkDir 形状不同，需专用 helper |

## Risks

- 双列表分页不精确（首版 limit 各拉 N 再合并排序即可，注明简单策略）。
- WAV Range 与浏览器 seek：应支持 Accept-Ranges。
