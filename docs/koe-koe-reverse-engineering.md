# Koe-Koe (koe-koe.com) 逆向分析完整文档

> 分析日期: 2026-07-11
> 目标: 完整分析网站数据获取方式，无需再次抓包即可开发 Provider

---

## 一、整体架构

### 1.1 技术栈

| 项目 | 值 |
|------|-----|
| 渲染方式 | **SSR** (传统服务端渲染) |
| 后端语言 | **PHP** |
| 前端框架 | **无** (纯原生 + jQuery) |
| JS库 | jQuery 3.4.1 |
| CSS | `/css/koe_pc.css?v=002`, FontAwesome 4.7 |
| Session存储 | PHP原生 Session (PHPSESSID) |
| 认证 | 自研密码认证 + Twitter OAuth + ナンネットID |
| 数据库 | MySQL/MariaDB (推断) |
| 广告网络 | Shinobi, i-mobile, Nan-net Revive Adserver |
| 分析 | Google Analytics G-9684K1DTKN |
| 音频CDN | `file.koe-koe.com` (推断为Nginx + 独立静态服务器) |
| 直播 | `live.koe-koe.com`, `cdn2.live.koe-koe.com` |
| 服务器 | 日本 (非Cloudflare) |

### 1.2 结论

**不是** SSR/CSR/Hybrid 框架。是传统 PHP 网站：
- 没有 React/Vue/Next.js/Nuxt
- 没有 SPA 路由
- 没有 Webpack/Vite 打包
- 没有 GraphQL
- 没有 WebSocket（除了直播可能有独立的WebSocket服务）
- 所有页面由 PHP 服务端渲染返回完整 HTML

### 1.3 页面加载流程

```
浏览器请求 URL
     │
     ▼
DNS: koe-koe.com → 服务器IP (日本)
     │
     ▼
服务器 PHP 处理请求:
  1. session_start() 获取/创建 PHPSESSID
  2. 验证 login_token cookie (如存在)
  3. 查询数据库 (MySQL)
  4. 渲染 HTML (PHP模板)
  5. 返回完整 HTML (包含内联CSS/JS引用)
     │
     ▼
浏览器渲染 HTML
  ├── 加载 CSS (/css/koe_pc.css)
  ├── 加载 jQuery (CDN)
  ├── 加载 parts2_1.js (点赞、评论功能)
  ├── 加载 onair_list.js (直播列表)
  ├── 加载 ng_match.js (NG词过滤)
  ├── 广告脚本 (Shinobi, i-mobile, Revive)
  └── Google Analytics (gtag)
     │
     ▼
$(function() { ... }) 执行:
  - 如果有音频ID参数 → 加载点赞数
  - 绑定点赞按钮事件
  - 设置直播列表
  - NG词过滤
```

### 1.4 请求流程图

```
┌─────────────────────────────────────────────────────┐
│                    浏览器                            │
│  ┌──────────────────────────────────────────────┐   │
│  │  HTML页面 (SSR)                               │   │
│  │  - 首页 /                                    │   │
│  │  - 列表 /list.php?g=1&g2=0                   │   │
│  │  - 详情 /detail.php?n=761964                 │   │
│  │  - 搜索 /search.php?word=xxx                 │   │
│  │  - 登录 /login.php                           │   │
│  └──────────┬───────────────────────────────────┘   │
│             │                                       │
│             ▼                                       │
│  ┌──────────────────┐    ┌───────────────────┐     │
│  │  GET 静态资源     │    │  POST 交互API     │     │
│  │  - /css/*.css    │    │  - login.php      │     │
│  │  - /js/*.js      │    │  - btn2.php       │     │
│  │  - /img/*.png    │    │  - loaded2.php    │     │
│  └──────────────────┘    │  - koe_comment.php │     │
│                          │  - add_bookmark.php│     │
│                          │  - koe_tag.php     │     │
│                          └───────────────────┘     │
└──────────────────────┬──────────────────────────────┘
                       │
                       ▼
              ┌──────────────────┐
              │  koe-koe.com     │
              │  (PHP Server)    │
              └────────┬─────────┘
                       │
          ┌────────────┼────────────┐
          ▼            ▼            ▼
   ┌──────────┐ ┌──────────┐ ┌──────────┐
   │ MySQL DB │ │ 本地文件  │ │file.koe- │
   │          │ │ (音频)   │ │koe.com   │
   │  - 作品  │ │ /sound/  │ │ (CDN)    │
   │  - 用户  │ │ upload/  │ │ /sound/  │
   │  - 评论  │ │          │ │ upload/  │
   │  - 标签  │ │          │ │          │
   └──────────┘ └──────────┘ └──────────┘
```

---

## 二、认证

### 2.1 认证方式总结

| 方式 | 名称 | 详情 |
|------|------|------|
| Session | `PHPSESSID` | PHP 原生 Session Cookie |
| Token | `login_token` | 持久化登录 Token (httpOnly, secure) |
| 第三方 | ナンネットID | `id.nan-net.jp` 联合登录 |
| 第三方 | Twitter OAuth | `./id/geturl.php` → Twitter |

### 2.2 Cookie 明细

**PHPSESSID**
```
Name:   PHPSESSID
Value:  随机字符串 (如 10bubajb4mb9ce9mdd4ief0vsg)
Domain: koe-koe.com
Path:   /
HttpOnly: false
Secure:   false
Session:  true (浏览器关闭即失效)
```

**login_token** (登录成功后设置)
```
Name:   login_token
Value:  MD5-like 哈希 (如 5d8ab84a726cc06a1a4e5c9e7c696b44)
Domain: .koe-koe.com (泛域名)
Path:   /
HttpOnly: true
Secure:   true
Expires: 长期 (约30天)
```

