import path from "node:path";
import { copyFile, rename, rm } from "node:fs/promises";
import { and, eq } from "drizzle-orm";
import type {
  AuthorPublic,
  LiveSubscriptionPublic,
  ProviderId,
  Session,
} from "@erolib/shared";
import type { AppDatabase } from "../db/client.js";
import {
  authors,
  liveMedia,
  liveSubscriptions,
  works,
} from "../db/schema.js";
import { fetchToFile } from "../providers/download-utils.js";
import {
  fetchUserProfile,
  looksLikeUuid,
  resolveAuthorByInput,
} from "../providers/otobanana-live.js";
import { sessionData } from "../providers/types.js";
import { nowSql } from "../lib/utils.js";
import {
  authorAvatarPaths,
  pathExists,
} from "../storage/paths.js";

async function avatarFileExists(
  mediaRoot: string,
  avatarPath: string | null | undefined,
): Promise<boolean> {
  if (!avatarPath?.trim()) return false;
  const abs = path.join(mediaRoot, avatarPath);
  // Prevent path escape outside media root
  const rel = path.relative(mediaRoot, abs);
  if (rel.startsWith("..") || path.isAbsolute(rel)) return false;
  return pathExists(abs);
}

async function resolveDisplayName(
  db: AppDatabase,
  provider: ProviderId,
  authorId: string,
  opts: {
    authorsDisplayName: string | null;
    subscription: LiveSubscriptionPublic | null;
  },
): Promise<{ displayName: string | null; username: string | null }> {
  if (opts.authorsDisplayName?.trim()) {
    return {
      displayName: opts.authorsDisplayName.trim(),
      username: opts.subscription?.username ?? null,
    };
  }
  if (opts.subscription?.displayName?.trim()) {
    return {
      displayName: opts.subscription.displayName.trim(),
      username: opts.subscription.username,
    };
  }
  if (opts.subscription?.username?.trim()) {
    return {
      displayName: opts.subscription.username.trim(),
      username: opts.subscription.username,
    };
  }

  const [work] = await db
    .select({ authorName: works.authorName })
    .from(works)
    .where(and(eq(works.provider, provider), eq(works.authorId, authorId)))
    .limit(1);
  if (work?.authorName?.trim()) {
    return {
      displayName: work.authorName.trim(),
      username: opts.subscription?.username ?? null,
    };
  }

  const [media] = await db
    .select({ authorName: liveMedia.authorName })
    .from(liveMedia)
    .where(
      and(eq(liveMedia.provider, provider), eq(liveMedia.authorId, authorId)),
    )
    .limit(1);
  if (media?.authorName?.trim()) {
    return {
      displayName: media.authorName.trim(),
      username: opts.subscription?.username ?? null,
    };
  }

  return {
    displayName: authorId,
    username: opts.subscription?.username ?? null,
  };
}

async function ensureAuthorsRow(
  db: AppDatabase,
  provider: ProviderId,
  authorId: string,
  displayName?: string | null,
): Promise<typeof authors.$inferSelect> {
  const [existing] = await db
    .select()
    .from(authors)
    .where(and(eq(authors.provider, provider), eq(authors.authorId, authorId)))
    .limit(1);
  if (existing) {
    if (
      displayName?.trim() &&
      !existing.displayName?.trim()
    ) {
      const now = nowSql();
      await db
        .update(authors)
        .set({ displayName: displayName.trim(), updatedAt: now })
        .where(eq(authors.id, existing.id));
      const [updated] = await db
        .select()
        .from(authors)
        .where(eq(authors.id, existing.id))
        .limit(1);
      return updated ?? existing;
    }
    return existing;
  }

  const now = nowSql();
  try {
    await db.insert(authors).values({
      provider,
      authorId,
      displayName: displayName?.trim() || null,
      avatarPath: null,
      createdAt: now,
      updatedAt: now,
    });
  } catch {
    // Concurrent open of the same author page may race on insert; re-read.
  }
  const [row] = await db
    .select()
    .from(authors)
    .where(and(eq(authors.provider, provider), eq(authors.authorId, authorId)))
    .limit(1);
  if (!row) {
    throw new Error("Failed to create authors row");
  }
  return row;
}

