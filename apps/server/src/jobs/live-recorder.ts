import { spawn, type ChildProcess } from "node:child_process";
import { access, mkdir, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { and, eq } from "drizzle-orm";
import type { AppConfig } from "../config.js";
import type { AppDatabase } from "../db/client.js";
import {
  liveMedia,
  liveRecordJobs,
  liveSubscriptions,
  type LiveRecordJobRow,
} from "../db/schema.js";
import { liveMediaDir } from "../storage/paths.js";

const MAX_CONCURRENT = 2;
const MAX_MS = 6 * 60 * 60 * 1000;
const MIN_BYTES_OK = 2048;

const NATIVE_CANDIDATES = [
  // Docker / production install path
  "/usr/local/bin/live-record",
  // monorepo: apps/live-record next to apps/server
  path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../../../live-record/live-record",
  ),
  path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../../../live-record/live-record.exe",
  ),
  // when running from apps/server cwd
  path.resolve(process.cwd(), "../live-record/live-record"),
  path.resolve(process.cwd(), "../live-record/live-record.exe"),
  path.resolve(process.cwd(), "apps/live-record/live-record"),
  path.resolve(process.cwd(), "apps/live-record/live-record.exe"),
];

async function canExecuteFile(bin: string): Promise<boolean> {
  try {
    await access(bin);
    return true;
  } catch {
    return false;
  }
}

/**
 * Resolve the required Go/pion live-record binary.
 * Throws a readable error when missing (no browser fallback).
 */
async function resolveNativeBin(config: AppConfig): Promise<string> {
  const preferred = config.liveRecorderBin?.trim();
  if (preferred) {
    if (await canExecuteFile(preferred)) return preferred;
    throw new Error(
      `LIVE_RECORDER_BIN not found: ${preferred}. Build apps/live-record (go build) or set LIVE_RECORDER_BIN to a valid path.`,
    );
  }
  for (const c of NATIVE_CANDIDATES) {
    if (await canExecuteFile(c)) return c;
  }
  // bare name on PATH
  if (await canExecuteFile("live-record")) return "live-record";
  if (process.platform === "win32" && (await canExecuteFile("live-record.exe"))) {
    return "live-record.exe";
  }
  throw new Error(
    "live-record binary not found. Build apps/live-record (cd apps/live-record && go build -o live-record[.exe] .) or set LIVE_RECORDER_BIN.",
  );
}

function nowSql(): string {
  return new Date().toISOString().replace("T", " ").replace(/\.\d{3}Z$/, "");
}

export interface LiveRecorder {
  ensureStarted(job: LiveRecordJobRow, accessToken: string): Promise<void>;
  stop(jobId: number, reason?: "ended" | "failed" | "shutdown"): Promise<void>;
  stopAll(): Promise<void>;
  isActive(jobId: number): boolean;
  activeCount(): number;
}

interface ActiveSession {
  jobId: number;
  abort: AbortController;
  done: Promise<void>;
}

