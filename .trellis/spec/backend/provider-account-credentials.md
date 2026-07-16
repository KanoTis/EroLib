# Provider Account Credentials

> Validate-on-save contract for provider account create/update.

## Scenario: Validate credentials before persist

### 1. Scope / Trigger

- Trigger: any code that creates or updates provider account secrets (`password` / `cookieHeader` / `authMode` / `username` rebuild).
- Cross-layer: backend must return `{ error: string }` on failure so web `api.request` can surface it.

### 2. Signatures

```ts
// apps/server/src/app.ts (internal)
async function verifyProviderCredentials(
  providerId: ProviderId,
  auth: ProviderAuth,
): Promise<{ session: Session } | { error: string }>

// HTTP
POST   /api/providers
PATCH  /api/providers/:id
POST   /api/providers/:id/test
```

### 3. Contracts

**Request (create body)**

| Field | Type | Notes |
|-------|------|-------|
| provider | ProviderId | required |
| authMode | `password` \| `cookie` | required |
| username | string? | required for password |
| password | string? | required for password |
| cookieHeader | string? | required for cookie |
| enabled | boolean? | default true |

**Request (patch body)** — partial; credential rebuild when any of `authMode`, `password`, `cookieHeader`, or `username !== undefined`.

**Success response**

- Create: `201` + `ProviderAccountPublic` with `status: "ok"`, `sessionBlob` persisted server-side.
- Patch (creds): `200` + public account `status: "ok"`.
- Patch (enabled only): `200`, no external login.

**Failure response**

- Always `{ error: string }` for client-visible failures.
- Credential invalid: `400` (fail closed — **no insert / no credential update**).
- Duplicate provider: `409` `{ error: "Provider already configured" }`.

### 4. Validation & Error Matrix

| Condition | HTTP | Persist? | Body |
|-----------|------|----------|------|
| Invalid zod body | 400 | no | `{ error: "Invalid body" }` |
| password mode missing user/pass | 400 | no | `{ error: "username/password required" }` |
| cookie mode missing cookie | 400 | no | `{ error: "cookieHeader required" }` |
| `login` throws / network auth fail | 400 | no | `{ error: <provider message> }` |
| `isSessionValid` false | 400 | no | `{ error: "Session invalid after login" }` |
| UNIQUE provider conflict | 409 | n/a | `{ error: "Provider already configured" }` |
| PATCH enabled only | 200 | enabled only | public account |
| test endpoint fail | 400 | updates `status=error` + `statusMessage` | `{ ok: false, error }` |
| test endpoint ok | 200 | session + `status=ok` | `{ ok: true }` |

### 5. Good / Base / Bad Cases

- **Good**: valid password or cookie → create returns 201, list shows `status=ok`.
- **Base**: PATCH `{ enabled: false }` → no provider login, only toggles enabled.
- **Bad**: wrong password create → 400, **no** `provider_accounts` row; wrong cookie PATCH → 400, old encrypted payload unchanged.

### 6. Tests Required

- Unit/integration when added:
  - Mock `getProvider().login` reject → POST no insert (assert row count / select empty).
  - Mock login+valid → POST insert `status=ok` + `sessionBlob` non-null.
  - PATCH creds with mock fail → encrypted payload bytes unchanged.
  - PATCH enabled only → mock login not called.
- Frontend: create failure surfaces `error` string; success message indicates verified.

### 7. Wrong vs Correct

#### Wrong

```ts
// Encrypt and insert first, validate later (or never)
const encrypted = encryptJson(secret, payload);
await db.insert(providerAccounts).values({ ..., status: "unknown" });
// user sees success while credentials are dead
```

#### Correct

```ts
const verified = await verifyProviderCredentials(provider, auth);
if ("error" in verified) return c.json({ error: verified.error }, 400);
await db.insert(providerAccounts).values({
  ...,
  sessionBlob: JSON.stringify(verified.session),
  status: "ok",
});
```

## Design Decision: Fail closed on save

**Context**: Invalid credentials used to persist as `status=unknown` until sync/test.

**Decision**: Create/update secret paths verify via `provider.login` + `isSessionValid` **before** writing secrets. Fail → 400, no secret write. Keep `POST .../test` for recheck of stored accounts.

**Why**: Avoid dirty rows and false UI success; reuse existing provider auth implementations.
