import { and, eq, inArray } from "drizzle-orm";
import type { AppConfig } from "../config.js";
import type { AppDatabase } from "../db/client.js";
import {
  liveRecordJobs,
  liveSubscriptions,
  providerAccounts,
  type LiveRecordJobRow,
  type LiveSubscriptionRow,
} from "../db/schema.js";
import { ensureProviderSession } from "../providers/ensure-session.js";
import {
  getUserOnair,
  type OnairRoom,
} from "../providers/otobanana-live.js";
import { sessionData } from "../providers/types.js";
import {
  createLiveRecorder,
  type LiveRecorder,
} from "./live-recorder.js";

const PROVIDER = "otobanana" as const;
const POLL_INTERVAL_MS = 45_000;
const CHECK_CONCURRENCY = 3;
const OPEN_STATES = [
  "discovered",
  "pending_media",
  "blocked",
  "recording",
] as const;

export interface LivePoller {
  start(): void;
  stop(): void;
  pollNow(): Promise<void>;
  /** Stop an active recorder session for a job (no-op if not recording). */
  stopRecording(jobId: number): Promise<void>;
}

function nowSql(): string {
  return new Date().toISOString().replace("T", " ").replace(/\.\d{3}Z$/, "");
}

async function mapPool<T>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<void>,
): Promise<void> {
  if (items.length === 0) return;
  let i = 0;
  const runners = Array.from(
    { length: Math.min(concurrency, items.length) },
    async () => {
      while (i < items.length) {
        const idx = i++;
        await worker(items[idx]!);
      }
    },
  );
  await Promise.all(runners);
}

