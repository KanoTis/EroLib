# Design: Erovoice MVP-2 Provider

## 1. Overview

在现有 Provider 插件位上实现 `erovoice`：WordPress Cookie 会话 + 收藏 AJAX + HLS AES 下载，ffmpeg 转码为 `audio.mp3` 后走统一 commit/play 路径。

```text
Web UI / Jobs
    │
    ▼
Provider erovoice
  login / isSessionValid ──► wp-login.php + loginCheckAjax
  listFavorites ───────────► admin-ajax getSQLDataBookmarkPostData
  getWork ─────────────────► SSR detail HTML parse
  download ────────────────► m3u8 → ts → AES-128 → concat → ffmpeg → audio.mp3
    │
    ▼
runner: ID3 (mp3) → commitCacheToMedia → /media/erovoice/...
```

## 2. Boundaries

| 模块 | 职责 | 非职责 |
|------|------|--------|
| `providers/erovoice.ts` | 登录、会话、收藏、元数据、HLS 下载编排 | 不写 DB / 不改 media 布局策略 |
| `providers/hls-download.ts`（新建，可同文件内聚） | m3u8 解析、分片下载、AES-128-CBC 解密、合并 | 不知 erovoice 业务字段 |
| `providers/ffmpeg.ts`（新建） | 探测 ffmpeg、TS/ES → mp3 | 不碰网络 |
| `jobs/runner.ts` | 去掉 erovoice skip | 不实现站点协议 |
| `app.ts` / `ProvidersPage` | 去掉 stub gate / 启用 UI | — |
| `Dockerfile` | runtime 装 ffmpeg | — |

不新增表、不改 API 形状（除删除 400）。

## 3. Auth & Session

### login

**password**

1. `POST https://erovoice-ch.com/wp-login.php`  
   `application/x-www-form-urlencoded`: `log`, `pwd`, `rememberme=forever`, `wp-submit=ログイン`, `redirect_to=...`
2. `redirect: manual`，合并 `Set-Cookie`（`PHPSESSID`、`wordpress_logged_in_*` 等）
3. 用得到的 Cookie 调 `loginCheckAjax`；失败则 throw 可读错误

**cookie**

1. 规范化用户粘贴的 Cookie header
2. 同上 `loginCheckAjax` 校验

### Session.data

```ts
{
  cookieHeader: string;
  userId?: string;      // 数字字符串
  userName?: string;
}
```

### isSessionValid

`POST admin-ajax.php` `action=loginCheckAjax`（或 `getUserInfo`）：  
`status` 为 `logined` / `success` 且含 `userID` → true。

### 请求头约定

```text
User-Agent: DEFAULT_UA
Origin: https://erovoice-ch.com
Referer: https://erovoice-ch.com/
Cookie: <cookieHeader>
X-Requested-With: XMLHttpRequest   # admin-ajax
```

## 4. Favorites

```text
POST /wp-admin/admin-ajax.php  multipart/form-data
  action=getSQLDataBookmarkPostData
  items=50
  start=N
  userID=<session.userId>
```

- 响应形态以实测为准：常见为 HTML 片段或 JSON 包 HTML；**解析策略**：
  1. 若 JSON：取 `html` / `data` / 字符串字段
  2. 从 HTML 提取 `data-postid`、`/ero-voice|ero-asmr|moe-asmr/{id}.html`、作者链接
- `start` 步进 `items`；当页 0 新 ID 或空 HTML 则停；硬上限页数（如 200）防死循环
- `RemoteWorkRef`：`provider: erovoice`，`workId: String(postId)`，`authorId` 从卡片作者 slug 尽量填

若 bookmark API 返回结构与文档偏差：以 `loginCheckAjax` 已登录为前提，在实现阶段用真实响应收紧解析（单测用 fixture HTML）。

## 5. getWork

1. 详情 URL 候选：  
   `https://erovoice-ch.com/ero-voice/{id}.html`  
   及 `ero-asmr` / `moe-asmr`（若 404 则试下一路径；或从收藏卡片保留 category）
2. SSR HTML 解析字段：title、description、author slug/name、cover、tags、duration、sourceUrl
3. `WorkMetadata.audioUrl` =  
   `https://erovoice-ch.com/wp-content/themes/erovoice-ch/libs/getm3u8file_origints.php?id={id}`  
   （标识用；download 仍走完整流水线）
4. `extra` 可存 `m3u8Path`、`category` 等 opaque

## 6. download 流水线

```text
cacheDir/
  segments/0000.ts.enc ...
  segments/0000.ts     (decrypted)
  stream.ts            (concat)
  audio.mp3            (ffmpeg)
  cover.jpg? 
```

### 6.1 Playlist

1. `GET getm3u8file_origints.php?id={postID}`（Cookie + Origin）  
2. 若失败/空：试 `getm3u8file_archive.php`  
3. 若仍失败：可先 `getm3u8URL` 再对路径请求（文档路径）  
4. 检测 live 特征（`getm3u8file_live`、无 `EXT-X-ENDLIST`、playlist type 异常）→ throw `Live stream not supported`

