import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import {
  copyFile,
  mkdir,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import type { ProviderId } from "@erolib/shared";

const UNKNOWN_AUTHOR = "_unknown";

export function sanitizePathSegment(value: string): string {
  const cleaned = value
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, "_")
    .replace(/^\.+/, "_")
    .trim();
  return cleaned.length > 0 ? cleaned.slice(0, 180) : "_empty";
}

export function resolveAuthorId(authorId: string | null | undefined): string {
  if (!authorId || authorId.trim() === "") {
    return UNKNOWN_AUTHOR;
  }
  return sanitizePathSegment(authorId);
}

export interface MediaPaths {
  dir: string;
  metaJson: string;
  cover: (ext: string) => string;
  audio: (ext: string) => string;
}

export function mediaWorkDir(
  mediaRoot: string,
  provider: ProviderId,
  authorId: string | null | undefined,
  workId: string,
): MediaPaths {
  const dir = path.join(
    mediaRoot,
    sanitizePathSegment(provider),
    resolveAuthorId(authorId),
    sanitizePathSegment(workId),
  );
  return {
    dir,
    metaJson: path.join(dir, "meta.json"),
    cover: (ext: string) => path.join(dir, `cover.${ext.replace(/^\./, "")}`),
    audio: (ext: string) => path.join(dir, `audio.${ext.replace(/^\./, "")}`),
  };
}

export function cacheJobDir(cacheRoot: string, jobId: number | string): string {
  return path.join(cacheRoot, "downloads", String(jobId));
}

export function cacheTmpDir(cacheRoot: string): string {
  return path.join(cacheRoot, "tmp");
}

/**
 * Finished live recordings under MEDIA_DIR:
 * `{mediaRoot}/{provider}/live/{authorId}/{roomSafe}/`
 */
export function liveMediaDir(
  mediaRoot: string,
  provider: string,
  authorId: string,
  roomId: string,
): string {
  const roomSafe = sanitizePathSegment(roomId.replace(/:/g, "_"));
  return path.join(
    mediaRoot,
    sanitizePathSegment(provider),
    "live",
    resolveAuthorId(authorId),
    roomSafe,
  );
}

/**
 * Author avatar storage under MEDIA_DIR:
 * `{mediaRoot}/{provider}/authors/{authorId}/avatar.{ext}`
 */
export function authorAvatarPaths(
  mediaRoot: string,
  provider: string,
  authorId: string,
): {
  dir: string;
  file: (ext: string) => string;
  rel: (ext: string) => string;
} {
  const dir = path.join(
    mediaRoot,
    sanitizePathSegment(provider),
    "authors",
    resolveAuthorId(authorId),
  );
  return {
    dir,
    file: (ext: string) =>
      path.join(dir, `avatar.${ext.replace(/^\./, "")}`),
    rel: (ext: string) =>
      path
        .join(
          sanitizePathSegment(provider),
          "authors",
          resolveAuthorId(authorId),
          `avatar.${ext.replace(/^\./, "")}`,
        )
        .replace(/\\/g, "/"),
  };
}

export async function ensureDir(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true });
}

export async function ensureStorageRoots(opts: {
  dataDir: string;
  mediaDir: string;
  cacheDir: string;
}): Promise<void> {
  await ensureDir(opts.dataDir);
  await ensureDir(opts.mediaDir);
  await ensureDir(opts.cacheDir);
  await ensureDir(cacheTmpDir(opts.cacheDir));
  await ensureDir(path.join(opts.cacheDir, "downloads"));
}

export async function writeJsonAtomic(
  filePath: string,
  value: unknown,
): Promise<void> {
  await ensureDir(path.dirname(filePath));
  const tmp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tmp, JSON.stringify(value, null, 2), "utf8");
  await rename(tmp, filePath);
}

export interface CommitResult {
  audioPath: string;
  coverPath: string | null;
}

export async function commitCacheToMedia(opts: {
  cacheDir: string;
  mediaDir: string;
  audioFileName: string;
  coverFileName?: string | null;
}): Promise<CommitResult> {
  await ensureDir(opts.mediaDir);
  const audioSrc = path.join(opts.cacheDir, opts.audioFileName);
  const audioDest = path.join(opts.mediaDir, opts.audioFileName);
  await renameOrCopy(audioSrc, audioDest);

  let coverPath: string | null = null;
  if (opts.coverFileName) {
    const coverSrc = path.join(opts.cacheDir, opts.coverFileName);
    const coverDest = path.join(opts.mediaDir, opts.coverFileName);
    try {
      await renameOrCopy(coverSrc, coverDest);
      coverPath = coverDest;
    } catch {
      coverPath = null;
    }
  }

  return { audioPath: audioDest, coverPath };
}

async function renameOrCopy(src: string, dest: string): Promise<void> {
  try {
    await rename(src, dest);
  } catch {
    await copyFile(src, dest);
    await rm(src, { force: true });
  }
}

export async function fileSha256(filePath: string): Promise<string> {
  const hash = createHash("sha256");
  await pipeline(createReadStream(filePath), hash);
  return hash.digest("hex");
}

export async function pathExists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

/** Fields needed to resolve a VOD work's local audio file. */
export interface LocalAudioWorkRef {
  mediaRelDir: string | null | undefined;
  audioExt: string | null | undefined;
}

/**
 * True when the VOD audio file is present on disk with size > 0.
 * Missing mediaRelDir/audioExt, missing path, stat failure, or 0-byte → false.
 */
export async function isLocalAudioAvailable(
  mediaRoot: string,
  work: LocalAudioWorkRef,
): Promise<boolean> {
  if (!work.mediaRelDir || !work.audioExt) return false;
  const ext = work.audioExt.replace(/^\./, "");
  if (!ext) return false;
  const audioPath = path.join(mediaRoot, work.mediaRelDir, `audio.${ext}`);
  try {
    const st = await stat(audioPath);
    return st.size > 0;
  } catch {
    return false;
  }
}

export async function cleanupCacheJob(
  cacheRoot: string,
  jobId: number,
): Promise<void> {
  const dir = cacheJobDir(cacheRoot, jobId);
  await rm(dir, { recursive: true, force: true });
}

export async function listDirSafe(dir: string): Promise<string[]> {
  try {
    return await readdir(dir);
  } catch {
    return [];
  }
}

export { UNKNOWN_AUTHOR };