export function createLivePoller(
  db: AppDatabase,
  config: AppConfig,
): LivePoller {
  let stopped = false;
  let timer: ReturnType<typeof setInterval> | null = null;
  let inFlight: Promise<void> | null = null;
  let rerun = false;
  const recorder: LiveRecorder = createLiveRecorder(db, config);

  async function ensureOtobananaToken(): Promise<string | null> {
    const [account] = await db
      .select()
      .from(providerAccounts)
      .where(eq(providerAccounts.provider, PROVIDER))
      .limit(1);
    // Account `enabled` no longer gates live credentials; only need a configured account.
    if (!account) return null;
    try {
      const session = await ensureProviderSession(db, config, account);
      return sessionData(session).accessToken ?? null;
    } catch {
      return null;
    }
  }

  async function ensureJob(room: OnairRoom): Promise<LiveRecordJobRow | null> {
    const existing = await db
      .select()
      .from(liveRecordJobs)
      .where(
        and(
          eq(liveRecordJobs.provider, PROVIDER),
          eq(liveRecordJobs.roomId, room.roomId),
        ),
      )
      .limit(1);
    if (existing[0]) return existing[0];

    const now = nowSql();
    const stream = (room.streamService ?? "").toLowerCase();
    const initialState =
      stream === "realtime" && room.postPtrId
        ? "pending_media"
        : "blocked";
    const initialError =
      initialState === "blocked"
        ? `Unsupported or incomplete media source (stream_service=${room.streamService ?? "null"}, post_ptr_id=${room.postPtrId ?? "null"})`
        : null;

    try {
      await db.insert(liveRecordJobs).values({
        provider: PROVIDER,
        authorId: room.authorId,
        roomId: room.roomId,
        postPtrId: room.postPtrId,
        streamService: room.streamService,
        title: room.title,
        state: initialState,
        startedAt: room.roomOpenAt ?? now,
        error: initialError,
        metaJson: JSON.stringify({
          username: room.username,
          displayName: room.displayName,
          isAdult: room.isAdult,
          listenerCount: room.listenerCount,
        }),
        createdAt: now,
        updatedAt: now,
      });
    } catch {
      // unique race
    }

    const [row] = await db
      .select()
      .from(liveRecordJobs)
      .where(
        and(
          eq(liveRecordJobs.provider, PROVIDER),
          eq(liveRecordJobs.roomId, room.roomId),
        ),
      )
      .limit(1);
    return row ?? null;
  }

  async function closeOpenJobsForAuthor(authorId: string): Promise<void> {
    const open = await db
      .select()
      .from(liveRecordJobs)
      .where(
        and(
          eq(liveRecordJobs.provider, PROVIDER),
          eq(liveRecordJobs.authorId, authorId),
          inArray(liveRecordJobs.state, [...OPEN_STATES]),
        ),
      );

    for (const job of open) {
      if (recorder.isActive(job.id)) {
        await recorder.stop(job.id, "ended");
      } else if (job.state === "recording" || job.state === "pending_media") {
        // Recorder already finished or never started; mark ended if no media.
        if (!job.mediaRelPath) {
          await db
            .update(liveRecordJobs)
            .set({
              state: "ended",
              endedAt: nowSql(),
              updatedAt: nowSql(),
            })
            .where(eq(liveRecordJobs.id, job.id));
        }
      } else if (job.state === "blocked" || job.state === "discovered") {
        await db
          .update(liveRecordJobs)
          .set({
            state: "ended",
            endedAt: nowSql(),
            updatedAt: nowSql(),
          })
          .where(eq(liveRecordJobs.id, job.id));
      }
    }
  }

  async function kickPendingRecorders(token: string | null): Promise<void> {
    if (!token) return;
    const pending = await db
      .select()
      .from(liveRecordJobs)
      .where(
        and(
          eq(liveRecordJobs.provider, PROVIDER),
          inArray(liveRecordJobs.state, ["pending_media", "recording"]),
        ),
      );
    for (const job of pending) {
      if (recorder.isActive(job.id)) continue;
      // Only auto-start pending_media; orphaned recording rows get re-attached
      if (job.state === "pending_media" || job.state === "recording") {
        await recorder.ensureStarted(job, token);
      }
    }
  }

  async function checkSubscription(
    sub: LiveSubscriptionRow,
    token: string | null,
  ): Promise<void> {
    const now = nowSql();
    try {
      const room = await getUserOnair(sub.authorId, token);
      if (room && room.isOpen) {
        const job = await ensureJob(room);
        if (job && token) {
          await recorder.ensureStarted(job, token);
        }
        await db
          .update(liveSubscriptions)
          .set({
            lastOnairAt: now,
            lastRoomId: room.roomId,
            lastCheckAt: now,
            lastError: null,
            username: room.username ?? sub.username,
            displayName: room.displayName ?? sub.displayName,
            updatedAt: now,
          })
          .where(eq(liveSubscriptions.id, sub.id));
      } else {
        await closeOpenJobsForAuthor(sub.authorId);
        await db
          .update(liveSubscriptions)
          .set({
            lastCheckAt: now,
            lastError: null,
            updatedAt: now,
          })
          .where(eq(liveSubscriptions.id, sub.id));
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await db
        .update(liveSubscriptions)
        .set({
          lastCheckAt: now,
          lastError: message,
          updatedAt: now,
        })
        .where(eq(liveSubscriptions.id, sub.id));
    }
  }

  async function pollOnce(): Promise<void> {
    const subs = await db
      .select()
      .from(liveSubscriptions)
      .where(
        and(
          eq(liveSubscriptions.provider, PROVIDER),
          eq(liveSubscriptions.enabled, true),
        ),
      );
    const token = await ensureOtobananaToken();
    if (subs.length > 0) {
      await mapPool(subs, CHECK_CONCURRENCY, (sub) =>
        checkSubscription(sub, token),
      );
    }
    await kickPendingRecorders(token);
  }

  async function pollNow(): Promise<void> {
    if (inFlight) {
      rerun = true;
      return inFlight;
    }
    // Keep inFlight === the same Promise we return. `.finally()` returns a
    // *new* Promise; assigning that made `inFlight === run` always false so
    // inFlight never cleared and later pollNow() only set rerun and returned.
    const run = (async () => {
      do {
        rerun = false;
        await pollOnce();
      } while (rerun);
    })();
    inFlight = run;
    void run.finally(() => {
      if (inFlight === run) inFlight = null;
    });
    return run;
  }

  return {
    start() {
      stopped = false;
      if (timer) return;
      timer = setInterval(() => {
        if (stopped) return;
        void pollNow().catch((err: unknown) => {
          console.error(
            "[live-poller]",
            err instanceof Error ? err.message : err,
          );
        });
      }, POLL_INTERVAL_MS);
      void pollNow().catch((err: unknown) => {
        console.error(
          "[live-poller]",
          err instanceof Error ? err.message : err,
        );
      });
    },
    stop() {
      stopped = true;
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
      void recorder.stopAll();
    },
    pollNow,
    async stopRecording(jobId: number) {
      await recorder.stop(jobId, "shutdown");
    },
  };
}
