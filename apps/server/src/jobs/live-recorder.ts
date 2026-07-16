import { createWriteStream, type WriteStream } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { and, eq } from "drizzle-orm";
import {
  chromium,
  type Browser,
  type BrowserContext,
  type Page,
} from "playwright";
import type { AppConfig } from "../config.js";
import type { AppDatabase } from "../db/client.js";
import {
  liveMedia,
  liveRecordJobs,
  liveSubscriptions,
  type LiveRecordJobRow,
} from "../db/schema.js";
import { liveMediaDir } from "../storage/paths.js";

const API_BASE = "https://api.v2.otobanana.com";
const WS_BASE = "wss://api.v3.otobanana.com/ws";
const MAX_CONCURRENT = 2;
const MAX_MS = 6 * 60 * 60 * 1000;
const MIN_BYTES_OK = 2048;

const SCRIPT_PATH = fileURLToPath(
  new URL("./live-browser-script.js", import.meta.url),
);

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

interface PageStatus {
  done: string | null;
  error: string | null;
}

interface BrowserRecordArgs {
  apiBase: string;
  wsBase: string;
  postPtrId: string;
  token: string;
  maxMs: number;
}

let cachedScriptSource: string | null = null;

async function loadBrowserScriptSource(): Promise<string> {
  if (cachedScriptSource) return cachedScriptSource;
  cachedScriptSource = await readFile(SCRIPT_PATH, "utf8");
  return cachedScriptSource;
}

/**
 * Build a page.evaluate-compatible function from the plain JS module source.
 * Avoids tsx/esbuild `__name` helpers that break Playwright serialization.
 */
async function makeBrowserFns(): Promise<{
  recordMain: (args: BrowserRecordArgs) => Promise<void>;
  readStatus: () => PageStatus;
  requestStop: () => Promise<void>;
}> {
  const source = await loadBrowserScriptSource();
  // Transform ESM exports into local bindings for Function body.
  const body = `
${source
  .replace(/export async function browserRecordMain/g, "async function browserRecordMain")
  .replace(/export function browserReadStatus/g, "function browserReadStatus")
  .replace(/export async function browserRequestStop/g, "async function browserRequestStop")}
return { browserRecordMain, browserReadStatus, browserRequestStop };
`;
  // eslint-disable-next-line @typescript-eslint/no-implied-eval -- intentional: load plain browser script without bundler helpers
  const factory = new Function(body) as () => {
    browserRecordMain: (args: BrowserRecordArgs) => Promise<void>;
    browserReadStatus: () => PageStatus;
    browserRequestStop: () => Promise<void>;
  };
  const fns = factory();
  return {
    recordMain: fns.browserRecordMain,
    readStatus: fns.browserReadStatus,
    requestStop: fns.browserRequestStop,
  };
}

