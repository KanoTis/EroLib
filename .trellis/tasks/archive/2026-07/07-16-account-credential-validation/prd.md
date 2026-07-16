# 添加账号时验证凭证有效性

## Goal

用户添加 / 更新 Provider 账号凭证时，服务端在写库前校验账密或 Cookie 是否有效，并向前端返回明确成功/失败反馈，避免无效凭证静默入库。

## Background

- 前端 `ProvidersPage` 保存走 `POST /api/providers`，成功仅提示「已保存（凭证已加密）」。
- `POST /api/providers` / `PATCH /api/providers/:id` 当前只做字段校验与加密存储，`status` 置为 `unknown`，不调用 `provider.login`。
- 已有 `POST /api/providers/:id/test`：`decrypt → login → isSessionValid`，写回 `sessionBlob` / `status` / `statusMessage`。
- 同步/下载路径 `ensureSession` 才懒登录；失败时才把账号标 `error`。
- 各 provider（otobanana / koekoe / erovoice）已实现 `login` + `isSessionValid`。
- `provider_accounts` 对 `provider` 唯一索引：每站至多一条账号。

## Decisions

| ID | Decision |
|----|----------|
| D1 | 校验失败**不写库**（create 不 insert；update 凭证不改 encryptedPayload/session）。返回 4xx + `{ error }`。 |
| D2 | 范围覆盖 **POST 创建** 与 **PATCH 提交凭证变更**（password / cookie / authMode / username 导致凭证变更时）。仅改 `enabled` 的 PATCH 不触发登录。 |
| D3 | 成功路径对齐 test：`login` 成功且 `isSessionValid` 为真 → 写 `sessionBlob`、`status=ok`、`statusMessage=null`。 |
| D4 | 保留 `POST .../test` 与列表「测试」按钮，行为不变。 |

## Requirements

- **R1**：`POST /api/providers` 在 insert 前用提交凭证调用 `getProvider(provider).login` + `isSessionValid`。
- **R2**：校验成功才 insert；返回 201 的 public account，`status=ok`，含已写入 session 的效果。
- **R3**：校验失败返回 4xx + 可读 `error`（provider/login 错误 message）；DB 无新行。
- **R4**：`PATCH /api/providers/:id` 若变更凭证（authMode / username / password / cookieHeader 任一影响凭证），先用**合并后的 next 凭证** login 校验；失败则不更新凭证字段与 session；成功则写 encrypted + session + `status=ok`。
- **R5**：仅 `enabled` 的 PATCH 不调用 login，保持现有行为。
- **R6**：前端创建保存：失败展示后端 `error`；成功提示表明**已验证**（不仅是加密）。
- **R7**：保存中保留 `saving` 状态；成功/失败提示互斥。

## Acceptance Criteria

- [ ] AC1：错误账密 `POST` → 4xx + 错误文案；DB 无该 provider 新记录。
- [ ] AC2：错误 Cookie/Token `POST` → 同上。
- [ ] AC3：有效账密或 Cookie `POST` → 201，`status=ok`，`sessionBlob` 非空，可立即同步/测试。
- [ ] AC4：前端失败显示后端错误；成功提示含「已验证」语义。
- [ ] AC5：`PATCH` 带错误新凭证 → 4xx，库中旧凭证/session/status 不变。
- [ ] AC6：`PATCH` 带有效新凭证 → 200，`status=ok`，session 更新。
- [ ] AC7：仅切换启用的 `PATCH` 不依赖外部登录、行为与现在一致。
- [ ] AC8：`POST /api/providers/:id/test` 仍可用。

## Out of Scope

- 改各站 login 实现（除非本链路暴露必须修的 bug）。
- 新增完整「编辑凭证」表单 UI（API 支持即可；UI 可后做）。
- 「跳过校验强制保存」、定时巡检、自动重试。
- 多账号同 provider（仍受唯一索引约束）。

## Technical Notes（非设计细节）

- 复用 `POST .../test` 的 login 路径，抽取公共 helper 避免三处复制。
- 错误响应格式保持 `{ error: string }`，前端 `api.ts` 已解析。
- 外网登录可能较慢；UI 已有 spinner，无需额外 UX 除非超时不可读。
