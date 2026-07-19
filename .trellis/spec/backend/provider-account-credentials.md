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
| enabled | boolean? | **legacy**; column still written (default true); **does not gate** VOD sync / live session |
| favoriteSyncEnabled | boolean? | default true; gates **VOD favorites sync only** |

**Request (patch body)** — partial; credential rebuild when any of `authMode`, `password`, `cookieHeader`, or `username !== undefined`. May include `favoriteSyncEnabled` and/or legacy `enabled` without external login.

**Success response**

- Create: `201` + `ProviderAccountPublic` with `status: "ok"`, `sessionBlob` persisted server-side, `favoriteSyncEnabled` present.
- Patch (creds): `200` + public account `status: "ok"`.
- Patch (`favoriteSyncEnabled` / legacy `enabled` only): `200`, no external login.

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
| PATCH `favoriteSyncEnabled` only | 200 | that column only | public account; no login |
| PATCH legacy `enabled` only | 200 | may write column | **no** effect on runSync / live (business ignores) |
| test endpoint fail | 400 | updates `status=error` + `statusMessage` | `{ ok: false, error }` |
| test endpoint ok | 200 | session + `status=ok` | `{ ok: true }` |

### 5. Good / Base / Bad Cases

- **Good**: valid password or cookie → create returns 201, list shows `status=ok`.
- **Base**: PATCH `{ favoriteSyncEnabled: false }` → no provider login; VOD `runSync` skips that provider; live poller/session still work.
- **Bad**: wrong password create → 400, **no** `provider_accounts` row; wrong cookie PATCH → 400, old encrypted payload unchanged.
- **Bad**: gating live/session on `provider_accounts.enabled` → closing “account” wrongly blocks recording while user only meant to pause VOD sync.

### 6. Tests Required

- Unit/integration when added:
  - Mock `getProvider().login` reject → POST no insert (assert row count / select empty).
  - Mock login+valid → POST insert `status=ok` + `sessionBlob` non-null.
  - PATCH creds with mock fail → encrypted payload bytes unchanged.
  - PATCH `favoriteSyncEnabled` only → mock login not called.
  - Live path with `enabled=false` still resolves session (business no longer reads `enabled`).
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
  // password/cookie: encryptJson → encryptedPayload
  // session: must not stay plaintext long-term (see below)
  sessionBlob: JSON.stringify(verified.session),
  status: "ok",
});
```

## Design Decision: Fail closed on save

**Context**: Invalid credentials used to persist as `status=unknown` until sync/test.

**Decision**: Create/update secret paths verify via `provider.login` + `isSessionValid` **before** writing secrets. Fail → 400, no secret write. Keep `POST .../test` for recheck of stored accounts.

**Why**: Avoid dirty rows and false UI success; reuse existing provider auth implementations.

## Scenario: Encrypt provider sessionBlob (P0 gap)

### 1. Scope / Trigger

- Trigger: any write/read of `provider_accounts.session_blob` (create/patch/test, job runner, live-poller, live-history-sync).
- Cross-layer: DB column holds third-party session tokens (accessToken etc.); `app.db` leak ≡ session hijack.
- Full-stack audit (2026-07-18): passwords/cookies use AES-GCM (`encryptedPayload`); **sessions currently `JSON.stringify` plaintext**.

### 2. Signatures

```ts
// Target helpers (same secret as credentials.ts)
function encryptSession(secret: string, session: Session): string
function decryptSession(secret: string, blob: string): Session
// DB: provider_accounts.session_blob TEXT — ciphertext or legacy plaintext during migration
```

### 3. Contracts

| Field | Today | Target |
|-------|--------|--------|
| `encryptedPayload` | AES-GCM of password/cookie | unchanged |
| `sessionBlob` | `JSON.stringify(session)` plaintext | same AES-GCM envelope as credentials (or versioned prefix) |
| API public DTO | never returns raw session | unchanged |

### 4. Validation & Error Matrix

| Condition | Behavior |
|-----------|----------|
| Write path after login/test | always encrypt before INSERT/UPDATE |
| Read path (jobs/sync) | decrypt; if decrypt fails, try legacy JSON parse once |
| Legacy plaintext row | accept on read; rewrite encrypted on next successful session refresh |
| Missing `CREDENTIALS_SECRET` / config secret | fail closed (same as credential encrypt) |

### 5. Good / Base / Bad Cases

- **Good**: new account → `sessionBlob` ciphertext only; runner decrypts and calls provider APIs.
- **Base**: old DB row still plaintext JSON → first job read migrates to ciphertext.
- **Bad**: leave `sessionBlob: JSON.stringify(session)` as the permanent write path after encrypt lands.

### 6. Tests Required

- Unit: encrypt → decrypt round-trip equals original Session.
- Unit: decrypt accepts legacy `JSON.stringify` fixture and returns Session.
- Integration: POST create/test persists non-JSON-looking blob (not parseable as plain Session).
- Integration: runner/live path still loads session after encrypt.

### 7. Wrong vs Correct

#### Wrong

```ts
sessionBlob: JSON.stringify(verified.session), // tokens at rest in app.db
```

#### Correct

```ts
sessionBlob: encryptSession(secret, verified.session),
// readers: decryptSession(secret, row.sessionBlob) with legacy plaintext fallback
```

## Design Decision: Session at rest must match credential encryption

**Context**: Audit found password/cookie encrypted but live provider tokens stored plaintext in the same row.

**Decision**: Treat `sessionBlob` as secret material. Encrypt at rest with the same key material as `encryptedPayload`; support one-shot legacy plaintext read + rewrite.

**Why**: `app.db` / volume exposure must not yield usable third-party sessions.

## Scenario: Favorite sync flag vs legacy account enabled

### 1. Scope / Trigger

- Trigger: VOD `runSync` account selection; live-poller / live-history-sync / `ensureOtobananaSession` account load; Providers UI; Sync page per-channel toggle.
- Cross-layer: `ProviderAccountPublic.favoriteSyncEnabled` must match DB `favorite_sync_enabled`.

### 2. Signatures

```ts
// DB: provider_accounts
// favorite_sync_enabled INTEGER NOT NULL DEFAULT 1
// enabled INTEGER NOT NULL DEFAULT 1  -- legacy, not business gate

