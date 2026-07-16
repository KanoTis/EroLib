import { sql } from "drizzle-orm";
import {
  integer,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

export const settings = sqliteTable("settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});

export const providerAccounts = sqliteTable(
  "provider_accounts",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    provider: text("provider").notNull(),
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
    authMode: text("auth_mode").notNull(),
    username: text("username"),
    encryptedPayload: text("encrypted_payload").notNull(),
    sessionBlob: text("session_blob"),
    status: text("status").notNull().default("unknown"),
    statusMessage: text("status_message"),
    createdAt: text("created_at")
      .notNull()
      .default(sql`(datetime('now'))`),
    updatedAt: text("updated_at")
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (t) => [uniqueIndex("provider_accounts_provider_uidx").on(t.provider)],
);

export const authors = sqliteTable(
  "authors",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    provider: text("provider").notNull(),
    authorId: text("author_id").notNull(),
    displayName: text("display_name"),
    avatarPath: text("avatar_path"),
    createdAt: text("created_at")
      .notNull()
      .default(sql`(datetime('now'))`),
    updatedAt: text("updated_at")
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (t) => [
    uniqueIndex("authors_provider_author_uidx").on(t.provider, t.authorId),
  ],
);

export const works = sqliteTable(
  "works",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    provider: text("provider").notNull(),
    workId: text("work_id").notNull(),
    authorId: text("author_id").notNull().default("_unknown"),
    authorName: text("author_name"),
    title: text("title").notNull(),
    description: text("description"),
    status: text("status").notNull().default("discovered"),
    remoteInFavorites: integer("remote_in_favorites", { mode: "boolean" })
      .notNull()
      .default(true),
    durationSeconds: integer("duration_seconds"),
    audioExt: text("audio_ext"),
    coverRelPath: text("cover_rel_path"),
    mediaRelDir: text("media_rel_dir"),
    error: text("error"),
    checksumSha256: text("checksum_sha256"),
    metaJson: text("meta_json"),
    createdAt: text("created_at")
      .notNull()
      .default(sql`(datetime('now'))`),
    updatedAt: text("updated_at")
      .notNull()
      .default(sql`(datetime('now'))`),
    downloadedAt: text("downloaded_at"),
  },
  (t) => [
    uniqueIndex("works_provider_work_uidx").on(t.provider, t.workId),
  ],
);

export const syncRuns = sqliteTable("sync_runs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  provider: text("provider"),
  startedAt: text("started_at")
    .notNull()
    .default(sql`(datetime('now'))`),
  finishedAt: text("finished_at"),
  discovered: integer("discovered").notNull().default(0),
  enqueued: integer("enqueued").notNull().default(0),
  markedNotFavorite: integer("marked_not_favorite").notNull().default(0),
  error: text("error"),
});

export const downloadJobs = sqliteTable("download_jobs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  workDbId: integer("work_db_id")
    .notNull()
    .references(() => works.id),
  state: text("state").notNull().default("queued"),
  progress: real("progress").notNull().default(0),
  attempts: integer("attempts").notNull().default(0),
  error: text("error"),
  createdAt: text("created_at")
    .notNull()
    .default(sql`(datetime('now'))`),
  updatedAt: text("updated_at")
    .notNull()
    .default(sql`(datetime('now'))`),
});

export const liveSubscriptions = sqliteTable(
  "live_subscriptions",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    provider: text("provider").notNull().default("otobanana"),
    authorId: text("author_id").notNull(),
    username: text("username"),
    displayName: text("display_name"),
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
    lastOnairAt: text("last_onair_at"),
    lastRoomId: text("last_room_id"),
    lastCheckAt: text("last_check_at"),
    lastError: text("last_error"),
    createdAt: text("created_at")
      .notNull()
      .default(sql`(datetime('now'))`),
    updatedAt: text("updated_at")
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (t) => [
    uniqueIndex("live_subscriptions_provider_author_uidx").on(
      t.provider,
      t.authorId,
    ),
  ],
);

