import { and, eq, inArray } from "drizzle-orm";
import type { ProviderAuth, Session } from "@erolib/shared";
import type { AppConfig } from "../config.js";
import {
  decryptJson,
  type EncryptedBlob,
} from "../crypto/credentials.js";
import type { AppDatabase } from "../db/client.js";
import {
  liveFolloweeAuthors,
  liveFolloweeSessions,
  providerAccounts,
  settings,
  type ProviderAccountRow,
} from "../db/schema.js";
import { getProvider } from "../providers/index.js";
import {
  listFolloweeRecentLivestreams,
  resolveSelfAuthorId,
} from "../providers/otobanana-live.js";
import { sessionData } from "../providers/types.js";

const PROVIDER = "otobanana" as const;
/** Default: 30 minutes — keep official API load low. */
const SYNC_INTERVAL_MS = 30 * 60 * 1000;
/** Delay first run so server boot is not blocked by a large followee crawl. */
const INITIAL_DELAY_MS = 15_000;

const SETTING_SYNCED_AT = "liveFolloweeHistorySyncedAt";
const SETTING_LAST_ERROR = "liveFolloweeHistoryLastError";

export interface LiveHistorySyncer {
  start(): void;
  stop(): void;
  /** Manual refresh (UI button). Deduped if a sync is already running. */
  syncNow(): Promise<void>;
  isSyncing(): boolean;
  getStatus(): Promise<{
    syncedAt: string | null;
    lastError: string | null;
    syncing: boolean;
  }>;
}

interface CredentialPayload {
  mode: "password" | "cookie";
  username?: string;
  password?: string;
  cookieHeader?: string;
}

function nowSql(): string {
  return new Date().toISOString().replace("T", " ").replace(/\.\d{3}Z$/, "");
}

function parseEncryptedPayload(
  secret: string,
  encoded: string,
): CredentialPayload {
  const raw: unknown = JSON.parse(encoded);
  return decryptJson(secret, raw as EncryptedBlob) as CredentialPayload;
}

function parseSession(blob: string | null): Session | null {
  if (!blob) return null;
  try {
    return JSON.parse(blob) as Session;
  } catch {
    return null;
  }
}

async function upsertSetting(
  db: AppDatabase,
  key: string,
  value: string,
): Promise<void> {
  const existing = await db
    .select()
    .from(settings)
    .where(eq(settings.key, key))
    .limit(1);
  if (existing.length > 0) {
    await db
      .update(settings)
      .set({ value })
      .where(eq(settings.key, key));
  } else {
    await db.insert(settings).values({ key, value });
  }
}

async function readSetting(
  db: AppDatabase,
  key: string,
): Promise<string | null> {
  const [row] = await db
    .select()
    .from(settings)
    .where(eq(settings.key, key))
    .limit(1);
  return row?.value ?? null;
}

