# 自托管音声媒体服务器

## Goal

构建一套 **Docker 自托管** 的音声备份与本地媒体库：对接 Otobanana / Koe-koe / Erovoice，**以各平台收藏夹备份为核心目标**——同步用户在各站的收藏/书签，将音频与元数据完整落盘到本地库，并在浏览器中浏览、检索、播放本地内容。所有服务端能力跑在容器内，**浏览器是唯一客户端**。

## Background

### 产品约束

- 自托管；部署形态：Docker
- 客户端：仅浏览器
- 产品模型：**本地下载媒体库**，主目标是各平台收藏夹备份（非在线逛站）
- 仓库现状：绿场；仅有 Trellis 脚手架 + 三份 Provider 逆向文档

### Provider 技术事实（`docs/` 逆向）

| Provider | 站点形态 | 认证 | 媒体获取 | 难度 |
|----------|----------|------|----------|------|
| **Otobanana** | REST API (`api.v2.otobanana.com`) | JWT（裸 token）+ session | 直链音频，支持 Range | 低 |
| **Koe-koe** | PHP SSR HTML | `PHPSESSID` + `login_token` | 直链 MP3，无防盗链 | 中 |
| **Erovoice** | WordPress SSR + admin-ajax | WP Cookie | HLS + AES-128 TS + 预签名 URL | 高 |

### 各站收藏源

| Provider | 列表来源 | 认证 |
|----------|----------|------|
| Otobanana | `GET /api/casts/likes` | JWT |
| Koe-koe | `GET /mypage.php` 书签 | Cookie |
| Erovoice | `getSQLDataBookmarkPostData` | WP Cookie |

### 相关材料

- `docs/otobanana_reverse_engineering.md`
- `docs/koe-koe-reverse-engineering.md`
- `docs/erovoice-ch.com-逆向分析报告.md`

## Requirements

### R1. 产品模型

- 定位：**收藏备份 + 本地媒体库**
- 主路径：绑定各站账号 → 拉收藏列表 → 下载音频与元数据 → 本地库播放/管理
- 在线浏览/试听非 MVP 主价值

### R2. 收藏同步

- **单向增量**：远端收藏 → 本地；缺失项入下载队列
- **远端取消收藏 ≠ 删本地文件**；可标记「远端已不在收藏」，清理需用户显式操作
- **不回写远端**
- **默认每 4 小时**全量对账；支持手动「立即同步」
- 按已启用 Provider 分别跑；失败可重试，不阻断其他 Provider

### R3. 本机鉴权

- **单用户**；无多租户
- Admin 密码由环境变量注入（`AUTH_USERNAME` / `AUTH_PASSWORD`）
- 未配置密码时允许无鉴权启动；文档警告勿直接暴露公网

### R4. MVP 范围

- **MVP-1**：Otobanana + Koe-koe
  1. Provider 账号配置（Web，凭证存服务端）
  2. 收藏同步（手动 + 默认 4h）
  3. 下载队列（元数据 + 封面 + 音频）
  4. 本地库列表 / 详情 / 搜索
  5. 浏览器播放**已下载**音频
  6. Docker Compose 一键启动
- **MVP-2**：Erovoice（HLS+AES），复用同一 Provider 接口
- 第一天定义统一 `Provider` 插件接口

### R5. 播放

- **仅下载完成且校验可用后**可播
- 无边下边播、无远端直链流式播放

### R6. Provider 凭证

- Web UI 配置；服务端 DB 持久化；定时同步无人值守
- 两种登录方式：
  1. **账密** → 服务端代登，维护会话/JWT
  2. **Cookie** → 粘贴/导入；过期提示更新或改账密
- `CREDENTIALS_SECRET` 对称加密 at rest
- 启用/禁用、更新、删除绑定；**删绑定不删已下载文件**
- 不做 OAuth 跳转流

### R7. 技术栈

- TypeScript monorepo
- API：Hono
- DB：Drizzle + SQLite
- 前端：React + Vite + 轻量播放器
- 任务：进程内 job + SQLite 状态（无 Redis）
- 部署：Docker Compose 单 `app` 容器（API 托管静态前端）

### R8. 存储布局

三分路径（均可环境变量覆盖）：

| 路径 | 环境变量 | 内容 | 可清空 |
|------|----------|------|--------|
| `/data` | `DATA_DIR` | `app.db` 等 | 否 |
| `/media` | `MEDIA_DIR` | 已完成备份 | 否 |
| `/cache` | `CACHE_DIR` | 下载临时、分片、未完成任务 | 是 |

落盘约定：

```text
/data/app.db

/media/{provider}/{authorId}/{workId}/
  meta.json
  cover.jpg          # 可选
  audio.<ext>        # 原样保存；MVP-1 不转码

/cache/downloads/{jobId}/
/cache/tmp/
```

- `provider` / `authorId` / `workId` 使用**稳定 ID**（非标题）；标题仅在 DB/`meta.json`
- `authorId` 缺失时使用保留值 `_unknown`
- 下载成功并校验后，从 `cache` 原子写入 `media`
- 同步永不因远端取消收藏而删 `media`
- 启动可清理过期 cache

## Acceptance Criteria

### MVP-1

- [ ] `docker compose up` 后浏览器可打开 Web UI
- [ ] 可配置 `AUTH_*` 后要求登录；未配置时可无鉴权访问
- [ ] 可为 Otobanana、Koe-koe 分别配置账密和/或 Cookie，凭证加密存储
- [ ] 手动同步与默认 4h 定时同步均可拉取收藏列表
- [ ] 收藏中缺失作品进入下载队列，完成后落盘到 `/media/{provider}/{authorId}/{workId}/`
- [ ] 远端取消收藏后本地文件仍在，且可被标记为「远端已不在收藏」
- [ ] 本地库可列表、详情、按标题/作者搜索
- [ ] 仅 `downloaded` 状态作品可在浏览器播放
- [ ] 删除 Provider 绑定不删除已下载媒体
- [ ] 数据落在 `DATA_DIR` / `MEDIA_DIR` / `CACHE_DIR` 可挂载 volume

### MVP-2（后续）

- [ ] Erovoice Provider：收藏同步 + HLS/AES 下载 + 本地播放，行为与 MVP-1 一致

## Out of Scope（MVP-1）

- Erovoice 实现（MVP-2）
- 直播、评论、点赞等互动写回
- 双向同步 / 远端 unbookmark
- 多用户 / 多租户
- 在线逛站、跨站推荐、边下边播、远端流式播放
- 音频转码、Redis、独立 worker 集群
- OAuth 浏览器跳转登录

## Decisions Log

| # | 决策 | 结论 |
|---|------|------|
| 1 | 产品模型 | 本地库 + 收藏备份 |
| 2 | 同步 | 单向增量；默认 4h；远端取消不删盘；不回写 |
| 3 | 鉴权 | 单用户；环境变量密码；可选无鉴权 |
| 4 | MVP | 两阶段；MVP-1=Otobanana+Koe-koe |
| 5 | 播放 | 仅下载完成后 |
| 6 | 凭证 | Web 录入；账密+Cookie；服务端加密 |
| 7 | 技术栈 | Hono + Drizzle + SQLite + React/Vite |
| 8 | 存储 | data/media/cache；`/media/{provider}/{authorId}/{workId}/` |

## Notes

- 任务目录：`.trellis/tasks/07-15-self-hosted-audio-media-server/`
- 状态保持 **planning**，直至 `design.md` + `implement.md` 审完且用户批准后再进入实现
