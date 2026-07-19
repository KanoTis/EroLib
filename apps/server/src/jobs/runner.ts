import { and, desc, eq, inArray, ne, sql } from "drizzle-orm";
import { copyFile, rename, rm } from "node:fs/promises";
import path from "node:path";
import type { ProviderId, WorkStatus } from "@erolib/shared";
import type { AppConfig } from "../config.js";
import type { AppDatabase } from "../db/client.js";
import {
  downloadJobs,
  liveSubscriptions,
  providerAccounts,
  syncRuns,
  works,
  type ProviderAccountRow,
  type WorkRow,
} from "../db/schema.js";
import { tagAudioFile } from "../media/id3.js";
import { ensureProviderSession } from "../providers/ensure-session.js";
import { getProvider } from "../providers/index.js";
import {
  cacheJobDir,
  cleanupCacheJob,
  commitCacheToMedia,
  ensureDir,
  isLocalAudioAvailable,
  mediaWorkDir,
  pathExists,
  resolveAuthorId,
  writeJsonAtomic,
} from "../storage/paths.js";

import { fetchToFile } from "../providers/download-utils.js";

export interface JobRunner {
  start(): void;
  stop(): void;
  triggerSync(provider?: ProviderId): Promise<void>;
  kickDownloads(): void;
  refreshWorkMetadata(
    provider: ProviderId,
    workId: string,
  ): Promise<{ ok: true; warning?: string }>;
}

function nowSql(): string {
  return new Date().toISOString().replace("T", " ").replace(/\.\d{3}Z$/, "");
}