### 2.3 登录流程

```
1. 用户访问 /login.php?op=login
     → 服务器创建 PHPSESSID (如未存在)
     → 返回登录页面 HTML

2. 用户提交表单:
   POST /login.php
   Content-Type: application/x-www-form-urlencoded
   
   Body: id=poiyee&pass=REMOVED

3. 服务器验证:
   - 查询ナンネットID系统或本地数据库
   - 验证 id + pass

4. 登录成功:
   → Set-Cookie: login_token=xxxxxxxx (httpOnly, secure, ~30d)
   → 302 Redirect → `login.php`（相对路径；**成功时也会回到 login.php**）
   → 随后用 `PHPSESSID` + `login_token` 访问 `/mypage.php` 才是已登录态
   → 判定成功：响应 cookie 含 `login_token`，且 mypage HTML 无登录表单

5. 登录失败:
   → 302 Redirect → `/login.php?op=login&err=confirm`（或带 err 的 login.php）
   → **不要**仅因 Location 含 `login.php` 就判失败（成功同样会 302 到 login.php）
   → 显示错误信息

6. Twitter登录:
   GET /id/geturl.php
     → 跳转到 Twitter OAuth 授权页
     → 回调后绑定到现有账号
```

### 2.4 请求头 (登录后)

```
GET /mypage.php
Host: koe-koe.com
Cookie: PHPSESSID=xxx; login_token=xxx
User-Agent: Mozilla/5.0 ...
Referer: https://koe-koe.com/login.php
```

### 2.5 认证结论

- 没有 CSRF Token
- 没有 JWT
- 没有 OAuth2 Bearer Token
- 没有 Refresh Token 机制
- 没有 Turnstile/reCAPTCHA
- 密码明文中传输 (非HTTPS? 但页面是HTTPS)

---

## 三、页面与数据来源

### 3.1 首页 `/`

| 项目 | 值 |
|------|-----|
| URL | `https://koe-koe.com/` |
| 渲染 | SSR (完整HTML) |
| API调用 | 无 (页面加载时无XHR) |
| JS动态加载 | 直播列表: `onair_list.js` → `cdn2.live.koe-koe.com/api/live_list.json` |

**页面内容:**
- 信息公告 (クリエイター応援キャンペーン等)
- 快速搜索分类入口 (女性/男性/カップル版)
- 再生&人気の音声 (推荐列表, 约5-8条)
- 特集 (featured topic)
- いいね×N 排行榜
- 新着音声 (最近上传)
- 伝言板 (bulletin board text posts)
- リクエスト (request posts)
- 広告 (右侧栏)

**直播列表请求:**
```
GET https://cdn2.live.koe-koe.com/api/live_list.json
→ JSON Array: [{gender, name, id, trip, comment, play, good, room_id, spend, start}]
```

### 3.2 列表页 `list.php`

```http
GET /list.php?g={gender}&g2={subcategory}&p={page}
```

| 参数 | 值 | 说明 |
|------|-----|------|
| `g` | 1/2/3 | 性别: 1=女性, 2=男性, 3=カップル |
| `g2` | 0~10 | 子分类: 0=全部, 1=エロ声, 2=オナ声, 4=体験談, 5=私の秘密, 10=アーカイブ, 6=通話, 3=その他 |
| `p` | 1~6700+ | 页码 |

**渲染:** SSR 完整HTML列表
**无XHR/Fetch调用**
**每页:** 约20条作品
**分页:** `&p=N` 参数, 底部分页导航
**排序:** 默认按时间倒序 (最新在前)
**最大页数:** 当前女性版 `g=1&g2=0` 共6700页

**列表项数据 (从HTML中提取):**
```
- 作品ID: 从 href="detail.php?n={ID}" 获取
- 时长: "5分", "3秒", "26分" 等
- 作者名: 名無し, ユーザー名◆trip, ユーザー名◇ID_xxxxx
- 标题: "声出せないけど"
- 评论数:  コメ : {N}
- 点赞数:  いいね : {N}
- 时间: @{X分前/時間前/日前}
- 性别图标: icon_female/male/couple (CSS类)
```

### 3.3 作品详情页 `detail.php`

```http
GET /detail.php?n={post_id}
```

| 参数 | 值 |
|------|-----|
| `n` | 作品数字ID (如 761964) |

**渲染:** SSR 完整HTML
**XHR请求:**
- **loaded2.php** (POST, 获取点赞数)
- **可能的音频文件:** `file.koe-koe.com/sound/upload/{id}.mp3`

