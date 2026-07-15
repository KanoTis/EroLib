import path from "node:path";

export interface AppConfig {
  port: number;
  host: string;
  dataDir: string;
  mediaDir: string;
  cacheDir: string;
  authUsername: string;
  authPassword: string | null;
  credentialsSecret: string;
  syncIntervalHours: number;
  maxDownloadConcurrency: number;
  webDistDir: string | null;
  nodeEnv: string;
}

function envString(name: string, fallback?: string): string {
  const value = process.env[name];
  if (value !== undefined && value !== "") {
    return value;
  }
  if (fallback !== undefined) {
    return fallback;
  }
  throw new Error(`Missing required env: ${name}`);
}

function envOptionalString(name: string): string | null {
  const value = process.env[name];
  if (value === undefined || value === "") {
    return null;
  }
  return value;
}

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") {
    return fallback;
  }
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n)) {
    throw new Error(`Invalid integer env ${name}: ${raw}`);
  }
  return n;
}

export function loadConfig(): AppConfig {
  const cwd = process.cwd();
  const dataDir = path.resolve(envString("DATA_DIR", path.join(cwd, "data")));
  const mediaDir = path.resolve(envString("MEDIA_DIR", path.join(cwd, "media")));
  const cacheDir = path.resolve(envString("CACHE_DIR", path.join(cwd, "cache")));

  const secret = envString(
    "CREDENTIALS_SECRET",
    "dev-only-change-me-credentials-secret-32b",
  );
  if (secret.length < 16) {
    throw new Error("CREDENTIALS_SECRET must be at least 16 characters");
  }

  const webDist =
    envOptionalString("WEB_DIST_DIR") ??
    path.resolve(cwd, "../web/dist");

  return {
    port: envInt("PORT", 8080),
    host: envString("HOST", "0.0.0.0"),
    dataDir,
    mediaDir,
    cacheDir,
    authUsername: envString("AUTH_USERNAME", "admin"),
    authPassword: envOptionalString("AUTH_PASSWORD"),
    credentialsSecret: secret,
    syncIntervalHours: envInt("SYNC_INTERVAL_HOURS", 4),
    maxDownloadConcurrency: envInt("MAX_DOWNLOAD_CONCURRENCY", 2),
    webDistDir: webDist,
    nodeEnv: envString("NODE_ENV", "development"),
  };
}

export function authEnabled(config: AppConfig): boolean {
  return config.authPassword !== null && config.authPassword.length > 0;
}
