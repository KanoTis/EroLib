export type ProviderId = "otobanana" | "koekoe" | "erovoice";

export type AuthMode = "password" | "cookie";

export type WorkStatus =
  | "discovered"
  | "queued"
  | "downloading"
  | "downloaded"
  | "failed";

export type JobState = "queued" | "running" | "done" | "failed";

export type AccountStatus = "ok" | "error" | "disabled" | "unknown";

export interface ProviderAuth {
  mode: AuthMode;
  username?: string;
  password?: string;
  /** Raw Cookie header value */
  cookieHeader?: string;
}

export interface RemoteWorkRef {
  provider: ProviderId;
  workId: string;
  authorId: string | null;
  title?: string;
  authorName?: string;
  extra?: Record<string, unknown>;
}

export interface WorkMetadata {
  provider: ProviderId;
  workId: string;
  authorId: string | null;
  authorName?: string;
  title: string;
  description?: string;
  durationSeconds?: number | null;
  audioUrl: string;
  coverUrl?: string | null;
  /** Canonical public page for the work */
  sourceUrl?: string | null;
  tags?: string[];
  createdAt?: string | null;
  extra?: Record<string, unknown>;
}

export interface DownloadProgress {
  bytesReceived: number;
  bytesTotal?: number;
  phase?: string;
}

export interface DownloadResult {
  audioPath: string;
  audioExt: string;
  coverPath?: string | null;
  checksumSha256?: string;
  bytes: number;
  meta: WorkMetadata;
}

export interface Session {
  provider: ProviderId;
  /** Opaque session payload (JWT, cookies, etc.) */
  data: Record<string, unknown>;
  expiresAt?: string | null;
}

export interface ProviderAccountPublic {
  id: number;
  provider: ProviderId;
  enabled: boolean;
  authMode: AuthMode;
  username: string | null;
  status: AccountStatus;
  statusMessage: string | null;
  hasPassword: boolean;
  hasCookie: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface WorkPublic {
  id: number;
  provider: ProviderId;
  workId: string;
  authorId: string;
  authorName: string | null;
  title: string;
  description: string | null;
  status: WorkStatus;
  remoteInFavorites: boolean;
  durationSeconds: number | null;
  audioExt: string | null;
  coverPath: string | null;
  sourceUrl: string | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
  downloadedAt: string | null;
}

export interface DownloadJobPublic {
  id: number;
  workDbId: number;
  provider: ProviderId;
  workId: string;
  title: string | null;
  state: JobState;
  progress: number;
  attempts: number;
  error: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SyncRunPublic {
  id: number;
  provider: ProviderId | null;
  startedAt: string;
  finishedAt: string | null;
  discovered: number;
  enqueued: number;
  markedNotFavorite: number;
  error: string | null;
}

export interface SettingsPublic {
  syncIntervalHours: number;
  dataDir: string;
  mediaDir: string;
  cacheDir: string;
  authEnabled: boolean;
  maxDownloadConcurrency: number;
}

export interface HealthResponse {
  ok: true;
  version: string;
  time: string;
}

export const PROVIDER_IDS: ProviderId[] = ["otobanana", "koekoe", "erovoice"];