**页面数据结构:**
```html
<h2>{标题}</h2>

<!-- 音频播放器 -->
<audio preload="metadata" controls>
  <source src="//file.koe-koe.com/sound/upload/{id}.mp3" type="audio/mp3">
</audio>

<!-- 时长 -->
<div class="audioTime audioTime_{gender}">4分48秒</div>

<!-- 作者信息 -->
<a href="search.php?word={author}&g={g}&m=1">
  <span class="user_name">{作者名}</span>
</a>

<!-- 分类 -->
<span class="meta_item">
  <a href="list.php?g={g}&g2={sub}">{类型}</a>
</span>

<!-- 发布时间 -->
<span class="meta_item">@{X分前/時間前/日前}</span>
  <!-- 旧作品: @YY/M/D 格式 -->

<!-- 性别图标 -->
<img src="/img/female3.png">  <!-- female/male/couple -->

<!-- 点赞&播放数 -->
<div id="clap">
  <button>いいね <span class="loaded">{count}</span></button>
  再生数 : {play_count}
</div>

<!-- ブックマーク -->
<a href="add_bookmark.php?n={id}">+ブックマークする</a>

<!-- 标签 -->
<div id="tag">
  <form action="koe_tag.php" method="post">
    <input type="hidden" name="id" value="{post_id}">
    <input type="text" name="word">
    <input type="submit" value="タグ追加">
  </form>
</div>

<!-- 投稿削除 -->
<form action="del_entry.php" method="post">
  <input type="hidden" name="id" value="{post_id}">
  <input type="text" name="pass">
  <input type="submit" value="投稿削除">
</form>

<!-- コメント投稿 -->
<form action="koe_comment.php" method="post" id="comment_form">
  <!-- 匿名: 名前 + コメント -->
  <!-- 注册用户: 仅コメント -->
  <input type="hidden" name="no" value="{post_id}">
</form>

<!-- コメント一覧 -->
<div class="comment">
  <p class="cm_name">{评论者名} : {评论内容}</p>
  <p class="cm_date">{日期}</p>
</div>
```

**点赞交互 (来自 parts2_1.js):**
```javascript
// 点击点赞按钮 → POST btn2.php
$.post('btn2.php', {
  num: postId,      // 作品ID
  tbl: 't',         // 表名 (t = audio? c = comment?)
  xyz: timestamp,   // 当前时间戳
  second: audioCurrentTime  // 音频播放进度(秒)
}, function(data) {
  // 刷新点赞数
  $("span.loaded").load("loaded2.php", {
    num: postId,
    tbl: 't',
    xyz: new Date().getTime()
  });
});
```

### 3.4 搜索页 `search.php`

```http
GET /search.php?word={keyword}&g={gender}&m=1&p={page}
```

| 参数 | 说明 |
|------|------|
| `word` | 关键词 (URL编码) |
| `g` | 性别筛选: 1/2/3 (可选) |
| `m` | 模式: 1=作者搜索, 不传=全文搜索 |
| `p` | 页码 |

**渲染:** SSR 完整HTML列表
**列表格式:** 与 list.php 完全相同
**搜索范围:** 标题 + 作者名 (m=1 时仅搜索作者名)
**特殊:** `auto_play.php?word={}&g={}` 自动播放页面

### 3.5 投稿者一覧 `post_users.php`

```http
GET /post_users.php?g={gender}
```

| 参数 | 说明 |
|------|------|
| g | 1=女性, 2=男性, 3=カップル, 不传=全部 |

**渲染:** SSR
**列表:** 按首字母(日文50音)排列的投稿者列表
**每项:** `<a href="search.php?word={name_encoded}&g={g}&m=1">{name}</a>`
**无作者独立页面**, 点击跳转到作者搜索

### 3.6 分类页 `all_genre.php`

```http
GET /all_genre.php
```

分类列表:
- 女性: エロ声(g2=1), オナ声(2), 体験談(4), 私の秘密(5), アーカイブ(10), 通話(6), その他(3)
- 男性: 同上结构 g=2
- カップル: 同上结构 g=3

### 3.7 月間アーカイブ `archive.php`

```http
GET /archive.php?date={YYYY-MM}
```

**页面列表:** `/detail.php?n={id}` 格式
**各月页面有分页:** `&p={N}`

### 3.8 タグ `all_tag.php` / `notable_tag.php`

```http
GET /all_tag.php         # 全标签
GET /notable_tag.php      # 注目标签
```

标签列表 → 点击跳转到 `search.php?word={tag}`

### 3.9  Bookmarks `mypage.php`

```http
GET /mypage.php
```

**需要登录** (PHPSESSID + login_token cookies)
**内容:** ブックマークした投稿 (已收藏的作品列表)
**分页:** 底部分页导航

### 3.10 直播 `live_top.php` / 直播API

```http
# 直播列表API:
GET https://cdn2.live.koe-koe.com/api/live_list.json
→ JSON Array

# 预约列表API:
GET https://cdn2.live.koe-koe.com/api/reserve_list.json
→ JSON Array

# 直播间:
https://live.koe-koe.com/{room_id}.html
```

**live_list.json 返回结构:**
```json
[
  {
    "gender": 1,           // 1=女性, 2=男性, 3=カップル
    "name": "る",
    "id": "",              // 用户ID (如果有)
    "trip": "",            // トリップ (如果有)
    "comment": "交尾しよっか",
    "play": 0,             // 同時再生数
    "good": 0,             // いいね数
    "room_id": "xxx",
    "spend": 11000,        // 开播后毫秒 (负数=预定)
    "start": 1741269600000 // 开始时间戳 (ms)
  }
]
```

### 3.11 评论API `koe_comment.php`

```http
POST /koe_comment.php
Content-Type: application/x-www-form-urlencoded

# 匿名用户:
name={名前}&comment={コメント}&no={post_id}

# 注册用户:
comment={コメント}&no={post_id}
```

### 3.12 点赞API `btn2.php`

```http
POST /btn2.php
Content-Type: application/x-www-form-urlencoded

num={post_id}&tbl=t&xyz={timestamp}&second={playback_seconds}
```

### 3.13 点赞数刷新 `loaded2.php`

```http
POST /loaded2.php
Content-Type: application/x-www-form-urlencoded

num={post_id}&tbl=t&xyz={timestamp}
```

返回: HTML片段 (点赞数字)

---

## 四、API 整理

### 4.1 Public API (无需认证)

实际上所有页面都是公开访问的，但以下列表是数据获取的主要入口：