// Shared
interface ProviderAccountPublic {
  enabled: boolean; // legacy echo
  favoriteSyncEnabled: boolean;
  // ...
}

// migrate (apps/server/src/db/client.ts)
// If column missing: ADD COLUMN favorite_sync_enabled ... DEFAULT 1
// Then: UPDATE provider_accounts SET favorite_sync_enabled = enabled
```

### 3. Contracts

| Consumer | Gate |
|----------|------|
| `JobRunner.runSync` | only rows with `favorite_sync_enabled = true` |
| Single-provider `POST /api/sync?provider=` when that account has favorite sync off | `400` `{ error: "该渠道已关闭收藏同步" }` (or equivalent) |
| Full sync | skip disabled-favorite channels (no hard fail for whole run) |
| live-poller / live-history-sync / live session | account must **exist**; **do not** require `enabled` |
| Auto-record list | still `live_subscriptions.enabled = true` (separate flag) |

### 4. Validation & Error Matrix

| Condition | Result |
|-----------|--------|
| `favoriteSyncEnabled=false`, full sync | provider skipped |
| `favoriteSyncEnabled=false`, sync that provider only | 400 |
| `enabled=false`, live poll | still uses account credentials |
| migrate second start | no error; column already present |

### 5. Good / Base / Bad Cases

- **Good**: toggle favorite sync off on Sync VOD tab → immediate full sync skips that provider; live still records subscribed authors.
- **Base**: new account → `favoriteSyncEnabled=true`, participates in sync.
- **Bad**: `runSync` still filters on `enabled` → Providers “remove enable UI” becomes a lie and old disabled accounts stay out of sync forever or live breaks.

### 6. Tests Required

- Unit/integration when added: runSync filter uses `favoriteSyncEnabled`.
- Manual: migrate old DB once + restart (idempotent ADD).
- Manual: `enabled=0` row still serves live session after upgrade.

### 7. Wrong vs Correct

#### Wrong

```ts
.where(eq(providerAccounts.enabled, true)); // VOD sync
if (!account.enabled) throw new Error("disabled"); // live session
```

#### Correct

```ts
.where(eq(providerAccounts.favoriteSyncEnabled, true)); // VOD only
// live: account row present is enough for credentials
```

## Design Decision: Split favorite sync from account availability

**Context**: One `enabled` bit gated VOD sync, live poller, history sync, and session — Providers UI “disable” was an account kill switch.

**Decision**: Add `favorite_sync_enabled` for VOD favorites participation only. Keep `enabled` column for DB compat but stop using it as a business gate. Remove Providers enable/disable UI; expose favorite toggle on Sync VOD tab.

**Why**: User can pause VOD favorites sync without disabling live auto-record credentials.
