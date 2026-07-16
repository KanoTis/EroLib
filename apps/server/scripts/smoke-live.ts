import { mkdirSync } from "node:fs";
import path from "node:path";
import { createApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { createDb, migrate } from "../src/db/client.js";
import { liveRecordJobs, liveSubscriptions } from "../src/db/schema.js";
import { createLivePoller } from "../src/jobs/live-poller.js";
import { createJobRunner } from "../src/jobs/runner.js";
import {
  getUserOnair,
  resolveAuthorByInput,
} from "../src/providers/otobanana-live.js";

async function main(): Promise<void> {
  const dataDir = path.resolve(".tmp-research/live-smoke-data3");
  mkdirSync(dataDir, { recursive: true });
  const config = loadConfig();
  config.dataDir = dataDir;
  config.mediaDir = path.join(dataDir, "media");
  config.cacheDir = path.join(dataDir, "cache");

  const { db, client } = createDb(dataDir);
  await migrate(client);
  const runner = createJobRunner(db, config);
  const livePoller = createLivePoller(db, config);
  const app = createApp({ config, db, runner, livePoller });

  const author = await resolveAuthorByInput("hideyooooooooo");
  console.log("resolved", author);
  const onair = await getUserOnair(author.authorId);
  console.log(
    "onair",
    onair
      ? { roomId: onair.roomId, isOpen: onair.isOpen, title: onair.title }
      : null,
  );

  let res = await app.request("http://local/api/live/subscriptions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ input: author.authorId }),
  });
  console.log("POST sub", res.status, await res.json());

  const before = await db.select().from(liveSubscriptions);
  console.log("subs before poll", before);

  await livePoller.pollNow();

  const after = await db.select().from(liveSubscriptions);
  console.log("subs after poll", after);
  const jobs = await db.select().from(liveRecordJobs);
  console.log("jobs after poll", jobs);

  res = await app.request("http://local/api/live/jobs");
  console.log("GET jobs", res.status, await res.json());

  // second poll idempotent
  await livePoller.pollNow();
  const jobs2 = await db.select().from(liveRecordJobs);
  console.log("jobs count after 2nd", jobs2.length);

  livePoller.stop();
  runner.stop();
  // drain any queued poll started by POST
  await livePoller.pollNow();
  client.close();
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
