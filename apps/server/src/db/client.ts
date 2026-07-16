import { createClient, type Client } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import path from "node:path";
import * as schema from "./schema.js";

export type AppDatabase = ReturnType<typeof drizzle<typeof schema>>;

export interface DbHandle {
  db: AppDatabase;
  client: Client;
}

export function createDb(dataDir: string): DbHandle {
  const dbPath = path.join(dataDir, "app.db");
  // libsql file URL: absolute path works on Windows with file:///
  const url = path.isAbsolute(dbPath)
    ? `file:${dbPath.replace(/\\/g, "/")}`
    : `file:${path.resolve(dbPath).replace(/\\/g, "/")}`;
  const client = createClient({ url });
  const db = drizzle(client, { schema });
  return { db, client };
}

export async function migrate(client: Client): Promise<void> {
  await client.executeMultiple(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY NOT NULL,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS provider_accounts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      provider TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      auth_mode TEXT NOT NULL,
      username TEXT,
      encrypted_payload TEXT NOT NULL,
      session_blob TEXT,
      status TEXT NOT NULL DEFAULT 'unknown',
      status_message TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE UNIQUE INDEX IF NOT EXISTS provider_accounts_provider_uidx
      ON provider_accounts(provider);

    CREATE TABLE IF NOT EXISTS authors (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      provider TEXT NOT NULL,
      author_id TEXT NOT NULL,
      display_name TEXT,
      avatar_path TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE UNIQUE INDEX IF NOT EXISTS authors_provider_author_uidx
      ON authors(provider, author_id);

    CREATE TABLE IF NOT EXISTS works (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      provider TEXT NOT NULL,
      work_id TEXT NOT NULL,
      author_id TEXT NOT NULL DEFAULT '_unknown',
      author_name TEXT,
      title TEXT NOT NULL,
      description TEXT,
      status TEXT NOT NULL DEFAULT 'discovered',
      remote_in_favorites INTEGER NOT NULL DEFAULT 1,
      duration_seconds INTEGER,
      audio_ext TEXT,
      cover_rel_path TEXT,
      media_rel_dir TEXT,
      error TEXT,
      checksum_sha256 TEXT,
      meta_json TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      downloaded_at TEXT
    );
    CREATE UNIQUE INDEX IF NOT EXISTS works_provider_work_uidx
      ON works(provider, work_id);

    CREATE TABLE IF NOT EXISTS sync_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      provider TEXT,
      started_at TEXT NOT NULL DEFAULT (datetime('now')),
      finished_at TEXT,
      discovered INTEGER NOT NULL DEFAULT 0,
      enqueued INTEGER NOT NULL DEFAULT 0,
      marked_not_favorite INTEGER NOT NULL DEFAULT 0,
      error TEXT
    );

    CREATE TABLE IF NOT EXISTS download_jobs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      work_db_id INTEGER NOT NULL REFERENCES works(id),
      state TEXT NOT NULL DEFAULT 'queued',
      progress REAL NOT NULL DEFAULT 0,
      attempts INTEGER NOT NULL DEFAULT 0,
      error TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS live_subscriptions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      provider TEXT NOT NULL DEFAULT 'otobanana',
      author_id TEXT NOT NULL,
      username TEXT,
      display_name TEXT,
      enabled INTEGER NOT NULL DEFAULT 1,
      last_onair_at TEXT,
      last_room_id TEXT,
      last_check_at TEXT,
      last_error TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE UNIQUE INDEX IF NOT EXISTS live_subscriptions_provider_author_uidx
      ON live_subscriptions(provider, author_id);

    CREATE TABLE IF NOT EXISTS live_record_jobs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      provider TEXT NOT NULL DEFAULT 'otobanana',
      author_id TEXT NOT NULL,
      room_id TEXT NOT NULL,
      post_ptr_id TEXT,
      stream_service TEXT,
      title TEXT,
      state TEXT NOT NULL DEFAULT 'pending_media',
      started_at TEXT,
      ended_at TEXT,
      media_rel_path TEXT,
      error TEXT,
      meta_json TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE UNIQUE INDEX IF NOT EXISTS live_record_jobs_provider_room_uidx
      ON live_record_jobs(provider, room_id);

    CREATE TABLE IF NOT EXISTS live_followee_authors (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      provider TEXT NOT NULL DEFAULT 'otobanana',
      author_id TEXT NOT NULL,
      username TEXT,
      display_name TEXT,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE UNIQUE INDEX IF NOT EXISTS live_followee_authors_provider_author_uidx
      ON live_followee_authors(provider, author_id);

    CREATE TABLE IF NOT EXISTS live_followee_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      provider TEXT NOT NULL DEFAULT 'otobanana',
      author_id TEXT NOT NULL,
      room_id TEXT NOT NULL,
      post_ptr_id TEXT,
      stream_service TEXT,
      title TEXT,
      is_open INTEGER NOT NULL DEFAULT 0,
      is_adult INTEGER,
      listener_count INTEGER,
      room_open_at TEXT,
      room_close_at TEXT,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE UNIQUE INDEX IF NOT EXISTS live_followee_sessions_provider_room_uidx
      ON live_followee_sessions(provider, room_id);
    CREATE INDEX IF NOT EXISTS live_followee_sessions_provider_author_idx
      ON live_followee_sessions(provider, author_id);

    CREATE TABLE IF NOT EXISTS live_media (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      provider TEXT NOT NULL DEFAULT 'otobanana',
      room_id TEXT NOT NULL,
      author_id TEXT NOT NULL,
      author_name TEXT,
      title TEXT,
      job_id INTEGER,
      audio_ext TEXT NOT NULL DEFAULT 'wav',
      media_rel_path TEXT NOT NULL,
      bytes INTEGER,
      duration_seconds INTEGER,
      recorded_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE UNIQUE INDEX IF NOT EXISTS live_media_provider_room_uidx
      ON live_media(provider, room_id);
  `);
}
