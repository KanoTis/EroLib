import { serveStatic } from "@hono/node-server/serve-static";
import { and, desc, eq, like, or, sql } from "drizzle-orm";
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
  type ProviderAccountRow,
} from "./db/schema.js";
import type { LiveHistorySyncer } from "./jobs/live-history-sync.js";
import type { LivePoller } from "./jobs/live-poller.js";
import type { JobRunner } from "./jobs/runner.js";
import { getProvider } from "./providers/index.js";
import {
  listFolloweeLivestreams,
  resolveAuthorByInput,
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
  enabled: z.boolean().optional(),
  authMode: z.enum(["password", "cookie"]),
  username: z.string().optional(),
  password: z.string().optional(),
  cookieHeader: z.string().optional(),
});

const ProviderPatch = z.object({
  enabled: z.boolean().optional(),
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

function sourceUrlFromMeta(metaJson: string | null, provider: ProviderId, workId: string): string | null {
  if (metaJson) {
    try {
      const parsed: unknown = JSON.parse(metaJson);
      if (
        parsed &&
        typeof parsed === "object" &&
        "sourceUrl" in parsed &&
        typeof (parsed as { sourceUrl?: unknown }).sourceUrl === "string"
      ) {
        return (parsed as { sourceUrl: string }).sourceUrl;
      }
    } catch {
      // fall through
    }
  }
  if (provider === "koekoe") {
    return `https://koe-koe.com/detail.php?n=${encodeURIComponent(workId)}`;
  }
  if (provider === "otobanana") {
    return `https://otobanana.com/general/cast/${encodeURIComponent(workId)}`;
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
          enabled: data.enabled ?? true,
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
          enabled: parsed.data.enabled ?? existing.enabled,
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
        enabled: parsed.data.enabled ?? existing.enabled,
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
    const st = statSync(audioPath);
    const size = st.size;
    const range = c.req.header("range");
    const contentType =
      row.audioExt === "mp3"
        ? "audio/mpeg"
        : row.audioExt === "m4a"
          ? "audio/mp4"
          : "application/octet-stream";

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
        const stream = createReadStream(audioPath, { start, end });
        return c.body(Readable.toWeb(stream) as ReadableStream, 206, {
          "Content-Range": `bytes ${start}-${end}/${size}`,
          "Accept-Ranges": "bytes",
          "Content-Length": String(chunkSize),
          "Content-Type": contentType,
        });
      }
    }

    const stream = createReadStream(audioPath);
    return c.body(Readable.toWeb(stream) as ReadableStream, 200, {
      "Content-Length": String(size),
      "Accept-Ranges": "bytes",
      "Content-Type": contentType,
    });
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
    const ext = path.extname(coverPath).toLowerCase();
    const contentType =
      ext === ".png"
        ? "image/png"
        : ext === ".webp"
          ? "image/webp"
          : ext === ".gif"
            ? "image/gif"
            : "image/jpeg";
    const st = statSync(coverPath);
    const stream = createReadStream(coverPath);
    return c.body(Readable.toWeb(stream) as ReadableStream, 200, {
      "Content-Length": String(st.size),
      "Content-Type": contentType,
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

  function parseSessionBlob(blob: string | null): Session | null {
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

  async function ensureOtobananaSession(): Promise<Session> {
    const [account] = await db
      .select()
      .from(providerAccounts)
      .where(eq(providerAccounts.provider, "otobanana"))
      .limit(1);
    if (!account) {
      throw new Error("Otobanana provider account not configured");
    }
    if (!account.enabled) {
      throw new Error("Otobanana provider account is disabled");
    }
    return ensureProviderSession(account);
  }

  async function ensureProviderSession(
    account: ProviderAccountRow,
  ): Promise<Session> {
    const provider = getProvider(account.provider as ProviderId);
    let creds: CredentialPayload;
    try {
      const raw: unknown = JSON.parse(account.encryptedPayload);
      if (!raw || typeof raw !== "object" || !("v" in raw) || !("data" in raw)) {
        throw new Error("Invalid credential blob");
      }
      creds = decryptJson<CredentialPayload>(
        config.credentialsSecret,
        raw as EncryptedBlob,
      );
    } catch {
      throw new Error("Failed to decrypt provider credentials");
    }
    const existing = parseSessionBlob(account.sessionBlob);
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
    const now = new Date()
      .toISOString()
      .replace("T", " ")
      .replace(/\.\d{3}Z$/, "");
    await db
      .update(providerAccounts)
      .set({
        sessionBlob: JSON.stringify(session),
        status: "ok",
        statusMessage: null,
        updatedAt: now,
      })
      .where(eq(providerAccounts.id, account.id));
    return session;
  }

  app.get("/api/live/subscriptions", async (c) => {
    const rows = await db
      .select()
      .from(liveSubscriptions)
      .orderBy(desc(liveSubscriptions.id));
    return c.json(rows.map(toLiveSubscription));
  });

  app.post("/api/live/subscriptions", async (c) => {
    const body: unknown = await c.req.json().catch(() => ({}));
    const parsed = z
      .object({
        input: z.string().min(1),
      })
      .safeParse(body);
    if (!parsed.success) {
      return c.json({ error: "input is required" }, 400);
    }
    let token: string | null = null;
    try {
      const session = await ensureOtobananaSession();
      token = sessionData(session).accessToken ?? null;
    } catch {
      // anonymous resolve is fine for public search/onair
    }
    try {
      const author = await resolveAuthorByInput(parsed.data.input, token);
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
          createdAt: now,
          updatedAt: now,
        });
      } catch {
        return c.json({ error: "Author already in live subscription list" }, 409);
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
      if (!row) return c.json({ error: "Failed to create subscription" }, 500);
      await livePoller.pollNow();
      return c.json(toLiveSubscription(row), 201);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return c.json({ error: message }, 400);
    }
  });

  app.patch("/api/live/subscriptions/:id", async (c) => {
    const id = Number.parseInt(c.req.param("id"), 10);
    if (!Number.isFinite(id)) return c.json({ error: "Invalid id" }, 400);
    const body: unknown = await c.req.json().catch(() => ({}));
    const parsed = z
      .object({
        enabled: z.boolean().optional(),
      })
      .safeParse(body);
    if (!parsed.success) return c.json({ error: "Invalid body" }, 400);
    if (parsed.data.enabled === undefined) {
      return c.json({ error: "No fields to update" }, 400);
    }
    const now = new Date()
      .toISOString()
      .replace("T", " ")
      .replace(/\.\d{3}Z$/, "");
    await db
      .update(liveSubscriptions)
      .set({
        enabled: parsed.data.enabled,
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
    const st = statSync(audioPath);
    const size = st.size;
    const range = c.req.header("range");
    const contentType =
      row.audioExt === "wav"
        ? "audio/wav"
        : row.audioExt === "mp3"
          ? "audio/mpeg"
          : row.audioExt === "m4a"
            ? "audio/mp4"
            : "application/octet-stream";

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
        const stream = createReadStream(audioPath, { start, end });
        return c.body(Readable.toWeb(stream) as ReadableStream, 206, {
          "Content-Range": `bytes ${start}-${end}/${size}`,
          "Accept-Ranges": "bytes",
          "Content-Length": String(chunkSize),
          "Content-Type": contentType,
        });
      }
    }

    const stream = createReadStream(audioPath);
    return c.body(Readable.toWeb(stream) as ReadableStream, 200, {
      "Content-Length": String(size),
      "Accept-Ranges": "bytes",
      "Content-Type": contentType,
    });
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

// keep sql import available for future aggregates
void sql;