### 6.2 Key & IV

- 解析 `#EXT-X-KEY:METHOD=AES-128,URI="...",IV=0x...`
- `METHOD=NONE`：跳过解密
- 其它 METHOD：throw
- URI 相对路径 → 绝对 URL；带 Cookie 拉 **16 字节** key
- IV：playlist 有则用；否则 HLS 默认 = media sequence 编号 16 字节 big-endian（实现按 RFC8216；文档样例 IV=0 时固定全零）

### 6.3 Segments

- 解析 `#EXTINF` 后的 URI（绝对预签名 URL）
- 并发默认 3–4；写盘 `segments/{index:04d}.enc`
- 失败：最多 2 次重试；若 403/签名过期 → **整表重新拉 m3u8** 一次后重试该片
- `onProgress`：`bytesReceived/bytesTotal` 按已完成分片估算；`phase`: `hls` | `decrypt` | `transcode`

### 6.4 Decrypt

- Node `crypto.createDecipheriv('aes-128-cbc', key, iv)`  
- PKCS#7 unpad（AES-CBC 标准）
- 输出 `segments/{index:04d}.ts`

### 6.5 Concat + ffmpeg

- 二进制顺序拼接为 `stream.ts`（或 ffmpeg concat demuxer 列表）
- `ffmpeg -y -i stream.ts -vn -acodec libmp3lame -q:a 2 audio.mp3`  
  （源 ~75kbps；VBR 质量档足够；若 lame 缺失则 `-c:a libmp3lame` 失败时回退文档化）
- 校验 `audio.mp3` size > 0
- `sha256` 对最终 mp3 计算
- 清理中间文件可选（cache job 目录本就会随生命周期清理）

### 6.6 ffmpeg 探测

```ts
// providers/ffmpeg.ts
export async function ensureFfmpeg(): Promise<string> // path or "ffmpeg"
export async function transcodeToMp3(input: string, output: string): Promise<void>
```

- 启动时或首次 download 时 `ffmpeg -version`；失败 → 明确错误：`ffmpeg not found; required for Erovoice downloads`
- Docker 保证存在；本地 dev 依赖 PATH

### 6.7 Cover

同其它 Provider：`fetchToFile` cover URL，失败忽略。

## 7. Gate removals

| 文件 | 改动 |
|------|------|
| `apps/server/src/app.ts` | 删除 erovoice 400；`implemented: true` 对全部或 `id !== ...` 逻辑改为查 provider 是否真实实现 |
| `apps/server/src/jobs/runner.ts` | 删除 `if (account.provider === "erovoice") continue` |
| `apps/web/src/pages/ProvidersPage.tsx` | 去掉 disabled / MVP-2 文案 |
| `README.md` | 去掉 stub 描述；注明 ffmpeg |

## 8. Error model

| 场景 | 行为 |
|------|------|
| 登录失败 | throw → account status error |
| Cookie 过期 | isSessionValid false → runner 标 error |
| 收藏页解析 0 且首页 | 空收藏合法；非错误 |
| 无 VOD m3u8 / 直播 | job failed，message 明确 |
| 分片/解密失败 | job failed，可重试 |
| ffmpeg 缺失/失败 | job failed，message 含 ffmpeg |

## 9. Testing strategy

| 层 | 内容 |
|----|------|
| 单测 | m3u8 解析（KEY/IV/segments）、AES 解密向量（固定 key/iv/密文 fixture）、HTML 卡片/详情解析 fixture |
| 集成（可选） | 有真实 Cookie 时手工 sync；不把真实密钥提交仓库 |
| 回归 | 现有 `crypto-paths` / `id3` / `koekoe-parse` + typecheck |

不强制 e2e 打真站（CI 无凭证）。

## 10. Security

- 不 log Cookie / 预签名 query 全串（可 log host + path）
- 出站仅 erovoice 域 + DO Spaces 预签名 host
- ffmpeg 仅本地文件参数，禁止拼接未校验 URL 进 shell（用 `spawn` 参数数组）

## 11. Trade-offs

| 选择 | 收益 | 代价 |
|------|------|------|
| 转码 mp3 | ID3 + 统一播放 | CPU；再损质量（源已低码率） |
| Node 解密 + ffmpeg | 可控依赖 | 实现量 > 纯 ffmpeg 读加密 HLS（加密 HLS 需自定义 demux） |
| 进程内并发分片 | 快 | 注意内存：流式写盘，不整包 buffer 全曲 |
| 单文件 erovoice + 小 util | 改动面小 | erovoice.ts 可能偏长 — 可拆 hls/ffmpeg 模块 |

## 12. Rollback

- 代码回滚：恢复 stub + gate 即可；已落盘 media 保留
- Docker：旧镜像无 ffmpeg 时 erovoice 下载失败但不影响其它 Provider
