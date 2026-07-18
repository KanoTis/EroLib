# OTOBANANA 网站逆向工程完整技术文档

> 分析日期: 2026-07-11
> 网站: https://otobanana.com/

---

## 目录

1. [整体架构](#一整体架构)
2. [认证](#二认证)
3. [页面对应的数据来源](#三页面对应的数据来源)
4. [API整理](#四api整理)
5. [作品数据模型](#五作品数据模型)
6. [作者数据模型](#六作者数据模型)
7. [媒体资源](#七媒体资源)
8. [反爬](#八反爬)
9. [建议的Provider架构](#九建议的provider架构)

---

## 一、整体架构

### 技术栈

| 层级 | 技术 |
|------|------|
| 前端框架 | **Nuxt 3** (Vue 3) — 通过 `__nuxt` root 元素及 `__NUXT_DATA__` JSON script 确认 |
| 渲染模式 | **Hybrid (SSR + CSR)** — 首页 SSR 预渲染数据嵌入 `__NUXT_DATA__`，详情页 CSR 客户端获取数据 |
| 状态管理 | **Pinia** — Nuxt 3 内置状态管理，auth store 管理 accessToken |
| HTTP 客户端 | **ofetch / $fetch** — Nuxt 内置 HTTP 客户端，包装了 `fetch` API |
| 后端 | **Laravel (PHP)** — 由 `otobanana_session` cookie 的 Laravel 加密格式 (`eyJpdiI6...` base64 编码的 iv/value/mac/tag) 确认 |
| API 子域名 | `api.v2.otobanana.com` — Laravel API 后端 |
| 媒体存储 | **AWS S3** + **CloudFront CDN** — 由 `x-amz-server-side-encryption: AES256`、`x-amz-meta-mediaconvert-jobid`、`Server: AmazonS3` 确认 |
| 直播 | **Amazon IVS** (Interactive Video Service) — 引入 `amazon-ivs-player.min.js`，有 `/api/livestreams/ivs/` 端点 |
| CDN | **AWS CloudFront** — 由 `via` / `x-amz-cf-id` / `x-amz-cf-pop` headers 确认 |
| A/B 测试 | **VWO** (Visual Website Optimizer) — `_vwo_uuid_v2` cookie + `/j.php` 请求 |
| 分析 | **Google Tag Manager** — `GTM-P3D8JMM` |
| 认证 | **JWT + Refresh Token** 双token机制，结合 Laravel session cookie |

### 页面加载流程

```
用户请求 /general/ 或 /deep/
        │
        ▼
┌──────────────────────────────┐
│  CloudFront CDN (边缘节点)     │
│  x-cache: Miss/Hit from       │
│  cloudfront                   │
└──────┬───────────────────────┘
       │
       ▼
┌──────────────────────────────┐
│  Nuxt SSR 服务器 (Node.js)    │
│  - 首次渲染页面                │
│  - 嵌入 __NUXT_DATA__ JSON    │
│  - 返回完整 HTML              │
└──────┬───────────────────────┘
       │
       ▼
┌──────────────────────────────┐
│  浏览器加载 HTML + Nuxt JS    │
│  - Vue 3 SPA hydration       │
│  - CSR 页面通过 API 获取数据   │
│  - 路由切换为客户端导航        │
└──────┬───────────────────────┘
       │
       ▼
┌──────────────────────────────┐
│  api.v2.otobanana.com        │
│  Laravel REST API             │
│  - /api/casts/{id}            │
│  - /api/users/{id}            │
│  - /api/top/casts             │
│  - /api/casts                 │
└──────────────────────────────┘
```

### 域名与CDN架构

```
otobanana.com ──────► CloudFront ──────► Nuxt SSR (Node)
                                                    │
api.v2.otobanana.com ───► CloudFront ────► Laravel PHP API
                                                    │
media.otobanana.com ───► CloudFront ────► S3 Bucket
                                                    │
assets.otobanana.com ──► CloudFront ────► S3 Bucket
```

### 路由结构

所有页面路由使用 `:floor()` 参数，支持两个值：
- `general` — 一般版
- `deep` — 成年版 (R18)

关键路由：
```
/                                          — 重定向到 /general/ 或 /deep/
/:floor()/                                 — 首页
/:floor()/cast/:id()                       — 作品详情页
/:floor()/user/:id()                       — 作者页
/:floor()/search/casts                     — 搜索(音频)
/:floor()/search/users                     — 搜索(用户)
/:floor()/search/livestreams               — 搜索(直播)
/:floor()/ranking/liver/week               — 排行榜(作者周榜)
/:floor()/ranking/liver/year               — 排行榜(作者年榜)
/:floor()/ranking/gifter/week              — 排行榜(送礼者周榜)
/:floor()/timeline                         — 时间线
/:floor()/history                          — 历史记录
/:floor()/likes                            — 收藏/点赞
/:floor()/notifications                    — 通知
/:floor()/events                           — 活动
/:floor()/livestream/:id()                 — 直播页面
/:floor()/hashtag/:hashtag()               — 标签页面
/:floor()/auth/signin                      — 登录页
/:floor()/auth/signup                      — 注册页
/:floor()/auth/signout                     — 登出
/:floor()/mypage                           — 我的页面
/:floor()/settings                         — 设置
/:floor()/point                            — 积分
/:floor()/voicepost                        — 音频投稿
/:floor()/cast/create                      — 创建作品
```

---

## 二、认证

### 认证方式: JWT + Session Cookie + Refresh Token

#### 使用的 Cookie

| Cookie 名称 | 类型 | Domain | HttpOnly | Secure | SameSite | 说明 |
|-------------|------|--------|----------|--------|----------|------|
| `otobanana_session` | Laravel Session | `.otobanana.com` | ✅ | ✅ | Lax | Laravel 加密 session cookie, AES-256-CBC 加密 |
| `__Secure-next-auth.callback-url` | Auth callback | `otobanana.com` | ✅ | ✅ | Lax | 认证回调URL |
| `__Host-next-auth.csrf-token` | CSRF Token | `otobanana.com` | ✅ | ✅ | Lax | CSRF 防护 token |

#### 认证流程

```
用户提交凭证 (email + password)
        │
        ▼
POST /api/signin
Content-Type: application/json
Credentials: include
Body: { "email": "...", "password": "..." }
        │
        ▼
Laravel 后端验证凭证
├── 生成 JWT Access Token
├── 设置 Refresh Token (存 Pinia store)
├── 设置 Laravel Session Cookie
├── 设置 CSRF Cookie
└── 返回响应 (含 token 信息)
        │
        ▼
Pinia auth store 更新
├── accessToken: string (JWT)
├── tokenTimerId: number
├── isVerified: boolean
├── provider: string
├── user info: id, username, email, name, avatarUrl, etc.
└── refreshToken: string (从 cookie/localStorage 恢复)
```

#### Token 使用方式

**Access Token:**
- 存储位置: Pinia store `auth.accessToken`
- 发送方式: `Authorization` header (裸 token, 无 `Bearer` 前缀)
- 刷新: `POST /api/refreshToken`

**Refresh Token:**
- 存储位置: cookie/localStorage (通过 `$getRefreshToken` 获取)
- 使用: `POST /api/refreshToken` 换取新的 Access Token

#### 登录 API

```http
POST https://api.v2.otobanana.com/api/signin
Content-Type: application/json
Origin: https://otobanana.com

{
    "Email": "",
    "Password": ""
}
```

响应（成功）示例字段：`accessToken`, `refreshToken`, `expireIn`。

注意（2026-07 实测）:
- 官方前端 `ke().public.apiBase` = `https://api.v2.otobanana.com`，`fetchSignIn` 实际请求 `${apiBase}/api/signin`。
- Body 字段为 **PascalCase**：`Email` / `Password`（小写 `email`/`password` 会 validation_exception）。
- 主域 `https://otobanana.com/api/signin` 当前对服务端请求固定 `302 → /error`，不可用。
- 密码规则：半角、含字母与数字；错误账号返回 `user_not_found`。

#### 登出

```http
POST https://otobanana.com/api/logout
Content-Type: application/json
Authorization: <accessToken>
credentials: include

{
    "Token": "<accessToken>"
}
```

登出时还会清除: Refresh Token, Code Verifier, Google 登录状态, 年龄验证状态, 重定向路径。

#### 认证端点在 JS Bundle 中发现

| 端点 | 方法 | 说明 |
|------|------|------|
| `/api/signin` | POST | 登录 |
| `/api/signup` | POST | 注册 |
| `/api/activate` | POST | 激活账号 |
| `/api/logout` | POST | 登出 |
| `/api/forgotPassword` | POST | 忘记密码 |
| `/api/resetPassword` | POST | 重置密码 |
| `/api/refreshToken` | POST | 刷新 Token |
| `/api/resendConfirmationCode` | POST | 重新发送确认码 |

所有认证 API 使用 `credentials: "include"`。

---

## 三、页面对应的数据来源

### 首页 (`/:floor()/`)

| 数据 | URL | 说明 |
|------|-----|------|
| 推荐信息 | `__NUXT_DATA__` (SSR 内嵌) | 首页 SSR 渲染的数据包含 releases (通知)、top casts (作品列表) |
| Releases | `GET /api/app/releases?is_adult=<bool>` | 横幅通知、活动信息 |
| Top Casts | `GET /api/top/casts` | 顶部作品列表 |
| Top Livestreams | `GET /api/top/livestreams` | 直播列表 (cursor-based 分页) |
| Top Followee Livestreams | `GET /api/top/followeelivestreams` | 关注者的直播 |

**首页 SSR 内嵌数据结构:**
`__NUXT_DATA__` JSON 包含:
- releases 数组 (id, url, src/image_url)
- topCasts 数组 (title, url, image, time, listenedCount, isAdult, userName)

### 作品详情页 (`/:floor()/cast/:id`)

| 数据 | URL | 说明 |
|------|-----|------|
| Cast 详情 | `GET /api/casts/{castId}` | 作品完整信息 |
| 用户信息 | `GET /api/users/{userId}` | 作者资料 |
| Gifters | `GET /api/casts/{castId}/gifters` | 送礼用户列表 |
| Bananas | `GET /api/app/bananas` | 所有可赠送的香蕉礼物 |
| Comments | `GET /api/casts/{castId}/comments` | 评论列表 (需要认证) |

**Cast 详情 API 返回 JSON 结构:**
```json
{
    "audio_url": "string",
    "duration_time": "string (HH:MM:SS)",
    "post_ptr_id": "string (uuid)",
    "thumbnail_url": "string|null",
    "is_adult": "boolean",
    "category_id": "string (uuid)",
    "event": "object|null",
    "is_liked": "boolean",
    "post": { ... }  // 作品详情 (见数据模型)
}
```

### 作者页 (`/:floor()/user/:id`)

| 数据 | URL | 说明 |
|------|-----|------|
| 用户信息 | `GET /api/users/{userId}` | 作者资料 |
| 用户作品列表 | `GET /api/users/{userId}/casts` | 分页作品列表 |
| Followers | `GET /api/users/{userId}/followers` | 粉丝列表 (分页) |
| Followees | `GET /api/users/{userId}/followees` | 关注列表 |

### 搜索页 (`/:floor()/search/casts`)

| 数据 | URL | 说明 |
|------|-----|------|
| Casts 列表 | `GET /api/casts` | 搜索+过滤作品 |
| Categories | `GET /api/casts/categories` | 分类列表 |

**搜索 API 参数:**
```
GET /api/casts
  ?q=<query>        // 搜索关键词 (URL encoded)
  &category_id=<id> // 分类 ID 过滤
  &limit=<n>        // 每页数量 (默认?)
  &offset=<n>       // 偏移量 (基于 offset 分页)
  &is_adult=<bool>  // R18 过滤
```

**注意**: 搜索不返回传统分页元数据 (total/pages)，使用 limit + offset 简单分页。

### 排行榜 (`/:floor()/ranking/...`)

排行榜页面是 Nuxt 客户端渲染，数据获取方式需从 JS bundle 进一步分析。已知路由:
```
/:floor()/ranking/liver/week     — 创作者周榜
/:floor()/ranking/liver/year     — 创作者年榜
/:floor()/ranking/gifter/week    — 送礼者周榜
```

### 收藏 / 点赞页 (`/:floor()/likes`)

需要认证。
- `GET /api/users/{userId}/likes` — 官方前端实际路径（cursor 分页，`next_page_url`）
- `userId` 来自 `GET /api/settings` 的 `username` 字段（Cognito 用户 UUID，不是 preferred_username）
- `GET /api/casts/likes` — **已失效**（当前 500 internal_server_error），勿用

### 历史记录 (`/:floor()/history`)

需要认证。
- `GET /api/casts/history` — 获取历史记录 (需要 accessToken)

### 通知 (`/:floor()/notifications`)

需要认证。
- `GET /api/notifications/exists` — 检查是否有新通知
- `GET /api/notifications/{id?}` — 通知列表

### 评论

需要认证。
- `GET /api/casts/{castId}/comments` — 获取评论列表

### 时间线 (`/:floor()/timeline`)

关注者的最新动态。

### 直播页 (`/:floor()/livestream/:id`)

- `GET /api/livestreams/ivs/{id}` — IVS 直播信息
- 使用 Amazon IVS Player (`player.live-video.net/1.24.0/amazon-ivs-player.min.js`)

---

## 四、API 整理

### API 基础信息

- API Base URL: `https://api.v2.otobanana.com`
- 数据格式: JSON
- 权限控制: JWT Access Token (Authorization header) / Laravel Session Cookie
- 分页方式: offset-based (casts list) / cursor-based (livestreams, followers)

---

### Public API (无需登录)

#### 1. 获取作品详情

```http
GET https://api.v2.otobanana.com/api/casts/{castId}
```

- **Method**: GET
- **Header**: 无 (public)
- **Body**: 无
- **Response**: Cast 对象 (见数据模型)
- **分页**: 无
- **限流**: 未知
- **权限**: Public

#### 2. 获取用户信息

```http
GET https://api.v2.otobanana.com/api/users/{userId}
```

- **Method**: GET
- **Header**: 无 (public)
- **Body**: 无
- **Response**: User 对象 (见数据模型)
- **分页**: 无
- **限流**: 未知
- **权限**: Public

#### 3. 获取用户作品列表

```http
GET https://api.v2.otobanana.com/api/users/{userId}/casts
```

- **Method**: GET
- **Header**: 无
- **Params**: `?limit=<n>&offset=<n>`
- **Response**: `{ "data": [Cast, ...] }`
- **分页**: offset-based (limit + offset)
- **权限**: Public

#### 4. 搜索/浏览作品

```http
GET https://api.v2.otobanana.com/api/casts
```

- **Method**: GET
- **Header**: 无
- **Params**:
  - `q=<string>` — 搜索关键词
  - `category_id=<uuid>` — 分类过滤
  - `limit=<int>` — 每页数量
  - `offset=<int>` — 偏移量
  - `is_adult=<bool>` — R18 过滤
- **Response**: `{ "data": [Cast, ...] }`
- **分页**: offset-based
- **权限**: Public

#### 5. 获取Top作品

```http
GET https://api.v2.otobanana.com/api/top/casts
```

- **Method**: GET
- **Header**: 无
- **Response**: `{ "data": [Cast, ...] }`
- **分页**: 固定数量 (无分页参数)
- **权限**: Public

#### 6. 获取Top直播

```http
GET https://api.v2.otobanana.com/api/top/livestreams
```

- **Method**: GET
- **Header**: 无
- **Response**: `{ "data": [...], "per_page": 10, "next_cursor": "string|null", "next_page_url": "string|null", "prev_cursor": "string|null", "prev_page_url": "string|null" }`
- **分页**: cursor-based
- **权限**: Public

#### 7. 获取关注者直播

```http
GET https://api.v2.otobanana.com/api/top/followeelivestreams
```

- **Method**: GET
- **响应**: 同 Top livestreams
- **权限**: 需要登录

#### 8. 获取App通知/Release

```http
GET https://api.v2.otobanana.com/api/app/releases
```

- **Method**: GET
- **Params**: `?is_adult=<bool>`
- **Response**: 通知横幅数组 `[{ id, url, image_url, title, is_adult, started_at, finished_at, priority }]`
- **权限**: Public

#### 9. 获取App香蕉礼物列表

```http
GET https://api.v2.otobanana.com/api/app/bananas
```

- **Method**: GET
- **Response**: 香蕉礼物分类数组
- **权限**: Public

#### 10. 获取用户粉丝列表

```http
GET https://api.v2.otobanana.com/api/users/{userId}/followers
```

- **Method**: GET
- **Response**: `{ "current_page": int, "data": [User, ...], ... }`
- **分页**: 标准分页 (current_page/data)
- **权限**: Public

#### 11. 获取作品Gifters

```http
GET https://api.v2.otobanana.com/api/casts/{castId}/gifters
```

- **Method**: GET
- **Response**: `{ "data": [{ user_id, amount_banana, last_gifted_at, user: {...} }, ...] }`
- **权限**: Public

#### 12. 获取分类列表

```http
GET https://api.v2.otobanana.com/api/casts/categories
```

- **Method**: GET
- **Params**: 需要额外参数 (待确认)
- **权限**: Public

---

### Private API (需要登录)

#### 1. 登录

```http
POST https://otobanana.com/api/signin
Content-Type: application/json
credentials: include

{ "email": "string", "password": "string" }
```

- **Method**: POST
- **权限**: 未登录
- **注意**: 端点位于主域名而非 `api.v2`

#### 2. 登出

```http
POST https://otobanana.com/api/logout
Content-Type: application/json
Authorization: <accessToken>
credentials: include

{ "Token": "<accessToken>" }
```

- **Method**: POST
- **权限**: 需要登录

#### 3. 刷新Token

```http
POST https://otobanana.com/api/refreshToken
Content-Type: application/json
credentials: include
```

- **Method**: POST
- **权限**: 有效的 Refresh Token

#### 4. 注册

```http
POST https://otobanana.com/api/signup
Content-Type: application/json
credentials: include

{ "email": "string", "password": "string", ... }
```

#### 5. 获取评论

```http
GET https://api.v2.otobanana.com/api/casts/{castId}/comments
```

- **Authorization**: `<accessToken>`
- **权限**: 需要登录

#### 6. 获取通知

```http
GET https://api.v2.otobanana.com/api/notifications/exists
GET https://api.v2.otobanana.com/api/notifications/{id}
```

- **Authorization**: `<accessToken>`
- **权限**: 需要登录

#### 7. 获取公告

```http
GET https://api.v2.otobanana.com/api/announcements
GET https://api.v2.otobanana.com/api/announcements/{id}
```

- **Authorization**: `<accessToken>`
- **权限**: 需要登录

#### 8. 设置/用户信息

```http
GET/POST https://api.v2.otobanana.com/api/settings
POST https://api.v2.otobanana.com/api/settings/username
POST https://api.v2.otobanana.com/api/settings/email
POST https://api.v2.otobanana.com/api/settings/email/verify
POST https://api.v2.otobanana.com/api/settings/password
```

- **Authorization**: `<accessToken>`
- **权限**: 需要登录

#### 9. 账号相关

```http
POST https://otobanana.com/api/activate
POST https://otobanana.com/api/forgotPassword
POST https://otobanana.com/api/resetPassword
POST https://otobanana.com/api/resendConfirmationCode
DELETE https://api.v2.otobanana.com/api/users/{userId}
```

---

### Internal API (Nuxt Server Routes)

以下 API 为 `otobanana.com` 主域下的 Nuxt Nitro server routes:

```http
POST /api/signin
POST /api/signup
POST /api/activate
POST /api/logout
POST /api/forgotPassword
POST /api/resetPassword
POST /api/refreshToken
POST /api/resendConfirmationCode
```

这些端点是 Nuxt 服务器端 API，负责认证流程，调用底层 Laravel 后端。

---

## 五、作品数据模型

### 作品 (Cast) 完整字段

| 字段 | 类型 | 说明 |
|------|------|------|
| `audio_url` | `string` | 音频文件URL |
| `duration_time` | `string` | 时长 `HH:MM:SS` |
| `post_ptr_id` | `string(uuid)` | 作品 ID (同 post.id) |
| `thumbnail_url` | `string|null` | 封面缩略图URL |
| `is_adult` | `boolean` | 是否R18 |
| `category_id` | `string(uuid)` | 分类ID |
| `event` | `object|null` | 关联活动 |
| `is_liked` | `boolean` | 当前用户是否点赞 |
| `created_at` | `string(datetime)` | 创建时间 |
| `like_count` | `int` | 点赞数 (search/top 返回) |

#### Post (作品详情) 字段

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | `string(uuid)` | 作品 ID |
| `title` | `string` | 标题 |
| `text` | `string` | 描述文本 |
| `type` | `int` | 类型 (1=cast/音频) |
| `user_id` | `string(uuid)` | 作者ID |
| `restriction` | `int` | 限制级别 |
| `comment_count` | `int` | 评论数 |
| `gift_banana` | `int` | 收到的香蕉数 |
| `like_count` | `int` | 点赞数 |
| `play_count` | `int` | 播放数 |
| `created_at` | `string(ISO datetime)` | 创建时间 |
| `mask_title` | `string` | 匿名标题 |
| `mask_text` | `string` | 匿名描述 |

#### User (嵌套在 Post 中)

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | `string(uuid)` | 用户ID |
| `username` | `string` | 用户名 |
| `avatar_url` | `string` | 头像URL |
| `bio` | `string` | 简介 |
| `gender` | `int` | 性别 (0=not_set, 1=male, 2=female) |
| `name` | `string` | 昵称/显示名 |
| `twitter_username` | `string` | Twitter账号 |
| `livestream_rule` | `string` | 直播规则 |
| `followee_count` | `int` | 关注数 |
| `follower_count` | `int` | 粉丝数 |
| `dlsite_url` | `string` | DLsite链接 |
| `cien_url` | `string` | Cien链接 |
| `gender_label` | `string` | 性别标签 |
| `mask_name` | `string` | 匿名昵称 |
| `mask_bio` | `string` | 匿名简介 |
| `mask_livestream_rule` | `string` | 匿名直播规则 |
| `is_notification_setting_enabled` | `boolean` | 通知设置 |
| `is_simple_notification` | `boolean` | 简化通知 |

### JSON 结构

```json
{
    "audio_url": "https://media.otobanana.com/converted/users/{userId}/casts/{fileId}.mp3",
    "duration_time": "00:02:00",
    "post_ptr_id": "a239a36b-038f-4d6a-a413-7a7cd99f3eef",
    "thumbnail_url": null,
    "is_adult": false,
    "category_id": "9ca29dd1-a025-4dd6-84a0-54972c5fb099",
    "event": null,
    "is_liked": false,
    "post": {
        "id": "a239a36b-038f-4d6a-a413-7a7cd99f3eef",
        "title": "後ろからハグしながら囁く",
        "text": "ツラいことあったらこれを思い出してね\n...#女性向けボイス",
        "type": 1,
        "user_id": "97f77635-f09f-49a3-8efd-cddc6bb816cd",
        "restriction": 1,
        "comment_count": 1,
        "gift_banana": 5,
        "like_count": 2,
        "play_count": 39,
        "created_at": "2026-07-10T11:53:05.350683Z",
        "mask_title": "後ろからハグしながら囁く",
        "mask_text": "ツラいことあったらこれを思い出してね\n...#女性向けボイス",
        "user": {
            "id": "97f77635-f09f-49a3-8efd-cddc6bb816cd",
            "username": "yu3132",
            "avatar_url": "https://media.otobanana.com/public/users/.../profile_1779961433.png",
            "bio": "はじめまして、七咲夕（ななさきゆう）と申します。...",
            "gender": 1,
            "name": "七咲 夕",
            "twitter_username": "yunoyoru3132",
            "followee_count": 0,
            "follower_count": 10,
            ...
        }
    }
}
```

---

## 六、作者数据模型

### 作者 (User) 完整字段

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | `string(uuid)` | 用户ID |
| `username` | `string` | 用户名 (登录用) |
| `avatar_url` | `string` | 头像URL |
| `bio` | `string` | 个人简介 |
| `gender` | `int` | 性别码 (0=未设置, 1=男性, 2=女性) |
| `gender_label` | `string` | 性别标签 (not_set/male/female) |
| `name` | `string` | 昵称 (显示名) |
| `twitter_username` | `string` | Twitter/X 用户名 |
| `livestream_rule` | `string` | 直播规则文本 |
| `followee_count` | `int` | 关注人数 |
| `follower_count` | `int` | 粉丝人数 |
| `dlsite_url` | `string` | DLsite 作品链接 |
| `cien_url` | `string` | Cien 链接 |
| `is_blocked` | `boolean` | 是否被当前用户屏蔽 |
| `is_muted` | `boolean` | 是否被当前用户静音 |
| `is_followed` | `boolean` | 当前用户是否关注 |
| `is_notification_setting_enabled` | `boolean` | 是否开启通知 |
| `is_simple_notification` | `boolean` | 是否简化通知 |

#### 匿名/掩码字段

| 字段 | 说明 |
|------|------|
| `mask_name` | 匿名昵称 |
| `mask_bio` | 匿名简介 |
| `mask_livestream_rule` | 匿名直播规则 |

#### Pinia Auth Store 额外字段

| 字段 | 类型 | 说明 |
|------|------|------|
| `accessToken` | `string` | JWT Token |
| `tokenTimerId` | `number` | Token 定时器ID |
| `isVerified` | `boolean` | 是否已验证 |
| `provider` | `string|null` | 认证提供者 |
| `email` | `string` | 邮箱 |
| `birthday` | `string` | 生日 |
| `hasAgreedToAgeLimit` | `boolean` | 是否同意年龄限制 |
| `isAgeVerification` | `boolean|null` | 年龄验证状态 |
| `hasNewNotifications` | `boolean` | 是否有新通知 |
| `isStreaming` | `boolean` | 是否正在直播 |
| `livestreamJoinToken` | `string|null` | 直播加入Token |

### JSON 结构

```json
{
    "id": "97f77635-f09f-49a3-8efd-cddc6bb816cd",
    "username": "yu3132",
    "avatar_url": "https://media.otobanana.com/public/users/.../profile_1779961433.png",
    "bio": "はじめまして、七咲夕...",
    "gender": 1,
    "name": "七咲 夕",
    "twitter_username": "yunoyoru3132",
    "livestream_rule": "",
    "followee_count": 0,
    "follower_count": 10,
    "dlsite_url": "",
    "cien_url": "",
    "is_blocked": false,
    "is_muted": false,
    "is_followed": false,
    "gender_label": "male",
    "mask_name": "七咲 夕",
    "mask_bio": "はじめまして、七咲夕...",
    "mask_livestream_rule": "",
    "is_notification_setting_enabled": false,
    "is_simple_notification": false
}
```

---

## 七、媒体资源

### 域名架构

| 域名 | 用途 | 托管 |
|------|------|------|
| `media.otobanana.com` | 音频文件 + 用户头像 + 作品封面 | S3 + CloudFront |
| `assets.otobanana.com` | 静态资源(图片/ICON/表情) | S3 + CloudFront |

### 音频文件

**URL 模式:**
```
https://media.otobanana.com/converted/users/{userId}/casts/{fileId}.mp3
```

**HEAD 响应 (确认已永久存储):**
```http
HTTP/1.1 200 OK
Content-Type: audio/mpeg3
Content-Length: 1929717
ETag: "467c86956e75e2a3c7fe8d518ee65020"
Last-Modified: Fri, 10 Jul 2026 11:53:16 GMT
x-amz-server-side-encryption: AES256
```

**Range 请求 (206 Partial Content):**
```http
HTTP/1.1 206 Partial Content
Content-Type: audio/mpeg3
Content-Range: bytes 0-1023/1929717
Content-Length: 1024
ETag: "467c86956e75e2a3c7fe8d518ee65020"
x-amz-server-side-encryption: AES256
access-control-allow-origin: *
access-control-expose-headers: *
```

#### 音频特性总结

| 特性 | 支持 |
|------|------|
| CDN | ✅ CloudFront |
| 签名URL | ❌ 否 (直接访问) |
| 过期 | ❌ 否 (永久有效) |
| Range下载 | ✅ 支持 (206 Partial) |
| HEAD请求 | ✅ 支持 |
| Resume | ✅ 支持 (Range=bytes=N-) |
| 多线程下载 | ✅ 支持 (Range并发) |
| Referer检查 | ❌ 无 (`access-control-allow-origin: *`) |
| Cookie检查 | ❌ 无 |
| CORS | ✅ 全开放 |
| ETag | ✅ 有 (可用于缓存/验证) |
| Last-Modified | ✅ 有 |
| 加密存储 | ✅ AES256-S3 |
| 转码服务 | ✅ AWS MediaConvert (`x-amz-meta-mediaconvert-jobid`) |

### 封面/头像图片

**URL 模式:**
```
作品封面: https://media.otobanana.com/public/users/{userId}/casts/{fileId}.png
用户头像: https://media.otobanana.com/public/users/{userId}/profile_{hash}.png
```

**图片传参:**
- `?fit=cover` — 裁剪模式 (支持图片变换)

### 资源域名 URL 模式汇总

```
# 音频 (已转码)
https://media.otobanana.com/converted/users/{userId}/casts/{fileId}.mp3

# 作品封面/缩略图
https://media.otobanana.com/public/users/{userId}/casts/{fileId}.png

# 用户头像
https://media.otobanana.com/public/users/{userId}/profile_{hash}.png

# Assets 资源
https://assets.otobanana.com/assets/bananas/{name}.png
https://assets.otobanana.com/assets/releases/{name}.jpg
```

### 媒体文件命名规律

- `converted/` 路径表示是经过 AWS MediaConvert 转码后的文件
- 文件名使用 UUID，`profile_{timestamp}.png` 格式
- 默认封面: `https://otobanana.com/ogp.jpg`
- 默认头像: 内联在 JS 中的 `data:image/svg+xml,...`

---

## 八、反爬

### 反爬措施评估

| 措施 | 状态 | 说明 |
|------|------|------|
| Cloudflare | ❌ 不使用 | 使用 AWS CloudFront (不同产品) |
| Turnstile/CAPTCHA | ❌ 不使用 | 登录页无验证码 |
| 频率限制 | ⚠️ 可能存在 | Laravel `throttle` 中间件可能启用 |
| WAF | ✅ AWS WAF | 通过 CloudFront 可能启用 WAF |
| Token 认证 | ✅ JWT | 需要登录的 API 需 Authorization header |
| CSRF Token | ✅ | `__Host-next-auth.csrf-token` cookie |
| UA 检测 | ⚠️ 可能 | 标准 Nuxt/JS SPA，低检测概率 |
| Referer 检测 | ❌ 无 | `access-control-allow-origin: *` |
| Origin 检测 | ❌ 无 | CORS 全开放 |
| 签名算法 | ❌ 无 | API 无签名参数 |
| 时间戳验证 | ❌ 无 | 未发现时间戳验证 |
| JS 混淆 | ❌ 无 | Nuxt 默认压缩，未做额外混淆 |
| 必须浏览器环境 | ❌ 否 | API 可直接 curl 调用 |
| 年龄验证 | ⚠️ 前端覆盖 | `is_adult` 标志位，UI 层拦截 |
| Session 验证 | ✅ Laravel session | `otobanana_session` cookie 需保持 |

### 详细分析

#### 1. Cloudflare
不使用 Cloudflare。CDN 使用 AWS CloudFront (`via: cloudfront`, `x-amz-cf-id`, `x-amz-cf-pop` 等 headers)。无 CF 质询页、无 Turnstile、无 cf 相关 script。

#### 2. 验证码
登录页无验证码/无 Turnstile。注册页可能有邮箱验证。

#### 3. 频率限制
Laravel 标准的 `throttle` 中间件可能在登录等关键 API 上启用。未测试具体限制频率。

#### 4. Token 认证
- 公开 API: 无认证要求
- 私有 API: 需要 `Authorization: <accessToken>` header
- Token 通过登录获取，有 refresh 机制

#### 5. CSRF
`__Host-next-auth.csrf-token` cookie 用于 CSRF 防护。
`credentials: "include"` 的 fetch 请求自动携带。

#### 6. CORS
API 和媒体资源均设置 `access-control-allow-origin: *`，可从任何域调用。

#### 7. 媒体访问
媒体文件无需任何认证、签名或 Referer，可直接用 Range 请求多线程下载。

#### 8. 年龄限制
通过 `is_adult` 字段标记 R18 内容。前端有年龄确认弹窗，但数据层无严格限制 — API 返回的数据包含 R18 内容。

---

## 九、建议的 Provider 架构

```
Provider/
├── API/
│   ├── Client.ts              # HTTP 客户端封装
│   ├── PublicAPI.ts           # 公开 API 调用
│   ├── PrivateAPI.ts          # 私有 API (需 token)
│   ├── AuthAPI.ts             # 认证相关 (login/refresh/logout)
│   └── endpoints.ts           # 所有 API 端点和类型常量
│
├── Parser/
│   ├── CastParser.ts          # 作品详情页数据解析
│   ├── UserParser.ts          # 作者/用户数据解析
│   ├── SearchParser.ts        # 搜索结果解析
│   ├── ListParser.ts          # 列表/分页数据解析
│   └── MediaParser.ts         # 媒体URL提取和解析
│
├── Downloader/
│   ├── AudioDownloader.ts     # 音频下载 (支持Range/多线程/断点续传)
│   ├── ImageDownloader.ts     # 封面/头像下载
│   └── manager.ts             # 下载任务管理
│
├── Auth/
│   ├── Authenticator.ts       # 登录/logout 逻辑
│   ├── TokenManager.ts        # JWT 存储/刷新/过期管理
│   └── Session.ts             # Session 状态维护
│
├── Search/
│   ├── SearchEngine.ts        # 搜索接口封装
│   └── FilterBuilder.ts       # 搜索参数构建
│
└── Metadata/
    ├── Cast.ts                # 作品数据模型 & 类型定义
    ├── User.ts                # 作者数据模型 & 类型定义
    ├── Category.ts            # 分类数据模型
    └── Media.ts               # 媒体资源类型定义
```

### 各层职责

#### API/
- **Client.ts**: 封装 HTTP 请求，统一处理 baseURL (`https://api.v2.otobanana.com`)，自动附加认证头，错误处理，重试逻辑
- **PublicAPI.ts**: 公开 API 调用方法 (getCast, getUser, searchCasts, getTopCasts, etc.)
- **PrivateAPI.ts**: 需要认证的 API (getComments, getNotifications, getHistory, etc.)
- **AuthAPI.ts**: 登录、注册、登出、Token刷新、密码重置等认证流程
- **endpoints.ts**: 集中管理所有 API URL 常量和请求参数类型

#### Parser/
- **CastParser.ts**: 从 API 原始 JSON 解析为内部 Cast 对象，处理字段映射 (post.xx → cast.xx)，mask/normal 字段二选一
- **UserParser.ts**: 解析用户 JSON，处理 mask/normal 字段，统一性别表示
- **SearchParser.ts**: 解析搜索结果 (limit/offset 分页)，提取分页信息和搜索结果
- **ListParser.ts**: 处理 cursor-based 分页列表 (livestreams, followers), offset-based 列表
- **MediaParser.ts**: 从 Cast 数据中提取音频 URL、封面 URL、缩略图 URL；处理 URL 生成/格式转换

#### Downloader/
- **AudioDownloader.ts**: 核心下载逻辑，利用 AWS S3 + CloudFront 支持 Range 请求的特性，支持多线程分片下载和断点续传。无需处理签名/认证/Referer
- **ImageDownloader.ts**: 封面/头像下载，支持 `?fit=cover` 参数
- **manager.ts**: 管理下载队列，跟踪进度，处理错误重试

#### Auth/
- **Authenticator.ts**: 实现登录流程 (email + password → accessToken)
- **TokenManager.ts**: Token 存储、自动刷新 (`/api/refreshToken`)、过期检测、持久化
- **Session.ts**: 管理登录状态、cookie 维护、登录状态检测

#### Search/
- **SearchEngine.ts**: 搜索 API 调用封装 (q, category_id, limit, offset)，搜索历史和缓存
- **FilterBuilder.ts**: 构建搜索参数，支持分类过滤、R18 过滤、排序

#### Metadata/
- **Cast.ts**: 作品数据模型类型定义，字段映射和文档
- **User.ts**: 作者数据模型类型定义
- **Category.ts**: 分类枚举/常量定义
- **Media.ts**: 媒体类型定义 (audio/video/image)，下载信息和状态

### 核心注意事项 (开发指南)

1. **API Base URL**: `https://api.v2.otobanana.com` — 数据 API **与登录** 均在此
2. **Auth URL**: `POST https://api.v2.otobanana.com/api/signin`，body `{ "Email", "Password" }`
3. **Token**: 裸字符串，无 `Bearer` 前缀；会话探测用 `GET /api/settings`
4. **Credentials**: 浏览器侧 `credentials: "include"`；服务端直连 api.v2 可不带 cookie 仍能登录
5. **收藏分页**: `GET /api/users/{userId}/likes` 使用 cursor / `next_page_url`（非 limit+offset）
6. **音频**: 直接 URL 下载，支持 Range，无需任何额外处理
7. **封面**: 可能为 null，需准备 fallback
8. **R18**: 通过 `is_adult` 字段判断，`/:floor()/` 中 `floor` = `general` 或 `deep`
9. **客房端渲染**: Cast 详情页数据通过 CSR 获取，需先获取 Cast ID
10. **无浏览器要求**: 所有 API 可直接用 HTTP 客户端调用
