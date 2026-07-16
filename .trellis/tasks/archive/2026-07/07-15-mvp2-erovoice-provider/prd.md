# Erovoice MVP-2 Provider

## Goal

把 Erovoice 从 stub 做成可用 Provider：绑定账号 → 同步收藏 → HLS/AES 下载并转码落盘为 `audio.mp3` → 本地库浏览与播放。行为与 Otobanana / Koe-koe（MVP-1）对齐。

## Background

### 产品约束（继承自托管媒体服务器）

- Docker 自托管；浏览器唯一客户端
- 模型：收藏备份 + 本地媒体库（非在线逛站）
- 同步：单向增量；远端取消收藏不删本地；不回写远端
- 播放：仅 `downloaded` 且文件可用后可播
- 凭证：Web 配置账密和/或 Cookie；`CREDENTIALS_SECRET` 加密 at rest
- 存储：`/media/erovoice/{authorId|_unknown}/{workId}/` 下 `meta.json` + 可选 `cover.*` + `audio.mp3`

### 仓库现状（已确认）

| 位置 | 状态 |
|------|------|
| `ProviderId` / 注册表 | 已含 `erovoice` |
| `apps/server/src/providers/erovoice.ts` | stub，全部 throw |
| `POST /api/providers` | `provider===erovoice` → 400 |
| sync runner | 跳过 `erovoice` 账号 |
| UI Providers 页 | Erovoice option disabled |
| 逆向文档 | `docs/erovoice-ch.com-逆向分析报告.md` |
| Docker runtime | `node:22-bookworm-slim`，**未装 ffmpeg** |
| ID3 打标 | 仅 `.mp3`（`apps/server/src/media/id3.ts`）— 与本 MVP 输出一致 |
| 播放 Content-Type | `mp3`→`audio/mpeg`（已支持） |

### Erovoice 技术事实（逆向文档）

| 项 | 事实 |
|----|------|
| 认证 | WP 账密 `wp-login.php` → `PHPSESSID` + `wordpress_logged_in_*`；或导入 Cookie |
| 会话检测 | `loginCheckAjax` / `getUserInfo` |
| 收藏列表 | `POST admin-ajax.php` action=`getSQLDataBookmarkPostData`，`items`/`start`/`userID` 分页 |
| 作品元数据 | 详情页 SSR HTML 解析 |
| 媒体 | HLS VOD：`getm3u8URL` / `getm3u8file_origints.php` → AES-128 TS + `keygen.php` |
| 加密 | AES-128；playlist 样例 `IV=0x0`；预签名 TS ~86 分钟过期 |
| 质量 | 平台仅 ~75 Kbps AAC 单一档位；无原始上传文件 |
| 防护 | Cookie + Origin/Referer；无 Turnstile |
| 直播 | 存在 live 代理 → **本 MVP 不做** |

### 相关材料

- `.trellis/tasks/archive/2026-07/07-15-self-hosted-audio-media-server/{prd,design,implement}.md`
- `docs/erovoice-ch.com-逆向分析报告.md`
- `apps/server/src/providers/{otobanana,koekoe,erovoice}.ts`、`download-utils.ts`、`jobs/runner.ts`

## Requirements

### R1. Provider 契约

实现既有 `Provider` 接口：`login` / `isSessionValid` / `listFavorites` / `getWork` / `download`，`id = "erovoice"`。  
库表、Job runner、media 提交、播放 API **不分叉**；仅移除 erovoice 专用 gate。

### R2. 认证

- `password`：服务端 `POST wp-login.php` 代登，合并 Set-Cookie
- `cookie`：粘贴 Cookie header；校验有效后持久化 session
- `isSessionValid`：`loginCheckAjax` 或 `getUserInfo` 判定已登录
- Cookie 过期：账号标记 error（与 Koe-koe 同类）
- 不做 X/Twitter OAuth

### R3. 收藏同步

- `listFavorites` 分页 `getSQLDataBookmarkPostData` 直至耗尽
- `RemoteWorkRef.workId` = postID 稳定字符串；`authorId` 优先 author slug，可 null
- 对接现有 runner：新作品入队；远端缺失 → `remote_in_favorites=false`，不删盘

### R4. 元数据

- `getWork` 解析详情页：title、author、cover、description、tags、duration、sourceUrl
- 实际下载不依赖直链音频；`audioUrl` 可填 PHP 代理 URL 作标识
- 封面可下载到 cache 再提交

### R5. HLS/AES 下载 → MP3

`download` 内完成：

1. 带 Cookie + Origin 取 m3u8（优先 `getm3u8file_origints.php?id=`；存档可回退 `getm3u8file_archive.php`）
2. 取 AES-128 key（playlist KEY URI / `keygen.php`）
3. 解析全部 `.ts` URL；限并发下载到 cache
4. 按 HLS 规范 AES-128-CBC 解密（IV 以 playlist 为准；缺省序列号规则）
5. 合并解密分片，**ffmpeg 转码为 `audio.mp3`**
6. 可选 cover；返回 `DownloadResult`（`audioExt: "mp3"`）
7. 直播 / 无 VOD playlist：明确失败，不拖垮其它 job
8. 预签名 403/过期：重新拉 m3u8 后重试失败分片（单次 download 内）

转码后由现有 runner 的 ID3 打标路径处理（soft-fail）。

### R6. 解锁产品入口

- 移除 API `erovoice` 400 stub
- runner 不再 skip `erovoice`
- Providers UI 启用 Erovoice
- `implemented` 对 erovoice 为 true

### R7. 运维 / 部署

- Docker runtime **安装 ffmpeg**（`apt` 或等价）
- README 注明 Erovoice 下载依赖 ffmpeg；本地 dev 需本机 ffmpeg 在 PATH
- 日志禁止完整 cookie/密码
- 出站：合理 UA + Origin/Referer；AJAX 带 `X-Requested-With`

## Acceptance Criteria

- [ ] 可为 Erovoice 配置账密和/或 Cookie；凭证加密；测登录成功
- [ ] 手动/定时同步可拉 Erovoice 收藏；缺失作品入下载队列
- [ ] 下载完成后落盘 `/media/erovoice/{authorId|_unknown}/{workId}/`：`meta.json` + `audio.mp3` + 可选 cover
- [ ] 浏览器可播放已下载 Erovoice 音频（Range / `audio/mpeg`）
- [ ] 远端取消收藏后本地仍在，且可标「远端已不在收藏」
- [ ] 删除 Provider 绑定不删已下载媒体
- [ ] 直播或无法取得 VOD m3u8 时 job 失败且错误可读，不阻塞其它任务
- [ ] Docker 镜像内含 ffmpeg，可完成上述链路
- [ ] Otobanana / Koe-koe 无回归：`pnpm typecheck` + `pnpm test` 通过

## Out of Scope

- 直播备份、边下边播、远端流式
- 搜索 / 逛站 / 关注列表备份
- 评论、点赞、收藏写回
- 双向同步 / 多用户
- 平台不提供的原始高码率上传文件
- Redis / 独立 worker 集群
- 新 Provider（非 erovoice）

## Decisions Log

| # | 决策 | 结论 |
|---|------|------|
| 1 | 范围 | 仅 Erovoice Provider + 解锁 gate；产品规则同 MVP-1 |
| 2 | 直播 | 不做；失败/跳过并记错 |
| 3 | 媒体质量 | 接受平台 ~75kbps AAC HLS |
| 4 | 输出格式 | **`audio.mp3`（ffmpeg 转码）**，便于 ID3 + 现有播放 |
| 5 | Docker | runtime 安装 ffmpeg |