export function createLiveRecorder(
  db: AppDatabase,
  config: AppConfig,
): LiveRecorder {
  const active = new Map<number, ActiveSession>();

  async function setJobState(
    jobId: number,
    patch: {
      state?: string;
      error?: string | null;
      mediaRelPath?: string | null;
      endedAt?: string | null;
    },
  ): Promise<void> {
    await db
      .update(liveRecordJobs)
      .set({
        ...patch,
        updatedAt: nowSql(),
      })
      .where(eq(liveRecordJobs.id, jobId));
  }

  async function upsertLiveMediaForJob(
    job: LiveRecordJobRow,
    mediaPath: string,
    audioExt: string,
    fileBytes: number,
    now: string,
  ): Promise<void> {
    const [sub] = await db
      .select({
        username: liveSubscriptions.username,
        displayName: liveSubscriptions.displayName,
      })
      .from(liveSubscriptions)
      .where(
        and(
          eq(liveSubscriptions.provider, job.provider),
          eq(liveSubscriptions.authorId, job.authorId),
        ),
      )
      .limit(1);
    const authorName =
      sub?.displayName?.trim() || sub?.username?.trim() || null;
    const [existing] = await db
      .select({ id: liveMedia.id })
      .from(liveMedia)
      .where(
        and(
          eq(liveMedia.provider, job.provider),
          eq(liveMedia.roomId, job.roomId),
        ),
      )
      .limit(1);
    const values = {
      authorId: job.authorId,
      authorName,
      title: job.title,
      jobId: job.id,
      audioExt,
      mediaRelPath: mediaPath,
      bytes: fileBytes > 0 ? fileBytes : null,
      recordedAt: now,
      updatedAt: now,
    };
    if (existing) {
      await db
        .update(liveMedia)
        .set(values)
        .where(eq(liveMedia.id, existing.id));
    } else {
      await db.insert(liveMedia).values({
        provider: job.provider,
        roomId: job.roomId,
        ...values,
        createdAt: now,
      });
    }
  }

  async function runNativeSession(
    job: LiveRecordJobRow,
    accessToken: string,
    signal: AbortSignal,
    bin: string,
  ): Promise<void> {
    const postPtrId = job.postPtrId?.trim();
    if (!postPtrId) {
      await setJobState(job.id, {
        state: "blocked",
        error: "Missing post_ptr_id for realtime join",
      });
      return;
    }

    const outDir = liveMediaDir(
      config.mediaDir,
      job.provider,
      job.authorId,
      job.roomId,
    );
    await mkdir(outDir, { recursive: true });
    const outFile = path.join(outDir, "audio.ogg");
    const relPath = path
      .relative(config.mediaDir, outFile)
      .split(path.sep)
      .join("/");

    await setJobState(job.id, { state: "recording", error: null });
    console.log(
      `[live-recorder job=${job.id}] native bin=${bin} post_ptr_id=${postPtrId}`,
    );

    const maxSec = Math.max(1, Math.floor(MAX_MS / 1000));
    const args = [
      "-token",
      accessToken,
      "-post-ptr-id",
      postPtrId,
      "-out",
      outFile,
      "-max-sec",
      String(maxSec),
    ];

    let stderr = "";
    let exitCode: number | null = null;

    try {
      const proc: ChildProcess = spawn(bin, args, {
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      });
      proc.stdout?.on("data", (chunk: Buffer | string) => {
        const line = typeof chunk === "string" ? chunk : chunk.toString("utf8");
        for (const part of line.split(/\r?\n/)) {
          if (part.trim()) console.log(`[live-record job=${job.id}] ${part}`);
        }
      });
      proc.stderr?.on("data", (chunk: Buffer | string) => {
        const text = typeof chunk === "string" ? chunk : chunk.toString("utf8");
        stderr += text;
        if (stderr.length > 8000) stderr = stderr.slice(-8000);
        for (const part of text.split(/\r?\n/)) {
          if (part.trim()) console.log(`[live-record job=${job.id}] ${part}`);
        }
      });

      const onAbort = () => {
        if (proc.killed) return;
        proc.kill("SIGTERM");
        setTimeout(() => {
          if (!proc.killed) proc.kill("SIGKILL");
        }, 3000);
      };
      signal.addEventListener("abort", onAbort, { once: true });

      exitCode = await new Promise<number>((resolve, reject) => {
        proc.once("error", reject);
        proc.once("exit", (code) => resolve(code ?? 1));
      });
      signal.removeEventListener("abort", onAbort);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await setJobState(job.id, {
        state: "failed",
        error: `native recorder spawn failed: ${message}`,
        endedAt: nowSql(),
      });
      return;
    }

    const now = nowSql();
    let fileBytes = 0;
    try {
      const st = await stat(outFile);
      fileBytes = st.size;
    } catch {
      fileBytes = 0;
    }

    if (fileBytes >= MIN_BYTES_OK) {
      await setJobState(job.id, {
        state: "completed",
        mediaRelPath: relPath,
        error: null,
        endedAt: now,
      });
      await upsertLiveMediaForJob(job, relPath, "ogg", fileBytes, now);
      console.log(
        `[live-recorder job=${job.id}] native completed bytes=${fileBytes} exit=${exitCode}`,
      );
      return;
    }

    const detail =
      stderr.trim().split(/\r?\n/).filter(Boolean).slice(-3).join(" | ") ||
      `exit ${exitCode ?? "unknown"}`;
    await setJobState(job.id, {
      state: "failed",
      error: signal.aborted
        ? "Recording aborted"
        : `native recorder failed: ${detail}`,
      endedAt: now,
      mediaRelPath: null,
    });
  }

  async function runSession(
    job: LiveRecordJobRow,
    accessToken: string,
    signal: AbortSignal,
  ): Promise<void> {
    const postPtrId = job.postPtrId?.trim();
    if (!postPtrId) {
      await setJobState(job.id, {
        state: "blocked",
        error: "Missing post_ptr_id for realtime join",
      });
      return;
    }
    if ((job.streamService ?? "").toLowerCase() !== "realtime") {
      await setJobState(job.id, {
        state: "blocked",
        error: `Unsupported stream_service: ${job.streamService ?? "null"}`,
      });
      return;
    }

    let nativeBin: string;
    try {
      nativeBin = await resolveNativeBin(config);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await setJobState(job.id, {
        state: "failed",
        error: message,
        endedAt: nowSql(),
      });
      return;
    }
    await runNativeSession(job, accessToken, signal, nativeBin);
  }

  return {
    isActive(jobId: number) {
      return active.has(jobId);
    },
    activeCount() {
      return active.size;
    },

    async ensureStarted(job: LiveRecordJobRow, accessToken: string) {
      if (active.has(job.id)) return;
      if (job.state !== "pending_media" && job.state !== "recording") return;
      if ((job.streamService ?? "").toLowerCase() !== "realtime") {
        if (job.state === "pending_media") {
          await setJobState(job.id, {
            state: "blocked",
            error: `Unsupported stream_service: ${job.streamService ?? "null"}`,
          });
        }
        return;
      }
      if (!job.postPtrId) {
        await setJobState(job.id, {
          state: "blocked",
          error: "Missing post_ptr_id",
        });
        return;
      }
      if (active.size >= MAX_CONCURRENT) return;

      const abort = new AbortController();
      const session: ActiveSession = {
        jobId: job.id,
        abort,
        done: Promise.resolve(),
      };
      session.done = runSession(job, accessToken, abort.signal)
        .catch((err: unknown) => {
          console.error(
            `[live-recorder job=${job.id}] unhandled`,
            err instanceof Error ? err.message : err,
          );
        })
        .finally(() => {
          active.delete(job.id);
        });
      active.set(job.id, session);
    },

    async stop(
      jobId: number,
      _reason: "ended" | "failed" | "shutdown" = "ended",
    ) {
      const s = active.get(jobId);
      if (!s) return;
      s.abort.abort();
      await s.done.catch(() => undefined);
    },

    async stopAll() {
      const sessions = [...active.values()];
      for (const s of sessions) s.abort.abort();
      await Promise.all(sessions.map((s) => s.done.catch(() => undefined)));
    },
  };
}
