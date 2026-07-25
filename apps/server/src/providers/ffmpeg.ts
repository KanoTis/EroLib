import { spawn } from "node:child_process";
import { access } from "node:fs/promises";
import path from "node:path";

let cachedFfmpeg: string | null | undefined;

async function canExecute(bin: string): Promise<boolean> {
  if (bin.includes("/") || bin.includes("\\")) {
    try {
      await access(bin);
      return true;
    } catch {
      return false;
    }
  }
  const { promise, resolve } = Promise.withResolvers<boolean>();
  const child = spawn(bin, ["-version"], {
    stdio: ["ignore", "ignore", "ignore"],
    windowsHide: true,
  });
  child.once("error", () => resolve(false));
  child.once("exit", (code) => resolve(code === 0));
  return promise;
}

/**
 * Resolve an ffmpeg binary on PATH (or FFMPEG_PATH). Cached after first success.
 */
export async function ensureFfmpeg(): Promise<string> {
  if (cachedFfmpeg) return cachedFfmpeg;

  const fromEnv = process.env.FFMPEG_PATH?.trim();
  const candidates = [
    ...(fromEnv ? [fromEnv] : []),
    "ffmpeg",
    "ffmpeg.exe",
  ];

  for (const candidate of candidates) {
    if (await canExecute(candidate)) {
      cachedFfmpeg = candidate;
      return candidate;
    }
  }

  throw new Error(
    "ffmpeg not found; required for Erovoice downloads. Install ffmpeg or set FFMPEG_PATH.",
  );
}

/**
 * Transcode input media (e.g. MPEG-TS) to MP3 via libmp3lame.
 * Uses spawn argv array — never shell interpolation.
 */
export async function transcodeToMp3(
  inputPath: string,
  outputPath: string,
): Promise<void> {
  const ffmpeg = await ensureFfmpeg();
  const absIn = path.resolve(inputPath);
  const absOut = path.resolve(outputPath);

  const args = [
    "-hide_banner",
    "-loglevel",
    "error",
    "-y",
    "-i",
    absIn,
    "-vn",
    "-acodec",
    "libmp3lame",
    "-q:a",
    "2",
    absOut,
  ];

  const { promise, resolve, reject } = Promise.withResolvers<void>();
  const child = spawn(ffmpeg, args, {
    stdio: ["ignore", "ignore", "pipe"],
    windowsHide: true,
  });

  let stderr = "";
  child.stderr?.on("data", (chunk: Buffer | string) => {
    stderr += typeof chunk === "string" ? chunk : chunk.toString("utf8");
    if (stderr.length > 4000) stderr = stderr.slice(-4000);
  });
  child.once("error", (err) => {
    reject(new Error(`ffmpeg spawn failed: ${err.message}`));
  });
  child.once("exit", (code) => {
    if (code === 0) {
      resolve();
      return;
    }
    const detail = stderr.trim() || `exit ${code ?? "unknown"}`;
    reject(new Error(`ffmpeg transcode failed: ${detail}`));
  });
  return promise;
}
