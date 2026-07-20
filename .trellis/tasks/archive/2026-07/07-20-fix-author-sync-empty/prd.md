# 修复订阅作者 listAuthorWorks 空结果

## Problem

开启「同步作品」并执行全量同步后：`lastCheckAt` 更新、无 `lastError`、下载队列不变。  
实测为 **listAuthorWorks 静默返回空列表**，非开关/入队链路故障。

## Root cause (verified)

| Provider | Bug | Evidence |
|----------|-----|----------|
| **otobanana** | `GET /api/users/{id}/casts` 未带 `is_adult`；成人作者默认空 | 同作者 `is_adult=true` 有数据；无参/`false` 为空 |
| **koekoe** | `search.php` 用完整 trip 身份作 `word` 且无性别 `g`；`m=1` 无 `g` 时 0 结果 | `word=黒猫&m=1&g=1|2` 有结果；完整 `黒猫◆/...` 无结果 |

## Goals

1. Otobanana 作者作品列表覆盖成人/非成人（双 `is_adult` 或等价策略），分页完整。
2. Koekoe 用可搜索的作者基名 + 性别维度拉取，并按订阅身份过滤，避免同名串作。
3. 全量同步对 `syncWorks=true` 的作者能发现未入库作品并入队（已下载仍不重复入队）。

## Non-goals

- 不改 UI / 订阅开关语义
- 不改 `remoteInFavorites` 作者路径契约
- 不修 erovoice（本轮未复现同类空列表）
- 不把「空列表」改成 error（空作者合法；修查询即可）

## Acceptance criteria

- [ ] AC1: Otobanana `listAuthorWorks` 对成人作者（如 kei7241）返回非空（在账号可用时）
- [ ] AC2: Koekoe `listAuthorWorks` 对带 trip 的作者身份（如 `黒猫◆/HV2b6TqMw`）返回该作者作品，且不把无关同名作者作品全量灌入
- [ ] AC3: 订阅 `syncWorks=true` → 立即同步 → 新作品 `discovered`/`enqueued` 增加（或已全部 downloaded 时至少 discovered 覆盖作者列表）
- [ ] AC4: 收藏同步路径与 `remoteInFavorites` 作者路径行为不变
- [ ] AC5: 相关 unit test 覆盖 koekoe 搜索词规范化 / 过滤；otobanana 分页 URL 含 `is_adult`

## Out of scope notes

- Docker 与 `pnpm dev` 数据目录不同属部署说明，非本任务必修
