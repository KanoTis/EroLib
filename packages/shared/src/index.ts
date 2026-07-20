export type ProviderId = "otobanana" | "koekoe" | "erovoice";

export type AuthMode = "password" | "cookie";

export type WorkStatus =
  | "discovered"
  | "queued"
  | "downloading"
  | "downloaded"
  | "failed";

export type JobState = "queued" | "running" | "done" | "failed";

export type LiveJobState =
  | "discovered"
  | "pending_media"
  | "blocked"
  | "recording"
  | "completed"
  | "ended"
  | "failed";

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
  /** @deprecated Account master switch; no longer gates live/sync. Prefer favoriteSyncEnabled. */
  enabled: boolean;
  /** Whether this provider participates in VOD favorites sync (manual + scheduled). */
  favoriteSyncEnabled: boolean;
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

export interface LiveSubscriptionPublic {
  id: number;
  provider: ProviderId;
  authorId: string;
  username: string | null;
  displayName: string | null;
  /** Live auto-record (otobanana poller). */
  enabled: boolean;
  /** VOD author works discovery via listAuthorWorks in full sync. */
  syncWorks: boolean;
  lastOnairAt: string | null;
  lastRoomId: string | null;
  lastCheckAt: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Local author profile for author page (`GET /api/authors/:provider/:authorId`). */
export interface AuthorPublic {
  provider: ProviderId;
  authorId: string;
  displayName: string | null;
  username: string | null;
  hasAvatar: boolean;
  subscription: LiveSubscriptionPublic | null;
}

/** Candidate from GET /api/authors/search (manual subscribe add). */
export interface AuthorSearchHit {
  provider: ProviderId;
  authorId: string;
  username: string | null;
  displayName: string | null;
}

/** Result of seeding subscriptions from platform follow lists. */
export interface SubscriptionImportProviderResult {
  provider: ProviderId;
  imported: number;
  existing: number;
  fetched: number;
  /** Set when follow list unavailable (e.g. no account / no API). */
  skipped?: string | null;
  error?: string | null;
}

export interface SubscriptionImportResult {
  providers: SubscriptionImportProviderResult[];
  totalImported: number;
}

export interface LiveRecordJobPublic {
  id: number;
  provider: ProviderId;
  authorId: string;
  authorUsername: string | null;
  authorDisplayName: string | null;
  roomId: string;
  postPtrId: string | null;
  streamService: string | null;
  title: string | null;
  state: LiveJobState;
  startedAt: string | null;
  endedAt: string | null;
  mediaRelPath: string | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface LiveOnairPublic {
  roomId: string;
  authorId: string;
  username: string | null;
  displayName: string | null;
  title: string | null;
  postPtrId: string | null;
  streamService: string | null;
  isOpen: boolean;
  isAdult: boolean | null;
  listenerCount: number | null;
  roomOpenAt: string | null;
  roomCloseAt?: string | null;
  selected: boolean;
  recordState?: LiveJobState | null;
  recordJobId?: number | null;
  recordError?: string | null;
}

export interface LiveFolloweeSessionPublic {
  roomId: string;
  title: string | null;
  postPtrId: string | null;
  streamService: string | null;
  isOpen: boolean;
  isAdult: boolean | null;
  listenerCount: number | null;
  roomOpenAt: string | null;
  roomCloseAt: string | null;
  recordState: LiveJobState | null;
  recordJobId: number | null;
  recordError: string | null;
}

export interface LiveFolloweeAuthorPublic {
  authorId: string;
  username: string | null;
  displayName: string | null;
  selected: boolean;
  liveNow: boolean;
  sessions: LiveFolloweeSessionPublic[];
}

/** Local-cache read model for Live page history panel. */
export interface LiveFolloweeHistoryPublic {
  authors: LiveFolloweeAuthorPublic[];
  /** Last successful background sync time (ISO-ish SQL datetime). */
  syncedAt: string | null;
  lastError: string | null;
  /** True while a background sync is in flight. */
  syncing: boolean;
}

/** Library entry for a completed live recording (parallel to WorkPublic). */
export interface LiveMediaPublic {
  id: number;
  kind: "live";
  provider: ProviderId;
  roomId: string;
  authorId: string;
  authorName: string | null;
  title: string | null;
  jobId: number | null;
  audioExt: string;
  mediaRelPath: string;
  bytes: number | null;
  durationSeconds: number | null;
  recordedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export const PROVIDER_IDS: ProviderId[] = ["otobanana", "koekoe", "erovoice"];
