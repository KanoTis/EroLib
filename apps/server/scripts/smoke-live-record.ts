/**
 * Phase 2 smoke: login → find open realtime room → record ~20s → check wav.
 *
 * Usage:
 *   OTOBANANA_EMAIL=... OTOBANANA_PASSWORD=... pnpm --filter @erolib/server exec tsx scripts/smoke-live-record.ts
 */
import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import { eq } from "drizzle-orm";
import { loadConfig } from "../src/config.js";
import { createDb, migrate } from "../src/db/client.js";
import { liveRecordJobs } from "../src/db/schema.js";
import { createLiveRecorder } from "../src/jobs/live-recorder.js";
import { ensureStorageRoots, liveMediaDir } from "../src/storage/paths.js";

const EMAIL = process.env.OTOBANANA_EMAIL;
const PASSWORD = process.env.OTOBANANA_PASSWORD;
if (!EMAIL || !PASSWORD) {
  throw new Error("Set OTOBANANA_EMAIL and OTOBANANA_PASSWORD");
}

const RECORD_MS = Number(process.env.SMOKE_RECORD_MS ?? "25000");
const API = "https://api.v2.otobanana.com";

async function signIn(): Promise<string> {
  const res = await fetch(`${API}/api/signin`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      Origin: "https://otobanana.com",
    },
    body: JSON.stringify({ Email: EMAIL, Password: PASSWORD }),
  });
  const raw: unknown = await res.json();
  if (!res.ok || !raw || typeof raw !== "object") {
    throw new Error(`signin failed: ${res.status} ${JSON.stringify(raw)}`);
  }
  const token = (raw as { accessToken?: string }).accessToken;
  if (!token) throw new Error("no accessToken");
  return token;
}

async function pickRoom(token: string): Promise<{
  roomId: string;
  postPtrId: string;
  authorId: string;
  title: string | null;
  streamService: string | null;
}> {
  for (const adult of [true, false]) {
    const res = await fetch(
      `${API}/api/top/livestreams?is_adult=${adult}`,
      {
        headers: {
          Authorization: token,
          Accept: "application/json",
          Origin: "https://otobanana.com",
        },
      },
    );
    const body: unknown = await res.json();
    const data =
      body &&
      typeof body === "object" &&
      Array.isArray((body as { data?: unknown }).data)
        ? (body as { data: unknown[] }).data
        : [];
    const open = data
      .map((item) => {
        if (!item || typeof item !== "object") return null;
        const r = item as Record<string, unknown>;
        if (r.is_open !== true) return null;
        if (r.stream_service !== "realtime") return null;
        const roomId = typeof r.room_id === "string" ? r.room_id : null;
        const postPtrId =
          typeof r.post_ptr_id === "string" ? r.post_ptr_id : null;
        const parts = roomId?.split(":") ?? [];
        const authorId = parts[1] ?? null;
        const post =
          r.post && typeof r.post === "object"
            ? (r.post as Record<string, unknown>)
            : null;
        const title =
          post && typeof post.title === "string" ? post.title : null;
        if (!roomId || !postPtrId || !authorId) return null;
        return {
          roomId,
          postPtrId,
          authorId,
          title,
          streamService: "realtime" as const,
          listeners:
            typeof r.listener_count === "number" ? r.listener_count : 0,
        };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null)
      .sort((a, b) => b.listeners - a.listeners);
    if (open[0]) {
      const r = open[0];
      console.log(
        "picked room",
        r.roomId,
        "listeners",
        r.listeners,
        "title",
        r.title,
      );
      return r;
    }
  }
  throw new Error("no open realtime room");
}

async function main(): Promise<void> {
  const config = loadConfig();
  await ensureStorageRoots({
    dataDir: config.dataDir,
    mediaDir: config.mediaDir,
    cacheDir: config.cacheDir,
  });
  const { db, client } = createDb(config.dataDir);
  await migrate(client);

  const token = await signIn();
  console.log("signed in");
  const room = await pickRoom(token);

  const now = new Date()
    .toISOString()
    .replace("T", " ")
    .replace(/\.\d{3}Z$/, "");
  await db.delete(liveRecordJobs).where(eq(liveRecordJobs.roomId, room.roomId));

  const inserted = await db
    .insert(liveRecordJobs)
    .values({
      provider: "otobanana",
      authorId: room.authorId,
      roomId: room.roomId,
      postPtrId: room.postPtrId,
      streamService: room.streamService,
      title: room.title,
      state: "pending_media",
      startedAt: now,
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  const job = inserted[0];
  if (!job) throw new Error("insert job failed");
  console.log("job id", job.id);

  const recorder = createLiveRecorder(db, config);
  await recorder.ensureStarted(job, token);
  console.log(`recording for ${RECORD_MS}ms...`);
  await new Promise((r) => setTimeout(r, RECORD_MS));
  await recorder.stop(job.id, "shutdown");
  await recorder.stopAll();

  const [finalJob] = await db
    .select()
    .from(liveRecordJobs)
    .where(eq(liveRecordJobs.id, job.id))
    .limit(1);
  console.log("final state", finalJob?.state, "error", finalJob?.error);
  console.log("mediaRelPath", finalJob?.mediaRelPath);

  const dir = liveMediaDir(
    config.mediaDir,
    "otobanana",
    room.authorId,
    room.roomId,
  );
  try {
    const files = await readdir(dir);
    for (const f of files) {
      const s = await stat(path.join(dir, f));
      console.log("file", f, s.size, "bytes");
    }
  } catch {
    console.log("no output dir", dir);
  }

  client.close();
  if (finalJob?.state === "completed" && finalJob.mediaRelPath) {
    console.log("SMOKE OK");
    process.exit(0);
  }
  try {
    const s = await stat(path.join(dir, "audio.wav"));
    if (s.size > 0) {
      console.log("SMOKE PARTIAL OK (file written, size=", s.size, ")");
      process.exit(0);
    }
  } catch {
    // fallthrough
  }
  console.error("SMOKE FAIL");
  process.exit(1);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
