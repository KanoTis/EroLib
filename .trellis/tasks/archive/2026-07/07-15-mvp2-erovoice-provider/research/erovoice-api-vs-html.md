# Erovoice：API 能否替代 HTML 解析？

> 调研日期：2026-07-15  
> 方法：对照 `docs/erovoice-ch.com-逆向分析报告.md`、主题 JS（`common.min.js` / `mypage.min.js`）、登录态 live 探测  
> 实现对照：`apps/server/src/providers/erovoice.ts`

## Executive Summary

**不能完整消灭 HTML 解析。最多部分替换。**

| 结论 | 说明 |
|------|------|
| 作品详情（标题/作者/描述/标签/时长/封面） | **无 JSON 详情接口**。JS 与猜测 action 均未暴露 `getPost`/`getVoice` 类 API；需继续 SSR HTML。 |
| 收藏列表 | **半接口**：`getSQLDataBookmarkPostData` 存在，但返回的是 **HTML 片段**（`result.getDatas`），不是结构化作品 JSON。首屏仍是 `mypage.html?type=bookmark` SSR。 |
| 登录 / 用户 ID | **已是接口**（`wp-login.php` + `loginCheckAjax` / `getUserInfo` JSON）。 |
| 音频 | **已是接口/代理**（`getm3u8URL` JSON + `getm3u8file_*.php` + HLS）。 |
| WordPress REST `/wp-json/` | **对 cookie 会话也 401**（`rest_not_logged_in`），当前凭证无法当详情 API 用。 |

**产品建议：** 保持现状（SSR + 片段 HTML 解析 + 音频代理）。投入改 API 性价比低，除非站点未来公开 REST 或返回 JSON 列表。

## Capability Matrix

| 能力 / 字段 | 当前实现 | API 候选 | 可替换？ | 置信度 | 证据 |
|-------------|----------|----------|----------|--------|------|
| 登录账密 | `POST /wp-login.php` | 同左 | 已是非 HTML | 高 | 成功 Set-Cookie `wordpress_logged_in_*` |
| 会话校验 / userId | `loginCheckAjax`, `getUserInfo` | 同左 JSON | 已是 JSON | 高 | `{"status":"logined","userID":5146,...}` |
| 收藏首屏 | SSR `mypage.html?type=bookmark` + `parseBookmarkHtml` | 无等价 JSON 首屏 | **否** | 高 | 首屏 3 条在 SSR；AJAX `start=0` → `"0"` |
| 收藏翻页 | AJAX `getSQLDataBookmarkPostData` + **parse HTML 片段** | 同 action | **仅传输层**，payload 仍是 HTML | 高 | 前端 `insertData(result.getDatas)`；`getDatas` 当 HTML 插入 DOM |
| workId / 列表 title / category | HTML `href` + `title` | 同上片段 | 仍需 parse | 高 | 列表卡结构 |
| 详情 title | 详情 SSR `og:title` / `h1` | 无 | **否** | 高 | 无 detail action |
| authorId / authorName | 详情 SSR | 无 | **否** | 高 | |
| description | `.discContent` | 无 | **否** | 高 | |
| tags | `.voiceTags li` | `ajaxGetTag` 存在但用途像投稿标签，非作品详情 | **否**（未验证为详情） | 中 | mypage.js 有 `ajaxGetTag`，非详情页主路径 |
| duration | `.controls__total-time` | 无 | **否** | 高 | |
| cover URL | `#voiceImagePreview .filterImage` background | 无 cover API；CDN 直链 | **否**（URL 来源仍 HTML） | 高 | 原图不在 JSON |
| 详情 canonical URL | SSR path | `getPostURL` → JSON 字符串 URL | **可部分** | 高 | `getPostURL` + `postID` → `"https://.../ero-voice/7846.html"` |
| m3u8 路径 | 代理 / `getm3u8URL` | `getm3u8URL` JSON | 已是 JSON | 高 | `{"m3u8URL":"wp-content/voice/m3u8/..."}` |
| 音频分片 | HLS 代理 + Spaces | 同左 | 已是非 HTML | 高 | |
| 评论 | 未实现 | `getCommentAjax2` | JSON 包 **html** 字段 | 中 | keys: status, html, latest_id, count |
| WP REST posts/media | 未用 | `/wp-json/wp/v2/*` | **当前不可用** | 高 | 登录 Cookie 下仍 `rest_not_logged_in` 401 |

## Live Evidence

### 1. WordPress REST

未登录与 **已登录 Cookie** 均：

```json
{"code":"rest_not_logged_in","message":"You are not currently logged in.","data":{"status":401}}
```

覆盖：`/wp-json/`、`/wp-json/wp/v2/posts`、`/wp-json/wp/v2/posts/{id}`、`/wp-json/wp/v2/media`、`/wp-json/wp/v2/users/me`。

说明：站点对 REST 关闭了 cookie 认证（或强制 application password / nonce），**不能**当作现成详情 JSON API。

