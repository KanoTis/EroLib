# Implement: 直播录制并入媒体库

## Ordered checklist

1. **shared**
   - 新增 `LiveMediaPublic`（`kind: "live"`）。
   - 重建 `@erolib/shared`。

2. **paths**
   - 新增 `liveMediaDir(mediaRoot, provider, authorId, roomId)` → `.../{provider}/live/{author}/{roomSafe}`。
   - 正式成品只用 MEDIA_DIR；无 `data/live` 兼容层。

3. **schema + migrate**
   - `live_media` 表 + unique `(provider, room_id)`。
   - `client.ts` migrate SQL。

4. **live-recorder**
   - 输出目录改为 `liveMediaDir(config.mediaDir, ...)`。
   - `mediaRelPath` 相对 `mediaDir`。
   - `completed` 时 upsert `live_media`。

5. **API (`app.ts`)**
   - `GET /api/live/media` list。
   - `GET /api/live/media/:provider/:roomId/audio` stream + Range。
   - `toLiveMedia` mapper。

6. **web api.ts**
   - `liveMedia(params)`、`liveAudioUrl(provider, roomId)`。

7. **LibraryPage**
   - 合并 works + live；type 筛选；直播徽章；live 播放。

8. **LivePage**
   - completed：播放 + 跳转媒体库（带 type=live）。

9. **验证**
   - `pnpm --filter @erolib/shared build`
   - `pnpm --filter @erolib/server typecheck`
   - `pnpm --filter @erolib/web typecheck`
   - `pnpm --filter @erolib/server test`
   - 有条件：一次录制完成 → 查路径 + 库页播放。

## Merge strategy (library list)

- 各拉 `limit`（默认 50）后按 `updatedAt`/`recordedAt` 混排截断。
- type=vod 只请求 works；type=live 只请求 live media；all 两边都要。

## Risky files

- `apps/server/src/jobs/live-recorder.ts` — 路径与入库
- `apps/web/src/pages/LibraryPage.tsx` — 双源 UI
- `apps/server/src/app.ts` — audio Range

## Rollback

- 回退 recorder 写路径 + 去掉 live_media upsert；前端去掉 live 分支即可。

## Done when

- PRD AC1–AC6 全部满足。