export const liveRecordJobs = sqliteTable(
  "live_record_jobs",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    provider: text("provider").notNull().default("otobanana"),
    authorId: text("author_id").notNull(),
    roomId: text("room_id").notNull(),
    postPtrId: text("post_ptr_id"),
    streamService: text("stream_service"),
    title: text("title"),
    state: text("state").notNull().default("pending_media"),
    startedAt: text("started_at"),
    endedAt: text("ended_at"),
    mediaRelPath: text("media_rel_path"),
    error: text("error"),
    metaJson: text("meta_json"),
    createdAt: text("created_at")
      .notNull()
      .default(sql`(datetime('now'))`),
    updatedAt: text("updated_at")
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (t) => [
    uniqueIndex("live_record_jobs_provider_room_uidx").on(t.provider, t.roomId),
  ],
);

/** Completed live recordings for library browse/play (not VOD works). */
export const liveMedia = sqliteTable(
  "live_media",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    provider: text("provider").notNull().default("otobanana"),
    roomId: text("room_id").notNull(),
    authorId: text("author_id").notNull(),
    authorName: text("author_name"),
    title: text("title"),
    jobId: integer("job_id"),
    audioExt: text("audio_ext").notNull().default("wav"),
    mediaRelPath: text("media_rel_path").notNull(),
    bytes: integer("bytes"),
    durationSeconds: integer("duration_seconds"),
    recordedAt: text("recorded_at"),
    createdAt: text("created_at")
      .notNull()
      .default(sql`(datetime('now'))`),
    updatedAt: text("updated_at")
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (t) => [
    uniqueIndex("live_media_provider_room_uidx").on(t.provider, t.roomId),
  ],
);

/** Cached Otobanana followees for history UI (background sync only). */
export const liveFolloweeAuthors = sqliteTable(
  "live_followee_authors",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    provider: text("provider").notNull().default("otobanana"),
    authorId: text("author_id").notNull(),
    username: text("username"),
    displayName: text("display_name"),
    updatedAt: text("updated_at")
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (t) => [
    uniqueIndex("live_followee_authors_provider_author_uidx").on(
      t.provider,
      t.authorId,
    ),
  ],
);

/** Cached recent livestream sessions for followee history UI. */
export const liveFolloweeSessions = sqliteTable(
  "live_followee_sessions",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    provider: text("provider").notNull().default("otobanana"),
    authorId: text("author_id").notNull(),
    roomId: text("room_id").notNull(),
    postPtrId: text("post_ptr_id"),
    streamService: text("stream_service"),
    title: text("title"),
    isOpen: integer("is_open", { mode: "boolean" }).notNull().default(false),
    isAdult: integer("is_adult", { mode: "boolean" }),
    listenerCount: integer("listener_count"),
    roomOpenAt: text("room_open_at"),
    roomCloseAt: text("room_close_at"),
    updatedAt: text("updated_at")
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (t) => [
    uniqueIndex("live_followee_sessions_provider_room_uidx").on(
      t.provider,
      t.roomId,
    ),
  ],
);

export type ProviderAccountRow = typeof providerAccounts.$inferSelect;
export type WorkRow = typeof works.$inferSelect;
export type DownloadJobRow = typeof downloadJobs.$inferSelect;
export type SyncRunRow = typeof syncRuns.$inferSelect;
export type AuthorRow = typeof authors.$inferSelect;
export type LiveSubscriptionRow = typeof liveSubscriptions.$inferSelect;
export type LiveRecordJobRow = typeof liveRecordJobs.$inferSelect;
export type LiveMediaRow = typeof liveMedia.$inferSelect;
export type LiveFolloweeAuthorRow = typeof liveFolloweeAuthors.$inferSelect;
export type LiveFolloweeSessionRow = typeof liveFolloweeSessions.$inferSelect;
