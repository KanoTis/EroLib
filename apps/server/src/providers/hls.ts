import { createCipheriv, createDecipheriv } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";
import { pipeline } from "node:stream/promises";
import type { DownloadProgress } from "@erolib/shared";
import { DEFAULT_UA } from "./types.js";

export type HlsKeyMethod = "AES-128" | "NONE";

export interface HlsSegment {
  index: number;
  uri: string;
  duration: number;
}

export interface HlsPlaylist {
  mediaSequence: number;
  targetDuration: number | null;
  endList: boolean;
  playlistType: string | null;
  method: HlsKeyMethod;
  keyUri: string | null;
  /** Explicit IV from EXT-X-KEY, or null → per-segment media-sequence IV */
  iv: Buffer | null;
  segments: HlsSegment[];
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export function resolvePlaylistUrl(baseUrl: string, ref: string): string {
  if (/^https?:\/\//i.test(ref)) return ref;
  return new URL(ref, baseUrl).href;
}

function parseIvHex(raw: string): Buffer {
  let hex = raw.trim();
  if (hex.startsWith("0x") || hex.startsWith("0X")) hex = hex.slice(2);
  if (hex.length % 2 === 1) hex = `0${hex}`;
  if (hex.length > 32) hex = hex.slice(-32);
  if (hex.length < 32) hex = hex.padStart(32, "0");
  return Buffer.from(hex, "hex");
}

/** HLS default IV: 16-byte big-endian media sequence number. */
export function mediaSequenceIv(sequence: number): Buffer {
  const iv = Buffer.alloc(16, 0);
  iv.writeUInt32BE(sequence >>> 0, 12);
  return iv;
}

/**
 * Parse a media (or simple) M3U8 playlist. Relative segment/key URIs are
 * resolved against `playlistUrl` when provided.
 */
export function parseM3u8(body: string, playlistUrl?: string): HlsPlaylist {
  const lines = body.replace(/^\uFEFF/, "").split(/\r?\n/);
  if (!lines[0]?.startsWith("#EXTM3U")) {
    throw new Error("Invalid m3u8: missing #EXTM3U");
  }

  let mediaSequence = 0;
  let targetDuration: number | null = null;
  let endList = false;
  let playlistType: string | null = null;
  let method: HlsKeyMethod = "NONE";
  let keyUri: string | null = null;
  let iv: Buffer | null = null;
  const segments: HlsSegment[] = [];

  let pendingDuration: number | null = null;
  let segIndex = 0;

  for (let i = 1; i < lines.length; i += 1) {
    const line = lines[i]?.trim() ?? "";
    if (!line) continue;

    if (line.startsWith("#EXT-X-MEDIA-SEQUENCE:")) {
      const n = Number.parseInt(line.slice("#EXT-X-MEDIA-SEQUENCE:".length), 10);
      if (Number.isFinite(n)) mediaSequence = n;
      continue;
    }
    if (line.startsWith("#EXT-X-TARGETDURATION:")) {
      const n = Number.parseFloat(line.slice("#EXT-X-TARGETDURATION:".length));
      if (Number.isFinite(n)) targetDuration = n;
      continue;
    }
    if (line.startsWith("#EXT-X-PLAYLIST-TYPE:")) {
      playlistType = line.slice("#EXT-X-PLAYLIST-TYPE:".length).trim() || null;
      continue;
    }
    if (line === "#EXT-X-ENDLIST") {
      endList = true;
      continue;
    }
    if (line.startsWith("#EXT-X-KEY:")) {
      const attrs = line.slice("#EXT-X-KEY:".length);
      const methodM = /METHOD=([^,]+)/i.exec(attrs);
      const methodRaw = (methodM?.[1] ?? "NONE").toUpperCase();
      if (methodRaw === "AES-128") method = "AES-128";
      else if (methodRaw === "NONE") method = "NONE";
      else throw new Error(`Unsupported HLS key method: ${methodRaw}`);

      const uriM = /URI="([^"]+)"/i.exec(attrs) ?? /URI=([^,]+)/i.exec(attrs);
      if (uriM?.[1]) {
        const rawUri = uriM[1].trim();
        keyUri = playlistUrl ? resolvePlaylistUrl(playlistUrl, rawUri) : rawUri;
      } else {
        keyUri = null;
      }

      const ivM = /IV=(0x[0-9a-fA-F]+|[0-9a-fA-F]+)/i.exec(attrs);
      iv = ivM?.[1] ? parseIvHex(ivM[1]) : null;
      continue;
    }
    if (line.startsWith("#EXTINF:")) {
      const rest = line.slice("#EXTINF:".length);
      const durStr = rest.split(",")[0] ?? "";
      const d = Number.parseFloat(durStr);
      pendingDuration = Number.isFinite(d) ? d : 0;
      continue;
    }
    if (line.startsWith("#")) continue;

    // URI line
    if (pendingDuration === null) continue;
    const uri = playlistUrl ? resolvePlaylistUrl(playlistUrl, line) : line;
    segments.push({
      index: segIndex,
      uri,
      duration: pendingDuration,
    });
    segIndex += 1;
    pendingDuration = null;
  }

