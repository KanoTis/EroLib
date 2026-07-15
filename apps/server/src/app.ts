import { serveStatic } from "@hono/node-server/serve-static";
import { and, desc, eq, like, or, sql } from "drizzle-orm";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { HTTPException } from "hono/http-exception";
import path from "node:path";
import { createReadStream, statSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { Readable } from "node:stream";
import { z } from "zod";
import type {
  AuthMode,
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
  providerAccounts,
  settings,
  syncRuns,
  works,
} from "./db/schema.js";
import type { JobRunner } from "./jobs/runner.js";
import { getProvider } from "./providers/index.js";
import { mediaWorkDir, pathExists } from "./storage/paths.js";

export interface AppDeps {
  config: AppConfig;
  db: AppDatabase;
  runner: JobRunner;
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
  const { config, db, runner } = deps;
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
        implemented: id !== "erovoice",
      })),
    );
  });

  app.post("/api/providers", async (c) => {
    const body: unknown = await c.req.json();
    const parsed = ProviderBody.safeParse(body);
    if (!parsed.success) return c.json({ error: "Invalid body" }, 400);
    const data = parsed.data;
    if (data.provider === "erovoice") {
      return c.json({ error: "Erovoice is MVP-2 only (stub)" }, 400);
    }
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
          status: "unknown",
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

    let encryptedPayload = existing.encryptedPayload;
    let authMode = existing.authMode;
    let username = existing.username;

    if (
      parsed.data.authMode ||
      parsed.data.password ||
      parsed.data.cookieHeader ||
      parsed.data.username !== undefined
    ) {
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
      authMode = next.mode;
      username = next.username ?? null;
      encryptedPayload = JSON.stringify(
        encryptJson(config.credentialsSecret, next),
      );
    }

    const [row] = await db
      .update(providerAccounts)
      .set({
        enabled: parsed.data.enabled ?? existing.enabled,
        authMode,
        username,
        encryptedPayload,
        sessionBlob: null,
        status: "unknown",
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
      const provider = getProvider(account.provider as ProviderId);
      const session = await provider.login({
        mode: payload.mode,
        username: payload.username,
        password: payload.password,
        cookieHeader: payload.cookieHeader,
      });
      const valid = await provider.isSessionValid(session);
      await db
        .update(providerAccounts)
        .set({
          sessionBlob: JSON.stringify(session),
          status: valid ? "ok" : "error",
          statusMessage: valid ? null : "Session invalid after login",
          updatedAt: new Date().toISOString(),
        })
        .where(eq(providerAccounts.id, id));
      return c.json({ ok: valid });
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
