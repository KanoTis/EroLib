import { serveStatic } from "@hono/node-server/serve-static";
import { and, desc, eq, like, or } from "drizzle-orm";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { HTTPException } from "hono/http-exception";
import path from "node:path";
import { createReadStream, statSync } from "node:fs";
import { readFile, rm } from "node:fs/promises";
import { Readable } from "node:stream";
import { z } from "zod";
import type {
  AuthMode,
  AuthorSearchHit,
  LiveFolloweeAuthorPublic,
  LiveFolloweeHistoryPublic,
  LiveJobState,
  LiveMediaPublic,
  LiveOnairPublic,
  LiveRecordJobPublic,
  LiveSubscriptionPublic,
  ProviderAccountPublic,
  ProviderId,
  SettingsPublic,
  SubscriptionImportProviderResult,
  SubscriptionImportResult,
  WorkPublic,
} from "@erolib/shared";
import { PROVIDER_IDS } from "@erolib/shared";
import type { AppConfig } from "./config.js";
import { authEnabled } from "./config.js";
import {
  authMiddleware,
  checkPassword,
  clearSessionCookie,
  setSessionCookie,
  verifySessionToken,
} from "./auth/session.js";
import {
  getAuthorPublic,
  resolveAuthorAvatarAbsPath,
} from "./authors/ensure-author.js";
import { getCookie } from "hono/cookie";
import {
  encryptJson,
  type EncryptedBlob,
  decryptJson,
} from "./crypto/credentials.js";
import type { AppDatabase } from "./db/client.js";
import {
  downloadJobs,
  liveFolloweeAuthors,
  liveFolloweeSessions,
  liveMedia,
  liveRecordJobs,
  liveSubscriptions,
  providerAccounts,
  settings,
  syncRuns,
  works,
} from "./db/schema.js";
import type { LiveHistorySyncer } from "./jobs/live-history-sync.js";
import type { LivePoller } from "./jobs/live-poller.js";
import type { JobRunner } from "./jobs/runner.js";
import { ensureProviderSession } from "./providers/ensure-session.js";
import { getProvider } from "./providers/index.js";
import {
  listErovoiceFolloweeAuthors,
  searchErovoiceAuthors,
} from "./providers/erovoice.js";
import { searchKoeKoeAuthors } from "./providers/koekoe.js";
import {
  listFolloweeAuthors,
  listFolloweeLivestreams,
  resolveAuthorByInput,
  resolveSelfAuthorId,
  searchAuthors as searchOtobananaAuthors,
} from "./providers/otobanana-live.js";
import { sessionData } from "./providers/types.js";
import { liveMediaDir, mediaWorkDir, pathExists } from "./storage/paths.js";
import type { ProviderAuth, Session } from "@erolib/shared";

export interface AppDeps {
  config: AppConfig;
  db: AppDatabase;
  runner: JobRunner;
  livePoller: LivePoller;
  historySyncer: LiveHistorySyncer;
}

type AuthEnv = {
  Variables: {
    authUser?: string;
  };
};

const ProviderBody = z.object({
  provider: z.enum(["otobanana", "koekoe", "erovoice"]),
  enabled: z.boolean().optional(), // legacy; no longer gates business logic
  favoriteSyncEnabled: z.boolean().optional(),
  authMode: z.enum(["password", "cookie"]),
  username: z.string().optional(),
  password: z.string().optional(),
  cookieHeader: z.string().optional(),
});

const ProviderPatch = z.object({
  enabled: z.boolean().optional(), // legacy no-op for business; may still write column
  favoriteSyncEnabled: z.boolean().optional(),
  authMode: z.enum(["password", "cookie"]).optional(),
  username: z.string().optional(),
  password: z.string().optional(),
  cookieHeader: z.string().optional(),
});

interface CredentialPayload {
  mode: AuthMode;
  username?: string;
  password?: string;
  cookieHeader?: string;
}