#### 获取列表
```http
GET /list.php?g=1&g2=0&p=1
```
- **Method:** GET
- **Header:** 无特殊要求
- **Body:** 无
- **Response:** 完整HTML
- **分页:** `&p=N`
- **限流:** 未发现明显限流
- **权限:** 无需登录

#### 获取详情
```http
GET /detail.php?n=761964
```
- **Method:** GET
- **Response:** 完整HTML
- **权限:** 无需登录

#### 搜索
```http
GET /search.php?word=キーワード&g=1&m=1&p=1
```
- **Method:** GET
- **Response:** 完整HTML

#### 获取直播列表
```http
GET https://cdn2.live.koe-koe.com/api/live_list.json
```
- **Method:** GET
- **Response:** JSON
- **权限:** 完全公开

### 4.2 Private API (需要登录)

#### 登录
```http
POST /login.php
Content-Type: application/x-www-form-urlencoded
Cookie: PHPSESSID=xxx

id=poiyee&pass=REMOVED
```
- **Response:** 302 Redirect (成功) / 200 HTML (失败)
- **Set-Cookie:** login_token=xxx

#### 收藏
```http
GET /add_bookmark.php?n=761964
```
- **Cookie:** PHPSESSID + login_token 必需
- **权限:** 需要登录

#### 投稿
```http
POST /koe_post.php
Content-Type: multipart/form-data

# 音频文件 + 表单字段
```
- **Cookie:** PHPSESSID + login_token

#### 删除投稿
```http
POST /del_entry.php
Content-Type: application/x-www-form-urlencoded

id={post_id}&pass={delete_password}
```

### 4.3 Internal API (无需特殊权限)

#### 点赞
```http
POST /btn2.php
Content-Type: application/x-www-form-urlencoded

num={post_id}&tbl=t&xyz={ts}&second={s}
```
- **Method:** POST
- **Header:** Referer (有更好)
- **Response:** HTML (点赞后状态)
- **限流:** 未发现显式限流

#### 刷新点赞数
```http
POST /loaded2.php
Content-Type: application/x-www-form-urlencoded

num={post_id}&tbl=t&xyz={ts}
```
- **Method:** POST
- **Response:** HTML数字
- **用途:** 刷新点赞数显示

#### 添加标签
```http
POST /koe_tag.php
Content-Type: application/x-www-form-urlencoded

id={post_id}&word={tag_name}
```

#### 发布评论
```http
POST /koe_comment.php
Content-Type: application/x-www-form-urlencoded

name={name}&comment={text}&no={post_id}
```
- 匿名用户可评论

---

## 五、作品数据模型

### 5.1 模型字段

| 字段 | 类型 | 来源 | 说明 |
|------|------|------|------|
| `id` | integer | URL参数 `n=` | 作品唯一ID (如 761964) |
| `title` | string | h2文本 | 作品标题 |
| `author_name` | string | `.user_name` | 作者昵称 |
| `author_trip` | string? | 作者名后 ◆xxx | トリップ (Tripcode) |
| `author_nan_id` | string? | 作者名后 ◇ID_xxxxx | ナンネットID |
| `author_search_url` | string | `search.php?word={}&g={}&m=1` | 作者搜索链接 |
| `gender` | int | `g` 参数 | 1=女性, 2=男性, 3=カップル |
| `subcategory` | int | `g2` 参数 | 1~10 |
| `subcategory_name` | string | meta标签 | 如 オナ声, エロ声 |
| `duration` | string | `.audioTime` | 如 "4分48秒", "5分" |
| `duration_seconds` | int? | 推断 | 可选从音频获取 |
| `audio_url` | string | `<source src>` | `//file.koe-koe.com/sound/upload/{id}.mp3` |
| `icon` | string | img src | `/img/female3.png` |
| `likes` | int | `#clap .loaded` | いいね数 |
| `plays` | int | 再生数 : N | 播放次数 |
| `comments_count` | int | コメ : N | 评论数 |
| `tags` | string[] | `#tag` 区域 | 标签列表 (用户添加) |
| `timestamp_relative` | string | `@X分前/時間前/日前` | 相对时间 |
| `timestamp_absolute` | string | 旧作品 | `YY/M/D` 格式 |
| `description` | string | desc文本 | 作品描述/说明 |
| `text_content` | string? | 音频文字化 | 可能有的文本内容 |

### 5.2 JSON 数据模型

```json
{
  "id": 761964,
  "title": "声出せないけど",
  "author": {
    "name": "名無し",
    "trip": null,
    "nan_id": null,
    "search_url": "/search.php?word=名無し&g=1&m=1"
  },
  "gender": 1,
  "subcategory": {
    "id": 2,
    "name": "オナ声"
  },
  "duration": {
    "display": "4分48秒",
    "seconds": 288
  },
  "media": {
    "audio_url": "https://file.koe-koe.com/sound/upload/761964.mp3",
    "format": "mp3",
    "icon_url": "https://koe-koe.com/img/female3.png"
  },
  "stats": {
    "likes": 1,
    "plays": 18,
    "comments": 0
  },
  "tags": [],
  "timestamps": {
    "relative": "@32分前",
    "absolute": null
  },
  "description": "我慢できなくて",
  "text_content": null,
  "url": "https://koe-koe.com/detail.php?n=761964"
}
```

### 5.3 HTML 提取映射