export function createLiveRecorder(
  db: AppDatabase,
  config: AppConfig,
): LiveRecorder {
  const active = new Map<number, ActiveSession>();
  let browser: Browser | null = null;
  let launching: Promise<Browser> | null = null;
  let browserFns: Awaited<ReturnType<typeof makeBrowserFns>> | null = null;

  async function getBrowserFns() {
    if (!browserFns) browserFns = await makeBrowserFns();
    return browserFns;
  }

  async function getBrowser(): Promise<Browser> {
    if (browser?.isConnected()) return browser;
    if (launching) return launching;
    launching = chromium
      .launch({
        headless: true,
        args: [
          "--autoplay-policy=no-user-gesture-required",
          "--disable-dev-shm-usage",
        ],
      })
      .then((b) => {
        browser = b;
        launching = null;
        return b;
      })
      .catch((err: unknown) => {
        launching = null;
        throw err;
      });
    return launching;
  }

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

    const outDir = liveMediaDir(
      config.mediaDir,
      job.provider,
      job.authorId,
      job.roomId,
    );
    await mkdir(outDir, { recursive: true });
    const pcmFile = path.join(outDir, "audio.pcm");
    const outFile = path.join(outDir, "audio.wav");
    const relPath = path
      .relative(config.mediaDir, outFile)
      .split(path.sep)
      .join("/");

    let context: BrowserContext | null = null;
    let page: Page | null = null;
    let stream: WriteStream | null = null;
    let bytes = 0;
    let sampleRate = 48000;
    let finalized = false;
    const fns = await getBrowserFns();

    const finalize = async (
      state: "completed" | "failed" | "ended",
      error?: string | null,
    ): Promise<void> => {
      if (finalized) return;
      finalized = true;
      try {
        if (page && !page.isClosed()) {
          await page.evaluate(fns.requestStop).catch(() => undefined);
        }
      } catch {
        // ignore
      }
      try {
        await page?.close({ runBeforeUnload: false });
      } catch {
        // ignore
      }
      try {
        await context?.close();
      } catch {
        // ignore
      }
      await new Promise<void>((resolve) => {
        if (!stream) return resolve();
        stream.end(() => resolve());
      });

      // Wrap PCM int16 LE mono into WAV if we captured anything.
      if (bytes > 0) {
        try {
          const pcm = await readFile(pcmFile);
          const header = Buffer.alloc(44);
          const dataSize = pcm.length;
          header.write("RIFF", 0);
          header.writeUInt32LE(36 + dataSize, 4);
          header.write("WAVE", 8);
          header.write("fmt ", 12);
          header.writeUInt32LE(16, 16); // PCM chunk size
          header.writeUInt16LE(1, 20); // audio format PCM
          header.writeUInt16LE(1, 22); // mono
          header.writeUInt32LE(sampleRate, 24);
          header.writeUInt32LE(sampleRate * 2, 28); // byte rate
          header.writeUInt16LE(2, 32); // block align
          header.writeUInt16LE(16, 34); // bits per sample
          header.write("data", 36);
          header.writeUInt32LE(dataSize, 40);
          await writeFile(outFile, Buffer.concat([header, pcm]));
          await rm(pcmFile, { force: true });
          console.log(
            `[live-recorder job=${job.id}] wrote wav bytes=${dataSize + 44} rate=${sampleRate}`,
          );
        } catch (err) {
          console.error(
            `[live-recorder job=${job.id}] wav wrap failed`,
            err instanceof Error ? err.message : err,
          );
        }
      }

      const now = nowSql();
      const fileBytes = bytes > 0 ? bytes + 44 : 0;

      async function upsertLiveMedia(mediaPath: string): Promise<void> {
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
          sub?.displayName?.trim() ||
          sub?.username?.trim() ||
          null;
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
          audioExt: "wav",
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

      if (
        state === "completed" ||
        (state === "ended" && bytes >= MIN_BYTES_OK)
      ) {
        await setJobState(job.id, {
          state: "completed",
          mediaRelPath: relPath,
          error: null,
          endedAt: now,
        });
        await upsertLiveMedia(relPath);
        return;
      }
      if (state === "ended") {
        await setJobState(job.id, {
          state: "failed",
          error: error ?? "Live ended but recorded file too small",
          endedAt: now,
          mediaRelPath: bytes >= MIN_BYTES_OK ? relPath : null,
        });
        if (bytes >= MIN_BYTES_OK) await upsertLiveMedia(relPath);
        return;
      }
      await setJobState(job.id, {
        state: "failed",
        error: error ?? "Live recording failed",
        endedAt: now,
        mediaRelPath: bytes >= MIN_BYTES_OK ? relPath : null,
      });
      if (bytes >= MIN_BYTES_OK) await upsertLiveMedia(relPath);
    };

    const onAbort = () => {
      // Give MediaRecorder a moment via browser stop path is best-effort;
      // finalize after current tick so any in-flight append can complete.
      setTimeout(() => {
        void finalize(
          bytes >= MIN_BYTES_OK ? "completed" : "failed",
          bytes >= MIN_BYTES_OK ? null : "Recording aborted",
        );
      }, 1500);
    };
    signal.addEventListener("abort", onAbort, { once: true });

    try {
      await setJobState(job.id, { state: "recording", error: null });
      const b = await getBrowser();
      if (signal.aborted) {
        await finalize("failed", "Recording aborted before start");
        return;
      }
      context = await b.newContext();
      page = await context.newPage();

      // Must be on otobanana origin so browser fetch CORS/Origin work.
      await page.goto("https://otobanana.com/", {
        waitUntil: "domcontentloaded",
        timeout: 60_000,
      });

      // Bind after navigation so the page context is ready.
      // Write raw PCM first; wrap to WAV in finalize.
      stream = createWriteStream(pcmFile);
      await page.exposeFunction(
        "__erolibAppend",
        (arr: number[]) =>
          new Promise<void>((resolve, reject) => {
            if (!stream || finalized) return resolve();
            const buf = Buffer.from(Uint8Array.from(arr));
            bytes += buf.length;
            if (bytes === buf.length || bytes % 50_000 < buf.length) {
              console.log(
                `[live-recorder job=${job.id}] append +${buf.length} total=${bytes}`,
              );
            }
            stream.write(buf, (e) => (e ? reject(e) : resolve()));
          }),
      );
      await page.exposeFunction("__erolibSampleRate", (rate: number) => {
        if (Number.isFinite(rate) && rate > 0) sampleRate = Math.floor(rate);
      });
      await page.exposeFunction("__erolibLog", (msg: string) => {
        console.log(`[live-recorder job=${job.id}] ${msg}`);
      });

      // Attach catch immediately so abort/close never becomes unhandled rejection.
      const browserDone = page
        .evaluate(fns.recordMain, {
          apiBase: API_BASE,
          wsBase: WS_BASE,
          postPtrId,
          token: accessToken,
          maxMs: MAX_MS,
        })
        .then(
          () => undefined as void,
          (err: unknown) => {
            const message =
              err instanceof Error ? err.message : String(err);
            // Ignore expected close races; real failures are handled via status/finalize.
            if (
              !/Target page, context or browser has been closed/i.test(message)
            ) {
              console.error(
                `[live-recorder job=${job.id}] evaluate`,
                message,
              );
            }
          },
        );
      const deadline = Date.now() + MAX_MS + 60_000;
      while (Date.now() < deadline && !finalized && !signal.aborted) {
        const status = await page.evaluate(fns.readStatus);
        if (status.error && status.done) {
          await finalize("failed", status.error);
          await browserDone.catch(() => undefined);
          return;
        }
        if (status.done) {
          await finalize(
            bytes >= MIN_BYTES_OK ? "completed" : "ended",
            status.error,
          );
          await browserDone.catch(() => undefined);
          return;
        }
        const settled = await Promise.race([
          browserDone.then(
            () => "done" as const,
            (err: unknown) => err,
          ),
          new Promise<"wait">((r) => setTimeout(() => r("wait"), 1000)),
        ]);
        if (settled === "done") {
          const finalStatus = await page.evaluate(fns.readStatus);
          if (finalStatus.error) {
            await finalize("failed", finalStatus.error);
          } else {
            await finalize(
              bytes >= MIN_BYTES_OK ? "completed" : "ended",
              finalStatus.error,
            );
          }
          return;
        }
        if (settled !== "wait") {
          const message =
            settled instanceof Error ? settled.message : String(settled);
          await finalize("failed", message);
          return;
        }
      }
      if (!finalized) {
        await finalize(
          bytes >= MIN_BYTES_OK ? "completed" : "failed",
          "Recording wait timed out",
        );
        await browserDone.catch(() => undefined);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[live-recorder job=${job.id}]`, message);
      await finalize("failed", message);
    } finally {
      signal.removeEventListener("abort", onAbort);
    }
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
      if (browser) {
        await browser.close().catch(() => undefined);
        browser = null;
      }
    },
  };
}
