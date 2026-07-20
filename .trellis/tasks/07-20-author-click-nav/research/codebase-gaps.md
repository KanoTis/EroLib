# Research: Issue #5 代码现状

## 缺口

- 无 Author 页/路由；作者名纯文本
- works/live media 列表无 `authorId` 过滤
- `authors` 表未使用；`avatarPath` 空
- 无 AuthorPublic / 详情 API

## 可复用

- 路由对称：`/works/:provider/:workId`
- Cover 流：`GET .../cover` + `mediaDir` 相对路径
- 订阅：`/api/live/subscriptions` CRUD，默认 flags false
- otobanana `avatar_url` 在 live user schema；profile 可扩展
- `WorkCover` 占位色/首字模式可借鉴头像占位

## 入口文件

- web: `App.tsx`, `LibraryPage.tsx`, `WorkDetailPage.tsx`, `api.ts`
- server: `app.ts`, `db/schema.ts`, `storage/paths.ts`, `providers/otobanana-live.ts`
- shared: `packages/shared/src/index.ts`
