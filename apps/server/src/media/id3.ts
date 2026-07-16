import { copyFile, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { WorkMetadata } from "@erolib/shared";
import NodeID3 from "node-id3";

export interface TagAudioResult {
  tagged: boolean;
  reason?: string;
}

function isMp3Path(audioPath: string): boolean {
  return path.extname(audioPath).toLowerCase() === ".mp3";
}

function mimeForCover(coverPath: string): string {
  const ext = path.extname(coverPath).toLowerCase();
  if (ext === ".png") return "image/png";
  if (ext === ".webp") return "image/webp";
  if (ext === ".gif") return "image/gif";
  return "image/jpeg";
}

function buildComment(meta: WorkMetadata): string | undefined {
  const parts: string[] = [];
  if (meta.description?.trim()) parts.push(meta.description.trim());
  if (meta.sourceUrl?.trim()) parts.push(`source_url=${meta.sourceUrl.trim()}`);
  return parts.length > 0 ? parts.join("\n") : undefined;
}

/**
 * Write ID3v2 tags into an MP3. Non-MP3 returns tagged:false.
 * On failure leaves the original file intact and returns tagged:false.
 */
export async function tagAudioFile(opts: {
  audioPath: string;
  meta: WorkMetadata;
  coverPath?: string | null;
}): Promise<TagAudioResult> {
  const { audioPath, meta, coverPath } = opts;
  if (!isMp3Path(audioPath)) {
    return { tagged: false, reason: "unsupported_format" };
  }

  const tags: NodeID3.Tags = {
    title: meta.title,
    artist: meta.authorName?.trim() || meta.authorId || undefined,
    album: `Erolib / ${meta.provider}`,
    comment: (() => {
      const text = buildComment(meta);
      return text ? { language: "eng", text } : undefined;
    })(),
  };

  if (meta.sourceUrl?.trim()) {
    tags.userDefinedUrl = [
      {
        description: "source",
        url: meta.sourceUrl.trim(),
      },
    ];
    tags.www = meta.sourceUrl.trim();
  }

  if (coverPath) {
    try {
      const imageBuffer = await readFile(coverPath);
      tags.image = {
        mime: mimeForCover(coverPath),
        type: { id: 3, name: "front cover" },
        description: "cover",
        imageBuffer,
      };
    } catch {
      // cover optional
    }
  }

  const tmp = `${audioPath}.id3tmp`;
  try {
    await copyFile(audioPath, tmp);
    const written = NodeID3.write(tags, tmp);
    if (written !== true) {
      await rm(tmp, { force: true });
      return {
        tagged: false,
        reason: typeof written === "string" ? written : "write_failed",
      };
    }
    try {
      await rename(tmp, audioPath);
    } catch {
      await copyFile(tmp, audioPath);
      await rm(tmp, { force: true });
    }
    return { tagged: true };
  } catch (err) {
    await rm(tmp, { force: true }).catch(() => undefined);
    return {
      tagged: false,
      reason: err instanceof Error ? err.message : String(err),
    };
  }
}

/** Test helper: write tags and return read-back object. */
export async function writeAndReadTags(
  audioPath: string,
  tags: NodeID3.Tags,
): Promise<NodeID3.Tags | null> {
  const ok = NodeID3.write(tags, audioPath);
  if (ok !== true) return null;
  return NodeID3.read(audioPath);
}

export async function ensureMinimalMp3(dest: string): Promise<void> {
  // Minimal MPEG frame so node-id3 can attach a tag without a real stream.
  // ID3 is prepended; frame bytes are a silent-ish stub.
  const frame = Buffer.from([
    0xff, 0xfb, 0x90, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
  ]);
  await writeFile(dest, frame);
}