export function createJobRunner(
  db: AppDatabase,
  config: AppConfig,
): JobRunner {
  let stopped = false;
  let syncRunning = false;
  let downloadActive = 0;
  let timer: ReturnType<typeof setInterval> | null = null;
  let tickTimer: ReturnType<typeof setTimeout> | null = null;

  async function ensureSession(account: ProviderAccountRow) {
    return ensureProviderSession(db, config, account);
  }

  async function enqueueDownload(work: WorkRow): Promise<boolean> {
    if (work.status === "downloaded") {
      // Re-enqueue only when the local audio is missing or empty.
      if (await isLocalAudioAvailable(config.mediaDir, work)) {
        return false;
      }
    }
    const open = await db
      .select()
      .from(downloadJobs)
      .where(
        and(
          eq(downloadJobs.workDbId, work.id),
          inArray(downloadJobs.state, ["queued", "running"]),
        ),
      )
      .limit(1);
    if (open.length > 0) return false;

    await db.insert(downloadJobs).values({
      workDbId: work.id,
      state: "queued",
      progress: 0,
      attempts: 0,
    });
    await db
      .update(works)
      .set({ status: "queued", updatedAt: nowSql(), error: null })
      .where(eq(works.id, work.id));
    return true;
  }

  /**
   * Upsert a discovered work and enqueue download.
   * `fromFavorites` controls remoteInFavorites (author path must stay false).
   */
  async function upsertWorkFromRef(
    providerId: ProviderId,
    ref: {
      workId: string;
      authorId: string | null;
      title?: string;
      authorName?: string;
    },
    fromFavorites: boolean,
  ): Promise<{ discovered: boolean; enqueued: boolean }> {
    const authorId = resolveAuthorId(ref.authorId);
    const existing = await db
      .select()
      .from(works)
      .where(
        and(eq(works.provider, providerId), eq(works.workId, ref.workId)),
      )
      .limit(1);

    if (existing[0]) {
      await db
        .update(works)
        .set({
          // Author-sourced works must never set remoteInFavorites=true.
          ...(fromFavorites ? { remoteInFavorites: true } : {}),
          title: ref.title ?? existing[0].title,
          authorId: ref.authorId ? authorId : existing[0].authorId,
          authorName: ref.authorName ?? existing[0].authorName,
          updatedAt: nowSql(),
        })
        .where(eq(works.id, existing[0].id));
      const enq = await enqueueDownload(existing[0]);
      return { discovered: true, enqueued: enq };
    }

    const [created] = await db
      .insert(works)
      .values({
        provider: providerId,
        workId: ref.workId,
        authorId,
        authorName: ref.authorName ?? null,
        title: ref.title ?? ref.workId,
        status: "discovered",
        remoteInFavorites: fromFavorites,
      })
      .returning();
    if (created && (await enqueueDownload(created))) {
      return { discovered: true, enqueued: true };
    }
    return { discovered: true, enqueued: false };
  }

  async function syncOne(account: ProviderAccountRow): Promise<void> {
    const providerId = account.provider as ProviderId;
    const [run] = await db
      .insert(syncRuns)
      .values({ provider: providerId })
      .returning();
    if (!run) return;

    let discovered = 0;
    let enqueued = 0;
    let markedNotFavorite = 0;
    const authorErrors: string[] = [];

    try {
      const provider = getProvider(providerId);
      const session = await ensureSession(account);

      // --- Favorites (gated by favoriteSyncEnabled) ---
      if (account.favoriteSyncEnabled) {
        const remoteIds = new Set<string>();

        for await (const ref of provider.listFavorites(session)) {
          remoteIds.add(ref.workId);
          const r = await upsertWorkFromRef(providerId, ref, true);
          if (r.discovered) discovered += 1;
          if (r.enqueued) enqueued += 1;
        }

        const local = await db
          .select()
          .from(works)
          .where(
            and(
              eq(works.provider, providerId),
              eq(works.remoteInFavorites, true),
            ),
          );

        for (const w of local) {
          if (!remoteIds.has(w.workId)) {
            await db
              .update(works)
              .set({ remoteInFavorites: false, updatedAt: nowSql() })
              .where(eq(works.id, w.id));
            markedNotFavorite += 1;
          }
        }
      }

      // --- Author subscriptions (sync_works); independent of favoriteSyncEnabled ---
      const authorSubs = await db
        .select()
        .from(liveSubscriptions)
        .where(
          and(
            eq(liveSubscriptions.provider, providerId),
            eq(liveSubscriptions.syncWorks, true),
          ),
        );

      for (const sub of authorSubs) {
        try {
          for await (const ref of provider.listAuthorWorks(
            session,
            sub.authorId,
          )) {
            // Force authorId when provider list omits it
            const withAuthor = {
              ...ref,
              authorId: ref.authorId ?? sub.authorId,
              authorName:
                ref.authorName ??
                sub.displayName ??
                sub.username ??
                undefined,
            };
            const r = await upsertWorkFromRef(providerId, withAuthor, false);
            if (r.discovered) discovered += 1;
            if (r.enqueued) enqueued += 1;
          }
          await db
            .update(liveSubscriptions)
            .set({
              lastCheckAt: nowSql(),
              lastError: null,
              updatedAt: nowSql(),
            })
            .where(eq(liveSubscriptions.id, sub.id));
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          authorErrors.push(`${sub.authorId}: ${message}`);
          await db
            .update(liveSubscriptions)
            .set({
              lastCheckAt: nowSql(),
              lastError: message,
              updatedAt: nowSql(),
            })
            .where(eq(liveSubscriptions.id, sub.id));
        }
      }

      // Persist possibly refreshed session cookies
      await db
        .update(providerAccounts)
        .set({
          sessionBlob: JSON.stringify(session),
          status: "ok",
          statusMessage: null,
          updatedAt: nowSql(),
        })
        .where(eq(providerAccounts.id, account.id));

      await db
        .update(syncRuns)
        .set({
          finishedAt: nowSql(),
          discovered,
          enqueued,
          markedNotFavorite,
          error:
            authorErrors.length > 0
              ? `author sync: ${authorErrors.slice(0, 5).join("; ")}`
              : null,
        })
        .where(eq(syncRuns.id, run.id));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await db
        .update(providerAccounts)
        .set({
          status: "error",
          statusMessage: message,
          updatedAt: nowSql(),
        })
        .where(eq(providerAccounts.id, account.id));
      await db
        .update(syncRuns)
        .set({
          finishedAt: nowSql(),
          discovered,
          enqueued,
          markedNotFavorite,
          error: message,
        })
        .where(eq(syncRuns.id, run.id));
    }
  }

  async function runSync(provider?: ProviderId): Promise<void> {
    if (syncRunning) return;
    syncRunning = true;
    try {
      // All configured accounts: favorites gated inside syncOne; author works always when subscribed.
      const accounts = await db.select().from(providerAccounts);
      for (const account of accounts) {
        if (provider && account.provider !== provider) continue;
        // Skip account only when neither favorites nor author sync applies.
        if (!account.favoriteSyncEnabled) {
          const [hasAuthor] = await db
            .select({ id: liveSubscriptions.id })
            .from(liveSubscriptions)
            .where(
              and(
                eq(liveSubscriptions.provider, account.provider),
                eq(liveSubscriptions.syncWorks, true),
              ),
            )
            .limit(1);
          if (!hasAuthor) continue;
        }
        await syncOne(account);
      }
    } finally {
      syncRunning = false;
      kickDownloads();
    }
  }

  async function processJob(jobId: number): Promise<void> {
    const [job] = await db
      .select()
      .from(downloadJobs)
      .where(eq(downloadJobs.id, jobId))
      .limit(1);
    if (!job) return;

    const [work] = await db
      .select()
      .from(works)
      .where(eq(works.id, job.workDbId))
      .limit(1);
    if (!work) {
      await db
        .update(downloadJobs)
        .set({ state: "failed", error: "Work missing", updatedAt: nowSql() })
        .where(eq(downloadJobs.id, jobId));
      return;
    }

    const [account] = await db
      .select()
      .from(providerAccounts)
      .where(eq(providerAccounts.provider, work.provider))
      .limit(1);
    if (!account) {
      await db
        .update(downloadJobs)
        .set({
          state: "failed",
          error: "Provider account missing",
          updatedAt: nowSql(),
        })
        .where(eq(downloadJobs.id, jobId));
      await db
        .update(works)
        .set({ status: "failed", error: "Provider account missing", updatedAt: nowSql() })
        .where(eq(works.id, work.id));
      return;
    }

    await db
      .update(downloadJobs)
      .set({
        state: "running",
        attempts: job.attempts + 1,
        progress: 0,
        updatedAt: nowSql(),
        error: null,
      })
      .where(eq(downloadJobs.id, jobId));
    await db
      .update(works)
      .set({ status: "downloading" satisfies WorkStatus, updatedAt: nowSql(), error: null })
      .where(eq(works.id, work.id));

    const cacheDir = cacheJobDir(config.cacheDir, jobId);
    await ensureDir(cacheDir);

    try {
      const provider = getProvider(work.provider as ProviderId);
      const session = await ensureSession(account);
      const meta = await provider.getWork(session, work.workId);
      const result = await provider.download(
        session,
        meta,
        cacheDir,
        (p) => {
          const progress =
            p.bytesTotal && p.bytesTotal > 0
              ? Math.min(0.99, p.bytesReceived / p.bytesTotal)
              : 0.1;
          void db
            .update(downloadJobs)
            .set({ progress, updatedAt: nowSql() })
            .where(eq(downloadJobs.id, jobId));
        },
      );

      const media = mediaWorkDir(
        config.mediaDir,
        work.provider as ProviderId,
        meta.authorId ?? work.authorId,
        work.workId,
      );
      await ensureDir(media.dir);
      await writeJsonAtomic(media.metaJson, {
        ...meta,
        downloadedAt: new Date().toISOString(),
      });

      const audioName = path.basename(result.audioPath);
      const coverName = result.coverPath
        ? path.basename(result.coverPath)
        : null;

      // Soft-fail ID3: tagging must not block a successful download.
      await tagAudioFile({
        audioPath: result.audioPath,
        meta: result.meta ?? meta,
        coverPath: result.coverPath ?? null,
      });

      await commitCacheToMedia({
        cacheDir,
        mediaDir: media.dir,
        audioFileName: audioName,
        coverFileName: coverName,
      });

      const relDir = path.relative(config.mediaDir, media.dir);
      await db
        .update(works)
        .set({
          status: "downloaded",
          title: meta.title,
          description: meta.description ?? null,
          authorId: resolveAuthorId(meta.authorId ?? work.authorId),
          authorName: meta.authorName ?? work.authorName,
          durationSeconds: meta.durationSeconds ?? null,
          audioExt: result.audioExt,
          coverRelPath: coverName ? path.join(relDir, coverName) : null,
          mediaRelDir: relDir,
          checksumSha256: result.checksumSha256 ?? null,
          metaJson: JSON.stringify(meta),
          error: null,
          downloadedAt: nowSql(),
          updatedAt: nowSql(),
        })
        .where(eq(works.id, work.id));

      await db
        .update(downloadJobs)
        .set({
          state: "done",
          progress: 1,
          updatedAt: nowSql(),
          error: null,
        })
        .where(eq(downloadJobs.id, jobId));

      await cleanupCacheJob(config.cacheDir, jobId);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await db
        .update(downloadJobs)
        .set({
          state: "failed",
          error: message,
          updatedAt: nowSql(),
        })
        .where(eq(downloadJobs.id, jobId));
      await db
        .update(works)
        .set({ status: "failed", error: message, updatedAt: nowSql() })
        .where(eq(works.id, work.id));
    }
  }

  function kickDownloads(): void {
    if (stopped) return;
    if (tickTimer) return;
    tickTimer = setTimeout(() => {
      tickTimer = null;
      void pumpDownloads();
    }, 50);
  }

  async function pumpDownloads(): Promise<void> {
    if (stopped) return;
    while (downloadActive < config.maxDownloadConcurrency) {
      const [next] = await db
        .select()
        .from(downloadJobs)
        .where(eq(downloadJobs.state, "queued"))
        .orderBy(downloadJobs.id)
        .limit(1);
      if (!next) break;

      // optimistic claim
      const claimed = await db
        .update(downloadJobs)
        .set({ state: "running", updatedAt: nowSql() })
        .where(
          and(
            eq(downloadJobs.id, next.id),
            eq(downloadJobs.state, "queued"),
          ),
        )
        .returning();
      if (claimed.length === 0) continue;

      downloadActive += 1;
      void processJob(next.id)
        .catch(() => undefined)
        .finally(() => {
          downloadActive -= 1;
          kickDownloads();
        });
    }
  }

  async function recoverOnStart(): Promise<void> {
    await db
      .update(downloadJobs)
      .set({ state: "queued", updatedAt: nowSql() })
      .where(eq(downloadJobs.state, "running"));
    await db
      .update(works)
      .set({ status: "queued", updatedAt: nowSql() })
      .where(eq(works.status, "downloading"));
    kickDownloads();
  }

  async function renameSafeLocal(src: string, dest: string): Promise<void> {
    try {
      await rename(src, dest);
    } catch {
      await copyFile(src, dest);
      await rm(src, { force: true });
    }
  }

  async function refreshWorkMetadata(
    providerId: ProviderId,
    workId: string,
  ): Promise<{ ok: true; warning?: string }> {
    const [work] = await db
      .select()
      .from(works)
      .where(and(eq(works.provider, providerId), eq(works.workId, workId)))
      .limit(1);
    if (!work) throw new Error("Work not found");

    const active = await db
      .select({ id: downloadJobs.id })
      .from(downloadJobs)
      .where(
        and(
          eq(downloadJobs.workDbId, work.id),
          inArray(downloadJobs.state, ["queued", "running"]),
        ),
      )
      .limit(1);
    if (active.length > 0) {
      throw new Error("下载进行中，请稍后再刷新元数据");
    }

    const [account] = await db
      .select()
      .from(providerAccounts)
      .where(eq(providerAccounts.provider, providerId))
      .limit(1);
    if (!account) throw new Error("Provider account missing");

    const provider = getProvider(providerId);
    const session = await ensureSession(account);
    const meta = await provider.getWork(session, work.workId);

    const authorId = resolveAuthorId(meta.authorId ?? work.authorId);
    const media = mediaWorkDir(
      config.mediaDir,
      providerId,
      authorId,
      work.workId,
    );
    await ensureDir(media.dir);

    let coverRelPath: string | null = work.coverRelPath;
    let coverAbs: string | null = null;

    if (meta.coverUrl) {
      try {
        const coverTmp = path.join(media.dir, "cover.refresh");
        const cover = await fetchToFile({
          url: meta.coverUrl,
          destPath: coverTmp,
        });
        const coverExt = cover.ext === "bin" ? "jpg" : cover.ext;
        const coverFinal = media.cover(coverExt);
        try {
          await renameSafeLocal(cover.path, coverFinal);
        } catch {
          // leave missing cover
        }
        if (await pathExists(coverFinal)) {
          coverAbs = coverFinal;
          coverRelPath = path.relative(config.mediaDir, coverFinal);
        }
      } catch {
        // keep previous cover
      }
    } else if (providerId === "koekoe") {
      // Drop any previously-mis-saved gender-icon cover.
      coverRelPath = null;
    } else if (work.coverRelPath) {
      const existing = path.join(config.mediaDir, work.coverRelPath);
      if (await pathExists(existing)) coverAbs = existing;
    }

    await writeJsonAtomic(media.metaJson, {
      ...meta,
      refreshedAt: new Date().toISOString(),
      downloadedAt: work.downloadedAt,
    });

    let warning: string | undefined;
    if (work.status === "downloaded" && work.audioExt) {
      const audioPath = media.audio(work.audioExt);
      if (await pathExists(audioPath)) {
        const tag = await tagAudioFile({
          audioPath,
          meta,
          coverPath: coverAbs,
        });
        if (!tag.tagged && tag.reason) {
          warning = `ID3: ${tag.reason}`;
        }
      }
    }

    await db
      .update(works)
      .set({
        title: meta.title,
        description: meta.description ?? null,
        authorId,
        authorName: meta.authorName ?? work.authorName,
        durationSeconds: meta.durationSeconds ?? null,
        coverRelPath,
        mediaRelDir: path.relative(config.mediaDir, media.dir),
        metaJson: JSON.stringify(meta),
        updatedAt: nowSql(),
        error: null,
      })
      .where(eq(works.id, work.id));

    await db
      .update(providerAccounts)
      .set({
        sessionBlob: JSON.stringify(session),
        status: "ok",
        statusMessage: null,
        updatedAt: nowSql(),
      })
      .where(eq(providerAccounts.id, account.id));

    return warning ? { ok: true, warning } : { ok: true };
  }

  return {
    start() {
      stopped = false;
      void recoverOnStart();
      const ms = Math.max(1, config.syncIntervalHours) * 60 * 60 * 1000;
      timer = setInterval(() => {
        void runSync();
      }, ms);
    },
    stop() {
      stopped = true;
      clearInterval(timer ?? undefined);
      clearTimeout(tickTimer ?? undefined);
      timer = null;
      tickTimer = null;
    },
    async triggerSync(provider?: ProviderId) {
      await runSync(provider);
    },
    kickDownloads,
    refreshWorkMetadata,
  };
}

// silence unused imports if tree-shake complains in some configs
void desc;
void ne;
void sql;