### 2. 已确认 JSON admin-ajax

| action | 响应形态 | 用途 |
|--------|----------|------|
| `loginCheckAjax` | JSON | 登录态 |
| `getUserInfo` | JSON | userID / displayName |
| `getm3u8URL` | JSON `{m3u8URL}` | 音频路径 |
| `getPostURL` | JSON string URL | postID → 详情 URL（可辅助选 category 路径） |
| `getCommentAjax2` | JSON + **html** | 评论仍是 HTML |

### 3. 列表类 action = HTML 管道

主题 `scrollGetData`（`common.min.js`）：

```js
// 伪码还原
postDatas.items / start / ajax
→ addPostDatas() 设置 action=getSQLDataBookmarkPostData, userID
→ trueSubmit(...)
→ result.status === "success"
→ insertData(result.getDatas, ele)  // getDatas 当 HTML 插入
```

含义：

- 服务端列表接口的**契约就是 HTML 片段**，不是作品 DTO。
- 客户端替换「解析」只能换成「把 HTML 片段当 DOM 插」——我们服务端仍要 strip 成结构化数据。
- `start=0` 对 bookmark 返回 `"0"`：首屏由 SSR 渲染，AJAX 从 `count=1 → start=items` 开始。

### 4. 猜测的详情 action（均失败）

对 `getPost` / `getPostData` / `getVoice` / `getVoiceData` / `getSQLDataPostData` / `getSQLDataVoicePostData` / `postInfo` / `getPostInfo` 等：

- HTTP 400 或 body `"0"`
- **不存在可用详情 JSON**

### 5. JS 中登记的 action 全集（与详情无关）

`common.min.js` 含收藏/关注/时间线/直播/评论/m3u8 等；**没有**「按 postID 返回完整 voice 元数据」的 action。  
`mypage.min.js` 含 `voicePostAjax`、`getPostURL`、`get_attachment_status` 等**创作者后台/投稿**向接口，不是读者详情 API。

## 当前实现里「已经是接口」的部分

无需改：

1. 登录 + Cookie 会话  
2. `getUserInfo` / `loginCheckAjax`  
3. HLS：`getm3u8file_origints.php` / `getm3u8URL` + keygen + TS  

仍依赖 HTML 的部分（核心痛点）：

1. `listFavorites` 首屏 SSR + 翻页 HTML 片段  
2. `getWork` 整页 SSR 字段  
3. `extractCoverUrl` 从详情 DOM 取原图 URL  

## 可选迁移路径（按价值排序）

### P0 — 不建议大改

维持 HTML 解析；补 fixture 单测防 DOM 漂移（已有 parse 测试方向正确）。

### P1 — 小优化（可选，收益有限）

| 改动 | 收益 | 成本 |
|------|------|------|
| 用 `getPostURL(postID)` 解析 category 详情 URL，减少 `ero-voice/ero-asmr/moe-asmr` 试错 | 少 0–2 次 404 | 低 |
| 翻页严格模拟 `ajax=1` + `scrollGetData` 字段 | 与浏览器一致 | 低（当前小收藏量无痛） |
| 缓存详情 HTML，同 job 内 getWork/download 复用 | 少一次请求 | 低 |

### P2 — 不值得

| 改动 | 原因 |
|------|------|
| 强行接 `/wp-json` | Cookie 401；要另搞 REST 认证且字段未必含封面/时长 |
| 浏览器自动化渲染 DOM | 过重，与 Docker 单容器目标冲突 |
| 期望 `getSQLData*` 改返回 JSON | 服务端主题契约是 HTML，非我们能改 |

### P3 — 仅当站点变更时再评估

若未来：

- 开放 REST 且 cookie/app password 可用，或  
- 列表 action 改为 JSON DTO，  

再开任务迁移 `getWork` / `listFavorites`。

## 对「能不能把解析 HTML 换成接口」的直接回答

| 问题 | 答案 |
|------|------|
| 能不能全部换成接口？ | **不能**（详情/封面/首屏收藏无结构化 API）。 |
| 有没有部分接口？ | **有**：登录、用户、m3u8、postURL、列表**传输**（但 body 仍是 HTML）。 |
| 现在该不该改？ | **不该为了「去 HTML」而改**；音频与鉴权已是非 HTML。HTML 解析是站点架构决定的，不是实现偷懒。 |

## Appendix：探测命令（可复现）

```bash
# 需本机凭证
cd apps/server
EROVOICE_USER=... EROVOICE_PASS=... EROVOICE_WORK_ID=7846 \
  pnpm exec tsx scripts/debug-erovoice-api-surface.mts
```

（调研用脚本应删除，不进主路径依赖。）

## Appendix：关键代码锚点

- 收藏 SSR：`fetchBookmarkSsrPage` → `mypage.html?type=bookmark`
- 收藏 AJAX：`getSQLDataBookmarkPostData`
- 详情：`parseDetailHtml` / `extractCoverUrl`
- 音频：`fetchPlaylist` / `getm3u8URL`
