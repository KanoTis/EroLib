import { serve } from "@hono/node-server";
import { eq } from "drizzle-orm";
import { createApp } from "./app.js";
import { loadConfig } from "./config.js";
import { createDb, migrate } from "./db/client.js";
import { settings } from "./db/schema.js";
import { createJobRunner } from "./jobs/runner.js";
import { createLivePoller } from "./jobs/live-poller.js";
import { createLiveHistorySyncer } from "./jobs/live-history-sync.js";
import { ensureStorageRoots } from "./storage/paths.js";

async function main(): Promise<void> {
  const config = loadConfig();
  await ensureStorageRoots({
    dataDir: config.dataDir,
    mediaDir: config.mediaDir,
    cacheDir: config.cacheDir,
  });

  const { db, client } = createDb(config.dataDir);
  await migrate(client);

  const existing = await db
    .select()
    .from(settings)
    .where(eq(settings.key, "syncIntervalHours"));
  if (existing.length === 0) {
    await db.insert(settings).values({
      key: "syncIntervalHours",
      value: String(config.syncIntervalHours),
    });
  } else {
    const v = Number.parseInt(existing[0]?.value ?? "", 10);
    if (Number.isFinite(v) && v > 0) {
      config.syncIntervalHours = v;
    }
  }

  const runner = createJobRunner(db, config);
  runner.start();

  const livePoller = createLivePoller(db, config);
  livePoller.start();

  const historySyncer = createLiveHistorySyncer(db, config);
  historySyncer.start();

  const app = createApp({ config, db, runner, livePoller, historySyncer });

  serve(
    {
      fetch: app.fetch,
      port: config.port,
      hostname: config.host,
    },
    (info) => {
      console.log(
        `[erolib] listening on http://${info.address}:${info.port} (auth=${
          config.authPassword ? "on" : "off"
        })`,
      );
    },
  );

  const shutdown = (): void => {
    console.log("[erolib] shutting down");
    runner.stop();
    livePoller.stop();
    historySyncer.stop();
    client.close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
