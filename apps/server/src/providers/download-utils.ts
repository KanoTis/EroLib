import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";
import { pipeline } from "node:stream/promises";
import type { DownloadProgress } from "@erolib/shared";
import { DEFAULT_UA } from "./types.js";

export function extFromUrlOrType(
  url: string,
  contentType?: string | null,
): string {
  const lower = url.toLowerCase();
  const type = contentType?.toLowerCase() ?? "";
  if (lower.includes(".mp3") || type.includes("mpeg") || type.includes("mp3"))
    return "mp3";
  if (lower.includes(".m4a") || type.includes("mp4") || type.includes("m4a"))
    return "m4a";
  if (lower.includes(".ogg") || type.includes("ogg")) return "ogg";
  if (lower.includes(".wav") || type.includes("wav")) return "wav";
  if (lower.includes(".aac") || type.includes("aac")) return "aac";
  if (
    lower.includes(".jpg") ||
    lower.includes(".jpeg") ||
    type.includes("jpeg")
  )
    return "jpg";
  if (lower.includes(".png") || type.includes("png")) return "png";
  if (lower.includes(".webp") || type.includes("webp")) return "webp";
  if (lower.includes(".gif") || type.includes("gif")) return "gif";
  return "bin";
}

export interface FetchToFileResult {
  path: string;
  bytes: number;
  sha256: string;
  contentType: string | null;
  ext: string;
}

export async function fetchToFile(opts: {
  url: string;
  destPath: string;
  headers?: Record<string, string>;
  onProgress?: (p: DownloadProgress) => void;
}): Promise<FetchToFileResult> {
  await mkdir(path.dirname(opts.destPath), { recursive: true });
  const res = await fetch(opts.url, {
    headers: {
      "User-Agent": DEFAULT_UA,
      ...opts.headers,
    },
    redirect: "follow",
  });
  if (!res.ok) {
    throw new Error(`Download failed ${res.status} for ${opts.url}`);
  }
  const contentType = res.headers.get("content-type");
  const totalHeader = res.headers.get("content-length");
  const bytesTotal = totalHeader ? Number.parseInt(totalHeader, 10) : undefined;
  const ext = extFromUrlOrType(opts.url, contentType);

  if (!res.body) {
    throw new Error("Response body empty");
  }

  const hash = createHash("sha256");
  let bytesReceived = 0;
  const webBody = res.body as unknown as NodeReadableStream;
  const nodeStream = Readable.fromWeb(webBody);
  const fileStream = createWriteStream(opts.destPath);

  nodeStream.on("data", (chunk: Buffer | string) => {
    const buf = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
    hash.update(buf);
    bytesReceived += buf.length;
    opts.onProgress?.({
      bytesReceived,
      bytesTotal: Number.isFinite(bytesTotal) ? bytesTotal : undefined,
      phase: "download",
    });
  });

  await pipeline(nodeStream, fileStream);

  return {
    path: opts.destPath,
    bytes: bytesReceived,
    sha256: hash.digest("hex"),
    contentType,
    ext,
  };
}

export function mergeCookieHeader(
  existing: string | undefined,
  setCookies: string[] | null,
): string {
  const jar = new Map<string, string>();
  if (existing) {
    for (const part of existing.split(";")) {
      const trimmed = part.trim();
      if (!trimmed) continue;
      const eq = trimmed.indexOf("=");
      if (eq <= 0) continue;
      jar.set(trimmed.slice(0, eq), trimmed.slice(eq + 1));
    }
  }
  if (setCookies) {
    for (const sc of setCookies) {
      const first = sc.split(";")[0];
      if (!first) continue;
      const eq = first.indexOf("=");
      if (eq <= 0) continue;
      jar.set(first.slice(0, eq).trim(), first.slice(eq + 1).trim());
    }
  }
  return [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
}

export function getSetCookieHeaders(res: Response): string[] {
  const headers = res.headers;
  if ("getSetCookie" in headers && typeof headers.getSetCookie === "function") {
    return headers.getSetCookie();
  }
  const single = headers.get("set-cookie");
  return single ? [single] : [];
}