  return {
    mediaSequence,
    targetDuration,
    endList,
    playlistType,
    method,
    keyUri,
    iv,
    segments,
  };
}

export function decryptAes128Cbc(
  encrypted: Buffer,
  key: Buffer,
  iv: Buffer,
): Buffer {
  if (key.length !== 16) {
    throw new Error(`AES-128 key must be 16 bytes, got ${key.length}`);
  }
  if (iv.length !== 16) {
    throw new Error(`AES-128 IV must be 16 bytes, got ${iv.length}`);
  }
  const decipher = createDecipheriv("aes-128-cbc", key, iv);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]);
}

/** Test helper: encrypt with AES-128-CBC + PKCS#7. */
export function encryptAes128CbcForTest(
  plain: Buffer,
  key: Buffer,
  iv: Buffer,
): Buffer {
  const cipher = createCipheriv("aes-128-cbc", key, iv);
  return Buffer.concat([cipher.update(plain), cipher.final()]);
}

export function segmentIv(
  playlist: HlsPlaylist,
  segmentIndex: number,
): Buffer {
  if (playlist.iv) return playlist.iv;
  return mediaSequenceIv(playlist.mediaSequence + segmentIndex);
}

async function fetchBuffer(
  url: string,
  headers: Record<string, string>,
): Promise<Buffer> {
  const res = await fetch(url, {
    headers: {
      "User-Agent": DEFAULT_UA,
      ...headers,
    },
    redirect: "follow",
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} for ${url.split("?")[0] ?? url}`);
  }
  const ab = await res.arrayBuffer();
  return Buffer.from(ab);
}

async function writeStreamToFile(
  res: Response,
  destPath: string,
): Promise<number> {
  if (!res.body) throw new Error("Response body empty");
  await mkdir(path.dirname(destPath), { recursive: true });
  const webBody = res.body as unknown as NodeReadableStream;
  const nodeStream = Readable.fromWeb(webBody);
  const fileStream = createWriteStream(destPath);
  let bytes = 0;
  nodeStream.on("data", (chunk: Buffer | string) => {
    bytes += typeof chunk === "string" ? Buffer.byteLength(chunk) : chunk.length;
  });
  await pipeline(nodeStream, fileStream);
  return bytes;
}

async function mapPool<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;

  async function runOne(): Promise<void> {
    while (next < items.length) {
      const i = next;
      next += 1;
      const item = items[i];
      if (item === undefined) continue;
      results[i] = await worker(item, i);
    }
  }

  const n = Math.max(1, Math.min(concurrency, items.length || 1));
  const runners: Promise<void>[] = [];
  for (let i = 0; i < n; i += 1) runners.push(runOne());
  await Promise.all(runners);
  return results;
}

export interface DownloadHlsOptions {
  /** Initial playlist body if already fetched. */
  playlistBody?: string;
  playlistUrl: string;
  headers?: Record<string, string>;
  cacheDir: string;
  concurrency?: number;
  onProgress?: (p: DownloadProgress) => void;
  /** Re-fetch playlist (e.g. expired presigned URLs). */
  refreshPlaylist?: () => Promise<{ body: string; url: string }>;
}

export interface DownloadHlsResult {
  streamPath: string;
  segmentCount: number;
  bytesEncrypted: number;
  endList: boolean;
}

/**
 * Download HLS media playlist segments, decrypt AES-128, concat to stream.ts.
 */
export async function downloadHlsToTs(
  opts: DownloadHlsOptions,
): Promise<DownloadHlsResult> {
  const headers = opts.headers ?? {};
  const concurrency = opts.concurrency ?? 4;
  const segDir = path.join(opts.cacheDir, "segments");
  await mkdir(segDir, { recursive: true });

  let playlistUrl = opts.playlistUrl;
  let body =
    opts.playlistBody ??
    (await fetchBuffer(playlistUrl, headers)).toString("utf8");
  let playlist = parseM3u8(body, playlistUrl);

  if (playlist.segments.length === 0) {
    throw new Error("HLS playlist has no segments");
  }
  if (!playlist.endList) {
    throw new Error("Live stream not supported (missing #EXT-X-ENDLIST)");
  }

  let key: Buffer | null = null;
  if (playlist.method === "AES-128") {
    if (!playlist.keyUri) throw new Error("AES-128 playlist missing key URI");
    key = await fetchBuffer(playlist.keyUri, headers);
    if (key.length !== 16) {
      throw new Error(`Unexpected AES key length: ${key.length}`);
    }
  }

  let bytesEncrypted = 0;
  const total = playlist.segments.length;
  let completed = 0;
  let refreshed = false;

  async function downloadOne(seg: HlsSegment): Promise<string> {
    const encPath = path.join(segDir, `${String(seg.index).padStart(4, "0")}.enc`);
    const decPath = path.join(segDir, `${String(seg.index).padStart(4, "0")}.ts`);

    const tryFetch = async (uri: string): Promise<void> => {
      const res = await fetch(uri, {
        headers: {
          "User-Agent": DEFAULT_UA,
          ...headers,
        },
        redirect: "follow",
      });
      if (!res.ok) {
        const err = new Error(
          `Segment ${seg.index} HTTP ${res.status}`,
        ) as Error & { status?: number };
        err.status = res.status;
        throw err;
      }
      const n = await writeStreamToFile(res, encPath);
      bytesEncrypted += n;
    };

    let lastErr: unknown;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const uri =
          attempt === 0
            ? seg.uri
            : (playlist.segments[seg.index]?.uri ?? seg.uri);
        await tryFetch(uri);
        lastErr = null;
        break;
      } catch (err) {
        lastErr = err;
        const status =
          isRecord(err) && typeof err.status === "number" ? err.status : 0;
        if ((status === 403 || status === 401) && opts.refreshPlaylist && !refreshed) {
          refreshed = true;
          const next = await opts.refreshPlaylist();
          playlistUrl = next.url;
          body = next.body;
          playlist = parseM3u8(body, playlistUrl);
          if (playlist.method === "AES-128" && playlist.keyUri) {
            key = await fetchBuffer(playlist.keyUri, headers);
          }
          continue;
        }
        if (attempt === 2) throw err;
      }
    }
    if (lastErr) throw lastErr;

    const encrypted = await readFile(encPath);
    if (playlist.method === "AES-128") {
      if (!key) throw new Error("Missing AES key");
      const iv = segmentIv(playlist, seg.index);
      const plain = decryptAes128Cbc(encrypted, key, iv);
      await writeFile(decPath, plain);
    } else {
      await writeFile(decPath, encrypted);
    }

    completed += 1;
    opts.onProgress?.({
      bytesReceived: completed,
      bytesTotal: total,
      phase: "hls",
    });
    return decPath;
  }

  // Use original segment list order; after refresh indices still match order.
  const decPaths = await mapPool(playlist.segments, concurrency, (seg) =>
    downloadOne(seg),
  );

  const streamPath = path.join(opts.cacheDir, "stream.ts");
  // Sequential concat to avoid loading whole track into memory at once.
  const out = createWriteStream(streamPath);
  const { promise, resolve, reject } = Promise.withResolvers<void>();
  out.once("error", reject);
  out.once("finish", () => resolve());

  (async () => {
    try {
      for (const p of decPaths) {
        const buf = await readFile(p);
        const ok = out.write(buf);
        if (!ok) {
          const { promise: drainP, resolve: drainR } =
            Promise.withResolvers<void>();
          out.once("drain", drainR);
          await drainP;
        }
      }
      out.end();
    } catch (err) {
      out.destroy();
      reject(err instanceof Error ? err : new Error(String(err)));
    }
  })();

  await promise;

  opts.onProgress?.({
    bytesReceived: total,
    bytesTotal: total,
    phase: "decrypt",
  });

  return {
    streamPath,
    segmentCount: total,
    bytesEncrypted,
    endList: playlist.endList,
  };
}
