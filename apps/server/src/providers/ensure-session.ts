import type { ProviderAuth, ProviderId, Session } from "@erolib/shared";
import { eq } from "drizzle-orm";
import type { AppConfig } from "../config.js";
import {
  decryptJson,
  type EncryptedBlob,
} from "../crypto/credentials.js";
import type { AppDatabase } from "../db/client.js";
import {
  providerAccounts,
  type ProviderAccountRow,
} from "../db/schema.js";
import { nowSql } from "../lib/utils.js";
import { getProvider } from "./index.js";

interface CredentialPayload {
  mode: "password" | "cookie";
  username?: string;
  password?: string;
  cookieHeader?: string;
}

/**
 * True when login failed because credentials/cookie are wrong — not transient network.
 * Used to stop automatic re-login loops until the user updates the account.
 */
export function isCredentialAuthError(message: string): boolean {
  const m = message.trim();
  if (!m) return false;
  // Transient provider/network failures should still re-attempt login later.
  if (/HTTP 5\d\d\b/i.test(m)) return false;
  if (/\b(ECONNRESET|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|fetch failed)\b/i.test(m)) {
    return false;
  }
  // Provider login() auth failures use these phrases for bad password/cookie.
  if (/login failed|登录失败/i.test(m)) return true;
  return (
    /用户名或密码错误/i.test(m) ||
    /credentials rejected/i.test(m) ||
    /cookie session invalid/i.test(m) ||
    /Cookie 无效或已过期/i.test(m) ||
    /Session invalid after login/i.test(m) ||
    /Email and password required/i.test(m) ||
    /id and pass required/i.test(m) ||
    /username\/password required/i.test(m) ||
    /cookieHeader required/i.test(m) ||
    /请填写 .*用户名和密码/i.test(m) ||
    /请粘贴 .*Cookie/i.test(m) ||
    /expects JWT access token/i.test(m) ||
    /Failed to decrypt provider credentials/i.test(m) ||
    /Invalid credential blob/i.test(m) ||
    /HTTP 401\b/i.test(m) ||
    /HTTP 403\b/i.test(m) ||
    /凭证无效/i.test(m)
  );
}

function parseEncryptedPayload(
  secret: string,
  encoded: string,
): CredentialPayload {
  const raw: unknown = JSON.parse(encoded);
  if (!raw || typeof raw !== "object" || !("v" in raw) || !("data" in raw)) {
    throw new Error("Invalid credential blob");
  }
  return decryptJson<CredentialPayload>(secret, raw as EncryptedBlob);
}

function parseSession(blob: string | null): Session | null {
  if (!blob) return null;
  try {
    const parsed: unknown = JSON.parse(blob);
    if (
      parsed &&
      typeof parsed === "object" &&
      "provider" in parsed &&
      "data" in parsed
    ) {
      return parsed as Session;
    }
  } catch {
    return null;
  }
  return null;
}

async function markAuthError(
  db: AppDatabase,
  accountId: number,
  message: string,
): Promise<void> {
  await db
    .update(providerAccounts)
    .set({
      status: "error",
      statusMessage: message,
      updatedAt: nowSql(),
    })
    .where(eq(providerAccounts.id, accountId));
}

/**
 * Resolve a valid provider session for the account.
 * On wrong password/cookie: persists status=error and will not re-login
 * until the user updates credentials or tests successfully (status back to ok).
 */
export async function ensureProviderSession(
  db: AppDatabase,
  config: AppConfig,
  account: ProviderAccountRow,
): Promise<Session> {
  // Re-read so concurrent jobs see a credential failure marked by another path.
  const [fresh] = await db
    .select()
    .from(providerAccounts)
    .where(eq(providerAccounts.id, account.id))
    .limit(1);
  const row = fresh ?? account;

  if (
    row.status === "error" &&
    row.statusMessage &&
    isCredentialAuthError(row.statusMessage)
  ) {
    throw new Error(row.statusMessage);
  }

  const provider = getProvider(row.provider as ProviderId);

  let creds: CredentialPayload;
  try {
    creds = parseEncryptedPayload(
      config.credentialsSecret,
      row.encryptedPayload,
    );
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to decrypt provider credentials";
    await markAuthError(db, row.id, message);
    throw new Error(message);
  }

  const existing = parseSession(row.sessionBlob);
  if (existing) {
    try {
      if (await provider.isSessionValid(existing)) {
        return existing;
      }
    } catch {
      // re-login
    }
  }

  const auth: ProviderAuth = {
    mode: creds.mode,
    username: creds.username,
    password: creds.password,
    cookieHeader: creds.cookieHeader,
  };

  try {
    const session = await provider.login(auth);
    await db
      .update(providerAccounts)
      .set({
        sessionBlob: JSON.stringify(session),
        status: "ok",
        statusMessage: null,
        updatedAt: nowSql(),
      })
      .where(eq(providerAccounts.id, row.id));
    return session;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (isCredentialAuthError(message)) {
      await markAuthError(db, row.id, message);
    }
    throw err instanceof Error ? err : new Error(message);
  }
}
