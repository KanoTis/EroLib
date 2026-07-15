# 媒体库元数据与 UI 修复

## Goal

修复本地媒体库的元数据展示与抓取质量问题，补齐封面/简介/原始链接链路，并把同步与下载任务拆成独立页面；下载落盘时把关键元数据写入音频 ID3，方便外部播放器识别。存量错误数据通过**单条「刷新元数据」**修复，不做全库自动 backfill。

## Background / Confirmed Facts

| # | 现象 | 代码证据 |
|---|------|----------|
| 1 | 前端看不到封面 | `LibraryPage` / `WorkDetailPage` 仅 `IconWave` 占位；`WorkPublic.coverPath` 有字段，无 cover 媒体路由（`app.ts` 仅 `/audio`） |
| 2 | 简介不完整 | DB/`WorkMetadata.description` 已有；Otobanana 取 `post.text`；Koe-koe `parseDetail` **未抓** description（逆向：`<div class="desc detail"><p>…</p></div>`） |
| 3 | Koe-koe 标题错误 | 例：真标题 `ビデオ通話で見られながらオナニーしてみた`，入库为站点宣传文案；`parseDetail` 用首个 `<h2>`/`<title>` 易误命中 |
| 4 | 媒体库无渠道筛选 | `GET /api/works?provider=` 与 `api.works({provider})` 已支持；`LibraryPage` 仅状态筛选 |
| 5 | 无 ID3 | 仅 `audio.*` + `meta.json` + 可选 `cover.*`；server 无 ID3 依赖 |
| 6 | 同步/任务同页 | 导航「同步 / 任务」→ `/jobs`；`JobsPage` 混排下载任务与同步记录 |
| 7 | **Koe-koe 无作品封面、无作者头像** | 逆向：仅性别图标 `/img/female3.png|male3.png|couple3.png`；无 thumbnail/avatar。现 `parseDetail` 误把性别图标当 `coverUrl` |

相关路径：Providers `apps/server/src/providers/*`；落盘 `jobs/runner.ts`；API `app.ts`；UI `LibraryPage`/`WorkDetailPage`/`JobsPage`/`App.tsx`；逆向 `docs/koe-koe-reverse-engineering.md`、`docs/otobanana_reverse_engineering.md`。

## Requirements

### R1. 封面可显示（仅真实封面）

- **有真实封面的渠道**（如 Otobanana `thumbnail_url` / 用户头像回退）：已下载后列表卡 + 详情显示封面图
- **Koe-koe**：**不抓、不存、不展示**性别图标当封面；`coverUrl`/`coverPath` 保持空；UI 用统一占位（可带 provider 标识）
- 无封面：保留占位，不 404 刷屏
- 新增 cover 媒体接口（仅当本地确有 cover 文件时 200）

### R2. 全渠道抓取简介

- **Koe-koe**：解析详情简介并入库
- **Otobanana**：继续 `post.text`；空则 `null`
- **Erovoice**：本任务不实现抓取，类型/落盘兼容
- 详情页已有 description 展示，抓到后可见

### R3. 修复 Koe-koe 标题

- 标题必须是作品标题，禁止站点 slogan / meta 描述
- 解析优先作品级节点（主内容 `h2`、`og:title` 等），避开已知宣传文案
- 单元测试覆盖用户报告类回归

### R4. 媒体库渠道筛选

- 筛选：全部 / otobanana / koekoe / erovoice
- 与 `q`、`status` 可组合
- 复用现有 `provider` query

### R5. 音频 ID3

下载成功后对音频写入至少：

| 字段 | 来源 |
|------|------|
| 标题 TIT2 | `meta.title` |
| 艺术家 TPE1 | `authorName` 或 `authorId` |
| 注释 COMM | `description`（可空） |
| 专辑/来源 | Provider 名 |
| 封面 APIC | 已下 **真实** cover（可空；Koe-koe 通常无） |
| 原始链接 | 稳定详情 URL（R5a） |

优先 **MP3 ID3v2**；非 MP3 尽力或跳过并记 log，不阻断下载成功。

#### R5a. 原始链接

稳定生成并写入 `meta.json` + ID3：

- koekoe: `https://koe-koe.com/detail.php?n={workId}`
- otobanana: `https://otobanana.com/general/cast/{workId}`（`/:floor()/cast/:id`）

### R6. 同步页与任务页分离

- 侧栏两个入口：同步、下载任务
- 同步页：手动同步 + `sync_runs`
- 任务页：`download_jobs`
- 旧 `/jobs` 重定向，避免死链

### R7. 单条刷新元数据（存量）

- 详情页「刷新元数据」
- 行为：`getWork` 重拉 title/description/author/coverUrl（**Koe-koe 不产生假封面**）；有真实 cover 时可选重下；更新 DB + `meta.json`；若本地音频存在则重写 ID3
- **默认不重下音频**（除非音频缺失）
- 仅 `downloaded`（及可选 `failed` 但已有媒体）可用；进行中任务禁用或排队

## Acceptance Criteria

- [ ] 有真实封面的已下载作品（Otobanana 等）：列表 + 详情显示封面；Koe-koe / 无封面作品稳定占位，不显示站点性别图标当封面
- [ ] Koe-koe 新下载：站点有简介则 `description` 非空；Otobanana 不回退
- [ ] Koe-koe 标题：用户类错误（宣传文案）不再当 title；正确标题入库；测试覆盖
- [ ] 媒体库可按渠道筛选，可与 q/status 组合
- [ ] 新下载 MP3 可用外部工具读出：标题、作者、简介（若有）、原始链接、封面（若有）
- [ ] 侧栏独立「同步」「下载任务」；数据不混在同一主列表
- [ ] 详情页「刷新元数据」可修正单条存量 title/description/封面/ID3，且不强制重下音频

## Out of Scope

- Erovoice 抓取实现
- 全库批量 backfill 任务
- 音频转码
- 远端写回 / 双向同步
- 非 MP3 全格式标签完备性
- 将 Koe-koe 性别图标当作作品封面或作者头像下载/展示
- 为 Koe-koe 伪造 AI/本地生成封面

## Decisions

| # | 决策 | 结论 |
|---|------|------|
| 1 | 存量修复 | 单条「刷新元数据」，不做全库 backfill |
| 2 | 原始链接 | provider 规则生成，不依赖瞬时 CDN |
| 3 | ID3 范围 | 优先 MP3；其他格式 best-effort |
| 4 | Otobanana 公开页 | `/general/cast/{id}` |
| 5 | Koe-koe 封面 | 站点无真实封面/头像；**不**用性别图标冒充；UI 占位 |

## Notes

- 任务：`.trellis/tasks/07-15-media-metadata-ui-fixes/`
- 需 `design.md` + `implement.md`；审完再实现