```html
<!-- 标题 -->
<h2>{title}</h2>

<!-- 音频URL -->
<source src="//file.koe-koe.com/sound/upload/{id}.mp3">

<!-- 时长 -->
<div class="audioTime audioTime_female">{duration}</div>

<!-- 作者 -->
<span class="user_name">{author_name}</span>
<!-- 作者可能有trip: name◆tripcode 或 ◇ID_number -->

<!-- 分类 + 时间 -->
<span class="meta_item">
  <a href="list.php?g={g}&g2={sub}">{sub_name}</a>
</span>
<span class="meta_item">@{relative_time}</span>

<!-- 点赞 -->
<span class="loaded">{likes_count}</span>
{plays_count} (来自文本: 再生数 : {N})

<!-- 评论数 (列表页) -->
コメ : {comments_count}

<!-- 描述/说明 -->
<div class="desc detail"><p>{description}</p></div>
```

---

## 六、作者数据模型

### 6.1 模型字段

> Koe-Koe **没有独立作者页面**, 作者信息散落在各作品中

| 字段 | 来源 | 说明 |
|------|------|------|
| `name` | `.user_name` | 作者昵称 |
| `trip` | 作者名后 ◆xxx | Tripcode (可选项) |
| `nan_id` | 作者名后 ◇ID_xxxxx | ナンネットID (可选项) |
| `gender` | 关联作品的 `g` | 1=女性, 2=男性, 3=カップル |
| `icon` | gender图标 | `/img/female3.png` 等 |
| `search_url` | author search link | `search.php?word={name}&g={g}&m=1` |
| `post_count` | 搜索结果数 | 通过搜索获取 |
| `posts` | Post[] | 通过搜索获取作品列表 |

### 6.2 JSON 数据模型

```json
{
  "name": "雨宮さん",
  "trip": "TGmFqVoorQ",
  "nan_id": null,
  "gender": 1,
  "icon": "https://koe-koe.com/img/female3.png",
  "url": "https://koe-koe.com/search.php?word=雨宮さん&g=1&m=1",
  "stats": {
    "post_count": 5
  },
  "recent_posts": [
    {
      "id": 761234,
      "title": "子作りせっくす♡♡♡",
      "likes": 55,
      "plays": 200,
      "comments": 7
    }
  ]
}
```

### 6.3 获取作者作品列表

```
1. author_search_url = search.php?word={author_name_encoded}&g={g}&m=1
2. 请求该URL获取HTML
3. 提取作品列表 (同list.php格式)
4. 分页: &p=N
5. 翻页直到最后一页
```

---

## 七、媒体资源

### 7.1 音频文件

| 属性 | 值 | 验证 |
|------|-----|------|
| **URL格式** | `https://file.koe-koe.com/sound/upload/{id}.mp3` | 确认 |
| **服务器** | **Nginx** | 确认 (`Server: nginx` header) |
| **协议** | HTTPS (HTML中协议相对 `//`) | 确认 |
| **子域名** | `file.koe-koe.com` (独立静态服务器) | 确认 |
| **Content-Type** | `audio/mpeg` | 确认 |
| **文件大小** | 不定 (示例 761964.mp3 = 2,304,620 bytes) | 确认 |
| **ETag** | `"6a521104-232a6c"` (十六进制) | 确认 |
| **Last-Modified** | 上传时间 (GMT) | 确认 |
| **Accept-Ranges** | `bytes` | 确认 |

| 检查项 | 是否存在 |
|--------|---------|
| **ID3标签** | 仅 34 字节极简头部 |
| **内嵌封面/专辑图** | ❌ 无 |
| **额外比特率版本 (128/192/320)** | ❌ 无 (全部 404) |
| **无损格式 (FLAC/WAV)** | ❌ 无 |
| **替代编码 (OGG/AAC/M4A)** | ❌ 无 |
| **原始上传文件** | ❌ 无法获取 (仅最终 MP3) |

**关于音频质量的结论：**

```
用户上传文件 (任意格式)
    → POST encode.koe-koe.com/file_receive.php
    → 处理: 可能转码为 MP3
    → file.koe-koe.com/sound/upload/{id}.mp3
    → 仅此一个版本, 无任何质量变体
```

上传表单只检测文件的 MIME type (`event.target.files[0].type`)，不限制上传格式。
但最终只保留一个 MP3 文件。**无法获取更高规格或原始文件。**

### 7.2 HTTP 特性 (Range / Resume / 多线程)

```http
# HEAD 请求 → 获取元数据
HEAD /sound/upload/761964.mp3
Host: file.koe-koe.com
→ HTTP/1.1 200 OK
  Server: nginx
  Content-Type: audio/mpeg
  Content-Length: 2304620
  Accept-Ranges: bytes
  ETag: "6a521104-232a6c"
  Last-Modified: Sat, 11 Jul 2026 09:46:44 GMT

# Range 请求 → 获取分片
GET /sound/upload/761964.mp3
Range: bytes=0-1023
→ HTTP/1.1 206 Partial Content
  Content-Range: bytes 0-1023/2304620
  Content-Length: 1024

# 完整请求
GET /sound/upload/761964.mp3
→ HTTP/1.1 200 OK
  Content-Length: 2304620

# 条件请求 (ETag)
If-None-Match: "6a521104-232a6c"
→ 200 OK (Nginx 默认)
```

| 能力 | 状态 | 证据 |
|------|------|------|
| **Range下载** | ✅ **完全支持** | `Accept-Ranges: bytes` + `206 Partial Content` |
| **断点续传 (Resume)** | ✅ 支持 | Range + Content-Range 即可实现 |
| **多线程下载** | ✅ **支持** | 可同时发起多个独立 Range 分片请求 |
| **HEAD请求** | ✅ 支持 | 返回完整元数据 (Content-Length, ETag, Type) |
| **条件请求 (If-None-Match)** | ✅ 可用 | ETag 已提供 |
| **条件请求 (If-Modified-Since)** | ✅ 可用 | Last-Modified 已提供 |
| **Cache-Control** | ❌ 未设置 | Nginx 默认行为 (可能由浏览器缓存) |