function toPublicAccount(
  row: typeof providerAccounts.$inferSelect,
  secret: string,
): ProviderAccountPublic {
  let hasPassword = false;
  let hasCookie = false;
  try {
    const raw: unknown = JSON.parse(row.encryptedPayload);
    if (raw && typeof raw === "object" && "v" in raw && "data" in raw) {
      const payload = decryptJson<CredentialPayload>(
        secret,
        raw as EncryptedBlob,
      );
      hasPassword = Boolean(payload.password);
      hasCookie = Boolean(payload.cookieHeader);
    }
  } catch {
    // ignore decrypt failures for listing
  }
  return {
    id: row.id,
    provider: row.provider as ProviderId,
    enabled: row.enabled,
    favoriteSyncEnabled: row.favoriteSyncEnabled,
    authMode: row.authMode as AuthMode,
    username: row.username,
    status: row.status as ProviderAccountPublic["status"],
    statusMessage: row.statusMessage,
    hasPassword,
    hasCookie,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

async function verifyProviderCredentials(
  providerId: ProviderId,
  auth: ProviderAuth,
): Promise<{ session: Session } | { error: string }> {
  try {
    const provider = getProvider(providerId);
    const session = await provider.login(auth);
    if (!(await provider.isSessionValid(session))) {
      return { error: "Session invalid after login" };
    }
    return { session };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

function parseMetaJson(metaJson: string | null): Record<string, unknown> | null {
  if (!metaJson) return null;
  try {
    const parsed: unknown = JSON.parse(metaJson);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // ignore
  }
  return null;
}

function sourceUrlFromMeta(metaJson: string | null, provider: ProviderId, workId: string): string | null {
  const parsed = parseMetaJson(metaJson);
  if (parsed && typeof parsed.sourceUrl === "string" && parsed.sourceUrl) {
    return parsed.sourceUrl;
  }
  if (provider === "koekoe") {
    return `https://koe-koe.com/detail.php?n=${encodeURIComponent(workId)}`;
  }
  if (provider === "otobanana") {
    return `https://otobanana.com/general/cast/${encodeURIComponent(workId)}`;
  }
  return null;
}

/** Source publish time from stored WorkMetadata (not local DB createdAt). */
function publishedAtFromMeta(metaJson: string | null): string | null {
  const parsed = parseMetaJson(metaJson);
  if (!parsed) return null;
  if (typeof parsed.createdAt === "string" && parsed.createdAt.trim()) {
    return parsed.createdAt.trim();
  }
  const extra = parsed.extra;
  if (extra && typeof extra === "object" && !Array.isArray(extra)) {
    const raw = (extra as Record<string, unknown>).postedAtRaw;
    if (typeof raw === "string" && raw.trim()) {
      return raw.trim().replace(/^@/, "");
    }
  }
  return null;
}

function toPublicWork(row: typeof works.$inferSelect): WorkPublic {
  return {
    id: row.id,
    provider: row.provider as ProviderId,
    workId: row.workId,
    authorId: row.authorId,
    authorName: row.authorName,
    title: row.title,
    description: row.description,
    status: row.status as WorkPublic["status"],
    remoteInFavorites: row.remoteInFavorites,
    durationSeconds: row.durationSeconds,
    audioExt: row.audioExt,
    coverPath: row.coverRelPath,
    sourceUrl: sourceUrlFromMeta(
      row.metaJson,
      row.provider as ProviderId,
      row.workId,
    ),
    publishedAt: publishedAtFromMeta(row.metaJson),
    error: row.error,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    downloadedAt: row.downloadedAt,
  };
}

export function createApp(deps: AppDeps): Hono<AuthEnv> {
  const { config, db, runner, livePoller, historySyncer } = deps;
  const app = new Hono<AuthEnv>();

  app.use(
    "*",
    cors({
      origin: (origin) => origin || "*",
      credentials: true,
    }),
  );

  app.onError((err, c) => {
    if (err instanceof HTTPException) {
      return err.getResponse();
    }
    console.error("[api]", err instanceof Error ? err.message : err);
    return c.json(
      { error: err instanceof Error ? err.message : "Internal error" },
      500,
    );
  });

  app.use("/api/*", authMiddleware(config));

  /** Image content-type from file extension. */
  const imageMime = (ext: string): string =>
    ext === ".png" ? "image/png"
    : ext === ".webp" ? "image/webp"
    : ext === ".gif" ? "image/gif"
    : "image/jpeg";

  /** Stream a file with optional Range support. */
  const streamFile = (
    c: import("hono").Context,
    filePath: string,
    size: number,
    contentType: string,
    extraHeaders?: Record<string, string>,
  ): Response => {
    const range = c.req.header("range");
    if (range) {
      const m = /bytes=(\d+)-(\d*)/.exec(range);
      if (m) {
        const start = Number.parseInt(m[1] ?? "0", 10);
        const end = m[2] ? Number.parseInt(m[2], 10) : size - 1;
        if (start >= size || end >= size || start > end) {
          return c.body(null, 416, {
            "Content-Range": `bytes */${size}`,
          });
        }
        const chunkSize = end - start + 1;
        const stream = createReadStream(filePath, { start, end });
        return c.body(Readable.toWeb(stream) as ReadableStream, 206, {
          "Content-Range": `bytes ${start}-${end}/${size}`,
          "Accept-Ranges": "bytes",
          "Content-Length": String(chunkSize),
          "Content-Type": contentType,
          ...extraHeaders,
        });
      }
    }
    const stream = createReadStream(filePath);
    return c.body(Readable.toWeb(stream) as ReadableStream, 200, {
      "Content-Length": String(size),
      "Accept-Ranges": "bytes",
      "Content-Type": contentType,
      ...extraHeaders,
    });
  };

  app.get("/api/health", (c) =>
    c.json({
      ok: true as const,
      version: "0.1.0",
      time: new Date().toISOString(),
    }),
  );

  app.get("/api/auth/status", (c) => {
    const enabled = authEnabled(config);
    if (!enabled) {
      return c.json({ authEnabled: false, authenticated: true, username: null });
    }
    const token = getCookie(c, "erolib_session");
    const session = token
      ? verifySessionToken(config.credentialsSecret, token)
      : null;
    return c.json({
      authEnabled: true,
      authenticated: Boolean(session),
      username: session?.username ?? null,
    });
  });

  app.post("/api/auth/login", async (c) => {
    if (!authEnabled(config)) {
      return c.json({ ok: true, authEnabled: false });
    }
    const body: unknown = await c.req.json();
    const parsed = z
      .object({ username: z.string(), password: z.string() })
      .safeParse(body);
    if (!parsed.success) {
      return c.json({ error: "Invalid body" }, 400);
    }
    if (!checkPassword(config, parsed.data.username, parsed.data.password)) {
      return c.json({ error: "Invalid credentials" }, 401);
    }
    setSessionCookie(c, config, parsed.data.username);
    return c.json({ ok: true, username: parsed.data.username });
  });

  app.post("/api/auth/logout", (c) => {
    clearSessionCookie(c);
    return c.json({ ok: true });
  });

  app.get("/api/settings", async (c) => {
    const rows = await db.select().from(settings);
    const map = new Map(rows.map((r) => [r.key, r.value]));
    const payload: SettingsPublic = {
      syncIntervalHours: Number(
        map.get("syncIntervalHours") ?? config.syncIntervalHours,
      ),
      dataDir: config.dataDir,
      mediaDir: config.mediaDir,
      cacheDir: config.cacheDir,
      authEnabled: authEnabled(config),
      maxDownloadConcurrency: config.maxDownloadConcurrency,
    };
    return c.json(payload);
  });

  app.put("/api/settings", async (c) => {
    const body: unknown = await c.req.json();
    const parsed = z
      .object({
        syncIntervalHours: z.number().int().min(1).max(168).optional(),
      })
      .safeParse(body);
    if (!parsed.success) return c.json({ error: "Invalid body" }, 400);
    if (parsed.data.syncIntervalHours !== undefined) {
      await db
        .insert(settings)
        .values({
          key: "syncIntervalHours",
          value: String(parsed.data.syncIntervalHours),
        })
        .onConflictDoUpdate({
          target: settings.key,
          set: { value: String(parsed.data.syncIntervalHours) },
        });
      config.syncIntervalHours = parsed.data.syncIntervalHours;
    }
    return c.json({ ok: true });
  });

  app.get("/api/providers", async (c) => {
    const rows = await db.select().from(providerAccounts);
    return c.json(
      rows.map((r) => toPublicAccount(r, config.credentialsSecret)),
    );
  });

  app.get("/api/providers/catalog", (c) => {
    return c.json(
      PROVIDER_IDS.map((id) => ({
        id,
        implemented: true,
      })),
    );
  });

  app.post("/api/providers", async (c) => {
    const body: unknown = await c.req.json();
    const parsed = ProviderBody.safeParse(body);
    if (!parsed.success) return c.json({ error: "Invalid body" }, 400);
    const data = parsed.data;
    const payload: CredentialPayload = {
      mode: data.authMode,
      username: data.username,
      password: data.password,
      cookieHeader: data.cookieHeader,
    };
    if (data.authMode === "password" && (!data.username || !data.password)) {
      return c.json({ error: "username/password required" }, 400);
    }
    if (data.authMode === "cookie" && !data.cookieHeader) {
      return c.json({ error: "cookieHeader required" }, 400);
    }
    const verified = await verifyProviderCredentials(data.provider, {
      mode: payload.mode,
      username: payload.username,
      password: payload.password,
      cookieHeader: payload.cookieHeader,
    });
    if ("error" in verified) {
      return c.json({ error: verified.error }, 400);
    }
    const encrypted = encryptJson(config.credentialsSecret, payload);
    try {
      const [row] = await db
        .insert(providerAccounts)
        .values({
          provider: data.provider,
          enabled: true,
          favoriteSyncEnabled: data.favoriteSyncEnabled ?? true,
          authMode: data.authMode,
          username: data.username ?? null,
          encryptedPayload: JSON.stringify(encrypted),
          sessionBlob: JSON.stringify(verified.session),
          status: "ok",
          statusMessage: null,
        })
        .returning();
      if (!row) return c.json({ error: "Insert failed" }, 500);
      return c.json(toPublicAccount(row, config.credentialsSecret), 201);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("UNIQUE")) {
        return c.json({ error: "Provider already configured" }, 409);
      }
      throw err;
    }
  });

  app.patch("/api/providers/:id", async (c) => {
    const id = Number.parseInt(c.req.param("id"), 10);
    if (!Number.isFinite(id)) return c.json({ error: "Invalid id" }, 400);
    const body: unknown = await c.req.json();
    const parsed = ProviderPatch.safeParse(body);
    if (!parsed.success) return c.json({ error: "Invalid body" }, 400);
    const [existing] = await db
      .select()
      .from(providerAccounts)
      .where(eq(providerAccounts.id, id))
      .limit(1);
    if (!existing) return c.json({ error: "Not found" }, 404);

    const credentialChange =
      Boolean(parsed.data.authMode) ||
      Boolean(parsed.data.password) ||
      Boolean(parsed.data.cookieHeader) ||
      parsed.data.username !== undefined;

    if (!credentialChange) {
      const [row] = await db
        .update(providerAccounts)
        .set({
          // enabled is legacy; only write if client still sends it
          ...(parsed.data.enabled !== undefined
            ? { enabled: parsed.data.enabled }
            : {}),
          ...(parsed.data.favoriteSyncEnabled !== undefined
            ? { favoriteSyncEnabled: parsed.data.favoriteSyncEnabled }
            : {}),
          updatedAt: new Date().toISOString(),
        })
        .where(eq(providerAccounts.id, id))
        .returning();
      if (!row) return c.json({ error: "Update failed" }, 500);
      return c.json(toPublicAccount(row, config.credentialsSecret));
    }

    let current: CredentialPayload = {
      mode: existing.authMode as AuthMode,
    };
    try {
      const raw: unknown = JSON.parse(existing.encryptedPayload);
      if (raw && typeof raw === "object" && "v" in raw && "data" in raw) {
        current = decryptJson<CredentialPayload>(
          config.credentialsSecret,
          raw as EncryptedBlob,
        );
      }
    } catch {
      // replace
    }
    const next: CredentialPayload = {
      mode: (parsed.data.authMode ?? current.mode) as AuthMode,
      username: parsed.data.username ?? current.username,
      password: parsed.data.password ?? current.password,
      cookieHeader: parsed.data.cookieHeader ?? current.cookieHeader,
    };
    const verified = await verifyProviderCredentials(
      existing.provider as ProviderId,
      {
        mode: next.mode,
        username: next.username,
        password: next.password,
        cookieHeader: next.cookieHeader,
      },
    );
    if ("error" in verified) {
      return c.json({ error: verified.error }, 400);
    }

    const [row] = await db
      .update(providerAccounts)
      .set({
        ...(parsed.data.enabled !== undefined
          ? { enabled: parsed.data.enabled }
          : {}),
        ...(parsed.data.favoriteSyncEnabled !== undefined
          ? { favoriteSyncEnabled: parsed.data.favoriteSyncEnabled }
          : {}),
        authMode: next.mode,
        username: next.username ?? null,
        encryptedPayload: JSON.stringify(
          encryptJson(config.credentialsSecret, next),
        ),
        sessionBlob: JSON.stringify(verified.session),
        status: "ok",
        statusMessage: null,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(providerAccounts.id, id))
      .returning();
    if (!row) return c.json({ error: "Update failed" }, 500);
    return c.json(toPublicAccount(row, config.credentialsSecret));
  });

  app.delete("/api/providers/:id", async (c) => {
    const id = Number.parseInt(c.req.param("id"), 10);
    if (!Number.isFinite(id)) return c.json({ error: "Invalid id" }, 400);
    await db.delete(providerAccounts).where(eq(providerAccounts.id, id));
    return c.json({ ok: true });
  });

  app.post("/api/providers/:id/test", async (c) => {
    const id = Number.parseInt(c.req.param("id"), 10);
    if (!Number.isFinite(id)) return c.json({ error: "Invalid id" }, 400);
    const [account] = await db
      .select()
      .from(providerAccounts)
      .where(eq(providerAccounts.id, id))
      .limit(1);
    if (!account) return c.json({ error: "Not found" }, 404);
    try {
      const raw: unknown = JSON.parse(account.encryptedPayload);
      if (!raw || typeof raw !== "object" || !("v" in raw) || !("data" in raw)) {
        return c.json({ ok: false, error: "Bad credential blob" }, 400);
      }
      const payload = decryptJson<CredentialPayload>(
        config.credentialsSecret,
        raw as EncryptedBlob,
      );
      const verified = await verifyProviderCredentials(
        account.provider as ProviderId,
        {
          mode: payload.mode,
          username: payload.username,
          password: payload.password,
          cookieHeader: payload.cookieHeader,
        },
      );
      if ("error" in verified) {
        await db
          .update(providerAccounts)
          .set({
            status: "error",
            statusMessage: verified.error,
            updatedAt: new Date().toISOString(),
          })
          .where(eq(providerAccounts.id, id));
        return c.json({ ok: false, error: verified.error }, 400);
      }
      await db
        .update(providerAccounts)
        .set({
          sessionBlob: JSON.stringify(verified.session),
          status: "ok",
          statusMessage: null,
          updatedAt: new Date().toISOString(),
        })
        .where(eq(providerAccounts.id, id));
      return c.json({ ok: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await db
        .update(providerAccounts)
        .set({
          status: "error",
          statusMessage: message,
          updatedAt: new Date().toISOString(),
        })
        .where(eq(providerAccounts.id, id));
      return c.json({ ok: false, error: message }, 400);
    }
  });

  app.post("/api/sync", async (c) => {
    const body: unknown = await c.req.json().catch(() => ({}));
    const parsed = z
      .object({
        provider: z.enum(["otobanana", "koekoe", "erovoice"]).optional(),
      })
      .safeParse(body);
    if (!parsed.success) return c.json({ error: "Invalid body" }, 400);
    // Single-provider: fail when neither favorites nor author-work sync applies.
    if (parsed.data.provider) {
      const [account] = await db
        .select()
        .from(providerAccounts)
        .where(eq(providerAccounts.provider, parsed.data.provider))
        .limit(1);
      if (account && !account.favoriteSyncEnabled) {
        const [hasAuthor] = await db
          .select({ id: liveSubscriptions.id })
          .from(liveSubscriptions)
          .where(
            and(
              eq(liveSubscriptions.provider, parsed.data.provider),
              eq(liveSubscriptions.syncWorks, true),
            ),
          )
          .limit(1);
        if (!hasAuthor) {
          return c.json({ error: "该渠道已关闭收藏同步" }, 400);
        }
      }
    }
    // fire and track via sync_runs
    void runner.triggerSync(parsed.data.provider);
    return c.json({ ok: true, started: true });
  });

  app.get("/api/sync/runs", async (c) => {
    const rows = await db
      .select()
      .from(syncRuns)
      .orderBy(desc(syncRuns.id))
      .limit(50);
    return c.json(
      rows.map((r) => ({
        id: r.id,
        provider: r.provider as ProviderId | null,
        startedAt: r.startedAt,
        finishedAt: r.finishedAt,
        discovered: r.discovered,
        enqueued: r.enqueued,
        markedNotFavorite: r.markedNotFavorite,
        error: r.error,
      })),
    );
  });

  app.get("/api/works", async (c) => {
    const q = c.req.query("q")?.trim() ?? "";
    const status = c.req.query("status");
    const provider = c.req.query("provider");
    const authorId = c.req.query("authorId")?.trim() ?? "";
    const limit = Math.min(
      200,
      Number.parseInt(c.req.query("limit") ?? "50", 10) || 50,
    );
    const offset = Number.parseInt(c.req.query("offset") ?? "0", 10) || 0;

    const conditions = [];
    if (q) {
      const pattern = `%${q}%`;
      conditions.push(
        or(like(works.title, pattern), like(works.authorName, pattern)),
      );
    }
    if (status) conditions.push(eq(works.status, status));
    if (provider) conditions.push(eq(works.provider, provider));
    if (authorId) conditions.push(eq(works.authorId, authorId));

    const where =
      conditions.length === 0
        ? undefined
        : conditions.length === 1
          ? conditions[0]
          : and(...conditions);

    const query = db.select().from(works).orderBy(desc(works.updatedAt));
    const rows = where
      ? await query.where(where).limit(limit).offset(offset)
      : await query.limit(limit).offset(offset);

    return c.json(rows.map(toPublicWork));
  });

  app.get("/api/works/:provider/:workId", async (c) => {
    const provider = c.req.param("provider");
    const workId = c.req.param("workId");
    const [row] = await db
      .select()
      .from(works)
      .where(and(eq(works.provider, provider), eq(works.workId, workId)))
      .limit(1);
    if (!row) return c.json({ error: "Not found" }, 404);
    return c.json(toPublicWork(row));
  });

  app.post("/api/works/:provider/:workId/retry", async (c) => {
    const provider = c.req.param("provider");
    const workId = c.req.param("workId");
    const [row] = await db
      .select()
      .from(works)
      .where(and(eq(works.provider, provider), eq(works.workId, workId)))
      .limit(1);
    if (!row) return c.json({ error: "Not found" }, 404);
    await db.insert(downloadJobs).values({
      workDbId: row.id,
      state: "queued",
      progress: 0,
      attempts: 0,
    });
    await db
      .update(works)
      .set({ status: "queued", error: null, updatedAt: new Date().toISOString() })
      .where(eq(works.id, row.id));
    runner.kickDownloads();
    return c.json({ ok: true });
  });

  app.get("/api/works/:provider/:workId/audio", async (c) => {
    const provider = c.req.param("provider") as ProviderId;
    const workId = c.req.param("workId");
    const [row] = await db
      .select()
      .from(works)
      .where(and(eq(works.provider, provider), eq(works.workId, workId)))
      .limit(1);
    if (!row) return c.json({ error: "Not found" }, 404);
    if (row.status !== "downloaded" || !row.audioExt || !row.mediaRelDir) {
      return c.json({ error: "Not downloaded" }, 404);
    }
    const media = mediaWorkDir(
      config.mediaDir,
      provider,
      row.authorId,
      row.workId,
    );
    const audioPath = media.audio(row.audioExt);
    if (!(await pathExists(audioPath))) {
      return c.json({ error: "Audio file missing" }, 404);
    }
    const size = statSync(audioPath).size;
    const contentType =
      row.audioExt === "mp3" ? "audio/mpeg"
      : row.audioExt === "m4a" ? "audio/mp4"
      : "application/octet-stream";
    return streamFile(c, audioPath, size, contentType);
  });

  app.get("/api/works/:provider/:workId/cover", async (c) => {
    const provider = c.req.param("provider") as ProviderId;
    const workId = c.req.param("workId");
    const [row] = await db
      .select()
      .from(works)
      .where(and(eq(works.provider, provider), eq(works.workId, workId)))
      .limit(1);
    if (!row) return c.json({ error: "Not found" }, 404);
    if (!row.coverRelPath) return c.json({ error: "No cover" }, 404);
    const coverPath = path.join(config.mediaDir, row.coverRelPath);
    if (!(await pathExists(coverPath))) {
      return c.json({ error: "Cover file missing" }, 404);
    }
    const contentType = imageMime(path.extname(coverPath).toLowerCase());
    const size = statSync(coverPath).size;
    return streamFile(c, coverPath, size, contentType, {
      "Cache-Control": "private, max-age=3600",
    });
  });

  app.post("/api/works/:provider/:workId/refresh-metadata", async (c) => {
    const provider = c.req.param("provider") as ProviderId;
    const workId = c.req.param("workId");
    try {
      const result = await runner.refreshWorkMetadata(provider, workId);
      return c.json(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes("下载进行中")) {
        return c.json({ error: message }, 409);
      }
      if (message === "Work not found") {
        return c.json({ error: message }, 404);
      }
      return c.json({ error: message }, 400);
    }
  });

  app.get("/api/jobs", async (c) => {
    const rows = await db
      .select({
        id: downloadJobs.id,
        workDbId: downloadJobs.workDbId,
        state: downloadJobs.state,
        progress: downloadJobs.progress,
        attempts: downloadJobs.attempts,
        error: downloadJobs.error,
        createdAt: downloadJobs.createdAt,
        updatedAt: downloadJobs.updatedAt,
        provider: works.provider,
        workId: works.workId,
        title: works.title,
      })
      .from(downloadJobs)
      .leftJoin(works, eq(downloadJobs.workDbId, works.id))
      .orderBy(desc(downloadJobs.id))
      .limit(100);

    return c.json(
      rows.map((r) => ({
        id: r.id,
        workDbId: r.workDbId,
        provider: (r.provider ?? "otobanana") as ProviderId,
        workId: r.workId ?? "",
        title: r.title,
        state: r.state,
        progress: r.progress,
        attempts: r.attempts,
        error: r.error,
        createdAt: r.createdAt,
        updatedAt: r.updatedAt,
      })),
    );
  });

  function toLiveSubscription(
    row: typeof liveSubscriptions.$inferSelect,
  ): LiveSubscriptionPublic {
    return {
      id: row.id,
      provider: row.provider as ProviderId,
      authorId: row.authorId,
      username: row.username,
      displayName: row.displayName,
      enabled: row.enabled,
      syncWorks: row.syncWorks,
      lastOnairAt: row.lastOnairAt,
      lastRoomId: row.lastRoomId,
      lastCheckAt: row.lastCheckAt,
      lastError: row.lastError,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  function toLiveJob(
    row: typeof liveRecordJobs.$inferSelect,
    authorUsername: string | null,
    authorDisplayName: string | null,
  ): LiveRecordJobPublic {
    return {
      id: row.id,
      provider: row.provider as ProviderId,
      authorId: row.authorId,
      authorUsername,
      authorDisplayName,
      roomId: row.roomId,
      postPtrId: row.postPtrId,
      streamService: row.streamService,
      title: row.title,
      state: row.state as LiveJobState,
      startedAt: row.startedAt,
      endedAt: row.endedAt,
      mediaRelPath: row.mediaRelPath,
      error: row.error,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  function toLiveMedia(
    row: typeof liveMedia.$inferSelect,
  ): LiveMediaPublic {
    return {
      id: row.id,
      kind: "live",
      provider: row.provider as ProviderId,
      roomId: row.roomId,
      authorId: row.authorId,
      authorName: row.authorName,
      title: row.title,
      jobId: row.jobId,
      audioExt: row.audioExt,
      mediaRelPath: row.mediaRelPath,
      bytes: row.bytes,
      durationSeconds: row.durationSeconds,
      recordedAt: row.recordedAt,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  async function ensureOtobananaSession(): Promise<Session> {
    const [account] = await db
      .select()
      .from(providerAccounts)
      .where(eq(providerAccounts.provider, "otobanana"))
      .limit(1);
    if (!account) {
      throw new Error("Otobanana provider account not configured");
    }
    // Account `enabled` no longer gates live session / followee APIs.
    return ensureProviderSession(db, config, account);
  }

  app.get("/api/live/subscriptions", async (c) => {
    const rows = await db
      .select()
      .from(liveSubscriptions)
      .orderBy(desc(liveSubscriptions.id));
    return c.json(rows.map(toLiveSubscription));
  });

  /** Author search for manual subscribe (partial match / list candidates). */
  app.get("/api/authors/search", async (c) => {
    const providerRaw = c.req.query("provider")?.trim() ?? "";
    const q = c.req.query("q")?.trim() ?? "";
    if (!q) {
      return c.json({ error: "q is required" }, 400);
    }
    const providerParsed = z
      .enum(["otobanana", "koekoe", "erovoice"])
      .safeParse(providerRaw);
    if (!providerParsed.success) {
      return c.json({ error: "provider is required" }, 400);
    }
    const provider = providerParsed.data as ProviderId;

    try {
      let hits: AuthorSearchHit[] = [];

      if (provider === "otobanana") {
        let token: string | null = null;
        try {
          const session = await ensureOtobananaSession();
          token = sessionData(session).accessToken ?? null;
        } catch {
          // public search allowed
        }
        const rows = await searchOtobananaAuthors(q, token, { limit: 20 });
        hits = rows.map((r) => ({
          provider,
          authorId: r.authorId,
          username: r.username,
          displayName: r.displayName,
        }));
      } else if (provider === "koekoe") {
        let cookie: string | null = null;
        try {
          const [account] = await db
            .select()
            .from(providerAccounts)
            .where(eq(providerAccounts.provider, "koekoe"))
            .limit(1);
          if (account) {
            const session = await ensureProviderSession(db, config, account);
            cookie = sessionData(session).cookieHeader ?? null;
          }
        } catch {
          // public search
        }
        const rows = await searchKoeKoeAuthors(q, cookie);
        hits = rows.map((r) => ({
          provider,
          authorId: r.authorId,
          username: r.username,
          displayName: r.displayName,
        }));
      } else {
        let cookie: string | null = null;
        try {
          const [account] = await db
            .select()
            .from(providerAccounts)
            .where(eq(providerAccounts.provider, "erovoice"))
            .limit(1);
          if (account) {
            const session = await ensureProviderSession(db, config, account);
            cookie = sessionData(session).cookieHeader ?? null;
          }
        } catch {
          // public search
        }
        const rows = await searchErovoiceAuthors(q, cookie);
        hits = rows.map((r) => ({
          provider,
          authorId: r.authorId,
          username: r.username,
          displayName: r.displayName,
        }));
      }

      return c.json(hits);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return c.json({ error: message }, 400);
    }
  });

  app.get("/api/authors/:provider/:authorId", async (c) => {
    const providerRaw = c.req.param("provider");
    const authorId = decodeURIComponent(c.req.param("authorId") ?? "").trim();
    const providerParsed = z
      .enum(["otobanana", "koekoe", "erovoice"])
      .safeParse(providerRaw);
    if (!providerParsed.success) {
      return c.json({ error: "Invalid provider" }, 400);
    }
    if (!authorId || authorId === "_unknown") {
      return c.json({ error: "Invalid authorId" }, 400);
    }
    const provider = providerParsed.data as ProviderId;
    try {
      const author = await getAuthorPublic({
        db,
        mediaRoot: config.mediaDir,
        provider,
        authorId,
        toLiveSubscription,
        ensureOtobananaSession:
          provider === "otobanana" ? ensureOtobananaSession : undefined,
      });
      return c.json(author);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return c.json({ error: message }, 500);
    }
  });

  app.get("/api/authors/:provider/:authorId/avatar", async (c) => {
    const providerRaw = c.req.param("provider");
    const authorId = decodeURIComponent(c.req.param("authorId") ?? "").trim();
    const providerParsed = z
      .enum(["otobanana", "koekoe", "erovoice"])
      .safeParse(providerRaw);
    if (!providerParsed.success) {
      return c.json({ error: "Invalid provider" }, 400);
    }
    if (!authorId || authorId === "_unknown") {
      return c.json({ error: "Not found" }, 404);
    }
    const provider = providerParsed.data as ProviderId;
    const abs = await resolveAuthorAvatarAbsPath({
      db,
      mediaRoot: config.mediaDir,
      provider,
      authorId,
    });
    if (!abs) return c.json({ error: "No avatar" }, 404);
    const contentType = imageMime(path.extname(abs).toLowerCase());
    const size = statSync(abs).size;
    return streamFile(c, abs, size, contentType, {
      "Cache-Control": "private, max-age=3600",
    });
  });

  app.post("/api/live/subscriptions", async (c) => {
    const body: unknown = await c.req.json().catch(() => ({}));
    const parsed = z
      .object({
        input: z.string().min(1).optional(),
        authorId: z.string().min(1).optional(),
        username: z.string().nullable().optional(),
        displayName: z.string().nullable().optional(),
        provider: z.enum(["otobanana", "koekoe", "erovoice"]).optional(),
        syncWorks: z.boolean().optional(),
        enabled: z.boolean().optional(),
      })
      .safeParse(body);
    if (!parsed.success) {
      return c.json({ error: "authorId or input is required" }, 400);
    }
    const hasAuthorId = Boolean(parsed.data.authorId?.trim());
    const hasInput = Boolean(parsed.data.input?.trim());
    if (!hasAuthorId && !hasInput) {
      return c.json({ error: "authorId or input is required" }, 400);
    }
    const provider = (parsed.data.provider ?? "otobanana") as ProviderId;
    // Manual add: default both flags off (user enables explicitly).
    const syncWorks = parsed.data.syncWorks ?? false;
    const enabled = parsed.data.enabled ?? false;
    if (enabled && provider !== "otobanana") {
      return c.json(
        { error: "自动录制仅支持 otobanana" },
        400,
      );
    }

    const now = new Date()
      .toISOString()
      .replace("T", " ")
      .replace(/\.\d{3}Z$/, "");

    try {
      let authorId: string;
      let username: string | null = null;
      let displayName: string | null = null;

      if (hasAuthorId) {
        // Selected from our search results — trust client fields.
        authorId = parsed.data.authorId!.trim();
        username =
          parsed.data.username !== undefined && parsed.data.username !== null
            ? parsed.data.username.trim() || null
            : authorId;
        displayName =
          parsed.data.displayName !== undefined &&
          parsed.data.displayName !== null
            ? parsed.data.displayName.trim() || null
            : username;
      } else if (provider === "otobanana") {
        let token: string | null = null;
        try {
          const session = await ensureOtobananaSession();
          token = sessionData(session).accessToken ?? null;
        } catch {
          // anonymous resolve is fine for public search/onair
        }
        const author = await resolveAuthorByInput(parsed.data.input!, token);
        authorId = author.authorId;
        username = author.username;
        displayName = author.displayName;
      } else {
        // koekoe: author display name for search.php?m=1
        // erovoice: author slug for /{slug}/
        const trimmed = parsed.data.input!.trim().replace(/^\/+|\/+$/g, "");
        if (!trimmed) {
          return c.json({ error: "input is required" }, 400);
        }
        authorId = trimmed;
        username = trimmed;
        displayName = trimmed;
      }

      try {
        await db.insert(liveSubscriptions).values({
          provider,
          authorId,
          username,
          displayName,
          enabled: provider === "otobanana" ? enabled : false,
          syncWorks,
          createdAt: now,
          updatedAt: now,
        });
      } catch {
        return c.json(
          { error: "Author already in subscription list" },
          409,
        );
      }
      const [row] = await db
        .select()
        .from(liveSubscriptions)
        .where(
          and(
            eq(liveSubscriptions.provider, provider),
            eq(liveSubscriptions.authorId, authorId),
          ),
        )
        .limit(1);
      if (!row) return c.json({ error: "Failed to create subscription" }, 500);
      if (provider === "otobanana" && row.enabled) {
        await livePoller.pollNow();
      }
      return c.json(toLiveSubscription(row), 201);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return c.json({ error: message }, 400);
    }
  });

  /** Import platform followees into subscription list (flags default off). */
  app.post("/api/live/subscriptions/import-followees", async (c) => {
    const now = new Date()
      .toISOString()
      .replace("T", " ")
      .replace(/\.\d{3}Z$/, "");
    const results: SubscriptionImportProviderResult[] = [];
    let totalImported = 0;

    // --- Otobanana ---
    {
      const r: SubscriptionImportProviderResult = {
        provider: "otobanana",
        imported: 0,
        existing: 0,
        fetched: 0,
        skipped: null,
        error: null,
      };
      try {
        const [account] = await db
          .select()
          .from(providerAccounts)
          .where(eq(providerAccounts.provider, "otobanana"))
          .limit(1);
        if (!account) {
          r.skipped = "未配置账号";
        } else {
          const session = await ensureProviderSession(db, config, account);
          const token = sessionData(session).accessToken;
          if (!token) {
            r.skipped = "无有效会话";
          } else {
            const selfId = await resolveSelfAuthorId(
              token,
              sessionData(session).userId,
            );
            const followees = await listFolloweeAuthors(token, selfId, {
              maxPages: 50,
            });
            r.fetched = followees.length;
            for (const f of followees) {
              const [exist] = await db
                .select({ id: liveSubscriptions.id })
                .from(liveSubscriptions)
                .where(
                  and(
                    eq(liveSubscriptions.provider, "otobanana"),
                    eq(liveSubscriptions.authorId, f.authorId),
                  ),
                )
                .limit(1);
              if (exist) {
                r.existing += 1;
                continue;
              }
              try {
                await db.insert(liveSubscriptions).values({
                  provider: "otobanana",
                  authorId: f.authorId,
                  username: f.username,
                  displayName: f.displayName,
                  enabled: false,
                  syncWorks: false,
                  createdAt: now,
                  updatedAt: now,
                });
                r.imported += 1;
              } catch {
                r.existing += 1;
              }
            }
          }
        }
      } catch (err) {
        r.error = err instanceof Error ? err.message : String(err);
      }
      totalImported += r.imported;
      results.push(r);
    }

    // --- Erovoice ---
    {
      const r: SubscriptionImportProviderResult = {
        provider: "erovoice",
        imported: 0,
        existing: 0,
        fetched: 0,
        skipped: null,
        error: null,
      };
      try {
        const [account] = await db
          .select()
          .from(providerAccounts)
          .where(eq(providerAccounts.provider, "erovoice"))
          .limit(1);
        if (!account) {
          r.skipped = "未配置账号";
        } else {
          const session = await ensureProviderSession(db, config, account);
          const followees = await listErovoiceFolloweeAuthors(session);
          r.fetched = followees.length;
          for (const f of followees) {
            const [exist] = await db
              .select({
                id: liveSubscriptions.id,
                username: liveSubscriptions.username,
                displayName: liveSubscriptions.displayName,
              })
              .from(liveSubscriptions)
              .where(
                and(
                  eq(liveSubscriptions.provider, "erovoice"),
                  eq(liveSubscriptions.authorId, f.authorId),
                ),
              )
              .limit(1);
            if (exist) {
              r.existing += 1;
              // Re-import: refresh displayName/username when parse has a better name.
              // Keep enabled / syncWorks flags unchanged.
              const betterName =
                f.displayName &&
                f.displayName.trim() &&
                f.displayName !== f.authorId &&
                (!exist.displayName ||
                  exist.displayName === f.authorId ||
                  exist.displayName === exist.username);
              const betterUser =
                f.username &&
                f.username.trim() &&
                (!exist.username || exist.username !== f.username);
              if (betterName || betterUser) {
                await db
                  .update(liveSubscriptions)
                  .set({
                    ...(betterUser ? { username: f.username } : {}),
                    ...(betterName ? { displayName: f.displayName } : {}),
                    updatedAt: now,
                  })
                  .where(eq(liveSubscriptions.id, exist.id));
              }
              continue;
            }
            try {
              await db.insert(liveSubscriptions).values({
                provider: "erovoice",
                authorId: f.authorId,
                username: f.username,
                displayName: f.displayName,
                enabled: false,
                syncWorks: false,
                createdAt: now,
                updatedAt: now,
              });
              r.imported += 1;
            } catch {
              r.existing += 1;
            }
          }
        }
      } catch (err) {
        r.error = err instanceof Error ? err.message : String(err);
      }
      totalImported += r.imported;
      results.push(r);
    }

    // --- Koe-koe: no platform follow list ---
    results.push({
      provider: "koekoe",
      imported: 0,
      existing: 0,
      fetched: 0,
      skipped: "该渠道无关注列表 API，请手动添加",
      error: null,
    });

    const payload: SubscriptionImportResult = {
      providers: results,
      totalImported,
    };
    return c.json(payload);
  });

  app.patch("/api/live/subscriptions/:id", async (c) => {
    const id = Number.parseInt(c.req.param("id"), 10);
    if (!Number.isFinite(id)) return c.json({ error: "Invalid id" }, 400);
    const body: unknown = await c.req.json().catch(() => ({}));
    const parsed = z
      .object({
        enabled: z.boolean().optional(),
        syncWorks: z.boolean().optional(),
      })
      .safeParse(body);
    if (!parsed.success) return c.json({ error: "Invalid body" }, 400);
    if (
      parsed.data.enabled === undefined &&
      parsed.data.syncWorks === undefined
    ) {
      return c.json({ error: "No fields to update" }, 400);
    }

    const [existing] = await db
      .select()
      .from(liveSubscriptions)
      .where(eq(liveSubscriptions.id, id))
      .limit(1);
    if (!existing) return c.json({ error: "Not found" }, 404);

    if (
      parsed.data.enabled === true &&
      existing.provider !== "otobanana"
    ) {
      return c.json({ error: "自动录制仅支持 otobanana" }, 400);
    }

    const now = new Date()
      .toISOString()
      .replace("T", " ")
      .replace(/\.\d{3}Z$/, "");
    await db
      .update(liveSubscriptions)
      .set({
        ...(parsed.data.enabled !== undefined
          ? { enabled: parsed.data.enabled }
          : {}),
        ...(parsed.data.syncWorks !== undefined
          ? { syncWorks: parsed.data.syncWorks }
          : {}),
        updatedAt: now,
      })
      .where(eq(liveSubscriptions.id, id));
    const [row] = await db
      .select()
      .from(liveSubscriptions)
      .where(eq(liveSubscriptions.id, id))
      .limit(1);
    if (!row) return c.json({ error: "Not found" }, 404);
    return c.json(toLiveSubscription(row));
  });

  app.delete("/api/live/subscriptions/:id", async (c) => {
    const id = Number.parseInt(c.req.param("id"), 10);
    if (!Number.isFinite(id)) return c.json({ error: "Invalid id" }, 400);
    await db.delete(liveSubscriptions).where(eq(liveSubscriptions.id, id));
    return c.json({ ok: true });
  });

  app.get("/api/live/followees", async (c) => {
    try {
      const session = await ensureOtobananaSession();
      const token = sessionData(session).accessToken;
      if (!token) {
        return c.json({ error: "Otobanana session missing access token" }, 400);
      }
      const rooms = await listFolloweeLivestreams(token);
      const subs = await db
        .select({ authorId: liveSubscriptions.authorId })
        .from(liveSubscriptions)
        .where(eq(liveSubscriptions.provider, "otobanana"));
      const selected = new Set(subs.map((s) => s.authorId));
      const jobRows = await db
        .select()
        .from(liveRecordJobs)
        .where(eq(liveRecordJobs.provider, "otobanana"))
        .orderBy(desc(liveRecordJobs.id))
        .limit(500);
      const jobByRoom = new Map(jobRows.map((j) => [j.roomId, j]));
      const payload: LiveOnairPublic[] = rooms.map((r) => {
        const job = jobByRoom.get(r.roomId);
        return {
          roomId: r.roomId,
          authorId: r.authorId,
          username: r.username,
          displayName: r.displayName,
          title: r.title,
          postPtrId: r.postPtrId,
          streamService: r.streamService,
          isOpen: r.isOpen,
          isAdult: r.isAdult,
          listenerCount: r.listenerCount,
          roomOpenAt: r.roomOpenAt,
          roomCloseAt: r.roomCloseAt,
          selected: selected.has(r.authorId),
          recordState: job ? (job.state as LiveJobState) : null,
          recordJobId: job?.id ?? null,
          recordError: job?.error ?? null,
        };
      });
      return c.json(payload);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const status = message.includes("not configured") ? 400 : 502;
      return c.json({ error: message }, status);
    }
  });

  app.get("/api/live/followees/history", async (c) => {
    try {
      const status = await historySyncer.getStatus();
      const authorRows = await db
        .select()
        .from(liveFolloweeAuthors)
        .where(eq(liveFolloweeAuthors.provider, "otobanana"));
      const sessionRows = await db
        .select()
        .from(liveFolloweeSessions)
        .where(eq(liveFolloweeSessions.provider, "otobanana"));
      const subs = await db
        .select({ authorId: liveSubscriptions.authorId })
        .from(liveSubscriptions)
        .where(eq(liveSubscriptions.provider, "otobanana"));
      const selected = new Set(subs.map((s) => s.authorId));
      const jobRows = await db
        .select()
        .from(liveRecordJobs)
        .where(eq(liveRecordJobs.provider, "otobanana"))
        .orderBy(desc(liveRecordJobs.id))
        .limit(1000);
      const jobByRoom = new Map(jobRows.map((j) => [j.roomId, j]));

      const sessionsByAuthor = new Map<string, typeof sessionRows>();
      for (const s of sessionRows) {
        const list = sessionsByAuthor.get(s.authorId) ?? [];
        list.push(s);
        sessionsByAuthor.set(s.authorId, list);
      }

      const authors: LiveFolloweeAuthorPublic[] = authorRows
        .map((a) => {
          const sessions = (sessionsByAuthor.get(a.authorId) ?? [])
            .slice()
            .sort((x, y) => {
              if (x.isOpen !== y.isOpen) return Number(y.isOpen) - Number(x.isOpen);
              return (y.roomOpenAt ?? "").localeCompare(x.roomOpenAt ?? "");
            })
            .map((s) => {
              const job = jobByRoom.get(s.roomId);
              return {
                roomId: s.roomId,
                title: s.title,
                postPtrId: s.postPtrId,
                streamService: s.streamService,
                isOpen: s.isOpen,
                isAdult: s.isAdult,
                listenerCount: s.listenerCount,
                roomOpenAt: s.roomOpenAt,
                roomCloseAt: s.roomCloseAt,
                recordState: job ? (job.state as LiveJobState) : null,
                recordJobId: job?.id ?? null,
                recordError: job?.error ?? null,
              };
            });
          return {
            authorId: a.authorId,
            username: a.username,
            displayName: a.displayName,
            selected: selected.has(a.authorId),
            liveNow: sessions.some((s) => s.isOpen),
            sessions,
          };
        })
        .sort((a, b) => {
          if (a.liveNow !== b.liveNow) return Number(b.liveNow) - Number(a.liveNow);
          const aT = a.sessions[0]?.roomOpenAt ?? "";
          const bT = b.sessions[0]?.roomOpenAt ?? "";
          return bT.localeCompare(aT);
        });

      const payload: LiveFolloweeHistoryPublic = {
        authors,
        syncedAt: status.syncedAt,
        lastError: status.lastError,
        syncing: status.syncing,
      };
      return c.json(payload);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return c.json({ error: message }, 500);
    }
  });

  app.post("/api/live/followees/history/sync", async (c) => {
    // Fire-and-forget background refresh; UI keeps reading local cache.
    void historySyncer.syncNow();
    const status = await historySyncer.getStatus();
    return c.json({ ok: true, ...status });
  });

  app.post("/api/live/followees/:authorId/select", async (c) => {
    const authorId = c.req.param("authorId");
    if (!authorId) return c.json({ error: "authorId required" }, 400);
    let token: string | null = null;
    try {
      const session = await ensureOtobananaSession();
      token = sessionData(session).accessToken ?? null;
    } catch {
      // optional
    }
    try {
      const author = await resolveAuthorByInput(authorId, token);
      const now = new Date()
        .toISOString()
        .replace("T", " ")
        .replace(/\.\d{3}Z$/, "");
      try {
        await db.insert(liveSubscriptions).values({
          provider: "otobanana",
          authorId: author.authorId,
          username: author.username,
          displayName: author.displayName,
          enabled: true,
          // Followee select is live-oriented; do not surprise-download VOD.
          syncWorks: false,
          createdAt: now,
          updatedAt: now,
        });
      } catch {
        // already selected — treat as success
      }
      const [row] = await db
        .select()
        .from(liveSubscriptions)
        .where(
          and(
            eq(liveSubscriptions.provider, "otobanana"),
            eq(liveSubscriptions.authorId, author.authorId),
          ),
        )
        .limit(1);
      if (!row) return c.json({ error: "Failed to select author" }, 500);
      await livePoller.pollNow();
      return c.json(toLiveSubscription(row));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return c.json({ error: message }, 400);
    }
  });

  /** Resolve path under mediaDir; null if traversal would escape the root. */
  function resolveUnderMediaRoot(relPath: string): string | null {
    const root = path.resolve(config.mediaDir);
    const full = path.resolve(root, relPath);
    const rel = path.relative(root, full);
    // Reject escape (`..`), absolute re-root, and the media root itself.
    if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) return null;
    return full;
  }

  /**
   * Best-effort delete of a live media file and its room directory.
   * Room dirs are only removed via liveMediaDir (sanitized segments) — never
   * by walking arbitrary parents of mediaRelPath (avoids wiping VOD trees).
   */
  async function removeLiveMediaFiles(
    relPath: string | null | undefined,
    opts?: { provider?: string; authorId?: string; roomId?: string },
  ): Promise<void> {
    if (relPath) {
      const full = resolveUnderMediaRoot(relPath);
      if (full) {
        await rm(full, { force: true }).catch(() => undefined);
      }
    }
    if (opts?.provider && opts.authorId && opts.roomId) {
      const dir = liveMediaDir(
        config.mediaDir,
        opts.provider,
        opts.authorId,
        opts.roomId,
      );
      const root = path.resolve(config.mediaDir);
      const resolved = path.resolve(dir);
      const rel = path.relative(root, resolved);
      // Must stay nested under mediaDir; never allow deleting the root.
      if (rel && !rel.startsWith("..") && !path.isAbsolute(rel)) {
        await rm(resolved, { recursive: true, force: true }).catch(
          () => undefined,
        );
      }
    }
  }

  app.get("/api/live/jobs", async (c) => {
    const rows = await db
      .select({
        job: liveRecordJobs,
        username: liveSubscriptions.username,
        displayName: liveSubscriptions.displayName,
      })
      .from(liveRecordJobs)
      .leftJoin(
        liveSubscriptions,
        and(
          eq(liveSubscriptions.provider, liveRecordJobs.provider),
          eq(liveSubscriptions.authorId, liveRecordJobs.authorId),
        ),
      )
      .orderBy(desc(liveRecordJobs.id))
      .limit(200);
    return c.json(
      rows.map((r) =>
        toLiveJob(r.job, r.username ?? null, r.displayName ?? null),
      ),
    );
  });

  app.delete("/api/live/jobs/:id", async (c) => {
    const id = Number.parseInt(c.req.param("id"), 10);
    if (!Number.isFinite(id)) return c.json({ error: "Invalid id" }, 400);

    const [job] = await db
      .select()
      .from(liveRecordJobs)
      .where(eq(liveRecordJobs.id, id))
      .limit(1);
    if (!job) return c.json({ error: "Not found" }, 404);

    // Stop active recorder before deleting so finalize cannot write back.
    await livePoller.stopRecording(job.id);

    const mediaRows = await db
      .select()
      .from(liveMedia)
      .where(
        or(
          eq(liveMedia.jobId, job.id),
          and(
            eq(liveMedia.provider, job.provider),
            eq(liveMedia.roomId, job.roomId),
          ),
        ),
      );

    for (const m of mediaRows) {
      await removeLiveMediaFiles(m.mediaRelPath, {
        provider: m.provider,
        authorId: m.authorId,
        roomId: m.roomId,
      });
      await db.delete(liveMedia).where(eq(liveMedia.id, m.id));
    }

    // Best-effort clean job media path if media row was already gone.
    if (mediaRows.length === 0) {
      await removeLiveMediaFiles(job.mediaRelPath, {
        provider: job.provider,
        authorId: job.authorId,
        roomId: job.roomId,
      });
    }

    await db.delete(liveRecordJobs).where(eq(liveRecordJobs.id, job.id));
    return c.json({ ok: true });
  });

  app.post("/api/live/poll", async (c) => {
    await livePoller.pollNow();
    return c.json({ ok: true });
  });

  app.get("/api/live/media", async (c) => {
    const q = c.req.query("q")?.trim() ?? "";
    const provider = c.req.query("provider");
    const authorId = c.req.query("authorId")?.trim() ?? "";
    const limit = Math.min(
      200,
      Number.parseInt(c.req.query("limit") ?? "50", 10) || 50,
    );
    const offset = Number.parseInt(c.req.query("offset") ?? "0", 10) || 0;

    const conditions = [];
    if (q) {
      const pattern = `%${q}%`;
      conditions.push(
        or(like(liveMedia.title, pattern), like(liveMedia.authorName, pattern)),
      );
    }
    if (provider) conditions.push(eq(liveMedia.provider, provider));
    if (authorId) conditions.push(eq(liveMedia.authorId, authorId));

    const where =
      conditions.length === 0
        ? undefined
        : conditions.length === 1
          ? conditions[0]
          : and(...conditions);

    const query = db.select().from(liveMedia).orderBy(desc(liveMedia.updatedAt));
    const rows = where
      ? await query.where(where).limit(limit).offset(offset)
      : await query.limit(limit).offset(offset);

    return c.json(rows.map(toLiveMedia));
  });

  app.delete("/api/live/media/:provider/:roomId", async (c) => {
    const provider = c.req.param("provider");
    const roomId = c.req.param("roomId");
    const [row] = await db
      .select()
      .from(liveMedia)
      .where(
        and(eq(liveMedia.provider, provider), eq(liveMedia.roomId, roomId)),
      )
      .limit(1);
    if (!row) return c.json({ error: "Not found" }, 404);

    // Stop linked jobs first so finalize cannot write after file/DB cleanup.
    const jobIds = new Set<number>();
    if (row.jobId != null) jobIds.add(row.jobId);
    const linkedJobs = await db
      .select({ id: liveRecordJobs.id })
      .from(liveRecordJobs)
      .where(
        and(
          eq(liveRecordJobs.provider, row.provider),
          eq(liveRecordJobs.roomId, row.roomId),
        ),
      );
    for (const j of linkedJobs) jobIds.add(j.id);
    for (const jobId of jobIds) {
      await livePoller.stopRecording(jobId);
    }

    // Re-read media path in case finalize updated it during stop.
    const [fresh] = await db
      .select()
      .from(liveMedia)
      .where(
        and(eq(liveMedia.provider, provider), eq(liveMedia.roomId, roomId)),
      )
      .limit(1);
    const media = fresh ?? row;

    await removeLiveMediaFiles(media.mediaRelPath, {
      provider: media.provider,
      authorId: media.authorId,
      roomId: media.roomId,
    });

    for (const jobId of jobIds) {
      await db.delete(liveRecordJobs).where(eq(liveRecordJobs.id, jobId));
    }
    await db
      .delete(liveMedia)
      .where(
        and(eq(liveMedia.provider, provider), eq(liveMedia.roomId, roomId)),
      );
    return c.json({ ok: true });
  });

  app.get("/api/live/media/:provider/:roomId/audio", async (c) => {
    const provider = c.req.param("provider") as ProviderId;
    const roomId = c.req.param("roomId");
    const [row] = await db
      .select()
      .from(liveMedia)
      .where(and(eq(liveMedia.provider, provider), eq(liveMedia.roomId, roomId)))
      .limit(1);
    if (!row) return c.json({ error: "Not found" }, 404);
    const audioPath = path.join(config.mediaDir, row.mediaRelPath);
    if (!(await pathExists(audioPath))) {
      return c.json({ error: "Audio file missing" }, 404);
    }
    const size = statSync(audioPath).size;
    const contentType =
      row.audioExt === "wav" ? "audio/wav"
      : row.audioExt === "ogg" || row.audioExt === "opus" ? "audio/ogg"
      : row.audioExt === "mp3" ? "audio/mpeg"
      : row.audioExt === "m4a" ? "audio/mp4"
      : "application/octet-stream";
    return streamFile(c, audioPath, size, contentType);
  });

  // SPA static (production)
  if (config.webDistDir) {
    const root = config.webDistDir.replace(/\\/g, "/");
    app.use(
      "/*",
      serveStatic({
        root,
        rewriteRequestPath: (p) => {
          if (p.startsWith("/api")) return p;
          return p;
        },
      }),
    );
    app.get("*", async (c) => {
      if (c.req.path.startsWith("/api")) {
        return c.json({ error: "Not found" }, 404);
      }
      const indexPath = path.join(config.webDistDir!, "index.html");
      if (await pathExists(indexPath)) {
        const html = await readFile(indexPath, "utf8");
        return c.html(html);
      }
      return c.text("Web UI not built", 404);
    });
  }

  return app;
}


