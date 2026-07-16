# Implement: 添加/更新账号时校验凭证

## Checklist

1. **Extract verify helper** in `apps/server/src/app.ts`（或紧邻小模块，优先同文件避免过度抽象）
   - Input: `ProviderId` + `ProviderAuth`（mode/username/password/cookieHeader）
   - Call `getProvider` → `login` → `isSessionValid`
   - Return session or error string
   - Refactor `POST /api/providers/:id/test` 使用同一 helper（行为不变）

2. **Wire POST `/api/providers`**
   - After field checks, before insert: verify
   - Fail → 400 `{ error }`
   - Ok → insert with `encryptedPayload`, `sessionBlob`, `status: "ok"`, `statusMessage: null`

3. **Wire PATCH `/api/providers/:id`**
   - When credential rebuild branch runs: compute `next` payload → verify
   - Fail → 400, **no** DB update of creds/session/status
   - Ok → write encrypted + session + ok status
   - Enabled-only path unchanged
   - Note: current code sets `sessionBlob: null` + `status: unknown` on any credential patch — replace with verified session + ok

4. **Frontend `ProvidersPage.tsx`**
   - Success message: e.g. `已保存并验证通过`（替代仅「已加密」）
   - Error path already uses `err.message` from `{ error }` — verify no swallow
   - Optional: saving button text could say「验证中…」while `saving`（nice-to-have）

5. **Smoke / verify**
   - Typecheck: package scripts if present (`pnpm --filter @erolib/server …`)
   - Manual or scripted: invalid create → no row; valid create → ok status
   - PATCH enabled toggle still works without network login if possible (mock not required if manual)

## Validation commands

```bash
# from repo root — adjust to project scripts
pnpm --filter @erolib/server exec tsc --noEmit
pnpm --filter @erolib/web exec tsc --noEmit
# optional existing tests
pnpm --filter @erolib/server test
```

## Risky files

| File | Risk |
|------|------|
| `apps/server/src/app.ts` | Core API; avoid breaking non-cred PATCH / UNIQUE 409 |
| `ProvidersPage.tsx` | Copy only; don't break test/delete/enable flows |

## Rollback points

- After helper + POST only: create path fixed; PATCH still old (partial)
- Full: POST + PATCH + UI copy

## Review gates before start

- [x] PRD decisions D1–D4 locked
- [x] design.md boundaries clear
- [x] implement.jsonl / check.jsonl curated