**多线程下载策略：**
```bash
# 四线程示例 (文件 ~2.3MB)
curl -H "Range: bytes=0-574999"   -o part1 "https://file.koe-koe.com/sound/upload/761964.mp3"
curl -H "Range: bytes=575000-1149999" -o part2 "https://file.koe-koe.com/sound/upload/761964.mp3"
curl -H "Range: bytes=1150000-1724999" -o part3 "https://file.koe-koe.com/sound/upload/761964.mp3"
curl -H "Range: bytes=1725000-"   -o part4 "https://file.koe-koe.com/sound/upload/761964.mp3"
# 合并: copy /b part1+part2+part3+part4 output.mp3
```

### 7.3 防盗链

| 措施 | 状态 | 验证过程 |
|------|------|----------|
| **Referer检测** | ❌ **无** | curl 不带/带正确/带错误 Referer 均返回 200 |
| **Origin检测** | ❌ 无 | 无 CORS 预检限制 |
| **Cookie** | ❌ **不要求** | 匿名请求即可完整下载 |
| **User-Agent检测** | ❌ 无 | curl + 默认 UA 成功 |
| **签名/Token** | ❌ 无 | URL 不含任何签名参数 |
| **IP限制** | ❌ 无 (推测) | 未验证但有 Range 请求即可确认 |
| **时间戳过期** | ❌ **无** | 文件持续可用 |

:bulb: **结论: 该音频 CDN 完全对外开放，无任何防盗链保护。**

### 7.4 图片资源

| 类型 | URL | CDN |
|------|-----|-----|
| 性别图标(女) | `/img/female3.png` | koe-koe.com (主域) |
| 性别图标(男) | `/img/male3.png` | koe-koe.com |
| 性别图标(情侣) | `/img/couple3.png` | koe-koe.com |
| Logo | `/img/koe-koe-logo.png` | koe-koe.com |
| Twitter分享图 | `/img/tw_thumb_l.png` | koe-koe.com |
| Favicon | `/img/favicon.ico` | koe-koe.com |

:bulb: 所有图片也在主域下，无独立 CDN。

### 7.5 媒体资源架构总图

```
                         上传 (POST multipart)
┌─────────────┐   ──────────────────────────►  ┌──────────────────┐
│   用户       │                                   │ encode.koe-koe.com │
│ (浏览器)     │                                   │ file_receive.php   │
└─────────────┘                                   │  (reCAPTCHA验证)   │
      │                                           └────────┬─────────┘
      │                                                     │
      │  下载 (GET / Range)                                 │ 写入
      │  ◄────────────────────────────                      │
      ▼                                                     ▼
┌──────────────────────┐                        ┌──────────────────────┐
│ file.koe-koe.com     │                        │ MySQL Database       │
│ Nginx 静态服务器      │                        │ - posts table        │
│ /sound/upload/{id}.mp3│                       │ - id, title, author  │
│                       │                        │ - genre, gender...   │
│ 特性:                 │                        └──────────────────────┘
│ - 仅MP3格式          │
│ - 无转码/无变体       │
│ - Range完全支持      │
│ - 无防盗链           │
│ - 无签名/过期        │
└──────────────────────┘
```

### 7.6 上传表单约束 (补充信息)

来自 `koe_post.php` 分析:

| 字段 | 约束 |
|------|------|
| 作者名 | 15字以内 |
| トリップ | 15字以内 |
| 标题 | **必需**, 30字以内 |
| 评论 | **必需**, 1000字以内 |
| 文件 | **必需**, 最大 12MB |
| 删除密码 | **必需**, 4~10位半角英数+至少1个英字 |
| 评论许可 | すべて / 管理人に任せる |
| reCAPTCHA | **Enterprise** (`6LdP3q0mAAAAAGcubttomg394Xesd4J8mcsKSHq8`) |
| 上传URL | `https://encode.koe-koe.com/file_receive.php` |

---

## 八、反爬分析

### 8.1 反爬措施总览

| 措施 | 存在? | 范围 | 等级 |
|------|-------|------|------|
| **reCAPTCHA Enterprise** | ✅ **仅上传页** | `koe_post.php` 提交时 | 中 |
| Cloudflare | ❌ | - | 无 |
| Turnstile | ❌ | - | 无 |
| JS Challenge | ❌ | - | 无 |
| 验证码 (图形) | ❌ | - | 无 |
| 频率限制 | ⚠️ 可能 | 服务器偶发超时 | 低 |
| Token鉴权 | ⚠️ 仅登录操作 | add_bookmark / koe_post | 低 |
| UA检测 | ❌ 无 | - | 无 |
| Referer检测 | ❌ 无 | CDN和主站均无 | 无 |
| Origin检测 | ❌ 无 | - | 无 |
| 签名算法 | ❌ 无 | - | 无 |
| 时间戳 | ❌ 仅防缓存 | xyz参数 | 无 |
| JS混淆 | ❌ 清晰代码 | - | 无 |
| 浏览器环境 | ❌ 不必要 | - | 无 |
| Cookie限制 | ❌ 无 | 页面均公开可读 | 无 |

### 8.2 详细分析

