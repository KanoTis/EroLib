# 媒体库元数据与 UI 修复

## Goal

修复本地媒体库的元数据展示与抓取质量问题，补齐封面/简介/原始链接链路，并把同步与下载任务拆成独立页面；下载落盘时把关键元数据写入音频 ID3，方便外部播放器识别。

## Background / Confirmed Facts

来自当前代码与用户反馈（非假设）：

| # | 现象 | 代码证据 |
|---|------|----------|
| 1 | 前端看不到封面 | `LibraryPage.tsx` / `WorkDetailPage.tsx` 仅渲染 `IconWave` 占位；`WorkPublic.coverPath` 已有字段，但无 `/api/works/.../cover` 路由（`app.ts` 仅有 `/audio`） |
| 2 | 简介不完整 | `WorkMetadata.description` 与 DB `works.description` 已存在；Otobanana `castToMeta` 取 `post.text`；Koe-koe `parseDetail` **未抓 description**（逆向文档：`<div class="desc detail"><p>{description}</p></div>`） |
| 3 | Koe-koe 标题错误 | 用户例：网站标题 `ビデオ通話で見られながらオナニーしてみた`，实际入库为站点宣传文案；`parseDetail` 用首个 `<h2>` / `<title>`，易命中非作品标题 |
| 4 | 媒体库缺渠道筛选 | `GET /api/works?provider=` 与 `api.works({ provider })` 已支持；`LibraryPage` 仅有状态筛选 UI |
| 5 | 无 ID3 写入 | 下载只写 `audio.<ext>` + `meta.json` + 可选 `cover.*`；`@erolib/server` 无 ID3 依赖 |
| 6 | 同步/任务同页 | 导航 `同步 / 任务` → `/jobs`；`JobsPage` 同时展示下载任务与同步记录 |

相关路径：

- Providers: `apps/server/src/providers/{koekoe,otobanana}.ts`
- Job 落盘: `apps/server/src/jobs/runner.ts`（下载后写 `title`/`description`/`coverRelPath`）
- API: `apps/server/src/app.ts`
- UI: `apps/web/src/pages/{LibraryPage,WorkDetailPage,JobsPage}.tsx`, `App.tsx`
- 逆向: `docs/koe-koe-reverse-engineering.md`（title=`h2`，description=`.desc.detail`）

## Requirements

### R1. 封面可显示

- 已下载且存在封面文件时，媒体库卡片与作品详情显示真实封面图
- 无封面时保留现有占位图
- 新增封面媒体接口（鉴权与 audio 一致），前端用其渲染 `<img>`

### R2. 全渠道抓取简介

- Koe-koe：从详情页抓取作品简介（`.desc.detail` 等稳定选择器）并入库
- Otobanana：继续使用 `post.text`；若为空保持 `null`
- Erovoice：MVP-2，本任务不实现抓取，但类型/落盘路径保持兼容
- 详情页已有 `work.description` 展示，抓到后应可见

### R3. 修复 Koe-koe 标题解析

- 作品标题必须是详情页的作品标题，不得把站点 slogan / meta 描述当标题
- 解析优先级应偏向作品级节点（如主内容区 `h2`、`og:title` 等），并覆盖用户报告样例类 HTML
- 解析结果有单元测试（含「错误命中站点宣传文案」回归）

### R4. 媒体库渠道筛选

- 媒体库增加 Provider 筛选（全部 / otobanana / koekoe / erovoice）
- 与现有标题搜索、状态筛选可组合
- 走已有 `provider` query，不另造筛选语义

### R5. 音频 ID3 元数据

下载成功提交到 `/media` 前（或提交后立刻），向音频文件写入至少：

| 字段 | 内容来源 |
|------|----------|
| 标题 (TIT2) | `meta.title` |
| 艺术家/作者 (TPE1) | `meta.authorName` 或 `authorId` |
| 简介/注释 (COMM) | `meta.description`（可空） |
| 专辑/来源信息 | Provider 名 + 原始链接 |
| 封面 (APIC) | 已下载的 cover 文件（可空） |
| 原始链接 | 稳定详情 URL（见 R5a） |

#### R5a. 原始链接

- 由 provider + workId 稳定生成（不依赖瞬时 CDN）：
  - koekoe: `https://koe-koe.com/detail.php?n={workId}`
  - otobanana: 官方作品页 URL（按现有逆向约定；若仅有 API id，用可点击的公开页）
- 写入 ID3（如 `WOAS`/`WXXX` 或 COMM 中的 `source_url=` 兜底）并保留在 `meta.json`

### R6. 同步页与任务页分离

- 导航拆为两个入口：例如「同步」与「下载任务」（文案可微调）
- 同步页：手动触发同步、同步历史 `sync_runs`
- 任务页：下载队列 `download_jobs` 进度/失败信息
- 旧 `/jobs` 可重定向到其中一个，避免死链

## Acceptance Criteria

- [ ] 已下载且有封面的作品：列表卡 + 详情页显示封面图；无封面时占位图
- [ ] Koe-koe 新下载作品 `description` 非空（站点有简介时）；Otobanana 行为不回退
- [ ] Koe-koe 标题解析用例：用户类错误（站点宣传文案）不再被当作 title；正确标题入库
- [ ] 媒体库可按渠道筛选，并与 q/status 组合生效
- [ ] 新下载音频可用外部工具读出 ID3：标题、作者、简介（若有）、原始链接、封面（若有）
- [ ] 侧栏有独立「同步」与「下载任务」页面；两页数据互不混在同一主列表

## Out of Scope

- Erovoice 抓取实现（仍属 MVP-2）
- 音频转码 / 非 MP3 的复杂标签方案（优先 MP3 ID3v2；其他格式尽力或跳过并记录）
- 远端写回、双向同步
- 大规模历史库自动全量重下（除非用户明确要求 backfill）

## Open Questions

1. **已下载历史数据**：错误标题/缺简介/无 ID3 的存量作品如何处理？
   - 推荐：提供「重新抓取元数据 / 重试下载」路径修复单条；本任务不做全库自动 backfill 批处理。

## Notes

- 任务目录：`.trellis/tasks/07-15-media-metadata-ui-fixes/`
- 复杂度：跨 provider 解析、API、前端路由与二进制标签 → 需要 `design.md` + `implement.md`
- 状态应保持 **planning**，待产物审完再 `task.py start` 实现
