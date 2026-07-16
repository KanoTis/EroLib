# Design: 添加/更新账号时校验凭证

## Boundaries

| Layer | Change |
|-------|--------|
| Backend `app.ts` | POST/PATCH 写库前校验；抽取 credential verify helper |
| Frontend `ProvidersPage.tsx` | 成功文案；错误已走 `api.request` 的 `error` 字段 |
| Providers / shared types | 不改契约（沿用 `login` / `isSessionValid`） |
| DB schema | 不改 |

## Data flow

### Create (POST)

```
UI form → POST /api/providers
  → zod + mode required fields
  → getProvider(id).login(auth)
  → isSessionValid(session)
  → fail: 400 { error }  (no insert)
  → ok: encrypt → insert(status=ok, sessionBlob) → 201 public account
```

### Update credentials (PATCH)

```
PATCH body with cred fields
  → load existing
  → merge CredentialPayload next
  → login(next) + isSessionValid
  → fail: 400 { error }  (no update of cred/session/status)
  → ok: encrypt next → update(sessionBlob, status=ok, clear statusMessage)
```

### Enabled-only PATCH

```
PATCH { enabled } only → update enabled only; no login
```

### Existing test (unchanged)

```
POST /:id/test → decrypt stored → login → isSessionValid → update status
```

## Contracts

### Helper (server-internal)

Suggested shape (name free):

```ts
async function verifyProviderCredentials(
  providerId: ProviderId,
  auth: ProviderAuth,
): Promise<{ session: Session } | { error: string }>
```

- Success: session ready to persist.
- Failure: string suitable for `{ error }` (prefer `err.message`).
- Policy: `login` throws → error; `isSessionValid === false` → `"Session invalid after login"`（与 test 一致）.

### HTTP

| Case | Status | Body |
|------|--------|------|
| Invalid body / missing fields | 400 | `{ error }` |
| Credential invalid | 400 | `{ error: <provider message> }` |
| Provider already configured | 409 | `{ error: "Provider already configured" }` |
| Create ok | 201 | `ProviderAccountPublic` (`status: "ok"`) |
| Patch ok | 200 | `ProviderAccountPublic` |
| Patch not found | 404 | `{ error }` |

Credential validation runs **before** insert/update of secrets. UNIQUE conflict still possible on concurrent create of same provider — keep existing 409 handling.

### PATCH: what counts as credential change

Trigger verify when any of:

- `authMode` present
- `password` present (non-empty string after trim policy: current code uses truthy)
- `cookieHeader` present
- `username !== undefined` **and** will change stored identity/payload in a way that rebuilds encrypted payload

Practical rule matching current patch block:

```
if (authMode || password || cookieHeader || username !== undefined) {
  rebuild next payload → VERIFY → then write
}
```

If only `enabled` is set: skip verify.

If rebuild path runs but effective next equals current and no new secret fields — still verify is acceptable for simplicity (network cost once). Prefer always verify when entering credential rebuild branch.

## Compatibility

- Old clients relying on create-with-unknown status: behavior change intentional.
- Invalid credentials can no longer be stored via POST/PATCH.
- `test` endpoint remains for re-validation of already-stored accounts.
- Runner `ensureSession` unchanged.

## Tradeoffs

| Choice | Why |
|--------|-----|
| Fail closed (no persist) | Avoids dirty `unknown`/`error` rows from create form |
| Reuse provider.login | Single source of truth; no second validation protocol |
| Verify on any credential rebuild PATCH | Covers future edit-credential UI without rework |
| Keep test endpoint | Manual recheck after cookie expiry without re-save |

## Rollout / Rollback

- Single deploy, no migration.
- Rollback: revert `app.ts` + success copy in `ProvidersPage`; no data migration needed.