**reCAPTCHA Enterprise (唯一真正的反爬):**
```javascript
// Site Key: 6LdP3q0mAAAAAGcubttomg394Xesd4J8mcsKSHq8
// 仅在 koe_post.php 提交时触发

grecaptcha.enterprise.ready(async () => {
  const token = await grecaptcha.enterprise.execute(
    '6LdP3q0mAAAAAGcubttomg394Xesd4J8mcsKSHq8',
    {action: 'LOGIN'}
  );
  $('#recaptchaToken').val(token);
  // POST multipart/form-data to encode.koe-koe.com/file_receive.php
});
```
- 仅影响**上传操作**
- 不影响数据读取/搜索/下载
- Provider 不需要处理

**服务器连接问题:**
- 分析过程中多次遇到 `ERR_CONNECTION_TIMED_OUT`
- 可能是服务器性能有限或共享主机超卖
- **建议请求间隔 ≥ 1-2 秒**

**音频CDN防盗链:**
- `file.koe-koe.com` 经由 **curl 实测确认无任何防盗链**
- 无 Referer 验证
- 无 UA 验证
- 无 Cookie 验证
- 直接可下载

**登录保护:**
- 仅受密码保护
- 无失败次数限制 (推测)
- 无验证码
- 暴力破解风险较高

**防缓存方案:**
- `xyz={timestamp}` 参数用于打破缓存
- CSS/JS有 `?v=N` 版本号
- 非严格防爬, 仅保证数据实时性

**上传页面的额外保护:**
- reCAPTCHA Enterprise (唯一)
- 文件大小限制 (12MB)
- 密码强度要求
- 这些都不影响只读数据获取

### 8.3 代理友好度

```
┌──────────────────────────────────────────────────────────┐
│ 该网站对只读爬虫/自动化极其友好:                          │
│                                                          │
│  ✅ 无需浏览器渲染 (纯HTML SSR)                          │
│  ✅ 无需执行JavaScript                                   │
│  ✅ 无Cloudflare / Turnstile / JS Challenge              │
│  ✅ 无签名/Token校验                                     │
│  ✅ 无GraphQL/WebSocket                                  │
│  ✅ 音频URL无需额外认证可直接下载                         │
│  ✅ 音频支持Range/多线程/断点续传                        │
│  ✅ 数据在HTML中结构化, 易于解析                          │
│  ✅ 分页简单 (数字页码参数)                              │
│  ✅ 无显式Rate Limit                                     │
│  ✅ 可直接 curl 访问所有页面和音频                        │
│                                                          │
│  ⚠️ 服务器偶发超时 (需要重试机制, 1-2s间隔)             │
│  ⚠️ 需处理日本语内容 (日文时间格式等)                    │
│  ⚠️ 上传需处理reCAPTCHA (但Provider不需要上传功能)       │
└──────────────────────────────────────────────────────────┘
```

---

## 九、建议的 Provider 架构

### 9.1 目录结构

```
Provider/
├── API/
│   ├── client.ts          # HTTP客户端, Cookie持久化, 重试
│   ├── list.ts            # 列表页解析 (list.php, search.php)
│   ├── detail.ts          # 详情页解析 (detail.php)
│   ├── auth.ts            # 登录认证
│   └── live.ts            # 直播API
│
├── Parser/
│   ├── html.ts            # HTML解析工具
│   ├── list-parser.ts     # 列表项HTML→结构化数据
│   ├── detail-parser.ts   # 详情页HTML→结构化数据
│   └── user-parser.ts     # 用户搜索页解析
│
├── Downloader/
│   ├── audio.ts           # 音频文件下载
│   ├── thumbnail.ts       # 封面/图标下载
│   └── range.ts           # Range下载支持
│
├── Auth/
│   ├── login.ts           # 登录流程
│   ├── session.ts         # Session/Cookie管理
│   └── twitter.ts         # Twitter OAuth (可选)
│
├── Search/
│   ├── index.ts           # 搜索入口
│   ├── query.ts           # 查询参数构建
│   └── result.ts          # 搜索结果解析
│
└── Metadata/
    ├── index.ts           # 元数据入口
    ├── work.ts            # 作品数据模型
    ├── author.ts          # 作者数据模型
    └── normalize.ts       # 字段规范化/清洗
```

### 9.2 各层职责

#### API 层 (`API/`)
```
- 发起 HTTP 请求 (GET/POST)
- Session/Cookie 管理
- 请求重试 (服务器超时)
- 请求间隔控制 (~1-2s)
- User-Agent 设置
- Referer 设置
- URL 构建 (分页, 参数)
- 返回原始 HTML/JSON
```

#### Parser 层 (`Parser/`)
```
- 接收原始 HTML
- HTML → 结构化数据
- CSS选择器提取
- 正则提取 (tripcode, ID)
- 日期时间解析 (相对时间→绝对时间)
- 文本清洗 (HTML实体转义等)
- 返回内部数据模型
```

#### Downloader 层 (`Downloader/`)
```
- 音频文件下载
- 支持 Range 请求 (断点续传)
- 支持 HEAD 请求探测
- 重命名/保存逻辑
- 进度回调
- 错误处理/重试
```

#### Auth 层 (`Auth/`)
```
- 登录凭证管理
- CookieJar 维护 (PHPSESSID + login_token)
- 登录状态检测
- 自动重新登录
- Session 持久化 (文件/数据库)
```

#### Search 层 (`Search/`)
```
- 构建搜索参数
- 处理搜索分页
- 聚合搜索结果
- 作者作品查询
- 标签搜索
```

#### Metadata 层 (`Metadata/`)
```
- 数据模型定义 (TypeScript interface)
- 字段规范化 (时长→秒, 相对时间→绝对时间)
- 数据验证
- 数据关联 (作者→作品, 作品→评论)
```

### 9.3 请求流程图 (Provider)