export function createLiveHistorySyncer(
  db: AppDatabase,
  config: AppConfig,
): LiveHistorySyncer {
  let stopped = false;
  let timer: ReturnType<typeof setInterval> | null = null;
  let initialTimer: ReturnType<typeof setTimeout> | null = null;
  let inFlight: Promise<void> | null = null;

  async function ensureSession(account: ProviderAccountRow): Promise<Session> {
    const provider = getProvider(PROVIDER);
    const creds = parseEncryptedPayload(
      config.credentialsSecret,
      account.encryptedPayload,
    );
    const existing = parseSession(account.sessionBlob);
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
    const session = await provider.login(auth);
    await db
      .update(providerAccounts)
      .set({
        sessionBlob: JSON.stringify(session),
        status: "ok",
        statusMessage: null,
        updatedAt: nowSql(),
      })
      .where(eq(providerAccounts.id, account.id));
    return session;
  }

  async function ensureToken(): Promise<{
    token: string;
    userId?: string;
  } | null> {
    const [account] = await db
      .select()
      .from(providerAccounts)
      .where(eq(providerAccounts.provider, PROVIDER))
      .limit(1);
    if (!account || !account.enabled) return null;
    try {
      const session = await ensureSession(account);
      const data = sessionData(session);
      if (!data.accessToken) return null;
      return { token: data.accessToken, userId: data.userId };
    } catch {
      return null;
    }
  }

  async function persistRows(
    rows: Awaited<ReturnType<typeof listFolloweeRecentLivestreams>>,
  ): Promise<void> {
    const now = nowSql();
    const authorIds = rows.map((r) => r.author.authorId);
    const roomIds = rows.flatMap((r) => r.sessions.map((s) => s.roomId));

    // Replace cache snapshot for this provider.
    if (authorIds.length > 0) {
      // Upsert authors one by one (sqlite-friendly).
      for (const row of rows) {
        const existing = await db
          .select({ id: liveFolloweeAuthors.id })
          .from(liveFolloweeAuthors)
          .where(
            and(
              eq(liveFolloweeAuthors.provider, PROVIDER),
              eq(liveFolloweeAuthors.authorId, row.author.authorId),
            ),
          )
          .limit(1);
        if (existing[0]) {
          await db
            .update(liveFolloweeAuthors)
            .set({
              username: row.author.username,
              displayName: row.author.displayName,
              updatedAt: now,
            })
            .where(eq(liveFolloweeAuthors.id, existing[0].id));
        } else {
          await db.insert(liveFolloweeAuthors).values({
            provider: PROVIDER,
            authorId: row.author.authorId,
            username: row.author.username,
            displayName: row.author.displayName,
            updatedAt: now,
          });
        }
      }
      // Drop authors no longer in followee list.
      const kept = new Set(authorIds);
      const allAuthors = await db
        .select()
        .from(liveFolloweeAuthors)
        .where(eq(liveFolloweeAuthors.provider, PROVIDER));
      for (const a of allAuthors) {
        if (!kept.has(a.authorId)) {
          await db
            .delete(liveFolloweeAuthors)
            .where(eq(liveFolloweeAuthors.id, a.id));
        }
      }
    } else {
      await db
        .delete(liveFolloweeAuthors)
        .where(eq(liveFolloweeAuthors.provider, PROVIDER));
    }

    // Sessions: upsert current, delete stale rooms for this provider.
    const seenRooms = new Set(roomIds);
    for (const row of rows) {
      for (const s of row.sessions) {
        const existing = await db
          .select({ id: liveFolloweeSessions.id })
          .from(liveFolloweeSessions)
          .where(
            and(
              eq(liveFolloweeSessions.provider, PROVIDER),
              eq(liveFolloweeSessions.roomId, s.roomId),
            ),
          )
          .limit(1);
        const values = {
          authorId: row.author.authorId,
          postPtrId: s.postPtrId,
          streamService: s.streamService,
          title: s.title,
          isOpen: s.isOpen,
          isAdult: s.isAdult,
          listenerCount: s.listenerCount,
          roomOpenAt: s.roomOpenAt,
          roomCloseAt: s.roomCloseAt,
          updatedAt: now,
        };
        if (existing[0]) {
          await db
            .update(liveFolloweeSessions)
            .set(values)
            .where(eq(liveFolloweeSessions.id, existing[0].id));
        } else {
          await db.insert(liveFolloweeSessions).values({
            provider: PROVIDER,
            roomId: s.roomId,
            ...values,
          });
        }
      }
    }

    const allSessions = await db
      .select({ id: liveFolloweeSessions.id, roomId: liveFolloweeSessions.roomId })
      .from(liveFolloweeSessions)
      .where(eq(liveFolloweeSessions.provider, PROVIDER));
    const staleIds = allSessions
      .filter((s) => !seenRooms.has(s.roomId))
      .map((s) => s.id);
    if (staleIds.length > 0) {
      // sqlite bind limit: chunk deletes
      const chunk = 100;
      for (let i = 0; i < staleIds.length; i += chunk) {
        const part = staleIds.slice(i, i + chunk);
        await db
          .delete(liveFolloweeSessions)
          .where(inArray(liveFolloweeSessions.id, part));
      }
    }
  }

  async function runSync(): Promise<void> {
    const auth = await ensureToken();
    if (!auth) {
      await upsertSetting(
        db,
        SETTING_LAST_ERROR,
        "Otobanana account not configured or session invalid",
      );
      return;
    }
    try {
      const selfAuthorId = await resolveSelfAuthorId(auth.token, auth.userId);
      // Conservative crawl: fewer pages + lower concurrency than the old live GET.
      const rows = await listFolloweeRecentLivestreams(auth.token, selfAuthorId, {
        maxFolloweePages: 6,
        sessionsPerAuthor: 5,
        concurrency: 2,
      });
      await persistRows(rows);
      const ts = nowSql();
      await upsertSetting(db, SETTING_SYNCED_AT, ts);
      await upsertSetting(db, SETTING_LAST_ERROR, "");
      console.log(
        `[live-history-sync] ok authors=${rows.length} sessions=${rows.reduce((n, r) => n + r.sessions.length, 0)}`,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await upsertSetting(db, SETTING_LAST_ERROR, message);
      console.error("[live-history-sync]", message);
    }
  }

  async function syncNow(): Promise<void> {
    if (inFlight) return inFlight;
    const run = runSync().finally(() => {
      if (inFlight === run) inFlight = null;
    });
    inFlight = run;
    return run;
  }

  return {
    start() {
      stopped = false;
      if (timer) return;
      initialTimer = setTimeout(() => {
        if (stopped) return;
        void syncNow();
      }, INITIAL_DELAY_MS);
      timer = setInterval(() => {
        if (stopped) return;
        void syncNow();
      }, SYNC_INTERVAL_MS);
    },
    stop() {
      stopped = true;
      if (initialTimer) {
        clearTimeout(initialTimer);
        initialTimer = null;
      }
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
    },
    syncNow,
    isSyncing() {
      return inFlight !== null;
    },
    async getStatus() {
      const syncedAt = await readSetting(db, SETTING_SYNCED_AT);
      const lastErrorRaw = await readSetting(db, SETTING_LAST_ERROR);
      return {
        syncedAt,
        lastError: lastErrorRaw && lastErrorRaw.length > 0 ? lastErrorRaw : null,
        syncing: inFlight !== null,
      };
    },
  };
}