async function tryDownloadOtobananaAvatar(opts: {
  db: AppDatabase;
  mediaRoot: string;
  authorId: string;
  authorsRowId: number;
  getToken: () => Promise<string | null>;
}): Promise<{
  avatarPath: string | null;
  displayName: string | null;
  username: string | null;
}> {
  let token: string | null = null;
  try {
    token = await opts.getToken();
  } catch {
    token = null;
  }

  let profile;
  try {
    if (looksLikeUuid(opts.authorId)) {
      profile = await fetchUserProfile(opts.authorId, token);
    } else {
      const resolved = await resolveAuthorByInput(opts.authorId, token);
      profile = await fetchUserProfile(resolved.authorId, token);
    }
  } catch {
    return { avatarPath: null, displayName: null, username: null };
  }

  let avatarPath: string | null = null;
  if (profile.avatarUrl) {
    try {
      const paths = authorAvatarPaths(opts.mediaRoot, "otobanana", opts.authorId);
      const tmpPath = path.join(paths.dir, `avatar.download.${process.pid}.tmp`);
      const result = await fetchToFile({
        url: profile.avatarUrl,
        destPath: tmpPath,
      });
      const ext =
        result.ext === "bin" || result.ext === "mp3" || result.ext === "m4a"
          ? "jpg"
          : result.ext;
      const finalPath = paths.file(ext);
      try {
        await rename(tmpPath, finalPath);
      } catch {
        await copyFile(tmpPath, finalPath);
        await rm(tmpPath, { force: true });
      }
      avatarPath = paths.rel(ext);
    } catch {
      avatarPath = null;
    }
  }

  const now = nowSql();
  await opts.db
    .update(authors)
    .set({
      ...(profile.displayName ? { displayName: profile.displayName } : {}),
      ...(avatarPath ? { avatarPath } : {}),
      updatedAt: now,
    })
    .where(eq(authors.id, opts.authorsRowId));

  return {
    avatarPath,
    displayName: profile.displayName,
    username: profile.username,
  };
}

export async function getAuthorPublic(opts: {
  db: AppDatabase;
  mediaRoot: string;
  provider: ProviderId;
  authorId: string;
  toLiveSubscription: (
    row: typeof liveSubscriptions.$inferSelect,
  ) => LiveSubscriptionPublic;
  ensureOtobananaSession?: () => Promise<Session>;
}): Promise<AuthorPublic> {
  const { db, mediaRoot, provider, authorId } = opts;

  const [subRow] = await db
    .select()
    .from(liveSubscriptions)
    .where(
      and(
        eq(liveSubscriptions.provider, provider),
        eq(liveSubscriptions.authorId, authorId),
      ),
    )
    .limit(1);
  const subscription = subRow ? opts.toLiveSubscription(subRow) : null;

  let authorsRow = await ensureAuthorsRow(
    db,
    provider,
    authorId,
    subscription?.displayName ?? null,
  );

  let hasAvatar = await avatarFileExists(mediaRoot, authorsRow.avatarPath);
  let profileUsername: string | null = null;

  // Stale DB path (file gone): clear so hasAvatar is not sticky and otobanana can re-fetch.
  if (!hasAvatar && authorsRow.avatarPath) {
    const now = nowSql();
    await db
      .update(authors)
      .set({ avatarPath: null, updatedAt: now })
      .where(eq(authors.id, authorsRow.id));
    authorsRow = { ...authorsRow, avatarPath: null };
  }

  // Lazy avatar download for otobanana only (best-effort; never fail the page).
  if (!hasAvatar && provider === "otobanana") {
    const downloaded = await tryDownloadOtobananaAvatar({
      db,
      mediaRoot,
      authorId,
      authorsRowId: authorsRow.id,
      getToken: async () => {
        if (!opts.ensureOtobananaSession) return null;
        try {
          const session = await opts.ensureOtobananaSession();
          return sessionData(session).accessToken ?? null;
        } catch {
          return null;
        }
      },
    });
    profileUsername = downloaded.username;
    if (downloaded.avatarPath || downloaded.displayName) {
      const [fresh] = await db
        .select()
        .from(authors)
        .where(eq(authors.id, authorsRow.id))
        .limit(1);
      if (fresh) authorsRow = fresh;
      hasAvatar = await avatarFileExists(mediaRoot, authorsRow.avatarPath);
    }
  }

  const names = await resolveDisplayName(db, provider, authorId, {
    authorsDisplayName: authorsRow.displayName,
    subscription,
  });

  // Prefer subscription username; fall back to lazy profile username (otobanana).
  return {
    provider,
    authorId,
    displayName: names.displayName,
    username:
      names.username ?? subscription?.username ?? profileUsername ?? null,
    hasAvatar,
    subscription,
  };
}

export async function resolveAuthorAvatarAbsPath(opts: {
  db: AppDatabase;
  mediaRoot: string;
  provider: ProviderId;
  authorId: string;
}): Promise<string | null> {
  const [row] = await opts.db
    .select()
    .from(authors)
    .where(
      and(
        eq(authors.provider, opts.provider),
        eq(authors.authorId, opts.authorId),
      ),
    )
    .limit(1);
  if (!row?.avatarPath) return null;
  const abs = path.join(opts.mediaRoot, row.avatarPath);
  const rel = path.relative(opts.mediaRoot, abs);
  if (rel.startsWith("..") || path.isAbsolute(rel)) return null;
  if (!(await pathExists(abs))) return null;
  return abs;
}