```
Search/List Request
        │
        ▼
  API/client.ts
  ├── 构建URL (含分页参数)
  ├── GET request (带Cookie/UA/Referer)
  ├── 成功? → 返回HTML
  └── 失败? → 重试(指数退避)
        │
        ▼
  Parser/list-parser.ts
  ├── 提取作品列表项
  ├── 提取分页信息
  └── 返回 Work[]
        │
        ▼
  Metadata/work.ts
  └── 规范化输出

-+-+-+-+-+-+-+-+-+-+-+-+-+-+-

Detail Request
        │
        ▼
  API/client.ts → GET /detail.php?n={id}
        │
        ▼
  Parser/detail-parser.ts
  ├── 提取标题/作者/时长/音频URL
  ├── 提取点赞/播放/评论数
  ├── 提取标签/描述
  └── 返回 WorkDetail
        │
        ▼
  Metadata/work.ts
  └── 规范化输出

-+-+-+-+-+-+-+-+-+-+-+-+-+-+-

Auth Flow
        │
        ▼
  API/client.ts → GET /login.php (获取PHPSESSID)
        │
        ▼
  Auth/login.ts
  ├── POST id+pass → /login.php
  ├── 保存 login_token cookie
  └── 验证状态 (GET /mypage.php)
        │
        ▼
  Auth/session.ts
  ├── Cookie持久化
  ├── 自动附加到后续请求
  └── 过期检测+重新登录
```

### 9.4 关键设计决策

1. **不要浏览器渲染** - 纯HTML SSR, 直接HTTP请求即可
2. **JS不需要执行** - 点赞/评论等交互可以模拟POST
3. **双重Cookie** - PHPSESSID (会话) + login_token (持久)
4. **请求间隔** - 建议 1-2秒, 避免服务器超时
5. **重试机制** - 服务器偶发超时, 指数退避+3次重试
6. **相对时间解析** - 需要日文时间解析: "3分前", "1時間前", "2日前"
7. **音频URL构建** - 已知格式 `//file.koe-koe.com/sound/upload/{id}.mp3`
8. **分页上限** - 当前最大6700页, 但持续增长

---

## 十、附录

### 10.1 所有已知URL表格

| 页面 | URL | 类型 | 方法 | 参数 |
|------|-----|------|------|------|
| 首页 | `/` | 公开 | GET | - |
| 列表 | `/list.php` | 公开 | GET | g, g2, p |
| 详情 | `/detail.php` | 公开 | GET | n |
| 搜索 | `/search.php` | 公开 | GET | word, g, m, p |
| 自动播放 | `/auto_play.php` | 公开 | GET | word, g |
| 投稿者一覧 | `/post_users.php` | 公开 | GET | g |
| 分类一覧 | `/all_genre.php` | 公开 | GET | - |
| タグ一覧 | `/all_tag.php` | 公开 | GET | - |
| 注目タグ | `/notable_tag.php` | 公开 | GET | - |
| 月間アーカイブ | `/archive.php` | 公开 | GET | date, p |
| 月間注目 | `/month_notable.php` | 公开 | GET | month |
| ショート音声 | `/short_sound.html` | 公开 | GET | g |
| サイトマップ | `/sitemap.php` | 公开 | GET | - |
| ヘルプ | `/help2.php` | 公开 | GET | - |
| お問い合わせ | `/support.php` | 公开 | GET/POST | - |
| ログイン | `/login.php` | 公开 | GET/POST | op, id, pass |
| マイページ | `/mypage.php` | 登录 | GET | - |
| 投稿 | `/koe_post.php` | 登录 | GET/POST | multipart |
| リクエスト投稿 | `/req_post.php` | 登录 | GET/POST | - |
| コメント | `/koe_comment.php` | 公开 | POST | name, comment, no |
| いいね | `/btn2.php` | 公开 | POST | num, tbl, xyz, second |
| いいね数読込 | `/loaded2.php` | 公开 | POST | num, tbl, xyz |
| ブックマーク | `/add_bookmark.php` | 登录 | GET | n |
| 削除 | `/del_entry.php` | 公开 | POST | id, pass |
| タグ追加 | `/koe_tag.php` | 公开 | POST | id, word |
| NG設定 | `/ng_list_set.php` | 公开 | GET | - |
| ライブ一覧 | `/live_top.php` | 公开 | GET | - |
| BBS | `/bbs/` | 公开 | GET | - |
| ライブAPI | `//cdn2.live.koe-koe.com/api/live_list.json` | 公开 | GET | - |
| 予約API | `//cdn2.live.koe-koe.com/api/reserve_list.json` | 公开 | GET | - |

### 10.2 作品ID范围

- 当前最小ID: 约 1 (早期作品)
- 当前最大ID: 约 762,000+ (持续增长)
- 并非所有ID都存在 (可能有删除)
- ID对应文件: `/sound/upload/{id}.mp3`
- 删除的作品ID可能返回空页面或不存在

### 10.3 子分类映射

| g2 | 分类名 | 说明 |
|----|--------|------|
| 0 | すべて | 全部 |
| 1 | エロ声 | エロ声 |
| 2 | オナ声 | オナニー声 |
| 3 | その他 | 其他 |
| 4 | 体験談 | 体験談 |
| 5 | 私の秘密 | 私の秘密 |
| 6 | 通話 | 通話募集 |
| 10 | アーカイブ | 存档 |

### 10.4 性别映射

| g | 性别 | 文件图标 |
|---|------|----------|
| 1 | 女性 | `/img/female3.png` |
| 2 | 男性 | `/img/male3.png` |
| 3 | カップル | `/img/couple3.png` |

---

> 文档结束。根据此文档可以直接开发 Koe-Koe Provider，无需再次抓包。
